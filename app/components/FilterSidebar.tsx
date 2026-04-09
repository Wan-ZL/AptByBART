'use client';

import * as Slider from '@radix-ui/react-slider';
import * as Checkbox from '@radix-ui/react-checkbox';
import { useAppStore, selectFilteredApartments } from '@/lib/store';
import ApartmentCard from './ApartmentCard';

const BEDROOM_OPTIONS = [
  { value: 0, label: 'Studio' },
  { value: 1, label: '1BR' },
  { value: 2, label: '2BR' },
  { value: 3, label: '3BR+' },
];

const AMENITY_OPTIONS: {
  key: 'inUnitWd' | 'dishwasher' | 'parking' | 'pool' | 'gym' | 'petFriendly';
  label: string;
}[] = [
  { key: 'inUnitWd', label: 'In-unit W/D' },
  { key: 'dishwasher', label: 'Dishwasher' },
  { key: 'parking', label: 'Garage Parking' },
  { key: 'pool', label: 'Pool' },
  { key: 'gym', label: 'Gym' },
  { key: 'petFriendly', label: 'Pet-friendly' },
];

function formatPriceShort(value: number): string {
  const k = value / 1000;
  return `$${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
}

function SliderTrack({ children }: { children: React.ReactNode }) {
  return (
    <Slider.Track className="relative h-1.5 w-full rounded-full bg-gray-200">
      <Slider.Range className="absolute h-full rounded-full bg-blue-500" />
      {children}
    </Slider.Track>
  );
}

function SliderThumb() {
  return (
    <Slider.Thumb className="block h-4 w-4 rounded-full bg-white border-2 border-blue-500 shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" />
  );
}

export default function FilterSidebar() {
  const filters = useAppStore((s) => s.filters);
  const filteredApartments = useAppStore(selectFilteredApartments);
  const setPriceRange = useAppStore((s) => s.setPriceRange);
  const toggleBedroom = useAppStore((s) => s.toggleBedroom);
  const toggleAmenity = useAppStore((s) => s.toggleAmenity);
  const setMaxCommute = useAppStore((s) => s.setMaxCommute);
  const setMinSafety = useAppStore((s) => s.setMinSafety);
  const selectApartment = useAppStore((s) => s.selectApartment);
  const resetFilters = useAppStore((s) => s.resetFilters);

  return (
    <aside className="w-[360px] bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="p-4 space-y-5 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">Filters</h2>

        {/* Price Range */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Price Range</span>
            <span className="text-xs text-gray-500">
              {formatPriceShort(filters.priceRange[0])} – {formatPriceShort(filters.priceRange[1])}
            </span>
          </div>
          <Slider.Root
            className="relative flex items-center select-none touch-none w-full h-5"
            min={1000}
            max={5000}
            step={100}
            value={filters.priceRange as unknown as number[]}
            onValueChange={(val) => setPriceRange([val[0], val[1]])}
          >
            <SliderTrack>
              <SliderThumb />
              <SliderThumb />
            </SliderTrack>
          </Slider.Root>
        </section>

        {/* Bedrooms */}
        <section>
          <span className="text-sm font-medium text-gray-700">Bedrooms</span>
          <div className="flex gap-2 mt-2">
            {BEDROOM_OPTIONS.map(({ value, label }) => {
              const active = filters.bedrooms.includes(value);
              return (
                <button
                  key={value}
                  onClick={() => toggleBedroom(value)}
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
        </section>

        {/* Amenities */}
        <section>
          <span className="text-sm font-medium text-gray-700">Amenities</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
            {AMENITY_OPTIONS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <Checkbox.Root
                  checked={filters[key]}
                  onCheckedChange={() => toggleAmenity(key)}
                  className="h-4 w-4 rounded border border-gray-300 flex items-center justify-center data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                >
                  <Checkbox.Indicator>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5L4 7.5L8.5 2.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Checkbox.Indicator>
                </Checkbox.Root>
                <span className="text-xs text-gray-600">{label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Max Commute */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Max Commute</span>
            <span className="text-xs text-gray-500">
              {filters.maxCommuteMin >= 60 ? 'No limit' : `${filters.maxCommuteMin} min to Montgomery`}
            </span>
          </div>
          <Slider.Root
            className="relative flex items-center select-none touch-none w-full h-5"
            min={10}
            max={60}
            step={5}
            value={[filters.maxCommuteMin]}
            onValueChange={(val) => setMaxCommute(val[0])}
          >
            <SliderTrack>
              <SliderThumb />
            </SliderTrack>
          </Slider.Root>
          <p className="text-xs text-gray-400 mt-1">Pre-computed to Montgomery St (Financial District)</p>
        </section>

        {/* Safety Score */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Safety Score</span>
            <span className="text-xs text-gray-500">
              {filters.minSafetyScore <= 1 ? 'No minimum' : `Min: ${filters.minSafetyScore}/10`}
            </span>
          </div>
          <Slider.Root
            className="relative flex items-center select-none touch-none w-full h-5"
            min={1}
            max={10}
            step={1}
            value={[filters.minSafetyScore]}
            onValueChange={(val) => setMinSafety(val[0])}
          >
            <SliderTrack>
              <SliderThumb />
            </SliderTrack>
          </Slider.Root>
        </section>

        {/* Result Count */}
        <div className="text-sm font-medium text-gray-600">
          {filteredApartments.length} apartment{filteredApartments.length !== 1 ? 's' : ''} found
        </div>
      </div>

      {/* Apartment List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filteredApartments.map((apt) => (
          <div
            key={apt.id}
            className="hover:bg-gray-50 rounded-lg transition-colors"
          >
            <ApartmentCard apartment={apt} />
          </div>
        ))}
        {filteredApartments.length === 0 && (
          <div className="text-center py-8 px-4">
            <p className="text-sm text-gray-500">No apartments match your filters.</p>
            <p className="text-xs text-gray-400 mt-2">Try increasing your price range or removing amenity requirements.</p>
            <button onClick={resetFilters} className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium">
              Reset All Filters
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
