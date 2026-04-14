import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ areaId: string }> }
) {
  try {
    const { areaId } = await params;

    const result = await db.execute({
      sql: `
        SELECT period_start, category, SUM(incident_count) as total
        FROM crime_observations
        WHERE geo_area_id = ?
        GROUP BY period_start, category
        ORDER BY period_start
      `,
      args: [areaId],
    });

    // Pivot rows into monthly buckets
    const monthMap = new Map<
      string,
      { period: string; violent: number; property: number; vehicle: number; qol: number; total: number }
    >();

    for (const row of result.rows) {
      const period = row.period_start as string;
      if (!monthMap.has(period)) {
        monthMap.set(period, { period, violent: 0, property: 0, vehicle: 0, qol: 0, total: 0 });
      }
      const bucket = monthMap.get(period)!;
      const count = (row.total as number) || 0;
      const cat = row.category as string;

      if (cat === "violent") bucket.violent += count;
      else if (cat === "property") bucket.property += count;
      else if (cat === "vehicle") bucket.vehicle += count;
      else if (cat === "quality_of_life") bucket.qol += count;

      bucket.total += count;
    }

    const months = Array.from(monthMap.values());

    return NextResponse.json(
      { areaId, months },
      {
        headers: {
          "Cache-Control": "public, max-age=86400",
        },
      }
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("no such table")) {
      return NextResponse.json(
        { areaId: "", months: [] },
        {
          headers: {
            "Cache-Control": "public, max-age=86400",
          },
        }
      );
    }
    console.error("GET /api/safety/[areaId]/trend error:", error);
    return NextResponse.json(
      { error: "Failed to fetch trend data" },
      { status: 500 }
    );
  }
}
