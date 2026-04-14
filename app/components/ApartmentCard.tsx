'use client';

import { useAppStore } from '@/lib/store';
import type { Apartment } from '@/lib/types';

const BEDROOM_LABELS: Record<number, string> = {
  0: 'Studio',
  1: '1BR',
  2: '2BR',
  3: '3BR+',
};

const AMENITY_BADGES: { key: keyof Apartment; label: string }[] = [
  { key: 'hasInUnitWd', label: 'W/D' },
  { key: 'hasDishwasher', label: 'DW' },
  { key: 'hasParking', label: 'P' },
  { key: 'hasGym', label: 'Gym' },
  { key: 'hasPool', label: 'Pool' },
  { key: 'petFriendly', label: 'Pet' },
];

function formatPrice(price: number): string {
  if (price >= 1000) {
    const k = price / 1000;
    return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `$${price}`;
}

function safetyColor(score: number | null): string {
  if (score == null) return 'bg-gray-100 text-gray-500';
  if (score >= 7) return 'bg-green-100 text-green-700';
  if (score >= 5) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

export default function ApartmentCard({ apartment }: { apartment: Apartment }) {
  const selectedId = useAppStore((s) => s.selectedApartmentId);
  const selectApartment = useAppStore((s) => s.selectApartment);
  const setViewport = useAppStore((s) => s.setViewport);
  const stations = useAppStore((s) => s.stations);

  const isSelected = selectedId === apartment.id;
  const nearestStation = apartment.nearestStationId
    ? stations.find((s) => s.id === apartment.nearestStationId)
    : null;

  return (
    <div
      onClick={() => {
        selectApartment(apartment.id);
        setViewport({ latitude: apartment.lat, longitude: apartment.lng, zoom: 15 });
      }}
      className={`p-3 border rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 hover:bg-gray-50'
      }`}
    >
      <div className="font-semibold text-sm text-gray-900">{apartment.name}</div>

      <div className="text-sm mt-1">
        {apartment.minPrice != null || apartment.maxPrice != null ? (
          <span className="text-gray-700">
            {apartment.minPrice != null && apartment.maxPrice != null
              ? `${formatPrice(apartment.minPrice)} - ${formatPrice(apartment.maxPrice)}`
              : formatPrice((apartment.minPrice ?? apartment.maxPrice)!)}
          </span>
        ) : (
          <span className="text-gray-400 text-sm">Price not available</span>
        )}
      </div>

      {apartment.bedroomTypes.length > 0 && (
        <div className="text-xs text-gray-500 mt-0.5">
          {apartment.bedroomTypes
            .map((b) => BEDROOM_LABELS[b] ?? `${b}BR`)
            .join(', ')}
        </div>
      )}

      <div className="flex flex-wrap gap-1 mt-1.5">
        {AMENITY_BADGES.filter(({ key }) => apartment[key]).map(({ label }) => (
          <span
            key={label}
            className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium"
          >
            {label}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between mt-2">
        {nearestStation && (
          <span className="text-xs text-gray-500">
            {nearestStation.name}
            {apartment.walkMinToBart != null && ` · ${apartment.walkMinToBart} min walk`}
          </span>
        )}

        {nearestStation?.safetyScore != null && (
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${safetyColor(
              nearestStation.safetyScore
            )}`}
          >
            {nearestStation.safetyScore}/10
          </span>
        )}
      </div>
    </div>
  );
}
