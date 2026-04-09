'use client';

import { Popup } from 'react-map-gl/maplibre';
import { useAppStore } from '@/lib/store';
import { useState, useEffect } from 'react';
import type { ApartmentDetail } from '@/lib/types';

function safetyBadgeColor(score: number): string {
  if (score >= 8) return 'bg-green-100 text-green-800';
  if (score >= 6) return 'bg-yellow-100 text-yellow-800';
  if (score >= 4) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-800';
}

function bedroomLabel(bedrooms: number): string {
  if (bedrooms === 0) return 'Studio';
  return `${bedrooms}BR`;
}

function priceSparkline(history: { priceMin: number }[]): string {
  if (history.length === 0) return '';
  const blocks = '▁▂▃▄▅▆▇█';
  const prices = history.map((h) => h.priceMin);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  return prices
    .map((p) => {
      const idx = Math.round(((p - min) / range) * (blocks.length - 1));
      return blocks[idx];
    })
    .join('');
}

export default function ApartmentPopup() {
  const selectedApartmentId = useAppStore((s) => s.selectedApartmentId);
  const apartments = useAppStore((s) => s.apartments);
  const stations = useAppStore((s) => s.stations);
  const selectApartment = useAppStore((s) => s.selectApartment);

  const [detail, setDetail] = useState<ApartmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchDetail = (id: number) => {
    setLoading(true);
    setDetail(null);
    setError(false);
    fetch(`/api/apartments/${id}`)
      .then((res) => res.json())
      .then((data) => setDetail(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (selectedApartmentId == null) {
      setDetail(null);
      setError(false);
      return;
    }
    fetchDetail(selectedApartmentId);
  }, [selectedApartmentId]);

  if (selectedApartmentId == null) return null;

  const apt = apartments.find((a) => a.id === selectedApartmentId);
  if (!apt) return null;

  const nearestStation = apt.nearestStationId
    ? stations.find((s) => s.id === apt.nearestStationId)
    : null;

  const amenities: string[] = [];
  if (apt.hasInUnitWd) amenities.push('W/D');
  if (apt.hasDishwasher) amenities.push('DW');
  if (apt.hasParking) amenities.push(apt.parkingType === 'garage' ? 'Garage' : 'Parking');
  if (apt.hasGym) amenities.push('Gym');
  if (apt.hasPool) amenities.push('Pool');
  if (apt.petFriendly) amenities.push('Pets OK');

  return (
    <Popup
      latitude={apt.lat}
      longitude={apt.lng}
      anchor="bottom"
      onClose={() => selectApartment(null)}
      closeOnClick={false}
      className="apartment-popup"
    >
      <div className="max-w-sm rounded-lg bg-white p-3 shadow-lg">
        <div className="mb-1 flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">{apt.name}</h3>
            <p className="text-xs text-gray-500">{apt.address}</p>
          </div>
          <button
            onClick={() => selectApartment(null)}
            className="ml-2 text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>

        {loading && (
          <p className="my-2 text-sm text-gray-400">Loading details...</p>
        )}

        {error && selectedApartmentId != null && (
          <p
            className="my-2 cursor-pointer text-sm text-red-500 hover:text-red-700"
            onClick={() => fetchDetail(selectedApartmentId)}
          >
            Failed to load details. Tap to retry.
          </p>
        )}

        {detail && detail.floorPlans.length > 0 && (
          <div className="my-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b text-gray-500">
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2">SqFt</th>
                  <th className="py-1 pr-2">Price</th>
                  <th className="py-1">Avail</th>
                </tr>
              </thead>
              <tbody>
                {detail.floorPlans.map((fp) => (
                  <tr key={fp.id} className={`border-b border-gray-100${fp.availableUnits === 0 ? ' opacity-50' : ''}`}>
                    <td className="py-1 pr-2 font-medium">
                      {bedroomLabel(fp.bedrooms)}/{fp.bathrooms}ba
                    </td>
                    <td className="py-1 pr-2">
                      {fp.sqftMin != null
                        ? fp.sqftMax && fp.sqftMax !== fp.sqftMin
                          ? `${fp.sqftMin}-${fp.sqftMax}`
                          : `${fp.sqftMin}`
                        : '—'}
                    </td>
                    <td className="py-1 pr-2">
                      {fp.priceMin != null
                        ? fp.priceMax && fp.priceMax !== fp.priceMin
                          ? `$${fp.priceMin}-$${fp.priceMax}`
                          : `$${fp.priceMin}`
                        : '—'}
                    </td>
                    <td className="py-1">{fp.availableUnits === 0 ? 'Unavailable' : fp.availableUnits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {amenities.length > 0 && (
          <div className="my-2 flex flex-wrap gap-1">
            {amenities.map((a) => (
              <span
                key={a}
                className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
              >
                {a}
              </span>
            ))}
          </div>
        )}

        {nearestStation && nearestStation.safetyScore != null && (
          <div className="my-1">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${safetyBadgeColor(nearestStation.safetyScore)}`}
            >
              Safety: {nearestStation.safetyScore}/10
            </span>
          </div>
        )}

        {nearestStation && (
          <p className="text-xs text-gray-600">
            {nearestStation.name}
            {apt.walkMinToBart != null && ` · ${apt.walkMinToBart} min walk`}
          </p>
        )}

        {detail &&
          Object.keys(detail.priceHistory).length > 0 &&
          (() => {
            const allEntries = Object.values(detail.priceHistory).flat();
            const spark = priceSparkline(allEntries);
            if (!spark) return null;
            const prices = allEntries.map((h) => h.priceMin);
            const delta = prices[prices.length - 1] - prices[0];
            return (
              <p className="my-1 text-xs text-gray-500">
                Price trend: <span className="font-mono">{spark}</span>{' '}
                <span className="text-xs text-gray-400">90-day trend</span>
                {delta !== 0 && (
                  <span className={`ml-1 text-xs font-medium ${delta > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {delta > 0 ? `+$${delta}` : `-$${Math.abs(delta)}`}
                  </span>
                )}
              </p>
            );
          })()}

        <a
          href={apt.websiteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-xs font-medium text-blue-600 hover:text-blue-800"
        >
          View Website &rarr;
        </a>
      </div>
    </Popup>
  );
}
