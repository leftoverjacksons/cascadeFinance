import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { activePage, addAccount, createHousehold, createUser, importCsv, openTab, pickCategory, signIn } from './helpers';

const sample = readFileSync(new URL('../tests/fixtures/usaa_bank_sample.csv', import.meta.url));

test('automatic categories, manual override with a rule, bulk edit, rule editor', async ({ page }) => {
  await signIn(page, await createUser('cat'));
  await createHousehold(page, 'Cat Household', 'Alex');
  await addAccount(page, 'Main Checking');
  await importCsv(page, 'Main Checking', { name: 'bk_download.csv', buffer: sample });

  // ── Seeded mappings categorise on import ──
  await openTab(page, 'transactions');
  const list = page.getByTestId('transactions');
  // Matches a row by its exact name (a RegExp for partial matches).
  const row = (name: string | RegExp) =>
    list.locator('ion-item').filter({
      has: page.locator('h3', { hasText: typeof name === 'string' ? new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : name }),
    });
  await expect(row('Publix').first()).toContainText('Food & Dining › Groceries');
  await expect(row('Corner Cafe').first()).toContainText('Food & Dining › Coffee Shops');
  await expect(row('USAA FUNDS TRANSFER DB')).toContainText('Transfers › Between Accounts');
  await expect(row(/^PUBLIX #503/)).toContainText('Uncategorized'); // pending, bank says "Category Pending"

  // ── Manual category + rule from a transaction ──
  await row('Corner Cafe').first().click();
  const modal = page.locator('ion-modal').filter({ hasText: 'Transaction' });
  await modal.getByTestId('category-field').click();
  await pickCategory(page, 'Restaurants');
  await expect(modal.locator('ion-input').filter({ hasText: 'When the description contains' }).locator('input'))
    .toHaveValue('CORNER CAFE');
  await expect(modal.getByText('Matches 2 transactions')).toBeVisible();
  await modal.getByRole('button', { name: 'Save' }).click();
  // Both identical purchases move: one by hand, the other via the new rule.
  await expect(row('Corner Cafe').filter({ hasText: 'Food & Dining › Restaurants' })).toHaveCount(2);

  // ── Uncategorized filter + bulk edit ──
  await activePage(page).getByTestId('category-filter').click();
  await page.locator('ion-modal').getByText('Uncategorized', { exact: true }).click();
  await expect(list.locator('ion-item')).toHaveCount(1); // only the pending Publix
  await activePage(page).locator('ion-item', { hasText: 'Clear category filter' }).click();
  await expect(list.locator('ion-item')).toHaveCount(7);

  await activePage(page).getByRole('button', { name: 'Select' }).click();
  await row('Publix').click();
  await row('Hardware, Paint & More').click();
  await page.getByRole('button', { name: 'Categorize 2' }).click();
  await pickCategory(page, 'Miscellaneous');
  await expect(page.getByText('Updated 2 transactions.')).toBeVisible();
  await expect(row('Hardware, Paint & More')).toContainText('Other › Miscellaneous');

  // ── Rule editor with live preview ──
  await openTab(page, 'settings');
  await activePage(page).getByText('Rules', { exact: true }).click();
  await expect(page.getByTestId('own-rules')).toContainText('Description contains "CORNER CAFE"');
  await activePage(page).getByRole('button', { name: 'Add rule' }).click();
  const ruleModal = page.locator('ion-modal').filter({ hasText: 'New rule' });
  await ruleModal.locator('ion-input').filter({ hasText: 'Text' }).locator('input').fill('payroll');
  await expect(ruleModal.getByTestId('rule-preview')).toHaveText('Matches 1 transaction');
  await ruleModal.getByTestId('rule-category').click();
  await pickCategory(page, 'Other Income');
  await ruleModal.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('own-rules')).toContainText('Income › Other Income');

  await openTab(page, 'transactions');
  await expect(row('Example Employer Payroll')).toContainText('Income › Other Income');
});
