import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";

const GRANULARITY_PRIORITY: Record<string, number> = {
  beat: 0,
  neighborhood: 1,
  city: 2,
  county: 3,
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify apartment exists
    const aptCheck = await db.execute({
      sql: `SELECT id FROM apartments WHERE id = ?`,
      args: [id],
    });

    if (aptCheck.rows.length === 0) {
      return NextResponse.json(
        { error: "Apartment not found" },
        { status: 404 }
      );
    }

    // Fetch all geo_areas for this apartment with safety scores
    const result = await db.execute({
      sql: `
        SELECT ga.id, ga.name, ga.area_type, ga.parent_area_id,
               ss.score, ss.violent_count, ss.property_count, ss.vehicle_count,
               ss.quality_of_life_count, ss.percentile_rank
        FROM apartment_geo_areas aga
        JOIN geo_areas ga ON aga.geo_area_id = ga.id
        LEFT JOIN safety_scores ss ON ss.geo_area_id = ga.id
        WHERE aga.apartment_id = ?
      `,
      args: [id],
    });

    const scores = result.rows.map((row) => ({
      areaId: row.id as string,
      areaName: row.name as string,
      areaType: row.area_type as string,
      score: row.score != null ? (row.score as number) : null,
      percentile: row.percentile_rank != null ? (row.percentile_rank as number) : null,
      counts: {
        violent: (row.violent_count as number) || 0,
        property: (row.property_count as number) || 0,
        vehicle: (row.vehicle_count as number) || 0,
        qualityOfLife: (row.quality_of_life_count as number) || 0,
      },
    }));

    // Find most granular area with a score (beat > neighborhood > city > county)
    const withScores = scores.filter((s) => s.score != null);
    withScores.sort(
      (a, b) =>
        (GRANULARITY_PRIORITY[a.areaType] ?? 99) -
        (GRANULARITY_PRIORITY[b.areaType] ?? 99)
    );

    const best = withScores[0] ?? null;

    return NextResponse.json(
      {
        apartmentId: Number(id),
        scores,
        bestAvailable: best
          ? {
              score: best.score,
              areaName: best.areaName,
              areaType: best.areaType,
              percentile: best.percentile,
            }
          : null,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { scores: [], bestAvailable: null },
        {
          headers: {
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          },
        }
      );
    }
    console.error("GET /api/apartments/[id]/safety error:", error);
    return NextResponse.json(
      { error: "Failed to fetch safety data" },
      { status: 500 }
    );
  }
}
