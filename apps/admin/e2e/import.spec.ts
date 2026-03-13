import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe('Import', () => {
  test('shows import form with all fields', async ({ page }) => {
    await page.goto('/import')
    await expect(page.getByRole('heading', { name: 'Import data' })).toBeVisible()
    await expect(page.locator('input[type="file"]')).toBeVisible()
    await expect(page.locator('select')).toBeVisible()
    await expect(page.locator('input[placeholder="e.g. nuclear_plants"]')).toBeVisible()
    await expect(page.locator('input[placeholder="4326"]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  test('auto-fills layer name from file name', async ({ page }) => {
    await page.goto('/import')
    const fileInput = page.locator('input[type="file"]')
    const geojsonPath = path.resolve(
      __dirname,
      '../../../data/centrales-de-production-nucleaire-edf.geojson',
    )
    await fileInput.setInputFiles(geojsonPath)
    const layerNameInput = page.locator('input[placeholder="e.g. nuclear_plants"]')
    await expect(layerNameInput).toHaveValue('centrales_de_production_nucleaire_edf')
    await expect(page.getByRole('button', { name: 'Import' })).toBeEnabled()
  })
})
