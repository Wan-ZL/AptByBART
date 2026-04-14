'use client';

import { useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { useAppStore } from '@/lib/store';
import { WEIGHT_PRESETS } from '@/lib/crime-taxonomy';
import type { SafetyPreset, SafetyWeights } from '@/lib/crime-taxonomy';

const PRESET_OPTIONS: { value: Exclude<SafetyPreset, 'custom'>; label: string }[] = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'personal_safety', label: 'Personal Safety' },
  { value: 'protect_my_stuff', label: 'Property' },
  { value: 'night_owl', label: 'Night Owl' },
];

const WEIGHT_SLIDERS: { key: keyof SafetyWeights; label: string }[] = [
  { key: 'violent', label: 'Violent Crime' },
  { key: 'property', label: 'Property Crime' },
  { key: 'vehicle', label: 'Vehicle Crime' },
  { key: 'qualityOfLife', label: 'Quality of Life' },
];

export default function SafetyWeightControls() {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const safetyPreset = useAppStore((s) => s.safetyPreset);
  const safetyWeights = useAppStore((s) => s.safetyWeights);
  const setSafetyPreset = useAppStore((s) => s.setSafetyPreset);
  const setSafetyWeights = useAppStore((s) => s.setSafetyWeights);

  const handleSliderChange = (key: keyof SafetyWeights, value: number) => {
    setSafetyWeights({ ...safetyWeights, [key]: value });
  };

  return (
    <div className="space-y-2">
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-1.5">
        {PRESET_OPTIONS.map(({ value, label }) => {
          const active = safetyPreset === value;
          return (
            <button
              key={value}
              onClick={() => setSafetyPreset(value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                active
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Toggle advanced */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs text-blue-600 hover:text-blue-800"
      >
        {showAdvanced ? 'Hide' : 'Customize'}
      </button>

      {/* Advanced sliders */}
      {showAdvanced && (
        <div className="space-y-3 pt-1">
          {WEIGHT_SLIDERS.map(({ key, label }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-600">{label}</span>
                <span className="text-xs text-gray-400">{safetyWeights[key].toFixed(1)}</span>
              </div>
              <Slider.Root
                className="relative flex items-center select-none touch-none w-full h-5"
                min={0}
                max={5}
                step={0.5}
                value={[safetyWeights[key]]}
                onValueChange={(val) => handleSliderChange(key, val[0])}
              >
                <Slider.Track className="relative h-1.5 w-full rounded-full bg-gray-200">
                  <Slider.Range className="absolute h-full rounded-full bg-blue-500" />
                  <Slider.Thumb className="block h-4 w-4 rounded-full bg-white border-2 border-blue-500 shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" />
                </Slider.Track>
              </Slider.Root>
            </div>
          ))}

          {safetyPreset === 'custom' && (
            <button
              onClick={() => setSafetyPreset('balanced')}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Reset to Balanced
            </button>
          )}
        </div>
      )}
    </div>
  );
}
