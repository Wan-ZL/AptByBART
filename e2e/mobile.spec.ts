import { test, expect } from '@playwright/test';

test.describe('Mobile Layout', () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('aptbybart-onboarding-dismissed', '1');
    });
    await page.goto('/');
  });

  test('should hide sidebar on mobile', async ({ page }) => {
    // The desktop sidebar is inside a hidden lg:block wrapper
    const desktopSidebar = page.locator('.hidden.lg\\:block');
    await expect(desktopSidebar).toBeHidden();
  });

  test('should show filter button in header', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Filters' })).toBeVisible();
  });

  // Requires client-side React to be functional (onClick handler opens slide-over).
  test('should open filter modal on filter button click', async ({ page }) => {
    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(page.getByText('Price Range', { exact: true }).first()).toBeVisible();
  });

  test('should show bottom sheet with apartment count', async ({ page }) => {
    // The bottom sheet button contains the apartment count (rendered in SSR)
    await expect(page.getByRole('button', { name: /apartments? found/ })).toBeVisible();
  });
});
