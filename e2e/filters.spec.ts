import { test, expect } from '@playwright/test';

test.describe('Filter Sidebar', () => {
  test.use({ viewport: { width: 1280, height: 720 } }); // Desktop

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('aptbybart-onboarding-dismissed', '1');
    });
    await page.goto('/');
  });

  test('should show filter sidebar on desktop', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Price Range', { exact: true })).toBeVisible();
    await expect(sidebar.getByText('Bedrooms')).toBeVisible();
    await expect(sidebar.getByText('Amenities')).toBeVisible();
  });

  test('should show bedroom toggle buttons', async ({ page }) => {
    await expect(page.getByText('Studio')).toBeVisible();
    await expect(page.getByText('1BR')).toBeVisible();
    await expect(page.getByText('2BR')).toBeVisible();
  });

  test('should show apartment count', async ({ page }) => {
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText(/apartments? found/)).toBeVisible();
  });

  test('should show commute helper text', async ({ page }) => {
    await expect(page.getByText('Pre-computed to Montgomery St')).toBeVisible();
  });
});
