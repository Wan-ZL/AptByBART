'use client';

import { useRef, useCallback, useMemo } from 'react';
import MapGL, {
  Source,
  Layer,
  NavigationControl,
  GeolocateControl,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useAppStore, selectFilteredApartments } from '@/lib/store';
import type { BartStation, Apartment } from '@/lib/types';
import SafetyOverlay, { SafetyLegend } from './SafetyOverlay';
import StationPopup from './StationPopup';
import ApartmentPopup from './ApartmentPopup';

// BART line route definitions — station IDs in order, grouped by line color
const BART_LINES: Record<string, string[]> = {
  yellow: ['ANTC','PCTR','PITT','NCON','CONC','PHIL','WCRK','LAFY','ORIN','ROCK','MCAR','19TH','12TH','WOAK','EMBR','MONT','POWL','CIVC','16TH','24TH','GLEN','BALB','DALY','COLM','SSAN','SBRN','MLBR','SFIA'],
  orange: ['RICH','DELN','PLZA','NBRK','DBRK','ASHB','MCAR','19TH','12TH','LAKE','FTVL','COLS','SANL','BAYF','HAYW','SHAY','UCTY','FRMT','WARM','MLPT','BERY'],
  red:    ['RICH','DELN','PLZA','NBRK','DBRK','ASHB','MCAR','19TH','12TH','WOAK','EMBR','MONT','POWL','CIVC','16TH','24TH','GLEN','BALB','DALY','COLM','SSAN','SBRN','MLBR'],
  blue:   ['DUBL','WDUB','CAST','BAYF','SANL','COLS','FTVL','LAKE','12TH','19TH','WOAK','EMBR','MONT','POWL','CIVC','16TH','24TH','GLEN','BALB','DALY'],
  green:  ['BERY','MLPT','WARM','FRMT','UCTY','SHAY','HAYW','BAYF','SANL','COLS','FTVL','LAKE','12TH','19TH','WOAK','EMBR','MONT','POWL','CIVC','16TH','24TH','GLEN','BALB','DALY'],
  beige:  ['OAKL','COLS'],
};

const LINE_COLORS: Record<string, string> = {
  yellow: '#FFD700',
  orange: '#FF8C00',
  red:    '#E12727',
  blue:   '#0099FF',
  green:  '#4CAF50',
  beige:  '#C2A878',
};

const LINE_SPACING = 6; // pixels between parallel lines

function buildBartLinesGeoJSON(stations: BartStation[]): GeoJSON.FeatureCollection {
  const stationMap = new Map<string, BartStation>();
  for (const s of stations) {
    stationMap.set(s.id, s);
  }

  // Build a map of segment -> set of line colors that use it
  const segmentLines = new Map<string, Set<string>>();
  for (const [color, stationIds] of Object.entries(BART_LINES)) {
    for (let i = 0; i < stationIds.length - 1; i++) {
      const a = stationIds[i];
      const b = stationIds[i + 1];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!segmentLines.has(key)) segmentLines.set(key, new Set());
      segmentLines.get(key)!.add(color);
    }
  }

  const features: GeoJSON.Feature[] = [];

  for (const [color, stationIds] of Object.entries(BART_LINES)) {
    for (let i = 0; i < stationIds.length - 1; i++) {
      const aId = stationIds[i];
      const bId = stationIds[i + 1];
      const aStation = stationMap.get(aId);
      const bStation = stationMap.get(bId);
      if (!aStation || !bStation) continue;

      const key = aId < bId ? `${aId}-${bId}` : `${bId}-${aId}`;
      const sharingLines = Array.from(segmentLines.get(key)!).sort();
      const totalLines = sharingLines.length;
      const index = sharingLines.indexOf(color);
      const offset = totalLines === 1 ? 0 : (index - (totalLines - 1) / 2) * LINE_SPACING;

      features.push({
        type: 'Feature',
        properties: {
          color: LINE_COLORS[color] || '#888888',
          offset,
        },
        geometry: {
          type: 'LineString',
          coordinates: [
            [aStation.lng, aStation.lat],
            [bStation.lng, bStation.lat],
          ],
        },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

function buildStationsGeoJSON(stations: BartStation[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stations.map((s) => ({
      type: 'Feature' as const,
      properties: {
        id: s.id,
        name: s.name,
        lineColor: LINE_COLORS[s.lineColors[0]] || '#888888',
      },
      geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
    })),
  };
}

function formatPrice(price: number): string {
  return `$${Math.round(price).toLocaleString()}`;
}

function buildApartmentsGeoJSON(apartments: Apartment[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: apartments.map((a) => {
      let priceLabel = '';
      if (a.minPrice != null) {
        if (a.maxPrice != null && a.maxPrice !== a.minPrice) {
          priceLabel = `${formatPrice(a.minPrice)}–${formatPrice(a.maxPrice)}`;
        } else {
          priceLabel = formatPrice(a.minPrice);
        }
      } else {
        priceLabel = 'N/A';
      }
      return {
        type: 'Feature' as const,
        properties: {
          id: a.id,
          name: a.name,
          price: a.minPrice ?? 0,
          maxPrice: a.maxPrice ?? 0,
          priceLabel,
        },
        geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] },
      };
    }),
  };
}

export default function MapView() {
  const mapRef = useRef<MapRef>(null);

  const stations = useAppStore((s) => s.stations);
  const filteredApartments = useAppStore(selectFilteredApartments);
  const viewport = useAppStore((s) => s.viewport);
  const setViewport = useAppStore((s) => s.setViewport);
  const selectApartment = useAppStore((s) => s.selectApartment);
  const selectStation = useAppStore((s) => s.selectStation);
  const mapStyle = useAppStore((s) => s.mapStyle);
  const setMapStyle = useAppStore((s) => s.setMapStyle);

  const bartLinesGeoJSON = useMemo(() => buildBartLinesGeoJSON(stations), [stations]);
  const stationsGeoJSON = useMemo(() => buildStationsGeoJSON(stations), [stations]);
  const apartmentsGeoJSON = useMemo(() => buildApartmentsGeoJSON(filteredApartments), [filteredApartments]);

  const handleStationClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (feature?.properties?.id) {
        selectStation(feature.properties.id as string);
      }
    },
    [selectStation],
  );

  const handleApartmentClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;

      // If clicking a cluster, zoom in
      if (feature.properties?.cluster) {
        const clusterId = feature.properties.cluster_id;
        const source = mapRef.current?.getSource('apartments') as any;
        source?.getClusterExpansionZoom?.(clusterId, (err: Error, zoom: number) => {
          if (err || !feature.geometry || feature.geometry.type !== 'Point') return;
          mapRef.current?.flyTo({
            center: feature.geometry.coordinates as [number, number],
            zoom,
          });
        });
        return;
      }

      if (feature.properties?.id) {
        selectApartment(feature.properties.id as number);
      }
    },
    [selectApartment],
  );

  const onMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      // Check layers in priority order
      const stationFeatures = mapRef.current?.queryRenderedFeatures(e.point, {
        layers: ['stations-layer'],
      });
      if (stationFeatures?.length) {
        const id = stationFeatures[0].properties?.id;
        if (id) selectStation(id as string);
        return;
      }

      const clusterFeatures = mapRef.current?.queryRenderedFeatures(e.point, {
        layers: ['clusters'],
      });
      if (clusterFeatures?.length) {
        const feature = clusterFeatures[0];
        const clusterId = feature.properties?.cluster_id;
        const source = mapRef.current?.getSource('apartments') as any;
        source?.getClusterExpansionZoom?.(clusterId, (err: Error, zoom: number) => {
          if (err || !feature.geometry || feature.geometry.type !== 'Point') return;
          mapRef.current?.flyTo({
            center: feature.geometry.coordinates as [number, number],
            zoom,
          });
        });
        return;
      }

      const aptFeatures = mapRef.current?.queryRenderedFeatures(e.point, {
        layers: ['apartment-points'],
      });
      if (aptFeatures?.length) {
        const id = aptFeatures[0].properties?.id;
        if (id) selectApartment(id as number);
        return;
      }

      // Clicked empty map space — dismiss any open popup
      selectApartment(null);
      selectStation(null);
    },
    [selectStation, selectApartment],
  );

  const interactiveLayerIds = useMemo(
    () => ['stations-layer', 'clusters', 'apartment-points'],
    [],
  );

  return (
    <MapGL
      ref={mapRef}
      mapStyle={mapStyle}
      longitude={viewport.longitude}
      latitude={viewport.latitude}
      zoom={viewport.zoom}
      onMove={(e) => setViewport(e.viewState)}
      onClick={onMapClick}
      interactiveLayerIds={interactiveLayerIds}
      cursor="auto"
      style={{ width: '100%', height: '100%' }}
    >
      {/* BART lines */}
      <Source id="bart-lines" type="geojson" data={bartLinesGeoJSON}>
        {/* White outline layer for visual separation between adjacent lines */}
        <Layer
          id="bart-lines-outline"
          type="line"
          paint={{
            'line-color': '#ffffff',
            'line-width': 6,
            'line-opacity': 1,
            'line-offset': ['get', 'offset'],
          }}
        />
        {/* Colored line layer on top */}
        <Layer
          id="bart-lines-layer"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': 4,
            'line-opacity': 1,
            'line-offset': ['get', 'offset'],
          }}
        />
      </Source>

      {/* BART stations */}
      <Source id="bart-stations" type="geojson" data={stationsGeoJSON}>
        <Layer
          id="stations-layer"
          type="circle"
          paint={{
            'circle-radius': 6,
            'circle-color': '#ffffff',
            'circle-stroke-color': ['get', 'lineColor'],
            'circle-stroke-width': 2.5,
          }}
        />
        <Layer
          id="stations-labels"
          type="symbol"
          layout={{
            'text-field': ['get', 'name'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.5],
            'text-anchor': 'top',
            'text-optional': true,
          }}
          paint={{
            'text-color': '#333333',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1,
          }}
          minzoom={11}
        />
      </Source>

      {/* Apartment markers with clustering */}
      <Source
        id="apartments"
        type="geojson"
        data={apartmentsGeoJSON}
        cluster={true}
        clusterMaxZoom={14}
        clusterRadius={50}
        clusterProperties={{
          clusterMinPrice: ['min', ['get', 'price']],
          clusterMaxPrice: ['max', ['get', 'maxPrice']],
          hasPrices: ['+', ['case', ['>', ['get', 'price'], 0], 1, 0]],
        }}
      >
        {/* Cluster circles */}
        <Layer
          id="clusters"
          type="circle"
          filter={['has', 'point_count']}
          paint={{
            'circle-color': [
              'step',
              ['get', 'point_count'],
              '#4CAF50',
              10,
              '#FFC107',
              30,
              '#FF5722',
            ],
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              18,
              10,
              24,
              30,
              32,
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          }}
        />

        {/* Cluster count labels */}
        <Layer
          id="cluster-count"
          type="symbol"
          filter={['has', 'point_count']}
          layout={{
            'text-field': '{point_count_abbreviated}',
            'text-size': 12,
            'text-font': ['Noto Sans Regular'],
          }}
          paint={{
            'text-color': '#1a1a1a',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1,
          }}
        />

        {/* Cluster price range label */}
        <Layer
          id="cluster-price"
          type="symbol"
          filter={['has', 'point_count']}
          layout={{
            'text-field': [
              'case',
              ['>', ['get', 'hasPrices'], 0],
              [
                'case',
                ['==',
                  ['round', ['get', 'clusterMinPrice']],
                  ['round', ['get', 'clusterMaxPrice']]
                ],
                ['concat', '$', ['to-string', ['round', ['get', 'clusterMinPrice']]]],
                ['concat',
                  '$', ['to-string', ['round', ['get', 'clusterMinPrice']]], '–$',
                  ['to-string', ['round', ['get', 'clusterMaxPrice']]]
                ],
              ],
              '',
            ],
            'text-font': ['Noto Sans Regular'],
            'text-size': 9,
            'text-offset': [0, 1.2],
            'text-anchor': 'top',
            'text-allow-overlap': true,
          }}
          paint={{
            'text-color': '#1a1a1a',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1,
          }}
        />

        {/* Individual apartment points */}
        <Layer
          id="apartment-points"
          type="circle"
          filter={['!', ['has', 'point_count']]}
          paint={{
            'circle-radius': 7,
            'circle-color': '#3B82F6',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
          }}
        />

        {/* Apartment price labels */}
        <Layer
          id="apartment-prices"
          type="symbol"
          filter={['!', ['has', 'point_count']]}
          layout={{
            'text-field': ['get', 'priceLabel'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 10,
            'text-offset': [0, 1.4],
            'text-anchor': 'top',
            'text-optional': true,
          }}
          paint={{
            'text-color': '#6B7280',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1,
          }}
          minzoom={12}
        />
      </Source>

      {/* Overlays and popups (must be inside MapGL) */}
      <SafetyOverlay />
      <SafetyLegend />
      <StationPopup />
      <ApartmentPopup />

      <NavigationControl position="top-right" />
      <GeolocateControl position="top-right" />

      {/* Map style switcher */}
      <div className="absolute bottom-6 left-2 z-10 bg-white rounded-lg shadow-md border border-gray-200 p-1 flex gap-1">
        {[
          { id: 'https://tiles.openfreemap.org/styles/positron', label: 'Clean' },
          { id: 'https://tiles.openfreemap.org/styles/liberty', label: 'Detailed' },
          { id: 'https://tiles.openfreemap.org/styles/bright', label: 'Bright' },
        ].map((style) => (
          <button
            key={style.id}
            onClick={() => setMapStyle(style.id)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              mapStyle === style.id
                ? 'bg-blue-500 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {style.label}
          </button>
        ))}
      </div>
    </MapGL>
  );
}
