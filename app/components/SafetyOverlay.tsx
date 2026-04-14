'use client';

import { useState, useEffect, useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useAppStore } from '@/lib/store';
import type { SafetyArea } from '@/lib/types';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

// Score-driven color interpolation (red -> orange -> yellow -> light blue -> blue)
const SCORE_FILL_COLOR: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['get', 'score'],
  1, '#dc2626',
  3, '#f97316',
  5, '#eab308',
  7, '#60a5fa',
  9, '#2563eb',
];

const SCORE_LINE_COLOR: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['get', 'score'],
  1, '#b91c1c',
  3, '#ea580c',
  5, '#ca8a04',
  7, '#3b82f6',
  9, '#1d4ed8',
];

function enrichFeatures(
  geojson: GeoJSON.FeatureCollection | null,
  safetyAreas: SafetyArea[]
): { withData: GeoJSON.FeatureCollection; noData: GeoJSON.FeatureCollection } {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  if (!geojson) return { withData: empty, noData: empty };

  const areaMap = new Map<string, SafetyArea>();
  for (const a of safetyAreas) areaMap.set(a.id, a);

  const withDataFeatures: GeoJSON.Feature[] = [];
  const noDataFeatures: GeoJSON.Feature[] = [];

  for (const feature of geojson.features) {
    const areaId = feature.properties?.areaId;
    if (!areaId) continue;

    const matched = areaMap.get(areaId);
    if (matched) {
      withDataFeatures.push({
        ...feature,
        properties: {
          ...feature.properties,
          score: matched.score,
        },
      });
    } else {
      noDataFeatures.push(feature);
    }
  }

  return {
    withData: { type: 'FeatureCollection', features: withDataFeatures },
    noData: { type: 'FeatureCollection', features: noDataFeatures },
  };
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

  const { withData, noData } = useMemo(
    () => enrichFeatures(geojson, safetyAreas),
    [geojson, safetyAreas]
  );

  // Always render layers (even when hidden) to preserve z-order in MapLibre.
  // Toggling visibility via layout property keeps layers in the correct stack position.
  const vis = visible ? 'visible' : 'none';

  return (
    <>
      {/* Scored areas — single unified layer, constant opacity */}
      <Source id="safety-unified" type="geojson" data={withData}>
        <Layer
          id="safety-fill"
          type="fill"
          layout={{ visibility: vis }}
          paint={{
            'fill-color': SCORE_FILL_COLOR,
            'fill-opacity': 0.3,
          }}
        />
        <Layer
          id="safety-stroke"
          type="line"
          layout={{ visibility: vis }}
          paint={{
            'line-color': SCORE_LINE_COLOR,
            'line-width': ['interpolate', ['linear'], ['zoom'],
              8, 0.5,
              12, 1.5,
              16, 2.5,
            ],
            'line-opacity': 0.8,
          }}
        />
        <Layer
          id="safety-labels"
          type="symbol"
          layout={{
            visibility: vis,
            'text-field': ['get', 'areaName'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 12],
            'text-anchor': 'center',
            'text-allow-overlap': false,
            'text-font': ['Noto Sans Regular'],
          }}
          paint={{
            'text-color': '#1f2937',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.5,
            'text-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 1],
          }}
        />
      </Source>

      {/* No-data areas — gray, no labels */}
      <Source id="safety-nodata" type="geojson" data={noData}>
        <Layer
          id="safety-nodata-fill"
          type="fill"
          layout={{ visibility: vis }}
          paint={{
            'fill-color': '#e5e7eb',
            'fill-opacity': 0.15,
          }}
        />
        <Layer
          id="safety-nodata-stroke"
          type="line"
          layout={{ visibility: vis }}
          paint={{
            'line-color': '#9ca3af',
            'line-width': 1,
            'line-opacity': 0.5,
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
          background: 'linear-gradient(to right, #dc2626, #f97316, #eab308, #60a5fa, #2563eb)',
        }}
      />
      <div className="flex justify-between text-[10px] text-gray-500 w-36">
        <span>Higher Risk</span>
        <span>Safest</span>
      </div>
    </div>
  );
}
