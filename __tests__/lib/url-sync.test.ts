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
      minSafetyScore: 1,
    },
    viewport: { latitude: 37.7749, longitude: -122.2194, zoom: 10 },
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

  describe('initStoreFromUrl — safety param', () => {
    it('parses safety value', () => {
      setUrlSearch('?safety=7');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.minSafetyScore).toBe(7);
    });

    it('ignores invalid safety value', () => {
      setUrlSearch('?safety=abc');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.minSafetyScore).toBe(1);
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
      expect(viewport.latitude).toBeCloseTo(37.7749);
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

    it('writes safety when above 1', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setMinSafety(5);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).toContain('safety=5');
    });

    it('omits safety when 1 (default)', () => {
      setUrlSearch('');
      renderHook(() => useUrlSync());

      act(() => {
        useAppStore.getState().setMinSafety(1);
      });

      const lastUrl = replaceStateSpy.mock.calls.at(-1)?.[2] as string;
      expect(lastUrl).not.toContain('safety');
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
      expect(filters.minSafetyScore).toBe(1);
    });

    it('handles missing commute param without error', () => {
      setUrlSearch('?price_min=2000');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.maxCommuteMin).toBe(60);
    });

    it('handles missing safety param without error', () => {
      setUrlSearch('?price_min=2000');
      renderHook(() => useUrlSync());
      expect(useAppStore.getState().filters.minSafetyScore).toBe(1);
    });
  });
});
