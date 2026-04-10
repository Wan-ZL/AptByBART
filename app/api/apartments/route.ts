import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;

    const bbox = searchParams.get("bbox");
    if (!bbox) {
      return NextResponse.json(
        { error: "bbox parameter is required (sw_lat,sw_lng,ne_lat,ne_lng)" },
        { status: 400 }
      );
    }

    const [swLat, swLng, neLat, neLng] = bbox.split(",").map(Number);
    if ([swLat, swLng, neLat, neLng].some(isNaN)) {
      return NextResponse.json(
        { error: "bbox must contain 4 valid numbers" },
        { status: 400 }
      );
    }

    const bedrooms = searchParams.get("bedrooms");
    const maxPrice = searchParams.get("max_price");
    const minPrice = searchParams.get("min_price");
    const hasInUnitWd = searchParams.get("has_in_unit_wd");
    const hasDishwasher = searchParams.get("has_dishwasher");
    const hasParking = searchParams.get("has_parking");
    const maxCommute = searchParams.get("max_commute");
    const minSafety = searchParams.get("min_safety");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      200,
      Math.max(1, parseInt(searchParams.get("limit") || "100", 10))
    );
    const offset = (page - 1) * limit;

    const conditions: string[] = [
      "a.lat BETWEEN ? AND ?",
      "a.lng BETWEEN ? AND ?",
    ];
    const args: (string | number)[] = [swLat, neLat, swLng, neLng];

    if (bedrooms) {
      conditions.push(
        "EXISTS (SELECT 1 FROM floor_plans fp2 WHERE fp2.apartment_id = a.id AND fp2.bedrooms = ?)"
      );
      args.push(Number(bedrooms));
    }

    if (maxPrice) {
      conditions.push(
        "EXISTS (SELECT 1 FROM floor_plans fp3 WHERE fp3.apartment_id = a.id AND fp3.price_min <= ?)"
      );
      args.push(Number(maxPrice));
    }

    if (minPrice) {
      conditions.push(
        "EXISTS (SELECT 1 FROM floor_plans fp4 WHERE fp4.apartment_id = a.id AND fp4.price_min >= ?)"
      );
      args.push(Number(minPrice));
    }

    if (hasInUnitWd === "true") conditions.push("a.has_in_unit_wd = 1");
    if (hasDishwasher === "true") conditions.push("a.has_dishwasher = 1");
    if (hasParking === "true") conditions.push("a.has_parking = 1");

    if (maxCommute) {
      conditions.push("s.travel_time_to_montgomery <= ?");
      args.push(Number(maxCommute));
    }

    if (minSafety) {
      conditions.push("latest_crime.safety_score >= ?");
      args.push(Number(minSafety));
    }

    const whereClause = conditions.length
      ? "WHERE " + conditions.join(" AND ")
      : "";

    // Count query
    const countResult = await db.execute({
      sql: `
        SELECT COUNT(DISTINCT a.id) as total
        FROM apartments a
        LEFT JOIN floor_plans fp ON fp.apartment_id = a.id
        LEFT JOIN bart_stations s ON s.id = a.nearest_station_id
        LEFT JOIN crime_stats latest_crime ON latest_crime.station_id = s.id
          AND latest_crime.id = (
            SELECT id FROM crime_stats
            WHERE station_id = s.id
            ORDER BY data_year DESC, data_month DESC
            LIMIT 1
          )
        ${whereClause}
      `,
      args,
    });
    const total = Number(countResult.rows[0].total);

    // Data query
    const dataResult = await db.execute({
      sql: `
        SELECT DISTINCT
          a.id,
          a.name,
          a.address,
          a.lat,
          a.lng,
          a.website_url,
          a.phone,
          a.nearest_station_id,
          a.walk_min_to_bart,
          a.has_in_unit_wd,
          a.has_dishwasher,
          a.has_parking,
          a.parking_type,
          a.has_gym,
          a.has_pool,
          a.pet_friendly,
          a.year_built,
          a.scrape_status,
          MIN(fp.price_min) as min_price,
          MAX(fp.price_max) as max_price,
          GROUP_CONCAT(DISTINCT fp.bedrooms) as bedroom_types,
          s.name as station_name,
          s.travel_time_to_montgomery,
          s.fare_to_montgomery,
          latest_crime.safety_score
        FROM apartments a
        LEFT JOIN floor_plans fp ON fp.apartment_id = a.id
        LEFT JOIN bart_stations s ON s.id = a.nearest_station_id
        LEFT JOIN crime_stats latest_crime ON latest_crime.station_id = s.id
          AND latest_crime.id = (
            SELECT id FROM crime_stats
            WHERE station_id = s.id
            ORDER BY data_year DESC, data_month DESC
            LIMIT 1
          )
        ${whereClause}
        GROUP BY a.id
        ORDER BY a.name
        LIMIT ? OFFSET ?
      `,
      args: [...args, limit, offset],
    });

    const apartments = dataResult.rows.map((row) => ({
      id: row.id,
      name: row.name,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      websiteUrl: row.website_url,
      phone: row.phone,
      nearestStationId: row.nearest_station_id,
      walkMinToBart: row.walk_min_to_bart,
      hasInUnitWd: !!row.has_in_unit_wd,
      hasDishwasher: !!row.has_dishwasher,
      hasParking: !!row.has_parking,
      parkingType: row.parking_type,
      hasGym: !!row.has_gym,
      hasPool: !!row.has_pool,
      petFriendly: !!row.pet_friendly,
      yearBuilt: row.year_built,
      scrapeStatus: row.scrape_status || 'pending',
      minPrice: row.min_price ?? null,
      maxPrice: row.max_price ?? null,
      bedroomTypes: row.bedroom_types
        ? (row.bedroom_types as string).split(',').map(Number).filter((n) => !isNaN(n))
        : [],
      stationName: row.station_name,
      travelTimeMin: row.travel_time_to_montgomery,
      fareCents: row.fare_to_montgomery,
      safetyScore: row.safety_score,
    }));

    return NextResponse.json(
      { apartments, total, page },
      {
        headers: {
          "Cache-Control": "public, max-age=3600",
        },
      }
    );
  } catch (error) {
    console.error("GET /api/apartments error:", error);
    return NextResponse.json(
      { error: "Failed to fetch apartments" },
      { status: 500 }
    );
  }
}
