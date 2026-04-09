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

function buildBartLinesGeoJSON(stations: BartStation[]): GeoJSON.FeatureCollection {
  const stationMap = new Map<string, BartStation>();
  for (const s of stations) {
    stationMap.set(s.id, s);
  }

  const features: GeoJSON.Feature[] = [];

  for (const [color, stationIds] of Object.entries(BART_LINES)) {
    const coords: [number, number][] = [];
    for (const id of stationIds) {
      const s = stationMap.get(id);
      if (s) coords.push([s.lng, s.lat]);
    }
    if (coords.length >= 2) {
      features.push({
        type: 'Feature',
        properties: { color: LINE_COLORS[color] || '#888888' },
        geometry: { type: 'LineString', coordinates: coords },
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

function buildApartmentsGeoJSON(apartments: Apartment[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: apartments.map((a) => ({
      type: 'Feature' as const,
      properties: {
        id: a.id,
        name: a.name,
        price: a.minPrice ?? 0,
        priceLabel: a.minPrice
          ? a.minPrice >= 1000
            ? `$${(a.minPrice / 1000).toFixed(1)}K`
            : `$${a.minPrice}`
          : '',
      },
      geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] },
    })),
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
      mapStyle="https://tiles.openfreemap.org/styles/liberty"
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
        <Layer
          id="bart-lines-layer"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-opacity': 0.8,
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
          totalPrice: ['+', ['get', 'price']],
          count: ['+', 1],
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
            'text-color': '#ffffff',
          }}
        />

        {/* Individual apartment points */}
        <Layer
          id="apartment-points"
          type="circle"
          filter={['!', ['has', 'point_count']]}
          paint={{
            'circle-radius': 5,
            'circle-color': '#3B82F6',
            'circle-stroke-width': 1.5,
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
            'text-size': 10,
            'text-offset': [0, 1.4],
            'text-anchor': 'top',
            'text-optional': true,
          }}
          paint={{
            'text-color': '#1E40AF',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1,
          }}
          minzoom={13}
        />
      </Source>

      {/* Overlays and popups (must be inside MapGL) */}
      <SafetyOverlay />
      <SafetyLegend />
      <StationPopup />
      <ApartmentPopup />

      <NavigationControl position="top-right" />
      <GeolocateControl position="top-right" />
    </MapGL>
  );
}
