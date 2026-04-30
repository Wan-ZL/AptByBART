import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { childLogger } from "@/lib/logger";

const log = childLogger("api:apartments");

export async function GET(request: NextRequest) {
  const started = Date.now();
  log.info(
    { method: request.method, url: request.nextUrl.pathname + request.nextUrl.search },
    "request"
  );
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
      2000,
      Math.max(1, parseInt(searchParams.get("limit") || "2000", 10))
    );
    const offset = (page - 1) * limit;

    const conditions: string[] = [
      "a.lat BETWEEN ? AND ?",
      "a.lng BETWEEN ? AND ?",
      "a.website_url IS NOT NULL AND a.website_url != ''",
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
      conditions.push("ss.score >= ?");
      args.push(Number(minSafety));
    }

    const whereClause = conditions.length
      ? "WHERE " + conditions.join(" AND ")
      : "";

    // safety_scores is joined on apartments.geo_area_id (populated by
    // scripts/backfill-apartment-geo-areas.ts via point-in-polygon), replacing
    // the legacy crime_stats.station_id path that broadcast a city-level total
    // to every station in the city (misattribution bug).
    const countResult = await db.execute({
      sql: `
        SELECT COUNT(DISTINCT a.id) as total
        FROM apartments a
        LEFT JOIN floor_plans fp ON fp.apartment_id = a.id
        LEFT JOIN bart_stations s ON s.id = a.nearest_station_id
        LEFT JOIN safety_scores ss ON ss.geo_area_id = a.geo_area_id
        ${whereClause}
      `,
      args,
    });
    const total = Number(countResult.rows[0].total);

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
          ss.score as safety_score
        FROM apartments a
        LEFT JOIN floor_plans fp ON fp.apartment_id = a.id
        LEFT JOIN bart_stations s ON s.id = a.nearest_station_id
        LEFT JOIN safety_scores ss ON ss.geo_area_id = a.geo_area_id
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

    log.info(
      {
        status: 200,
        durationMs: Date.now() - started,
        total,
        returned: apartments.length,
        page,
      },
      "response"
    );
    return NextResponse.json(
      { apartments, total, page },
      {
        headers: {
          "Cache-Control": "public, max-age=3600",
        },
      }
    );
  } catch (error) {
    log.error(
      { err: error, durationMs: Date.now() - started },
      "handler error"
    );
    return NextResponse.json(
      { error: "Failed to fetch apartments" },
      { status: 500 }
    );
  }
}
