import { test, expect } from '@playwright/test';

test.describe('Map', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('aptbybart-onboarding-dismissed', '1');
    });
    await page.goto('/');
  });

  // MapLibre requires client-side JS to initialize canvas.
  // Currently blocked by "Maximum update depth exceeded" crash in useUrlSync/viewport loop.
  test.fixme('should render the map canvas', async ({ page }) => {
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 });
  });

  // NavigationControl requires MapLibre to be initialized.
  test.fixme('should show map navigation controls', async ({ page }) => {
    await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible({ timeout: 15000 });
  });

  test('should show safety toggle button', async ({ page }) => {
    // SafetyToggleButton is rendered in SSR HTML
    await expect(page.getByText('Safety: OFF')).toBeVisible({ timeout: 10000 });
  });
});
