import { NextResponse } from "next/server";
import { db } from "@/db/client";

export async function GET() {
  try {
    const result = await db.execute(`
      SELECT
        s.id,
        s.name,
        s.lat,
        s.lng,
        s.line_colors,
        s.travel_time_to_montgomery,
        s.fare_to_montgomery,
        s.monthly_commute_cost,
        cs.safety_score
      FROM bart_stations s
      LEFT JOIN crime_stats cs ON cs.station_id = s.id
        AND cs.id = (
          SELECT id FROM crime_stats
          WHERE station_id = s.id
          ORDER BY data_year DESC, data_month DESC
          LIMIT 1
        )
      ORDER BY s.name
    `);

    const stations = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      lineColors: row.line_colors ? JSON.parse(row.line_colors as string) : [],
      travelTimeMin: row.travel_time_to_montgomery,
      fareCents: row.fare_to_montgomery,
      monthlyCommuteCost: row.monthly_commute_cost,
      safetyScore: row.safety_score,
    }));

    // City-level safety: one entry per city with centroid coordinates
    const cityResult = await db.execute(`
      SELECT
        s.city,
        AVG(s.lat) as lat,
        AVG(s.lng) as lng,
        cs.safety_score,
        cs.violent_crime_count,
        cs.property_crime_count,
        cs.vehicle_crime_count
      FROM bart_stations s
      LEFT JOIN crime_stats cs ON cs.station_id = s.id
        AND cs.id = (
          SELECT id FROM crime_stats
          WHERE station_id = s.id
          ORDER BY data_year DESC, data_month DESC
          LIMIT 1
        )
      WHERE s.city IS NOT NULL
      GROUP BY s.city
    `);

    const citySafety = cityResult.rows.map((row) => {
      const v = (row.violent_crime_count as number) || 0;
      const p = (row.property_crime_count as number) || 0;
      const ve = (row.vehicle_crime_count as number) || 0;
      const hasData = v + p + ve > 0;
      return {
        city: row.city,
        lat: row.lat,
        lng: row.lng,
        safetyScore: hasData ? row.safety_score : null,
      };
    });

    return NextResponse.json(
      { stations, citySafety },
      {
        headers: {
          "Cache-Control":
            "public, max-age=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch (error) {
    console.error("GET /api/stations error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stations" },
      { status: 500 }
    );
  }
}
