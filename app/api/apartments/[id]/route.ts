import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Fetch apartment with nearest station info
    const aptResult = await db.execute({
      sql: `
        SELECT
          a.*,
          s.id as station_id,
          s.name as station_name,
          s.travel_time_to_montgomery,
          s.fare_to_montgomery,
          s.monthly_commute_cost,
          latest_crime.safety_score
        FROM apartments a
        LEFT JOIN bart_stations s ON s.id = a.nearest_station_id
        LEFT JOIN crime_stats latest_crime ON latest_crime.station_id = s.id
          AND latest_crime.id = (
            SELECT id FROM crime_stats
            WHERE station_id = s.id
            ORDER BY data_year DESC, data_month DESC
            LIMIT 1
          )
        WHERE a.id = ?
      `,
      args: [id],
    });

    if (aptResult.rows.length === 0) {
      return NextResponse.json(
        { error: "Apartment not found" },
        { status: 404 }
      );
    }

    const row = aptResult.rows[0];

    // Fetch floor plans
    const fpResult = await db.execute({
      sql: `SELECT * FROM floor_plans WHERE apartment_id = ? ORDER BY bedrooms, price_min`,
      args: [id],
    });

    const floorPlans = fpResult.rows.map((fp) => ({
      id: fp.id,
      name: fp.name,
      bedrooms: fp.bedrooms,
      bathrooms: fp.bathrooms,
      sqftMin: fp.sqft_min,
      sqftMax: fp.sqft_max,
      priceMin: fp.price_min,
      priceMax: fp.price_max,
      availableUnits: fp.available_units,
      floorPlanUrl: fp.floor_plan_url,
    }));

    // Fetch price history for last 90 days, grouped by floor_plan_id
    const floorPlanIds = fpResult.rows.map((fp) => fp.id);
    const priceHistory: Record<string, Array<{ priceMin: number; priceMax: number; availableUnits: number | null; recordedAt: string }>> = {};

    if (floorPlanIds.length > 0) {
      const placeholders = floorPlanIds.map(() => "?").join(",");
      const phResult = await db.execute({
        sql: `
          SELECT * FROM price_history
          WHERE floor_plan_id IN (${placeholders})
            AND recorded_at >= datetime('now', '-90 days')
          ORDER BY recorded_at
        `,
        args: floorPlanIds as number[],
      });

      for (const ph of phResult.rows) {
        const key = String(ph.floor_plan_id);
        if (!priceHistory[key]) priceHistory[key] = [];
        priceHistory[key].push({
          priceMin: ph.price_min as number,
          priceMax: ph.price_max as number,
          availableUnits: ph.available_units as number | null,
          recordedAt: ph.recorded_at as string,
        });
      }
    }

    const apartment = {
      id: row.id,
      name: row.name,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      websiteUrl: row.website_url,
      phone: row.phone,
      walkMinToBart: row.walk_min_to_bart,
      hasInUnitWd: !!row.has_in_unit_wd,
      hasDishwasher: !!row.has_dishwasher,
      hasParking: !!row.has_parking,
      parkingType: row.parking_type,
      hasGym: !!row.has_gym,
      hasPool: !!row.has_pool,
      petFriendly: !!row.pet_friendly,
      yearBuilt: row.year_built,
      amenities: row.amenities_json
        ? JSON.parse(row.amenities_json as string)
        : null,
      floorPlans,
      priceHistory,
      nearestStation: row.station_id
        ? {
            id: row.station_id,
            name: row.station_name,
            travelTimeMin: row.travel_time_to_montgomery,
            fareCents: row.fare_to_montgomery,
            monthlyCommuteCost: row.monthly_commute_cost,
            safetyScore: row.safety_score,
          }
        : null,
    };

    return NextResponse.json(
      { apartment },
      {
        headers: {
          "Cache-Control": "public, max-age=3600",
        },
      }
    );
  } catch (error) {
    console.error("GET /api/apartments/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch apartment" },
      { status: 500 }
    );
  }
}
