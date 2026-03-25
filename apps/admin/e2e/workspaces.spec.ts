import { test, expect } from '@playwright/test'

test.describe('Workspaces', () => {
  test('lists default workspace', async ({ page }) => {
    await page.goto('/admin/workspaces')
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'default', exact: true })).toBeVisible()
  })

  test('create, edit, and delete a workspace', async ({ page }) => {
    await page.goto('/admin/workspaces')

    // Create
    await page.getByRole('button', { name: 'New workspace' }).click()
    const dialog = page.locator('.fixed')
    await dialog.locator('input[type="text"]').fill('e2e-test-ws')
    await dialog.locator('textarea').fill('Created by E2E test')
    await dialog.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('cell', { name: 'e2e-test-ws' })).toBeVisible()

    // Edit
    const row = page.getByRole('row').filter({ hasText: 'e2e-test-ws' })
    await row.getByRole('button', { name: 'Edit' }).click()
    await dialog.locator('textarea').fill('Updated by E2E test')
    await dialog.getByRole('button', { name: 'Update' }).click()
    await expect(page.getByRole('cell', { name: 'Updated by E2E test' })).toBeVisible()

    // Delete
    page.on('dialog', (dialog) => dialog.accept())
    await row.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('cell', { name: 'e2e-test-ws' })).not.toBeVisible()
  })

  test('default workspace cannot be deleted', async ({ page }) => {
    await page.goto('/admin/workspaces')
    const defaultRow = page.getByRole('row').filter({ hasText: /^default/ })
    await expect(defaultRow.getByRole('button', { name: 'Delete' })).not.toBeVisible()
  })
})
