import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  activePage,
  addAccount,
  createHousehold,
  createUser,
  importCsv,
  openTab,
  pickCategory,
  signIn,
  transactionDetail,
} from './helpers';

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
    list.locator('[data-txn]').filter({
      has: page.locator('.txn-name', { hasText: typeof name === 'string' ? new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : name }),
    });
  await expect(row('Publix').first()).toContainText('Food & Dining › Groceries');
  await expect(row('Corner Cafe').first()).toContainText('Food & Dining › Coffee Shops');
  await expect(row('USAA FUNDS TRANSFER DB')).toContainText('Transfers › Between Accounts');
  await expect(row(/^PUBLIX #503/)).toContainText('Uncategorized'); // pending, bank says "Category Pending"

  // ── Manual category + rule from a transaction ──
  await row('Corner Cafe').first().click();
  const modal = transactionDetail(page);
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
  await expect(list.locator('[data-txn]')).toHaveCount(1); // only the pending Publix
  await activePage(page).locator('ion-item', { hasText: 'Clear category filter' }).click();
  await expect(list.locator('[data-txn]')).toHaveCount(7);

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

test('a new group can be created, and categories added to it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, await createUser('catgroup'));
  await createHousehold(page, 'Group Household', 'Alex');
  await page.goto('./#/settings/categories');
  const cats = activePage(page);
  await expect(cats.getByText('Food & Dining').first()).toBeVisible();

  // New group: name, then kind (two dialogs, one after the other).
  await cats.getByRole('button', { name: 'Add group' }).click();
  await page.locator('ion-alert input').fill('Kids');
  await page.locator('ion-alert').getByRole('button', { name: 'Next' }).click();
  const kind = page.locator('ion-alert', { hasText: 'What kind of money is "Kids"?' });
  await expect(kind).toBeVisible();
  await kind.getByRole('radio', { name: 'Spending', exact: true }).click();
  await kind.getByRole('button', { name: 'Create' }).click();
  const kids = cats.locator('ion-list', { has: page.getByRole('button', { name: 'Kids', exact: true }) });
  await expect(kids).toBeVisible();

  // A category in it, with the group's Add button...
  await kids.getByRole('button', { name: 'Add', exact: true }).click();
  await page.locator('ion-alert input').fill('Daycare');
  await page.locator('ion-alert').getByRole('button', { name: 'Save' }).click();
  await expect(kids).toContainText('Daycare');

  // ...and from the group's menu.
  await kids.getByRole('button', { name: 'Kids', exact: true }).click();
  await page.locator('ion-action-sheet').getByRole('button', { name: 'Add category' }).click();
  await page.locator('ion-alert input').fill('School');
  await page.locator('ion-alert').getByRole('button', { name: 'Save' }).click();
  await expect(kids).toContainText('School');

  // Cancelling the name step creates nothing.
  await cats.getByRole('button', { name: 'Add group' }).click();
  await page.locator('ion-alert input').fill('Nope');
  await page.locator('ion-alert').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('ion-alert')).toHaveCount(0);
  await expect(cats.getByRole('button', { name: 'Nope', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('deleting a category unassigns its transactions; transfer categories cannot be deleted', async ({ page }) => {
  await signIn(page, await createUser('catdelete'));
  await createHousehold(page, 'Delete Household', 'Alex');
  await addAccount(page, 'Main Checking');
  await importCsv(page, 'Main Checking', { name: 'bk_download.csv', buffer: sample });

  await page.goto('./#/settings/categories');
  const cats = activePage(page);
  await cats.locator('ion-item', { hasText: 'Coffee Shops' }).click();
  await page.locator('ion-action-sheet').getByRole('button', { name: 'Delete…' }).click();
  const confirm = page.locator('ion-alert', { hasText: 'Delete "Coffee Shops"?' });
  await expect(confirm).toContainText('2 transactions will become uncategorised');
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(cats.locator('ion-item', { hasText: 'Coffee Shops' })).toHaveCount(0);

  // The transfer categories have no Delete (transfer linking assigns them).
  await expect(page.locator('ion-action-sheet, ion-alert')).toHaveCount(0);
  await cats.locator('ion-item', { hasText: 'Between Accounts' }).click();
  await expect(page.locator('ion-action-sheet').getByRole('button', { name: 'Archive' })).toBeVisible();
  await expect(page.locator('ion-action-sheet').getByRole('button', { name: 'Delete…' })).toHaveCount(0);
  await page.locator('ion-action-sheet').getByRole('button', { name: 'Cancel' }).click();

  await openTab(page, 'transactions');
  const cafes = page.getByTestId('transactions').locator('[data-txn]', { hasText: 'Corner Cafe' });
  await expect(cafes).toHaveCount(2);
  for (const r of await cafes.all()) await expect(r).toContainText('Uncategorized');
});

test('a category can be moved to another group, keeping its transactions', async ({ page }) => {
  await signIn(page, await createUser('catmove'));
  await createHousehold(page, 'Move Household', 'Alex');
  await addAccount(page, 'Main Checking');
  await importCsv(page, 'Main Checking', { name: 'bk_download.csv', buffer: sample });

  await page.goto('./#/settings/categories');
  const cats = activePage(page);
  const group = (name: string) => cats.locator('ion-list', { has: page.getByRole('button', { name, exact: true }) });
  await group('Food & Dining').locator('ion-item', { hasText: 'Coffee Shops' }).click();
  await page.locator('ion-action-sheet').getByRole('button', { name: 'Move to group…' }).click();
  const dialog = page.locator('ion-alert', { hasText: 'Move "Coffee Shops" to…' });
  await dialog.getByRole('radio', { name: 'Other', exact: true }).click();
  await dialog.getByRole('button', { name: 'Move' }).click();
  await expect(group('Other')).toContainText('Coffee Shops');
  await expect(group('Food & Dining')).not.toContainText('Coffee Shops');

  // Transfer categories are only offered transfer groups (there is just one).
  await expect(page.locator('ion-action-sheet, ion-alert')).toHaveCount(0);
  await group('Transfers').locator('ion-item', { hasText: 'Between Accounts' }).click();
  await page.locator('ion-action-sheet').getByRole('button', { name: 'Move to group…' }).click();
  await expect(page.getByText('There is no other group to move it to.')).toBeVisible();

  await openTab(page, 'transactions');
  const cafes = page.getByTestId('transactions').locator('[data-txn]', { hasText: 'Corner Cafe' });
  await expect(cafes).toHaveCount(2);
  for (const r of await cafes.all()) await expect(r).toContainText('Other › Coffee Shops');
});
