'use client';

import { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useAppStore } from '@/lib/store';

function createCirclePolygon(
  lng: number,
  lat: number,
  radiusMeters: number,
  numPoints: number = 32,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const earthRadius = 6371000;
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    const dLat = (radiusMeters / earthRadius) * Math.cos(angle);
    const dLng =
      (radiusMeters / (earthRadius * Math.cos((lat * Math.PI) / 180))) *
      Math.sin(angle);
    coords.push([lng + (dLng * 180) / Math.PI, lat + (dLat * 180) / Math.PI]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

function safetyColor(score: number): string {
  if (score >= 8) return '#22c55e';
  if (score >= 6) return '#eab308';
  if (score >= 4) return '#f97316';
  return '#ef4444';
}

export default function SafetyOverlay() {
  const citySafety = useAppStore((s) => s.citySafety);
  const visible = useAppStore((s) => s.safetyOverlayVisible);
  const radius = useAppStore((s) => s.safetyRadius);

  // Cities WITH data — filled circles
  const filledGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => {
    const features = citySafety
      .filter((c) => c.safetyScore != null && c.safetyScore > 0)
      .map((c) => {
        const feature = createCirclePolygon(c.lng, c.lat, radius);
        feature.properties = {
          color: safetyColor(c.safetyScore!),
          city: c.city,
        };
        return feature;
      });
    return { type: 'FeatureCollection', features };
  }, [citySafety, radius]);

  // Cities WITHOUT data — outline-only circles
  const outlineGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => {
    const features = citySafety
      .filter((c) => c.safetyScore == null || c.safetyScore === 0)
      .map((c) => {
        const feature = createCirclePolygon(c.lng, c.lat, radius);
        feature.properties = { city: c.city };
        return feature;
      });
    return { type: 'FeatureCollection', features };
  }, [citySafety, radius]);

  if (!visible) return null;

  return (
    <>
      {/* Filled circles for cities with data */}
      <Source id="safety-overlay" type="geojson" data={filledGeoJSON}>
        <Layer
          id="safety-overlay-fill"
          type="fill"
          paint={{
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.35,
          }}
        />
      </Source>

      {/* Outline-only circles for cities without data */}
      <Source id="safety-overlay-nodata" type="geojson" data={outlineGeoJSON}>
        <Layer
          id="safety-overlay-nodata-outline"
          type="line"
          paint={{
            'line-color': '#9ca3af',
            'line-width': 1.5,
            'line-dasharray': [4, 3],
          }}
        />
      </Source>
    </>
  );
}

export function SafetyToggleButton() {
  const visible = useAppStore((s) => s.safetyOverlayVisible);
  const toggle = useAppStore((s) => s.toggleSafetyOverlay);

  return (
    <button
      onClick={toggle}
      className={`absolute top-3 left-3 z-10 rounded-lg px-3 py-1.5 text-sm font-medium shadow-md transition-colors ${
        visible
          ? 'bg-green-600 text-white'
          : 'bg-white text-gray-700 hover:bg-gray-100'
      }`}
    >
      Safety: {visible ? 'ON' : 'OFF'}
    </button>
  );
}

export function SafetyLegend() {
  const visible = useAppStore((s) => s.safetyOverlayVisible);
  const radius = useAppStore((s) => s.safetyRadius);
  const setRadius = useAppStore((s) => s.setSafetyRadius);

  if (!visible) return null;

  return (
    <div className="absolute bottom-8 left-3 bg-white/90 backdrop-blur-sm rounded-lg shadow-md px-3 py-2 text-xs z-10">
      <div className="font-medium text-gray-700 mb-1">Safety Score</div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#22c55e]" /> 8-10 Safest</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#eab308]" /> 6-8 Moderate</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#f97316]" /> 4-6 Caution</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#ef4444]" /> 1-4 Higher Risk</div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full border border-gray-400 border-dashed" />
          No data
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-gray-200">
        <div className="flex items-center justify-between mb-1">
          <span className="text-gray-600">Radius</span>
          <span className="text-gray-500">{(radius / 1000).toFixed(1)} km</span>
        </div>
        <input
          type="range"
          min={1000}
          max={15000}
          step={500}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="w-full h-1 bg-gray-300 rounded-full appearance-none cursor-pointer accent-blue-500"
        />
      </div>
    </div>
  );
}
