import { test, expect } from '@playwright/test'

test.describe('Layers', () => {
  test('lists layers and links to import', async ({ page }) => {
    await page.goto('/layers')
    await expect(page.getByRole('heading', { name: 'Layers' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Import data' })).toBeVisible()
  })

  test('workspace filter dropdown works', async ({ page }) => {
    await page.goto('/layers')
    const select = page.getByRole('combobox')
    await expect(select).toBeVisible()
    await expect(select).toHaveValue('')

    // Select default workspace
    await select.selectOption({ label: 'default' })
    await expect(page).toHaveURL(/workspace=/)
  })
})
