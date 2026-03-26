import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('displays stats and database status', async ({ page }) => {
    await page.goto('/admin/')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    // Database status
    await expect(page.getByText('Connected')).toBeVisible()

    // Stats cards contain numbers
    const main = page.getByRole('main')
    await expect(main.getByText('Database')).toBeVisible()

    // Verify the stat values are rendered (numbers in the cards)
    await expect(main.locator('p.text-2xl')).toHaveCount(3)
  })

  test('shows recent collections table', async ({ page }) => {
    await page.goto('/admin/')
    await expect(page.getByRole('heading', { name: 'Recent collections' })).toBeVisible()
  })
})
