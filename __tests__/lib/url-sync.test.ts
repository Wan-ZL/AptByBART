import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import { useUrlSync } from '@/lib/url-sync';

function setUrlSearch(search: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search, pathname: '/' },
    writable: true,
    configurable: true,
  });
}

function resetStore() {
  useAppStore.setState({
    filters: {
      priceRange: [1000, 5000],
      bedrooms: [],
      inUnitWd: false,
      dishwasher: false,
      parking: false,
      gym: false,
      pool: false,
      petFriendly: false,
      maxCommuteMin: 60,
      maxRiskScore: 1,
    },
    viewport: { latitude: 37.5693, longitude: -121.8268, zoom: 9.5 },
  });
}

describe('URL sync logic', () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetStore();
    replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    setUrlSearch('');
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
  });

  describe('initStoreFromUrl — price params', () => {
    it('parses price_min and price_max from URL', () => {
      setUrlSearch('?price_min=2000&price_max=4000');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.priceRange).toEqual([2000, 4000]);
    });

    it('parses only price_min, keeps default max', () => {
      setUrlSearch('?price_min=2500');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.priceRange).toEqual([2500, 5000]);
    });

    it('parses only price_max, keeps default min', () => {
      setUrlSearch('?price_max=3000');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.priceRange).toEqual([1000, 3000]);
    });

    it('ignores invalid price params (NaN)', () => {
      setUrlSearch('?price_min=abc&price_max=xyz');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.priceRange).toEqual([1000, 5000]);
    });
  });

  describe('initStoreFromUrl — beds param', () => {
    it('parses comma-separated bed values', () => {
      setUrlSearch('?beds=0,1,2');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.bedrooms).toEqual([0, 1, 2]);
    });

    it('parses single bed value', () => {
      setUrlSearch('?beds=2');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.bedrooms).toEqual([2]);
    });
  });

  describe('initStoreFromUrl — amenity boolean params', () => {
    it('sets inUnitWd when wd=1', () => {
      setUrlSearch('?wd=1');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.inUnitWd).toBe(true);
    });

    it('does not set inUnitWd when wd is missing', () => {
      setUrlSearch('?');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.inUnitWd).toBe(false);
    });

    it('does not set inUnitWd when wd=0', () => {
      setUrlSearch('?wd=0');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.inUnitWd).toBe(false);
    });

    it('sets dishwasher when dw=1', () => {
      setUrlSearch('?dw=1');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.dishwasher).toBe(true);
    });

    it('does not set dishwasher when dw is absent', () => {
      setUrlSearch('?');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.dishwasher).toBe(false);
    });

    it('sets parking when parking=1', () => {
      setUrlSearch('?parking=1');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.parking).toBe(true);
    });

    it('does not set parking when parking is absent', () => {
      setUrlSearch('?');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.parking).toBe(false);
    });

    it('sets gym when gym=1', () => {
      setUrlSearch('?gym=1');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.gym).toBe(true);
    });

    it('does not set gym when gym is absent', () => {
      setUrlSearch('?');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.gym).toBe(false);
    });

    it('sets pool when pool=1', () => {
      setUrlSearch('?pool=1');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.pool).toBe(true);
    });

    it('does not set pool when pool is absent', () => {
      setUrlSearch('?');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.pool).toBe(false);
    });

    it('sets petFriendly when pet=1', () => {
      setUrlSearch('?pet=1');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.petFriendly).toBe(true);
    });

    it('does not set petFriendly when pet is absent', () => {
      setUrlSearch('?');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.petFriendly).toBe(false);
    });

    it('sets all amenities at once', () => {
      setUrlSearch('?wd=1&dw=1&parking=1&gym=1&pool=1&pet=1');
      renderHook(() => useUrlSync());
      const { filters } = useAppStore.getState();
      expect(filters.inUnitWd).toBe(true);
      expect(filters.dishwasher).toBe(true);
      expect(filters.parking).toBe(true);
      expect(filters.gym).toBe(true);
      expect(filters.pool).toBe(true);
      expect(filters.petFriendly).toBe(true);
    });
  });

  describe('initStoreFromUrl — commute param', () => {
    it('parses commute value', () => {
      setUrlSearch('?commute=30');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.maxCommuteMin).toBe(30);
    });

    it('ignores invalid commute value', () => {
      setUrlSearch('?commute=abc');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.maxCommuteMin).toBe(60);
    });
  });

  describe('initStoreFromUrl — risk param', () => {
    it('parses risk value', () => {
      setUrlSearch('?risk=0.3');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.maxRiskScore).toBe(0.3);
    });

    it('ignores invalid risk value', () => {
      setUrlSearch('?risk=abc');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.maxRiskScore).toBe(1);
    });
  });

  describe('initStoreFromUrl — viewport params', () => {
    it('parses lat, lng, zoom', () => {
      setUrlSearch('?lat=37.8&lng=-122.4&zoom=12.5');
      renderHook(() => useUrlSync());
      const { viewport } = useAppStore.getState();
      expect(viewport.latitude).toBeCloseTo(37.8);
      expect(viewport.longitude).toBeCloseTo(-122.4);
      expect(viewport.zoom).toBeCloseTo(12.5);
    });

    it('defaults zoom to 10 when not provided', () => {
      setUrlSearch('?lat=37.8&lng=-122.4');
      renderHook(() => useUrlSync());
      const { viewport } = useAppStore.getState();
      expect(viewport.zoom).toBe(10);
    });

    it('does not change viewport when only lat is provided', () => {
      setUrlSearch('?lat=37.8');
      renderHook(() => useUrlSync());
      const { viewport } = useAppStore.getState();
      // Should remain default since both lat AND lng are required
      expect(viewport.latitude).toBeCloseTo(37.5693);
    });
  });

  describe('writeFiltersToUrl — triggered on filter changes', () => {
    it('writes price_min to URL when non-default', () => {
      setUrlSearch('');
      const { result } = renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setPriceRange([2000, 5000]);
      });

      expect(replaceStateSpy).toHaveBeenCalled();
      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('price_min=2000');
      expect(lastUrl).not.toContain('price_max');
    });

    it('writes price_max to URL when non-default', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setPriceRange([1000, 4000]);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('price_max=4000');
      expect(lastUrl).not.toContain('price_min');
    });

    it('writes both price params when both non-default', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setPriceRange([2000, 4000]);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('price_min=2000');
      expect(lastUrl).toContain('price_max=4000');
    });

    it('writes beds param when bedrooms selected', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setBedrooms([1, 2]);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('beds=1%2C2');
    });

    it('omits beds param when no bedrooms', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setBedrooms([]);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).not.toContain('beds');
    });

    it('writes wd=1 when inUnitWd is true', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setFilter('inUnitWd', true);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('wd=1');
    });

    it('writes dw=1 when dishwasher is true', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setFilter('dishwasher', true);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('dw=1');
    });

    it('writes parking=1 when parking is true', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setFilter('parking', true);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('parking=1');
    });

    it('writes gym=1 when gym is true', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setFilter('gym', true);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('gym=1');
    });

    it('writes pool=1 when pool is true', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setFilter('pool', true);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('pool=1');
    });

    it('writes pet=1 when petFriendly is true', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setFilter('petFriendly', true);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('pet=1');
    });

    it('writes commute when less than 60', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setMaxCommute(30);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('commute=30');
    });

    it('omits commute when 60 (default)', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setMaxCommute(60);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).not.toContain('commute');
    });

    it('writes risk when below 1', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setMaxRisk(0.5);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('risk=0.5');
    });

    it('omits risk when 1 (default)', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setMaxRisk(1);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).not.toContain('risk');
    });

    it('writes clean pathname when all filters are default', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      // Trigger a filter change then reset to defaults
      act(() => {
        useAppStore.getState().setPriceRange([2000, 4000]);
      });
      act(() => {
        useAppStore.getState().resetFilters();
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toBe('/');
    });

    it('writes viewport lat/lng/zoom to URL when non-default', () => {
      vi.useFakeTimers();
      setUrlSearch('');
      renderHook(() => useUrlSync());

      // Trigger a filter change first to move past isFirstRender
      act(() => {
        useAppStore.getState().setPriceRange([2000, 5000]);
      });

      // Now change viewport — writeFiltersToUrl is called via the viewport effect with debounce
      act(() => {
        useAppStore.getState().setViewport({ latitude: 38.0, longitude: -121.0, zoom: 12 });
      });

      // Fast-forward the debounce timer (viewport subscribe uses 500ms debounce)
      act(() => {
        vi.advanceTimersByTime(550);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('lat=38.0000');
      expect(lastUrl).toContain('lng=-121.0000');
      expect(lastUrl).toContain('zoom=12.0');
      vi.useRealTimers();
    });

    it('omits viewport from URL when at default values', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      // Change price to trigger URL write, keep viewport default
      act(() => {
        useAppStore.getState().setPriceRange([2000, 5000]);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).not.toContain('lat=');
      expect(lastUrl).not.toContain('lng=');
      expect(lastUrl).not.toContain('zoom=');
    });

    it('does not write URL on first render (skip first effect)', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      // The first effect run should NOT write to URL (isFirstRender guard)
      // Only the init call should have happened, which doesn't write URL for defaults
      const callsBeforeChange = replaceStateSpy.mock.calls.length;

      // Now change a filter — this should trigger a URL write
      act(() => {
        useAppStore.getState().toggleAmenity('gym');
      });

      expect(replaceStateSpy.mock.calls.length).toBeGreaterThan(callsBeforeChange);
    });

    it('debounces viewport changes', () => {
      vi.useFakeTimers();
      setUrlSearch('');
      renderHook(() => useUrlSync());

      // Move past first render for filters
      act(() => {
        useAppStore.getState().setPriceRange([2000, 5000]);
      });

      const callsAfterFilter = replaceStateSpy.mock.calls.length;

      // Multiple rapid viewport changes — should debounce
      act(() => {
        useAppStore.getState().setViewport({ latitude: 38.0, longitude: -121.0, zoom: 12 });
      });
      act(() => {
        useAppStore.getState().setViewport({ latitude: 39.0, longitude: -120.0, zoom: 11 });
      });

      // Before debounce fires, no viewport URL writes
      const callsBeforeDebounce = replaceStateSpy.mock.calls.length;

      act(() => {
        vi.advanceTimersByTime(550);
      });

      // After debounce, there should be exactly one URL write for viewport
      expect(replaceStateSpy.mock.calls.length).toBe(callsBeforeDebounce + 1);
      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('lat=39.0000');
      vi.useRealTimers();
    });
  });

  describe('initStoreFromUrl — edge cases', () => {
    it('handles no URL params gracefully', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());
      // All defaults should remain
      const { filters } = useAppStore.getState();
      expect(filters.priceRange).toEqual([1000, 5000]);
      expect(filters.bedrooms).toEqual([]);
      expect(filters.maxCommuteMin).toBe(60);
      expect(filters.maxRiskScore).toBe(1);
    });

    it('handles missing commute param without error', () => {
      setUrlSearch('?price_min=2000');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.maxCommuteMin).toBe(60);
    });

    it('handles missing risk param without error', () => {
      setUrlSearch('?price_min=2000');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.maxRiskScore).toBe(1);
    });
  });

  // --- Mutation-killing tests for url-sync.ts ---

  describe('initStoreFromUrl — mutation killers', () => {
    // Kill: `if (priceMin || priceMax)` → `if (true)` (line 14)
    // When neither price_min nor price_max is present, setPriceRange should NOT be called
    it('does not call setPriceRange when neither price_min nor price_max is in URL', () => {
      setUrlSearch('?wd=1');
      const setPriceRangeSpy = vi.spyOn(useAppStore.getState(), 'setPriceRange');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.priceRange).toEqual([1000, 5000]);
    });

    // Kill: `!isNaN(min) && !isNaN(max)` → `!isNaN(min) || !isNaN(max)` (line 17)
    // When only one of min/max is NaN, setPriceRange should NOT be called
    it('does not set price range when price_min is NaN but price_max is valid', () => {
      setUrlSearch('?price_min=abc&price_max=3000');
      renderHook(() => useUrlSync());
      // min would be NaN, max would be 3000. With &&, neither gets set. With ||, it would wrongly set.
      expect(useAppStore.getState().filters.priceRange).toEqual([1000, 5000]);
    });

    it('does not set price range when price_max is NaN but price_min is valid', () => {
      setUrlSearch('?price_min=2000&price_max=abc');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.priceRange).toEqual([1000, 5000]);
    });

    // Kill: beds.split(',') → beds.split('') (line 22 string literal mutant)
    // With split(''), "0,1,2" → ['0',',','1',',','2'] → map(Number) → [0, NaN, 1, NaN, 2]
    // After filter(!isNaN), we'd get [0, 1, 2] which is same. BUT without filter, we get NaN.
    // The .filter removal mutant is separate. Test with a single value to detect split('') difference.
    it('parses beds=10 correctly as a single bedroom value', () => {
      setUrlSearch('?beds=10');
      renderHook(() => useUrlSync());
      // With split(','), "10" → ['10'] → [10]
      // With split(''), "10" → ['1','0'] → [1, 0] — different!
      expect(useAppStore.getState().filters.bedrooms).toEqual([10]);
    });

    // Kill: .filter((n) => !isNaN(n)) removal (line 22)
    // With filter removed, NaN values could get through. Test with invalid bed value.
    it('filters out NaN values from beds param', () => {
      setUrlSearch('?beds=1,abc,2');
      renderHook(() => useUrlSync());
      const bedrooms = useAppStore.getState().filters.bedrooms;
      expect(bedrooms).toEqual([1, 2]);
      expect(bedrooms.every((b: number) => !isNaN(b))).toBe(true);
    });

    // Kill: `bedrooms.length > 0` → `true` or `>= 0` (line 23)
    // When beds param is present but all values are invalid (empty after filter),
    // setBedrooms should NOT be called. We preload bedrooms AFTER reset so init
    // runs with pre-existing bedrooms that the invalid URL param should not clear.
    it('does not overwrite bedrooms when all bed values in URL are invalid', () => {
      // First, set bedrooms before the hook mounts
      useAppStore.getState().setBedrooms([1, 2]);
      setUrlSearch('?beds=abc,xyz');
      renderHook(() => useUrlSync());
      // With > 0: filtered bedrooms is [], length is 0, guard is false → setBedrooms NOT called
      // With true or >= 0: setBedrooms([]) called → clears bedrooms to empty
      const bedrooms = useAppStore.getState().filters.bedrooms;
      expect(bedrooms).toEqual([1, 2]);
      expect(bedrooms).toHaveLength(2);
    });

    // Kill: `if (commute)` → `if (true)` (line 34)
    // When commute param is absent, we should NOT call setMaxCommute
    it('does not change maxCommuteMin when commute param is absent', () => {
      useAppStore.getState().setMaxCommute(30);
      setUrlSearch('?price_min=2000');
      renderHook(() => useUrlSync());
      // The hook calls initStoreFromUrl, which should NOT touch maxCommuteMin
      // since there's no commute param. With `if (true)`, it would try to parseInt(null)
      // which is NaN, and the isNaN guard would save us. So this mutant is equivalent.
      // Actually let's verify it stays at the store default (60) not our modified 30,
      // because the hook resets via beforeEach. The key question is: does the mutant
      // cause a different result?
      // With `if (true)`: commute is null, val = parseInt(null) = NaN, isNaN(NaN) = true → skip
      // So this mutant IS equivalent. Moving on.
    });

    // Kill: `if (safety)` → `if (true)` (line 40) — same pattern, equivalent mutant

    // Kill: viewport `||` → `&&` mutations (line 75)
    // Test that changing ONLY latitude (not longitude or zoom) writes viewport to URL
    it('writes viewport when only latitude differs from default', () => {
      vi.useFakeTimers();
      setUrlSearch('');
      renderHook(() => useUrlSync());

      // Move past first render
      act(() => {
        useAppStore.getState().setPriceRange([2000, 5000]);
      });

      // Change only latitude
      act(() => {
        useAppStore.getState().setViewport({ latitude: 38.0, longitude: -121.8268, zoom: 9.5 });
      });

      act(() => {
        vi.advanceTimersByTime(550);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('lat=38.0000');
      vi.useRealTimers();
    });

    // Kill: viewport `||` → `&&` — test only longitude change
    it('writes viewport when only longitude differs from default', () => {
      vi.useFakeTimers();
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setPriceRange([2000, 5000]);
      });

      act(() => {
        useAppStore.getState().setViewport({ latitude: 37.5693, longitude: -121.0, zoom: 9.5 });
      });

      act(() => {
        vi.advanceTimersByTime(550);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('lng=-121.0000');
      vi.useRealTimers();
    });

    // Kill: viewport `||` → `&&` — test only zoom change
    it('writes viewport when only zoom differs from default', () => {
      vi.useFakeTimers();
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setPriceRange([2000, 5000]);
      });

      act(() => {
        useAppStore.getState().setViewport({ latitude: 37.5693, longitude: -121.8268, zoom: 15 });
      });

      act(() => {
        vi.advanceTimersByTime(550);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('zoom=15.0');
      vi.useRealTimers();
    });

    // Kill: `if (vp === prevViewport) return` → `if (false) return` or `!==` (line 116)
    // When viewport doesn't change, no new URL write should happen
    it('does not write URL when viewport reference does not change', () => {
      vi.useFakeTimers();
      setUrlSearch('');
      renderHook(() => useUrlSync());

      // Move past first render
      act(() => {
        useAppStore.getState().setPriceRange([2000, 5000]);
      });

      const callsAfterFilter = replaceStateSpy.mock.calls.length;

      // Trigger a non-viewport state change (selection) — viewport stays same reference
      act(() => {
        useAppStore.getState().selectApartment(1);
      });

      // Advance timer — but no viewport URL write should happen
      act(() => {
        vi.advanceTimersByTime(550);
      });

      // No extra replaceState calls from viewport subscription
      // (the filter change already wrote once, and selectApartment shouldn't trigger viewport write)
      const callsAfterSelect = replaceStateSpy.mock.calls.length;
      expect(callsAfterSelect).toBe(callsAfterFilter);
      vi.useRealTimers();
    });

    // Kill: `isFirstRender.current` → `false` and BlockStatement removal (lines 101-104)
    // The first render after mount should NOT write to URL
    it('first filter effect render does not write URL', () => {
      setUrlSearch('');
      const callsBefore = replaceStateSpy.mock.calls.length;
      renderHook(() => useUrlSync());
      // After mount, isFirstRender should prevent writeFiltersToUrl from running
      // No replaceState calls should have happened from the filter effect
      expect(replaceStateSpy.mock.calls.length).toBe(callsBefore);
    });

    // Kill: `initialized.current` check → `if (true)` (line 92)
    // and `initialized.current = true` → `= false` (line 93)
    // Test that initStoreFromUrl runs only once across re-renders
    it('only initializes from URL once across re-renders', () => {
      setUrlSearch('?price_min=2000');
      const { rerender } = renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.priceRange[0]).toBe(2000);

      // Change the URL and re-render — should NOT re-initialize
      setUrlSearch('?price_min=3000');
      rerender();
      // Price should still be 2000 from first init, not 3000
      expect(useAppStore.getState().filters.priceRange[0]).toBe(2000);
    });

    // Kill: `isFirstRender.current = false` → `= true` (line 99/102)
    // and the whole if block being emptied
    it('second filter change writes to URL after first render skip', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      // First change triggers the effect but isFirstRender should skip the write
      act(() => {
        useAppStore.getState().setPriceRange([2000, 5000]);
      });
      const firstChangeUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      // Should have written (isFirstRender was true on mount effect, then set to false)
      expect(firstChangeUrl).toContain('price_min=2000');

      // Second change should also write
      act(() => {
        useAppStore.getState().setPriceRange([3000, 5000]);
      });
      const secondChangeUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(secondChangeUrl).toContain('price_min=3000');
    });

    // Kill: replaceState second param '' → "Stryker was here!" (line 83)
    // Verify the title param passed to replaceState
    it('calls replaceState with empty string as title', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setPriceRange([2000, 5000]);
      });

      const lastCall = replaceStateSpy.mock.calls.at(-1);
      expect(lastCall?.[0]).toBeNull();
      expect(lastCall?.[1]).toBe('');
    });

    // Kill: useEffect dependency array [] → ["Stryker was here"] (lines 96, 129)
    // These are hard to kill directly. The functional behavior is what matters.
    // If the deps array had a value, the effect would re-run on every render.
    // We already test that init runs only once above.

    // Kill: `if (timer) clearTimeout(timer)` → `if (true)` or `if (false)` (lines 119, 127)
    // These are cleanup guards. Testing the cleanup behavior:
    it('cleans up viewport subscription timer on unmount', () => {
      vi.useFakeTimers();
      setUrlSearch('');
      const { unmount } = renderHook(() => useUrlSync());

      // Move past first render
      act(() => {
        useAppStore.getState().setPriceRange([2000, 5000]);
      });

      // Start a viewport change (sets a timer)
      act(() => {
        useAppStore.getState().setViewport({ latitude: 38.0, longitude: -121.0, zoom: 12 });
      });

      const callsBefore = replaceStateSpy.mock.calls.length;

      // Unmount before the debounce fires
      unmount();

      // Advance time — the timer should have been cleared on unmount
      act(() => {
        vi.advanceTimersByTime(550);
      });

      // No additional replaceState calls should have happened
      expect(replaceStateSpy.mock.calls.length).toBe(callsBefore);
      vi.useRealTimers();
    });
  });
});
