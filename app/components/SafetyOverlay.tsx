'use client';

import { useState, useEffect, useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useAppStore } from '@/lib/store';
import type { SafetyArea } from '@/lib/types';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const NO_DATA_FILL = '#9ca3af';
const NO_DATA_STROKE = '#6b7280';

const IS_NO_DATA: maplibregl.ExpressionSpecification = ['==', ['get', 'score'], null];

// Score scale: 0 = safest (deep blue) → 0.5 = mid (yellow) → 1 = most dangerous (deep red).
const FILL_COLOR: maplibregl.ExpressionSpecification = [
  'case',
  IS_NO_DATA, NO_DATA_FILL,
  [
    'interpolate', ['linear'], ['to-number', ['get', 'score'], 0.5],
    0, '#1e40af',
    0.5, '#eab308',
    1, '#b91c1c',
  ],
];

const LINE_COLOR: maplibregl.ExpressionSpecification = [
  'case',
  IS_NO_DATA, NO_DATA_STROKE,
  [
    'interpolate', ['linear'], ['to-number', ['get', 'score'], 0.5],
    0, '#1e3a8a',
    0.5, '#ca8a04',
    1, '#7f1d1d',
  ],
];

// Opacity scales with score presence. No-data gets flat 0.4; scored tracts get 0.6.
const FILL_OPACITY: maplibregl.ExpressionSpecification = [
  'case',
  IS_NO_DATA, 0.4,
  0.6,
];

const LINE_WIDTH: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  8, 0.5,
  12, 1.5,
  16, 2.5,
];

const TRACT_FILTER: maplibregl.ExpressionSpecification = ['==', ['get', 'areaType'], 'tract'];

const FILL_PAINT = {
  'fill-color': FILL_COLOR,
  'fill-opacity': FILL_OPACITY,
} as const;

const LINE_PAINT = {
  'line-color': LINE_COLOR,
  'line-width': LINE_WIDTH,
  'line-opacity': 0.8,
} as const;

function enrichFeatures(
  geojson: GeoJSON.FeatureCollection | null,
  safetyAreas: SafetyArea[]
): GeoJSON.FeatureCollection {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  if (!geojson) return empty;

  const areaMap = new Map<string, SafetyArea>();
  for (const a of safetyAreas) areaMap.set(a.id, a);

  const features: GeoJSON.Feature[] = [];
  for (const feature of geojson.features) {
    if (feature.properties?.areaType !== 'tract') continue;
    const areaId = feature.properties?.areaId;
    if (!areaId) continue;

    const matched = areaMap.get(areaId);
    features.push({
      ...feature,
      properties: {
        ...feature.properties,
        score: matched?.score ?? null,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

export default function SafetyOverlay() {
  const safetyAreas = useAppStore((s) => s.safetyAreas);
  const visible = useAppStore((s) => s.safetyOverlayVisible);
  const [geojson, setGeojson] = useState<GeoJSON.FeatureCollection | null>(null);

  useEffect(() => {
    fetch(`${basePath}/unified-safety.geojson`)
      .then((r) => r.json())
      .then(setGeojson)
      .catch((e) => console.warn('Failed to load unified-safety.geojson', e));
  }, []);

  const data = useMemo(
    () => enrichFeatures(geojson, safetyAreas),
    [geojson, safetyAreas]
  );

  const vis = visible ? 'visible' : 'none';

  return (
    <Source id="safety-unified" type="geojson" data={data}>
      <Layer id="safety-fill-tract" type="fill" filter={TRACT_FILTER} layout={{ visibility: vis }} paint={FILL_PAINT} />
      <Layer id="safety-stroke-tract" type="line" filter={TRACT_FILTER} layout={{ visibility: vis }} paint={LINE_PAINT} />
      <Layer
        id="safety-labels"
        type="symbol"
        filter={['!', IS_NO_DATA]}
        layout={{
          visibility: vis,
          'text-field': ['get', 'areaName'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 12],
          'text-anchor': 'center',
          'text-allow-overlap': false,
          'text-font': ['Noto Sans Regular'],
        }}
        paint={{
          'text-color': '#6b7280',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 0.35, 13, 0.5],
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
  const safetyPreset = useAppStore((s) => s.safetyPreset);

  if (!visible) return null;

  const presetLabels: Record<string, string> = {
    balanced: 'Balanced',
    personal_safety: 'Personal Safety',
    protect_my_stuff: 'Protect My Stuff',
    night_owl: 'Night Owl',
    custom: 'Custom',
  };

  return (
    <div className="absolute bottom-8 left-3 bg-white/90 backdrop-blur-sm rounded-lg shadow-md px-3 py-2 text-xs z-10">
      <div className="font-medium text-gray-700 mb-1.5">
        Safety — {presetLabels[safetyPreset] || safetyPreset}
      </div>
      <div
        className="h-2.5 w-36 rounded-full mb-1"
        style={{
          background: 'linear-gradient(to right, #1e40af, #eab308, #b91c1c)',
        }}
      />
      <div className="flex justify-between text-[10px] text-gray-500 w-36">
        <span>Safest</span>
        <span>Higher Risk</span>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-gray-200">
        <span
          className="inline-block h-2.5 w-2.5 rounded-sm border border-gray-400"
          style={{ backgroundColor: NO_DATA_FILL, opacity: 0.4 }}
        />
        <span className="text-[10px] text-gray-500">No data</span>
      </div>
    </div>
  );
}
