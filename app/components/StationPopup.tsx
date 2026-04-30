'use client';

import { Popup } from 'react-map-gl/maplibre';
import { useAppStore } from '@/lib/store';

const LINE_COLORS: Record<string, string> = {
  yellow: '#FFD700',
  orange: '#FF8C00',
  red:    '#E12727',
  blue:   '#0099FF',
  green:  '#4CAF50',
  beige:  '#C2A878',
};

function safetyBadgeColor(score: number): string {
  if (score <= 0.2) return 'bg-green-100 text-green-800';
  if (score <= 0.4) return 'bg-yellow-100 text-yellow-800';
  if (score <= 0.6) return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-800';
}

export default function StationPopup() {
  const selectedStationId = useAppStore((s) => s.selectedStationId);
  const stations = useAppStore((s) => s.stations);
  const selectStation = useAppStore((s) => s.selectStation);

  if (!selectedStationId) return null;

  const station = stations.find((s) => s.id === selectedStationId);
  if (!station) return null;

  return (
    <Popup
      latitude={station.lat}
      longitude={station.lng}
      anchor="bottom"
      onClose={() => selectStation(null)}
      closeOnClick={false}
      className="station-popup"
    >
      <div className="max-w-sm rounded-lg bg-white p-3 shadow-lg">
        <div className="mb-2 flex items-start justify-between">
          <h3 className="text-base font-bold text-gray-900">{station.name}</h3>
          <button
            onClick={() => selectStation(null)}
            className="ml-2 text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>

        <div className="mb-2 flex flex-wrap gap-1">
          {station.lineColors.map((color) => (
            <span
              key={color}
              className="inline-flex items-center gap-1 text-xs"
            >
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ backgroundColor: LINE_COLORS[color] || color }}
              />
              <span className="capitalize">{color}</span>
            </span>
          ))}
        </div>

        <div className="space-y-1 text-sm text-gray-700">
          {station.travelTimeMin != null && (
            <p>{station.travelTimeMin} min to Montgomery</p>
          )}
          {station.fareCents != null && (
            <p>${(station.fareCents / 100).toFixed(2)} (Clipper)</p>
          )}
          {station.monthlyCommuteCost != null && (
            <p>${(station.monthlyCommuteCost / 100).toFixed(2)}/mo</p>
          )}
        </div>

        {station.safetyScore != null && (
          <div className="mt-2">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${safetyBadgeColor(station.safetyScore)}`}
            >
              Safety: {station.safetyScore.toFixed(2)}
            </span>
          </div>
        )}
      </div>
    </Popup>
  );
}
