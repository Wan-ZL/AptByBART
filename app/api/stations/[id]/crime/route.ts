import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { childLogger } from "@/lib/logger";

const log = childLogger("api:stations:id:crime");

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const started = Date.now();
  try {
    const { id } = await params;
    log.info({ method: "GET", url: `/api/stations/${id}/crime` }, "request");

    const result = await db.execute({
      sql: `
        SELECT
          data_year,
          data_month,
          violent_crime_count,
          property_crime_count,
          vehicle_crime_count,
          total_incidents,
          safety_score
        FROM crime_stats
        WHERE station_id = ?
        ORDER BY data_year DESC, data_month DESC
        LIMIT 12
      `,
      args: [id],
    });

    const months = result.rows.map((row) => ({
      year: row.data_year,
      month: row.data_month,
      violent: row.violent_crime_count,
      property: row.property_crime_count,
      vehicle: row.vehicle_crime_count,
      total: row.total_incidents,
      safetyScore: row.safety_score,
    }));

    log.info(
      {
        status: 200,
        durationMs: Date.now() - started,
        id,
        monthCount: months.length,
      },
      "response"
    );
    return NextResponse.json(
      { stationId: id, months },
      {
        headers: {
          "Cache-Control":
            "public, max-age=86400, stale-while-revalidate=604800",
        },
      }
    );
  } catch (error) {
    log.error(
      { err: error, durationMs: Date.now() - started },
      "handler error"
    );
    return NextResponse.json(
      { error: "Failed to fetch crime stats" },
      { status: 500 }
    );
  }
}
