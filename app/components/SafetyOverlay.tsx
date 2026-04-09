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
  const stations = useAppStore((s) => s.stations);
  const visible = useAppStore((s) => s.safetyOverlayVisible);

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features = stations
      .filter((s) => s.safetyScore != null)
      .map((s) => {
        const feature = createCirclePolygon(s.lng, s.lat, 800);
        feature.properties = {
          color: safetyColor(s.safetyScore!),
          stationId: s.id,
        };
        return feature;
      });
    return { type: 'FeatureCollection', features };
  }, [stations]);

  if (!visible) return null;

  return (
    <Source id="safety-overlay" type="geojson" data={geojson}>
      <Layer
        id="safety-overlay-fill"
        type="fill"
        paint={{
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.25,
        }}
      />
    </Source>
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
  if (!visible) return null;

  return (
    <div className="absolute bottom-8 left-3 bg-white/90 backdrop-blur-sm rounded-lg shadow-md px-3 py-2 text-xs z-10">
      <div className="font-medium text-gray-700 mb-1">Safety Score</div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#22c55e]" /> 8-10 Safest</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#eab308]" /> 6-8 Moderate</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#f97316]" /> 4-6 Caution</div>
        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#ef4444]" /> 1-4 Higher Risk</div>
      </div>
    </div>
  );
}
