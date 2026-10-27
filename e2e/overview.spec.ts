import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { activePage, addAccount, createHousehold, createUser, importCsv, openTab, signIn } from './helpers';

const sample = readFileSync(new URL('../tests/fixtures/usaa_bank_sample.csv', import.meta.url));

test('overview: KPIs, spending table, statement balance and net worth', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await signIn(page, await createUser('ov'));
  await createHousehold(page, 'Overview Household', 'Alex');
  await expect(activePage(page).getByText('Import transactions to see your overview.')).toBeVisible();

  await addAccount(page, 'Main Checking');
  await addAccount(page, 'Car Loan', 'Ford Credit', 'Auto loan');
  await importCsv(page, 'Main Checking', { name: 'bk_download.csv', buffer: sample }, '2,431.17');

  // Statement balance for the loan, entered as the amount owed.
  await openTab(page, 'accounts');
  await activePage(page).locator('ion-item', { hasText: 'Car Loan' }).click();
  await page.getByRole('button', { name: 'Record balance' }).click();
  const modal = page.locator('ion-modal').filter({ hasText: 'Record balance' });
  await modal.locator('ion-input').nth(1).locator('input').fill('18,000');
  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(activePage(page).locator('ion-item', { hasText: 'Car Loan' })).toContainText('owes $18,000.00');

  await openTab(page, 'overview');
  const overview = activePage(page);
  await expect(overview.getByTestId('kpis')).toContainText('Avg monthly spending');
  // Both balances are as of today, so net worth is exact: 2,431.17 − 18,000.
  await expect(overview.getByTestId('kpis')).toContainText('-$15,569');
  await expect(overview.getByTestId('balances-table')).toContainText('owes $18,000');
  await expect(overview.getByTestId('group-table')).toContainText('Food & Dining');
  await expect(overview.locator('canvas')).toHaveCount(3);

  // Expanding a group shows its categories.
  // Located by CSS: Playwright's role lookup intermittently treats this table's
  // buttons as hidden although they are visible, stable and labelled.
  await overview.locator('[data-testid=group-table] button', { hasText: 'Food & Dining' }).click();
  await expect(overview.getByTestId('group-table')).toContainText('Groceries');

  // Changing the period keeps everything rendering.
  await overview.locator('ion-segment-button', { hasText: '6 months' }).click();
  await expect(overview.locator('canvas')).toHaveCount(3);
  expect(errors).toEqual([]);
});
