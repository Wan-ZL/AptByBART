import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAppStore } from '@/lib/store';
import ApartmentCard from '@/app/components/ApartmentCard';
import type { Apartment } from '@/lib/types';

function makeApartment(overrides: Partial<Apartment> = {}): Apartment {
  return {
    id: 1,
    name: 'Skyline Apartments',
    address: '100 Market St',
    lat: 37.79,
    lng: -122.40,
    websiteUrl: 'https://skyline.com',
    nearestStationId: 'MONT',
    walkMinToBart: 5,
    hasInUnitWd: true,
    hasDishwasher: true,
    hasParking: false,
    parkingType: null,
    hasGym: true,
    hasPool: false,
    petFriendly: true,
    scrapeStatus: 'ok',
    lastScrapedAt: null,
    minPrice: 2500,
    maxPrice: 4000,
    bedroomTypes: [0, 1, 2],
    ...overrides,
  };
}

describe('ApartmentCard', () => {
  beforeEach(() => {
    useAppStore.setState({
      stations: [
        {
          id: 'MONT',
          name: 'Montgomery St.',
          lat: 37.7894,
          lng: -122.4013,
          lineColors: ['yellow'],
          travelTimeMin: 0,
          fareCents: 0,
          monthlyCommuteCost: 0,
          safetyScore: 0.15,
        },
      ],
      apartments: [],
      selectedApartmentId: null,
      selectedStationId: null,
      viewport: { latitude: 37.5693, longitude: -121.8268, zoom: 9.5 },
    });
  });

  it('renders apartment name', () => {
    render(<ApartmentCard apartment={makeApartment()} />);
    expect(screen.getByText('Skyline Apartments')).toBeInTheDocument();
  });

  it('renders price range', () => {
    render(<ApartmentCard apartment={makeApartment({ minPrice: 2500, maxPrice: 4000 })} />);
    expect(screen.getByText('$2.5K - $4K')).toBeInTheDocument();
  });

  it('renders single price when min equals max', () => {
    render(<ApartmentCard apartment={makeApartment({ minPrice: 3000, maxPrice: 3000 })} />);
    expect(screen.getByText('$3K - $3K')).toBeInTheDocument();
  });

  it('renders bedroom types', () => {
    render(<ApartmentCard apartment={makeApartment({ bedroomTypes: [0, 1, 2] })} />);
    expect(screen.getByText('Studio, 1BR, 2BR')).toBeInTheDocument();
  });

  it('renders amenity badges for active amenities', () => {
    render(<ApartmentCard apartment={makeApartment()} />);
    expect(screen.getByText('W/D')).toBeInTheDocument();
    expect(screen.getByText('DW')).toBeInTheDocument();
    expect(screen.getByText('Gym')).toBeInTheDocument();
    expect(screen.getByText('Pet')).toBeInTheDocument();
    // hasParking=false, hasPool=false, so no P or Pool badges
    expect(screen.queryByText('P')).not.toBeInTheDocument();
    expect(screen.queryByText('Pool')).not.toBeInTheDocument();
  });

  it('renders nearest station name and walk time', () => {
    render(<ApartmentCard apartment={makeApartment()} />);
    expect(screen.getByText(/Montgomery St\./)).toBeInTheDocument();
    expect(screen.getByText(/5 min walk/)).toBeInTheDocument();
  });

  it('renders safety score badge', () => {
    render(<ApartmentCard apartment={makeApartment()} />);
    expect(screen.getByText('0.15')).toBeInTheDocument();
  });

  it('selects apartment and pans map on click', () => {
    render(<ApartmentCard apartment={makeApartment()} />);
    const card = screen.getByText('Skyline Apartments').closest('div[class*="cursor-pointer"]')!;
    fireEvent.click(card);

    const state = useAppStore.getState();
    expect(state.selectedApartmentId).toBe(1);
    expect(state.viewport.latitude).toBe(37.79);
    expect(state.viewport.longitude).toBe(-122.40);
    expect(state.viewport.zoom).toBe(15);
  });

  it('shows selected style when apartment is selected', () => {
    useAppStore.setState({ selectedApartmentId: 1 });
    render(<ApartmentCard apartment={makeApartment()} />);
    const card = screen.getByText('Skyline Apartments').closest('div[class*="cursor-pointer"]')!;
    expect(card.className).toContain('border-blue-500');
    expect(card.className).toContain('bg-blue-50');
  });

  it('shows default style when apartment is not selected', () => {
    useAppStore.setState({ selectedApartmentId: 999 });
    render(<ApartmentCard apartment={makeApartment()} />);
    const card = screen.getByText('Skyline Apartments').closest('div[class*="cursor-pointer"]')!;
    expect(card.className).toContain('border-gray-200');
  });

  it('handles apartment without nearest station', () => {
    render(<ApartmentCard apartment={makeApartment({ nearestStationId: null })} />);
    expect(screen.queryByText(/Montgomery/)).not.toBeInTheDocument();
  });

  it('handles apartment without prices', () => {
    render(<ApartmentCard apartment={makeApartment({ minPrice: null, maxPrice: null })} />);
    // Should not render price div
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('handles apartment with only minPrice', () => {
    render(<ApartmentCard apartment={makeApartment({ minPrice: 2500, maxPrice: null })} />);
    expect(screen.getByText('$2.5K')).toBeInTheDocument();
  });

  it('renders empty bedroom list gracefully', () => {
    render(<ApartmentCard apartment={makeApartment({ bedroomTypes: [] })} />);
    // No bedroom text should render
    expect(screen.queryByText('Studio')).not.toBeInTheDocument();
  });
});
