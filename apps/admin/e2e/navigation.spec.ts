import { test, expect } from '@playwright/test'

test.describe('Navigation', () => {
  test('sidebar links navigate to correct pages', async ({ page }) => {
    await page.goto('/')

    const sidebar = page.getByRole('complementary')

    // Dashboard is active by default
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    // Navigate to Workspaces
    await sidebar.getByRole('link', { name: 'Workspaces' }).click()
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()

    // Navigate to Layers
    await sidebar.getByRole('link', { name: 'Layers' }).click()
    await expect(page.getByRole('heading', { name: 'Layers' })).toBeVisible()

    // Navigate to Import
    await sidebar.getByRole('link', { name: 'Import' }).click()
    await expect(page.getByRole('heading', { name: 'Import data' })).toBeVisible()

    // Back to Dashboard
    await sidebar.getByRole('link', { name: 'Dashboard' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('sidebar shows logo and version', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('img', { name: 'Sanson' })).toBeVisible()
    await expect(page.getByText('Sanson v0.1.0')).toBeVisible()
  })
})
