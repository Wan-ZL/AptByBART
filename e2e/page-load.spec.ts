import { test, expect } from '@playwright/test';

test.describe('Page Load', () => {
  test('should load the homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/AptByBART/);
  });

  test('should show the header with logo', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toContainText('AptByBART');
  });

  test('should show onboarding overlay on first visit', async ({ page }) => {
    // Clear localStorage to simulate first visit
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByText('Welcome to AptByBART')).toBeVisible();
  });

  // Requires client-side React to be functional (click handler + state update).
  // Currently blocked by "Maximum update depth exceeded" crash in useUrlSync/viewport loop.
  test.fixme('should dismiss onboarding and not show again', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('aptbybart-onboarding-dismissed');
    });
    await page.goto('/');
    await expect(page.getByText('Welcome to AptByBART')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Start Exploring' }).click();
    await expect(page.getByText('Welcome to AptByBART')).not.toBeVisible({ timeout: 5000 });
    await page.reload();
    await expect(page.getByText('Welcome to AptByBART')).not.toBeVisible({ timeout: 5000 });
  });
});
