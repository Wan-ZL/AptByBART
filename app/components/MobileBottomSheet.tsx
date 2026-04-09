'use client';

import { useState, useCallback } from 'react';
import { useAppStore, selectFilteredApartments } from '@/lib/store';

function formatPrice(price: number): string {
  if (price >= 1000) {
    const k = price / 1000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `$${price}`;
}

export default function MobileBottomSheet() {
  const filteredApartments = useAppStore(selectFilteredApartments);
  const stations = useAppStore((s) => s.stations);
  const selectApartment = useAppStore((s) => s.selectApartment);
  const setViewport = useAppStore((s) => s.setViewport);

  const stationMap = new Map(stations.map((s) => [s.id, s.name]));
  const [expanded, setExpanded] = useState(false);

  const handleCardTap = useCallback(
    (apt: { id: number; lat: number; lng: number }) => {
      selectApartment(apt.id);
      setViewport({ latitude: apt.lat, longitude: apt.lng, zoom: 15 });
    },
    [selectApartment, setViewport],
  );

  const count = filteredApartments.length;

  return (
    <div
      className={`lg:hidden fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-lg z-40 transition-all duration-300 ${
        expanded ? 'max-h-[60vh]' : 'max-h-32'
      }`}
    >
      {/* Drag handle / count bar */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex flex-col items-center pt-2 pb-1 cursor-pointer"
      >
        <div className="w-10 h-1 rounded-full bg-gray-300 mb-2" />
        <span className="text-sm font-semibold text-gray-700">
          {count} apartment{count !== 1 ? 's' : ''} found
        </span>
      </button>

      {/* Apartment cards — horizontal scroll when collapsed, vertical when expanded */}
      <div
        className={`px-3 pb-3 ${
          expanded
            ? 'overflow-y-auto max-h-[calc(60vh-52px)]'
            : 'overflow-x-auto'
        }`}
      >
        <div
          className={`${
            expanded
              ? 'flex flex-col gap-2'
              : 'flex gap-2 flex-nowrap'
          }`}
        >
          {filteredApartments.map((apt) => (
            <button
              key={apt.id}
              onClick={() => handleCardTap(apt)}
              className={`${
                expanded ? 'w-full' : 'min-w-[160px] flex-shrink-0'
              } text-left p-3 border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors`}
            >
              <div className="font-medium text-sm text-gray-900 truncate">
                {apt.name}
              </div>
              {apt.minPrice != null && (
                <div className="text-xs text-gray-600 mt-0.5">
                  {formatPrice(apt.minPrice)}
                  {apt.maxPrice != null && apt.maxPrice !== apt.minPrice
                    ? ` - ${formatPrice(apt.maxPrice)}`
                    : ''}
                  /mo
                </div>
              )}
              {apt.nearestStationId && (
                <div className="text-xs text-gray-400 mt-0.5 truncate">
                  {stationMap.get(apt.nearestStationId) ?? apt.nearestStationId} · {apt.walkMinToBart ?? '?'} min walk
                </div>
              )}
            </button>
          ))}
          {count === 0 && (
            <p className="text-sm text-gray-400 text-center py-4 w-full">
              No apartments match your filters.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
