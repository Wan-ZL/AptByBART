import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { computeSafetyScores } from "@/lib/safety-scoring";
import type { AreaCrimeCounts } from "@/lib/safety-scoring";
import type { SafetyWeights } from "@/lib/crime-taxonomy";
import { DEFAULT_WEIGHTS } from "@/lib/crime-taxonomy";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const weightsParam = searchParams.get("weights");
    const granularity = searchParams.get("granularity");
    const validGranularities = ["city", "neighborhood", "beat", "county", "tract"];
    const filterByGranularity = granularity && validGranularities.includes(granularity) ? granularity : null;

    let weights: SafetyWeights = DEFAULT_WEIGHTS;
    let customWeights = false;

    if (weightsParam) {
      const parts = weightsParam.split(",").map(Number);
      if (parts.length === 4 && parts.every((n) => !isNaN(n) && n >= 0)) {
        weights = {
          violent: parts[0],
          property: parts[1],
          vehicle: parts[2],
          qualityOfLife: parts[3],
        };
        customWeights = true;
      }
    }

    // Fetch safety scores joined with geo areas
    const result = filterByGranularity
      ? await db.execute({
          sql: `
            SELECT ss.*, ga.name, ga.area_type, ga.parent_area_id, ga.centroid_lat, ga.centroid_lng, ga.population
            FROM safety_scores ss
            JOIN geo_areas ga ON ss.geo_area_id = ga.id
            WHERE ga.area_type = ?
            ORDER BY ga.area_type, ga.name
          `,
          args: [filterByGranularity],
        })
      : await db.execute(`
          SELECT ss.*, ga.name, ga.area_type, ga.parent_area_id, ga.centroid_lat, ga.centroid_lng, ga.population
          FROM safety_scores ss
          JOIN geo_areas ga ON ss.geo_area_id = ga.id
          ORDER BY ga.area_type, ga.name
        `);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { areas: [], weights, lastUpdated: new Date().toISOString() },
        {
          headers: {
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          },
        }
      );
    }

    // Fetch which sources contributed to each area
    const sourcesResult = await db.execute(`
      SELECT DISTINCT geo_area_id, source_id FROM crime_observations
    `);

    const sourcesByArea = new Map<string, string[]>();
    for (const row of sourcesResult.rows) {
      const areaId = row.geo_area_id as string;
      const sourceId = row.source_id as string;
      if (!sourcesByArea.has(areaId)) sourcesByArea.set(areaId, []);
      sourcesByArea.get(areaId)!.push(sourceId);
    }

    let scoresByArea: Map<string, { score: number; percentile: number }> | null = null;

    if (customWeights) {
      // Recompute scores with custom weights using per-source normalization
      const areaCounts = new Map<string, AreaCrimeCounts>();
      for (const row of result.rows) {
        areaCounts.set(row.geo_area_id as string, {
          violent: (row.violent_count as number) || 0,
          property: (row.property_count as number) || 0,
          vehicle: (row.vehicle_count as number) || 0,
          qualityOfLife: (row.quality_of_life_count as number) || 0,
          population: (row.population as number) || undefined,
        });
      }

      // Fetch per-source observations for per-source percentile normalization
      const obsResult = await db.execute(`
        SELECT source_id, geo_area_id, category, SUM(incident_count) as total
        FROM crime_observations
        GROUP BY source_id, geo_area_id, category
      `);

      const perSourceData = new Map<string, Map<string, AreaCrimeCounts>>();
      for (const row of obsResult.rows) {
        const sourceId = row.source_id as string;
        const areaId = row.geo_area_id as string;
        const category = row.category as string;
        const count = row.total as number;

        if (!perSourceData.has(sourceId)) perSourceData.set(sourceId, new Map());
        const sourceMap = perSourceData.get(sourceId)!;
        if (!sourceMap.has(areaId)) {
          sourceMap.set(areaId, { violent: 0, property: 0, vehicle: 0, qualityOfLife: 0 });
        }
        const counts = sourceMap.get(areaId)!;
        switch (category) {
          case 'violent': counts.violent += count; break;
          case 'property': counts.property += count; break;
          case 'vehicle': counts.vehicle += count; break;
          case 'quality_of_life': counts.qualityOfLife += count; break;
        }
      }

      // Attach population to per-source counts
      for (const [, sourceMap] of perSourceData) {
        for (const [areaId, counts] of sourceMap) {
          const pop = areaCounts.get(areaId)?.population;
          if (pop) counts.population = pop;
        }
      }

      scoresByArea = computeSafetyScores(areaCounts, weights, perSourceData);
    }

    let lastUpdated = new Date().toISOString();
    const areas = result.rows.map((row) => {
      const geoAreaId = row.geo_area_id as string;
      const customResult = customWeights ? scoresByArea!.get(geoAreaId) : null;
      const score = customResult
        ? customResult.score
        : ((row.score as number) ?? 5);
      const percentileRank = customResult
        ? customResult.percentile
        : ((row.percentile_rank as number) ?? null);

      if (row.updated_at) {
        const rowDate = row.updated_at as string;
        if (rowDate > lastUpdated) {
          lastUpdated = rowDate;
        }
      }

      return {
        id: geoAreaId,
        name: row.name as string,
        type: row.area_type as string,
        parentId: (row.parent_area_id as string) || null,
        score: Math.round(score * 10) / 10,
        percentileRank,
        counts: {
          violent: (row.violent_count as number) || 0,
          property: (row.property_count as number) || 0,
          vehicle: (row.vehicle_count as number) || 0,
          qualityOfLife: (row.quality_of_life_count as number) || 0,
        },
        population: (row.population as number) || null,
        perCapitaRate: (() => {
          const pop = (row.population as number) || 0;
          const total = ((row.violent_count as number) || 0) + ((row.property_count as number) || 0) +
                        ((row.vehicle_count as number) || 0) + ((row.quality_of_life_count as number) || 0);
          return pop > 0 ? Math.round((total / pop) * 10000 * 10) / 10 : null;
        })(),
        dataGranularity: (row.area_type as string) === 'tract' ? 'inherited' : 'direct',
        sources: sourcesByArea.get(geoAreaId) || [],
        centroidLat: (row.centroid_lat as number) || 0,
        centroidLng: (row.centroid_lng as number) || 0,
      };
    });

    return NextResponse.json(
      { areas, weights, lastUpdated },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch (error) {
    // Handle case where tables don't exist yet
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { areas: [], weights: DEFAULT_WEIGHTS, lastUpdated: new Date().toISOString() },
        {
          headers: {
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          },
        }
      );
    }
    console.error("GET /api/safety error:", error);
    return NextResponse.json(
      { error: "Failed to fetch safety data" },
      { status: 500 }
    );
  }
}
