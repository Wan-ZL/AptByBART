'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import Sparkline from './Sparkline';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface TrendMonth {
  period: string;
  violent: number;
  property: number;
  vehicle: number;
  qol: number;
  total: number;
}

function scoreColor(score: number): string {
  if (score <= 0.2) return '#2563eb';  // blue (safest)
  if (score <= 0.4) return '#60a5fa';  // light blue
  if (score <= 0.6) return '#eab308';  // yellow
  if (score <= 0.8) return '#f97316';  // orange
  return '#dc2626';                     // red (highest risk)
}

function letterGrade(score: number): string {
  if (score <= 0.2) return 'A';
  if (score <= 0.4) return 'B';
  if (score <= 0.6) return 'C';
  if (score <= 0.8) return 'D';
  return 'F';
}

const BAR_COLORS: Record<string, string> = {
  violent: '#ef4444',
  property: '#3b82f6',
  vehicle: '#f97316',
  qualityOfLife: '#9ca3af',
};

const CATEGORY_LABELS: Record<string, string> = {
  violent: 'Violent Crime',
  property: 'Property Crime',
  vehicle: 'Vehicle Crime',
  qualityOfLife: 'Quality of Life',
};

const CATEGORIES = ['violent', 'property', 'vehicle', 'qualityOfLife'] as const;

export default function SafetyDetailPanel() {
  const selectedId = useAppStore((s) => s.selectedSafetyAreaId);
  const safetyAreas = useAppStore((s) => s.safetyAreas);
  const selectSafetyArea = useAppStore((s) => s.selectSafetyArea);
  const [trendData, setTrendData] = useState<TrendMonth[] | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setTrendData(null);
      return;
    }
    setTrendData(null);
    fetch(`${basePath}/api/safety/${encodeURIComponent(selectedId)}/trend`)
      .then((r) => r.json())
      .then((data) => setTrendData(data.months))
      .catch(() => setTrendData(null));
  }, [selectedId]);

  if (!selectedId) return null;

  const selectedArea = safetyAreas.find((a) => a.id === selectedId);
  if (!selectedArea) return null;

  const parentArea = selectedArea.parentId
    ? safetyAreas.find((a) => a.id === selectedArea.parentId)
    : null;

  const maxCount = Math.max(
    ...CATEGORIES.map((c) => selectedArea.counts[c]),
    1,
  );

  const typeBadgeColor =
    selectedArea.type === 'city'
      ? 'bg-blue-100 text-blue-700'
      : selectedArea.type === 'neighborhood'
        ? 'bg-purple-100 text-purple-700'
        : selectedArea.type === 'tract'
          ? 'bg-amber-100 text-amber-700'
          : 'bg-gray-100 text-gray-700';

  return (
    <div className="absolute top-3 right-14 z-20 w-72 rounded-lg bg-white shadow-md border border-gray-200">
      {/* Header */}
      <div className="flex items-start justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          {selectedArea.type === 'tract' ? (
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-900 truncate">
                {parentArea?.name || selectedArea.name}
              </h3>
              <div className="text-[11px] text-gray-500 truncate">{selectedArea.name}</div>
            </div>
          ) : (
            <h3 className="text-sm font-bold text-gray-900 truncate">
              {selectedArea.name}
            </h3>
          )}
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${typeBadgeColor}`}
          >
            {selectedArea.type}
          </span>
        </div>
        <button
          onClick={() => selectSafetyArea(null)}
          className="ml-2 shrink-0 text-gray-400 hover:text-gray-600 text-lg leading-none"
        >
          &times;
        </button>
      </div>

      {/* Score badge */}
      <div className="flex items-center gap-3 px-3 pb-2">
        <div
          className="flex flex-col items-center justify-center w-10 h-10 rounded-full text-white"
          style={{ backgroundColor: scoreColor(selectedArea.score) }}
        >
          <span className="text-sm font-bold leading-none">{selectedArea.score.toFixed(2)}</span>
          <span className="text-[9px] font-semibold leading-none mt-0.5">{letterGrade(selectedArea.score)}</span>
        </div>
        <div className="text-xs text-gray-500">
          Safety Score
          <br />
          <span className="text-gray-400">0 (safest) — 1 (highest risk)</span>
          {selectedArea.percentile != null && (
            <div className="text-xs text-gray-500 mt-1">
              Safer than {selectedArea.percentile}% of Bay Area
            </div>
          )}
          {selectedArea.population != null && selectedArea.population > 0 && (
            <div className="text-[11px] text-gray-400 mt-0.5">
              Pop. {selectedArea.population.toLocaleString()}
            </div>
          )}
          {(selectedArea.population === 0 || selectedArea.population === null) && (
            <div className="text-[11px] text-gray-400 italic mt-0.5">
              No population data — score is neutral estimate
            </div>
          )}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="px-3 pb-2 space-y-1.5">
        {CATEGORIES.map((cat) => {
          const count = selectedArea.counts[cat];
          const pct = (count / maxCount) * 100;
          return (
            <div key={cat}>
              <div className="flex items-center justify-between text-[11px] text-gray-600 mb-0.5">
                <span>{CATEGORY_LABELS[cat]}</span>
                <span className="tabular-nums">
                  {count.toLocaleString()} incidents
                  {selectedArea.population && selectedArea.population > 0 && (
                    <span className="text-gray-400 ml-1">
                      ({((count / selectedArea.population) * 10000).toFixed(1)} per 10K)
                    </span>
                  )}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: BAR_COLORS[cat],
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Crime Trend (hidden for tract areas — no trend data) */}
      {selectedArea.type !== 'tract' && (
        <div className="px-3 pb-2 border-t border-gray-100 pt-2">
          <div className="text-xs text-gray-500 mb-1">12-Month Trend</div>
          {trendData && trendData.length >= 2 ? (
            <Sparkline data={trendData.map((m) => m.total)} width={200} height={30} />
          ) : (
            <div className="text-xs text-gray-400 italic">Insufficient data for trend</div>
          )}
        </div>
      )}

      {/* Parent comparison */}
      {parentArea && (
        <div className="px-3 pb-2 text-[11px] text-gray-500 border-t border-gray-100 pt-2">
          <span className="font-medium text-gray-700">{parentArea.name} avg:</span>{' '}
          {parentArea.score.toFixed(2)} vs{' '}
          <span className="font-medium text-gray-700">This area:</span>{' '}
          {selectedArea.score.toFixed(2)}
        </div>
      )}

      {/* Sources */}
      {selectedArea.sources.length > 0 && (
        <div className="px-3 pb-3 text-[10px] text-gray-400">
          Data sources: {selectedArea.sources.join(', ')}
        </div>
      )}
    </div>
  );
}
