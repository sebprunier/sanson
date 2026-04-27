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
    await expect(page.getByRole('button', { name: 'Data', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Schema', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Style', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'API', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible()
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

  test('Data tab shows features, filter input and Export button', async ({ page }) => {
    await goToCollectionDetail(page)
    await page.getByRole('button', { name: 'Data', exact: true }).click()
    await expect(page.getByPlaceholder("CQL2 filter, e.g. name='Paris'")).toBeVisible()
    await expect(page.getByPlaceholder(/bbox/)).toBeVisible()
    await expect(page.getByText(/Showing \d+ of \d+ features/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Export/ })).toBeVisible()
  })

  test('CQL2 filter works in Data view', async ({ page }) => {
    await goToCollectionDetail(page)
    await page.getByRole('button', { name: 'Data', exact: true }).click()
    await expect(page.getByText(/Showing \d+ of \d+ features/)).toBeVisible()

    const filterInput = page.getByPlaceholder("CQL2 filter, e.g. name='Paris'")
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

  test('Settings tab has General, Fields and Map defaults sub-nav', async ({ page }) => {
    await goToCollectionDetail(page)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()

    // Sub-nav buttons present
    await expect(page.getByRole('button', { name: 'General', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Fields', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Map defaults', exact: true })).toBeVisible()

    // General is the default section
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible()

    // Switch to Fields
    await page.getByRole('button', { name: 'Fields', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Exposed fields' })).toBeVisible()

    // Switch to Map defaults
    await page.getByRole('button', { name: 'Map defaults', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Map defaults' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Capture current view/ })).toBeVisible()
  })

  test('Map defaults persist after save and reload', async ({ page }) => {
    await goToCollectionDetail(page)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Map defaults', exact: true }).click()

    // Fill values manually (avoids relying on map readiness for capture).
    // exact: true is needed for "Zoom" because MapLibre adds Zoom in / Zoom out
    // buttons whose accessible names also start with "Zoom".
    await page.getByLabel('Longitude', { exact: true }).fill('2.35')
    await page.getByLabel('Latitude', { exact: true }).fill('48.85')
    await page.getByLabel('Zoom', { exact: true }).fill('10')

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Saved successfully')).toBeVisible()

    // Reload the page and confirm values are persisted
    await page.reload()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Map defaults', exact: true }).click()
    await expect(page.getByLabel('Longitude', { exact: true })).toHaveValue('2.35')
    await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('48.85')
    await expect(page.getByLabel('Zoom', { exact: true })).toHaveValue('10')

    // Reset so the test is idempotent across runs
    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Saved successfully')).toBeVisible()
  })

  test('Data tab bbox filter applies to the table', async ({ page }) => {
    await goToCollectionDetail(page)
    await page.getByRole('button', { name: 'Data', exact: true }).click()
    await expect(page.getByText(/Showing \d+ of \d+ features/)).toBeVisible()

    await page.getByPlaceholder(/bbox/).fill('-1,42,2,46')
    await page.getByRole('button', { name: 'Filter' }).click()

    await expect(page.getByText('— filtered')).toBeVisible()

    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByText('— filtered')).not.toBeVisible()
  })

  test('Data tab Export downloads CSV with active filters', async ({ page }) => {
    await goToCollectionDetail(page)
    await page.getByRole('button', { name: 'Data', exact: true }).click()

    // Open the Export popover
    await page.getByRole('button', { name: /Export/ }).click()
    await expect(page.getByRole('button', { name: 'CSV', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'GeoJSON', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'CSV', exact: true }).click()

    // Click Download and intercept the export request
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes('/export') && r.url().includes('format=csv'),
    )
    await page.getByRole('button', { name: 'Download', exact: true }).click()
    const response = await responsePromise
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/csv')
  })
})
