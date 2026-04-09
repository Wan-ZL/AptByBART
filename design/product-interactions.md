# Product Interaction Design

## Product Domain
AptByBART — apartment search for BART commuters.

## Primary User Persona
"Alex" — renter commuting to Montgomery St, needs to find affordable + safe apartments near BART.

## Interaction Inventory

| Element | Location | Trigger | Expected Response | Status |
|---------|----------|---------|-------------------|--------|
| Price range slider | FilterSidebar | Drag | Instant filter, markers update, URL syncs | ✅ |
| Bedroom toggle buttons | FilterSidebar | Click | Multi-select toggle, instant filter | ✅ |
| Amenity checkboxes | FilterSidebar | Click | Toggle, instant filter | ✅ |
| Commute slider | FilterSidebar | Drag | Filter by BART time, show "X min to Montgomery" | ✅ |
| Safety slider | FilterSidebar | Drag | Filter by score, show "Min: X/10" | ✅ |
| Apartment card (sidebar) | FilterSidebar | Hover | Visual highlight only (NOT select/popup) | 🔧 Fix #5 |
| Apartment card (sidebar) | FilterSidebar | Click | Select apartment, pan map to it, open popup | 🔧 Fix #16 |
| Apartment marker (map) | Map | Click | Open apartment popup, fetch detail | ✅ |
| Cluster marker (map) | Map | Click | Zoom to expand cluster | ✅ |
| BART station marker | Map | Click | Open station popup | ✅ |
| Safety toggle button | Map (top-left) | Click | Toggle choropleth overlay + show legend | 🔧 Fix #6, #7 |
| Station popup close | StationPopup | Click X | Close popup | ✅ |
| Apartment popup close | ApartmentPopup | Click X | Close popup | ✅ |
| "View Website" link | ApartmentPopup | Click | Open apartment site in new tab | ✅ |
| Filter button (mobile) | Header | Click | Open filter slide-over modal | ✅ |
| Bottom sheet handle | MobileBottomSheet | Tap | Toggle expand/collapse | ✅ |
| Mobile apartment card | MobileBottomSheet | Tap | Select + fly map to apartment | ✅ |
| Map zoom/pan | Map | Pinch/scroll | Update viewport | ✅ |
| Geolocate button | Map | Click | Center map on user location | ✅ |

## Empty State Handling
| State | Current | Required |
|-------|---------|----------|
| No apartments match filters | "No apartments match your filters." | Add which filter is most restrictive + "Reset Filters" button |
| Apartment popup fetch fails | Silent failure, empty popup | Show "Failed to load. Tap to retry." |
| Initial page load failure | Silent, blank map | Show error banner with retry button |
| First-time visitor | No guidance | Show dismissible onboarding overlay |

## Conditional Rendering Rules
| Condition | Show | Hide |
|-----------|------|------|
| Desktop (≥1024px) | FilterSidebar | MobileBottomSheet, Filter button |
| Mobile (<1024px) | MobileBottomSheet, Filter button | FilterSidebar (until modal opened) |
| safetyOverlayVisible=true | Safety choropleth + legend | — |
| selectedStationId set | StationPopup | — |
| selectedApartmentId set | ApartmentPopup | — |
| filteredApartments.length=0 | Empty state with suggestions | Apartment list |
| Floor plan availableUnits=0 | Grayed out row with "Unavailable" | — |

## Accepted Tradeoffs
- No keyboard navigation for map markers (MapLibre limitation)
- Price labels on map are approximate (rounded) — acceptable for visual scanning
- Commute filter is BART ride time only, not total door-to-door time (labeled accordingly)

## Last Reviewed: 2026-04-09
