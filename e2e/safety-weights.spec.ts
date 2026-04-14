import { test, expect } from '@playwright/test';

test.describe('Safety Overlay & Weight Controls', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('aptbybart-onboarding-dismissed', '1');
    });
  });

  test('safety toggle shows overlay and legend', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Safety: OFF')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Safety: OFF' }).click();
    await expect(page.getByText('Safety: ON')).toBeVisible();

    // Legend appears when overlay is on
    await expect(page.getByText('Higher Risk')).toBeVisible();
    await expect(page.getByText('Safest')).toBeVisible();
  });

  test('weight presets appear when safety is on', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Safety: OFF')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Safety: OFF' }).click();

    // Preset buttons in sidebar
    const sidebar = page.locator('aside');
    await expect(sidebar.getByRole('button', { name: 'Balanced' })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Personal Safety' })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Property' })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'Night Owl' })).toBeVisible();
  });

  test('clicking preset updates URL', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Safety: OFF')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Safety: OFF' }).click();
    const sidebar = page.locator('aside');
    await expect(sidebar.getByRole('button', { name: 'Personal Safety' })).toBeVisible();

    await sidebar.getByRole('button', { name: 'Personal Safety' }).click();
    await expect(page).toHaveURL(/preset=personal_safety/);
  });

  test('customize reveals weight sliders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Safety: OFF')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Safety: OFF' }).click();

    const sidebar = page.locator('aside');
    await sidebar.getByText('Customize').click();

    await expect(sidebar.getByText('Violent Crime')).toBeVisible();
    await expect(sidebar.getByText('Property Crime')).toBeVisible();
    await expect(sidebar.getByText('Vehicle Crime')).toBeVisible();
    await expect(sidebar.getByText('Quality of Life')).toBeVisible();
  });

  test('URL preset param loads correct preset', async ({ page }) => {
    await page.goto('/?preset=night_owl');
    await expect(page.getByText('Safety: OFF')).toBeVisible({ timeout: 15000 });

    // Turn safety on to reveal preset buttons and verify Night Owl is active
    await page.getByRole('button', { name: 'Safety: OFF' }).click();
    const sidebar = page.locator('aside');
    const nightOwlBtn = sidebar.getByRole('button', { name: 'Night Owl' });
    await expect(nightOwlBtn).toBeVisible();
    // Active preset has blue background (bg-blue-500)
    await expect(nightOwlBtn).toHaveClass(/bg-blue-500/);
  });

  test('safety off hides weight controls', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Safety: OFF')).toBeVisible({ timeout: 15000 });

    // Safety is off by default — weight preset buttons should not be visible
    const sidebar = page.locator('aside');
    await expect(sidebar.getByText('Safety Weights')).not.toBeVisible();
  });

  test('legend shows active preset name', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Safety: OFF')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Safety: OFF' }).click();

    // Default: Balanced
    await expect(page.getByText('Safety — Balanced')).toBeVisible();

    // Switch to Night Owl
    const sidebar = page.locator('aside');
    await sidebar.getByRole('button', { name: 'Night Owl' }).click();
    await expect(page.getByText('Safety — Night Owl')).toBeVisible();
  });
});
