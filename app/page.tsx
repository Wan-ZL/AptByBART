'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

import FilterSidebar from '@/app/components/FilterSidebar';
import { SafetyToggleButton } from '@/app/components/SafetyOverlay';
import Header from '@/app/components/Header';
import MobileBottomSheet from '@/app/components/MobileBottomSheet';
import OnboardingOverlay from '@/app/components/OnboardingOverlay';
import { useAppStore } from '@/lib/store';
import { useUrlSync } from '@/lib/url-sync';

const MapView = dynamic(() => import('@/app/components/Map'), {
  ssr: false,
  loading: () => <div className="flex-1 bg-gray-100 animate-pulse" />,
});

export default function Home() {
  const setStations = useAppStore((s) => s.setStations);
  const setApartments = useAppStore((s) => s.setApartments);
  const setCitySafety = useAppStore((s) => s.setCitySafety);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useUrlSync();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stationsRes, apartmentsRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/stations`, { cache: 'no-cache' }),
        fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/apartments?bbox=37.3,-122.6,38.1,-121.7`, { cache: 'no-cache' }),
      ]);
      if (!stationsRes.ok || !apartmentsRes.ok) {
        throw new Error('Failed to fetch data');
      }
      const [stationsData, apartmentsData] = await Promise.all([
        stationsRes.json(),
        apartmentsRes.json(),
      ]);
      setStations(stationsData.stations);
      setApartments(apartmentsData.apartments);
      if (stationsData.citySafety) setCitySafety(stationsData.citySafety);
    } catch {
      setError('Failed to load BART data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [setStations, setApartments, setCitySafety]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="flex flex-col h-screen">
      <OnboardingOverlay />
      <Header
        showFilterButton
        onToggleFilters={() => setMobileFiltersOpen((o) => !o)}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <div className="hidden lg:block w-[360px] overflow-y-auto">
          <FilterSidebar />
        </div>

        {/* Map area */}
        <div className="flex-1 relative">
          <MapView />
          <SafetyToggleButton />

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
              <p className="text-gray-600 text-lg animate-pulse">Loading BART data...</p>
            </div>
          )}

          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-red-600 text-white px-4 py-2 rounded shadow-lg flex items-center gap-3">
              <span>{error}</span>
              <button
                onClick={fetchData}
                className="underline font-medium hover:text-red-100"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: bottom sheet */}
      <MobileBottomSheet />

      {/* Mobile: filter slide-over */}
      {mobileFiltersOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileFiltersOpen(false)}
          />
          {/* Panel */}
          <div className="relative w-full max-w-sm bg-white overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <span className="text-lg font-semibold text-gray-900">Filters</span>
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            <FilterSidebar />
          </div>
        </div>
      )}
    </div>
  );
}
