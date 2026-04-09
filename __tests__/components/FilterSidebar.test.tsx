import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import type { Apartment } from '@/lib/types';

// Mock Radix UI Slider
vi.mock('@radix-ui/react-slider', () => {
  const Root = ({ children, ...props }: any) => (
    <div data-testid="slider-root">{children}</div>
  );
  const Track = ({ children }: any) => <div>{children}</div>;
  const Range = () => <div />;
  const Thumb = () => <div />;
  return { Root, Track, Range, Thumb };
});

// Mock Radix UI Checkbox
vi.mock('@radix-ui/react-checkbox', () => {
  const Root = ({ children, checked, onCheckedChange, ...props }: any) => (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
    >
      {children}
    </button>
  );
  const Indicator = ({ children }: any) => <span>{children}</span>;
  return { Root, Indicator };
});

// Mock ApartmentCard
vi.mock('@/app/components/ApartmentCard', () => ({
  default: ({ apartment }: any) => (
    <div data-testid={`apartment-card-${apartment.id}`}>{apartment.name}</div>
  ),
}));

// Mock selectFilteredApartments to avoid the infinite re-render loop
// The real selector creates new array refs each call, which triggers
// infinite updates in React 19's strict useSyncExternalStore
let mockFilteredApartments: Apartment[] = [];
vi.mock('@/lib/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/store')>();
  return {
    ...actual,
    selectFilteredApartments: () => mockFilteredApartments,
  };
});

import FilterSidebar from '@/app/components/FilterSidebar';

describe('FilterSidebar', () => {
  beforeEach(() => {
    mockFilteredApartments = [];
    useAppStore.setState({
      stations: [],
      apartments: [],
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
      selectedApartmentId: null,
      selectedStationId: null,
      safetyOverlayVisible: false,
      viewport: { latitude: 37.7749, longitude: -122.2194, zoom: 10 },
    });
  });

  it('renders the Filters heading', () => {
    render(<FilterSidebar />);
    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  it('renders bedroom toggle buttons', () => {
    render(<FilterSidebar />);
    expect(screen.getByText('Studio')).toBeInTheDocument();
    expect(screen.getByText('1BR')).toBeInTheDocument();
    expect(screen.getByText('2BR')).toBeInTheDocument();
    expect(screen.getByText('3BR+')).toBeInTheDocument();
  });

  it('renders amenity checkboxes', () => {
    render(<FilterSidebar />);
    expect(screen.getByText('In-unit W/D')).toBeInTheDocument();
    expect(screen.getByText('Dishwasher')).toBeInTheDocument();
    expect(screen.getByText('Garage Parking')).toBeInTheDocument();
    expect(screen.getByText('Pool')).toBeInTheDocument();
    expect(screen.getByText('Gym')).toBeInTheDocument();
    expect(screen.getByText('Pet-friendly')).toBeInTheDocument();
  });

  it('renders price range label', () => {
    render(<FilterSidebar />);
    expect(screen.getByText('Price Range')).toBeInTheDocument();
  });

  it('renders Max Commute section', () => {
    render(<FilterSidebar />);
    expect(screen.getByText('Max Commute')).toBeInTheDocument();
  });

  it('renders Safety Score section', () => {
    render(<FilterSidebar />);
    expect(screen.getByText('Safety Score')).toBeInTheDocument();
  });

  it('toggles bedroom when clicked', () => {
    render(<FilterSidebar />);
    const studioBtn = screen.getByText('Studio');
    fireEvent.click(studioBtn);
    expect(useAppStore.getState().filters.bedrooms).toContain(0);
  });

  it('toggles bedroom off when clicked again', () => {
    render(<FilterSidebar />);
    const btn1BR = screen.getByText('1BR');
    fireEvent.click(btn1BR);
    expect(useAppStore.getState().filters.bedrooms).toContain(1);
    fireEvent.click(btn1BR);
    expect(useAppStore.getState().filters.bedrooms).not.toContain(1);
  });

  it('shows apartment count', () => {
    render(<FilterSidebar />);
    expect(screen.getByText('0 apartments found')).toBeInTheDocument();
  });

  it('shows singular "apartment" for 1 result', () => {
    const apt: Apartment = {
      id: 1,
      name: 'Test',
      address: '123',
      lat: 37.8,
      lng: -122.3,
      websiteUrl: '',
      nearestStationId: null,
      walkMinToBart: null,
      hasInUnitWd: false,
      hasDishwasher: false,
      hasParking: false,
      parkingType: null,
      hasGym: false,
      hasPool: false,
      petFriendly: false,
      scrapeStatus: 'ok',
      lastScrapedAt: null,
      minPrice: 2000,
      maxPrice: 3000,
      bedroomTypes: [1],
    };
    mockFilteredApartments = [apt];
    render(<FilterSidebar />);
    expect(screen.getByText('1 apartment found')).toBeInTheDocument();
  });

  it('shows reset button when no apartments match', () => {
    render(<FilterSidebar />);
    expect(screen.getByText('Reset All Filters')).toBeInTheDocument();
  });

  it('resets filters when reset button clicked', () => {
    useAppStore.getState().setPriceRange([3000, 4000]);
    useAppStore.getState().toggleBedroom(2);

    render(<FilterSidebar />);
    const resetBtn = screen.getByText('Reset All Filters');
    fireEvent.click(resetBtn);

    const { filters } = useAppStore.getState();
    expect(filters.priceRange).toEqual([1000, 5000]);
    expect(filters.bedrooms).toEqual([]);
  });

  it('renders apartment cards when apartments match filters', () => {
    const apt: Apartment = {
      id: 1,
      name: 'Cool Loft',
      address: '100 Market',
      lat: 37.8,
      lng: -122.3,
      websiteUrl: '',
      nearestStationId: null,
      walkMinToBart: null,
      hasInUnitWd: false,
      hasDishwasher: false,
      hasParking: false,
      parkingType: null,
      hasGym: false,
      hasPool: false,
      petFriendly: false,
      scrapeStatus: 'ok',
      lastScrapedAt: null,
      minPrice: 2000,
      maxPrice: 3000,
      bedroomTypes: [1],
    };
    mockFilteredApartments = [apt];

    render(<FilterSidebar />);
    expect(screen.getByTestId('apartment-card-1')).toBeInTheDocument();
    expect(screen.getByText('Cool Loft')).toBeInTheDocument();
  });

  it('displays no-results message when filtered list is empty', () => {
    render(<FilterSidebar />);
    expect(screen.getByText('No apartments match your filters.')).toBeInTheDocument();
  });
});
