'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from './store';
import type { Filters } from './types';
import type { SafetyPreset } from './crime-taxonomy';
import { WEIGHT_PRESETS } from './crime-taxonomy';

function initStoreFromUrl() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const store = useAppStore.getState();

  const priceMin = params.get('price_min');
  const priceMax = params.get('price_max');
  if (priceMin || priceMax) {
    const min = priceMin ? parseInt(priceMin, 10) : store.filters.priceRange[0];
    const max = priceMax ? parseInt(priceMax, 10) : store.filters.priceRange[1];
    if (!isNaN(min) && !isNaN(max)) store.setPriceRange([min, max]);
  }

  const beds = params.get('beds');
  if (beds) {
    const bedrooms = beds.split(',').map(Number).filter((n) => !isNaN(n));
    if (bedrooms.length > 0) store.setBedrooms(bedrooms);
  }

  if (params.get('wd') === '1') store.setFilter('inUnitWd', true);
  if (params.get('dw') === '1') store.setFilter('dishwasher', true);
  if (params.get('parking') === '1') store.setFilter('parking', true);
  if (params.get('gym') === '1') store.setFilter('gym', true);
  if (params.get('pool') === '1') store.setFilter('pool', true);
  if (params.get('pet') === '1') store.setFilter('petFriendly', true);

  const commute = params.get('commute');
  if (commute) {
    const val = parseInt(commute, 10);
    if (!isNaN(val)) store.setMaxCommute(val);
  }

  const risk = params.get('risk');
  if (risk) {
    const val = parseFloat(risk);
    if (!isNaN(val)) store.setMaxRisk(val);
  }

  // Safety weights
  const preset = params.get('preset') as SafetyPreset | null;
  if (preset && preset !== 'custom' && preset in WEIGHT_PRESETS) {
    store.setSafetyPreset(preset);
  } else if (preset === 'custom') {
    const wv = params.get('wv');
    const wp = params.get('wp');
    const wve = params.get('wve');
    const wq = params.get('wq');
    if (wv && wp && wve && wq) {
      const weights = {
        violent: parseFloat(wv),
        property: parseFloat(wp),
        vehicle: parseFloat(wve),
        qualityOfLife: parseFloat(wq),
      };
      if (Object.values(weights).every((n) => !isNaN(n) && n >= 0)) {
        store.setSafetyWeights(weights);
      }
    }
  }

  const lat = params.get('lat');
  const lng = params.get('lng');
  const zoom = params.get('zoom');
  if (lat && lng) {
    store.setViewport({
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      zoom: zoom ? parseFloat(zoom) : 10,
    });
  }
}

function writeFiltersToUrl(filters: Filters) {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams();

  if (filters.priceRange[0] !== 1000) params.set('price_min', String(filters.priceRange[0]));
  if (filters.priceRange[1] !== 5000) params.set('price_max', String(filters.priceRange[1]));
  if (filters.bedrooms.length > 0) params.set('beds', filters.bedrooms.join(','));
  if (filters.inUnitWd) params.set('wd', '1');
  if (filters.dishwasher) params.set('dw', '1');
  if (filters.parking) params.set('parking', '1');
  if (filters.gym) params.set('gym', '1');
  if (filters.pool) params.set('pool', '1');
  if (filters.petFriendly) params.set('pet', '1');
  if (filters.maxCommuteMin < 60) params.set('commute', String(filters.maxCommuteMin));
  if (filters.maxRiskScore < 1) params.set('risk', String(filters.maxRiskScore));

  const { safetyPreset, safetyWeights } = useAppStore.getState();
  if (safetyPreset !== 'balanced') {
    params.set('preset', safetyPreset);
    if (safetyPreset === 'custom') {
      params.set('wv', String(safetyWeights.violent));
      params.set('wp', String(safetyWeights.property));
      params.set('wve', String(safetyWeights.vehicle));
      params.set('wq', String(safetyWeights.qualityOfLife));
    }
  }

  const viewport = useAppStore.getState().viewport;
  if (viewport.latitude !== 37.5693 || viewport.longitude !== -121.8268 || viewport.zoom !== 9.5) {
    params.set('lat', viewport.latitude.toFixed(4));
    params.set('lng', viewport.longitude.toFixed(4));
    params.set('zoom', viewport.zoom.toFixed(1));
  }

  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

export function useUrlSync() {
  const initialized = useRef(false);
  const filters = useAppStore((s) => s.filters);
  const safetyPreset = useAppStore((s) => s.safetyPreset);
  const safetyWeights = useAppStore((s) => s.safetyWeights);

  // On mount: read URL params and initialize store
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      initStoreFromUrl();
    }
  }, []);

  // On filter/safety change: write to URL (skip on first render to avoid overwriting initial URL params)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    writeFiltersToUrl(filters);
  }, [filters, safetyPreset, safetyWeights]);

  // Subscribe to viewport changes outside React's render cycle to avoid
  // infinite loops (Map.tsx creates new viewport objects on every onMove)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let prevViewport = useAppStore.getState().viewport;

    const unsub = useAppStore.subscribe((state) => {
      const vp = state.viewport;
      if (vp === prevViewport) return;
      prevViewport = vp;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        writeFiltersToUrl(useAppStore.getState().filters);
      }, 500);
    });

    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
