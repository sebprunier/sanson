import { test, expect } from '@playwright/test'

test.describe('Collection Detail', () => {
  // Navigate to the first collection detail from the collections list
  async function goToCollectionDetail(page: import('@playwright/test').Page) {
    await page.goto('/admin/collections')
    await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible()
    // Wait for table to load and click first collection link
    const firstLink = page.locator('table a').first()
    await expect(firstLink).toBeVisible({ timeout: 15000 })
    await firstLink.click()
    await page.waitForURL(/\/collections\//)
    // Wait for collection detail to fully load (tabs appear)
    await expect(page.getByRole('button', { name: 'Map', exact: true })).toBeVisible({
      timeout: 15000,
    })
  }

  test('shows collection info and all tabs', async ({ page }) => {
    await goToCollectionDetail(page)
    await expect(page.getByRole('button', { name: 'Map', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Table', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Schema', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'API', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
  })

  test('API tab shows curl examples with copy buttons', async ({ page }) => {
    await goToCollectionDetail(page)
    await page.getByRole('button', { name: 'API', exact: true }).click()

    await expect(page.getByText('Collection description and metadata')).toBeVisible()
    await expect(page.getByText('Features as GeoJSON FeatureCollection')).toBeVisible()
    await expect(page.getByText('Mapbox Vector Tile (MVT)')).toBeVisible()
    await expect(page.locator('code', { hasText: 'curl' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy' }).first()).toBeVisible()
  })

  test('table tab shows features and filter input', async ({ page }) => {
    await goToCollectionDetail(page)
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(page.getByPlaceholder('CQL2 filter')).toBeVisible()
    await expect(page.getByText(/Showing \d+ of \d+ features/)).toBeVisible()
  })

  test('CQL2 filter works in table view', async ({ page }) => {
    await goToCollectionDetail(page)
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    await expect(page.getByText(/Showing \d+ of \d+ features/)).toBeVisible()

    const filterInput = page.getByPlaceholder('CQL2 filter')
    await filterInput.fill("departement='GIRONDE'")
    await page.getByRole('button', { name: 'Filter' }).click()

    await expect(page.getByText('— filtered')).toBeVisible()

    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByText('— filtered')).not.toBeVisible()
  })

  test('schema tab shows column information', async ({ page }) => {
    await goToCollectionDetail(page)
    await page.getByRole('button', { name: 'Schema', exact: true }).click()

    await expect(page.getByText(/\d+ columns/)).toBeVisible()
    await expect(page.getByText(/\d+ rows/)).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Column' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible()
  })

  test('history tab shows import records', async ({ page }) => {
    await goToCollectionDetail(page)
    await page.getByRole('button', { name: 'History', exact: true }).click()

    await expect(page.getByText(/\d+ import/)).toBeVisible()
    await expect(page.getByText('completed')).toBeVisible()
  })
})
