import { test, expect } from '@playwright/test'

test.describe('Collections', () => {
  test('lists collections and links to import', async ({ page }) => {
    await page.goto('/admin/collections')
    await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Import data' })).toBeVisible()
  })

  test('workspace filter dropdown works', async ({ page }) => {
    await page.goto('/admin/collections')
    const select = page.getByRole('combobox')
    await expect(select).toBeVisible()
    await expect(select).toHaveValue('')

    // Select default workspace
    await select.selectOption({ label: 'default' })
    await expect(page).toHaveURL(/workspace=/)
  })
})
