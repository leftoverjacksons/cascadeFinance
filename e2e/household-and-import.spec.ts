import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { activePage, createUser, openTab, signIn } from './helpers';

const sample = readFileSync(new URL('../tests/fixtures/usaa_bank_sample.csv', import.meta.url));

// A later export: overlaps the sample, the pending Publix has posted under a new
// description, and one new paycheck arrived.
const later = Buffer.from(
  sample
    .toString()
    .replace(
      '2026-10-26,"PUBLIX #503                      102526","PUBLIX #503                      102526",Category Pending,-38.75,Pending',
      '2026-10-27,"Example Employer Payroll","EXAMPLE EMPLOYER PAYROLL",Paycheck,3176.28,Posted\n' +
        '2026-10-26,"Publix","PUBLIX #503              ATLANTA      GA",Groceries,-38.75,Posted',
    ),
);

test('household setup, partner sharing, and idempotent CSV import', async ({ browser, page }) => {
  const alex = await createUser('alex');
  const blair = await createUser('blair');

  // ── Household ──
  await signIn(page, alex);
  await page.getByText('Set up your household').waitFor();
  await page.locator('ion-input').nth(0).locator('input').fill('Test Household');
  await page.locator('ion-input').nth(1).locator('input').fill('Alex');
  await page.getByRole('button', { name: 'Create household' }).click();
  await expect(page.locator('ion-tab-bar')).toBeVisible();

  await openTab(page, 'settings');
  const settings = activePage(page);
  await settings.locator('ion-input[type=email] input').fill(blair);
  await settings.locator('ion-input').nth(1).locator('input').fill('Blair');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByText('Alex 50%')).toBeVisible();

  // ── Account ──
  await openTab(page, 'accounts');
  await expect(page.getByText('No accounts yet')).toBeVisible();
  await page.getByRole('button', { name: 'Add account' }).first().click();
  const modal = page.locator('ion-modal');
  await modal.locator('ion-input').nth(0).locator('input').fill('Alex Checking');
  await modal.locator('ion-input').nth(1).locator('input').fill('USAA');
  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('USAA · Checking · Joint')).toBeVisible();

  // ── First import ──
  await openTab(page, 'import');
  const imp = activePage(page);
  await imp.locator('ion-select').click();
  await page.getByRole('radio', { name: 'Alex Checking' }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByTestId('csv-input').setInputFiles({ name: 'bk_download.csv', mimeType: 'text/csv', buffer: sample });
  await imp.locator('ion-input').nth(1).locator('input').fill('2,431.17');
  const preview = page.getByTestId('preview');
  await expect(preview.locator('ion-item', { hasText: 'New' }).locator('ion-badge')).toHaveText('6');
  await expect(preview.locator('ion-item', { hasText: 'Pending' }).locator('ion-badge')).toHaveText('1');
  await page.getByRole('button', { name: 'Import 6 new transactions' }).click();
  await expect(page.getByTestId('import-result')).toContainText('6 added · 0 already present · 0 skipped · 1 pending');

  // ── Same file again: refused before import ──
  await page.getByTestId('csv-input').setInputFiles({ name: 'bk_download.csv', mimeType: 'text/csv', buffer: sample });
  await expect(page.getByText('This exact file was already imported')).toBeVisible();
  await expect(page.getByRole('button', { name: /Import \d+ new/ })).toHaveCount(0);

  // ── Overlapping later export ──
  await page.getByTestId('csv-input').setInputFiles({ name: 'bk_download (1).csv', mimeType: 'text/csv', buffer: later });
  await expect(preview.locator('ion-item', { hasText: 'Already imported' }).locator('ion-badge')).toHaveText('6');
  await page.getByRole('button', { name: 'Import 2 new transactions' }).click();
  await expect(page.getByTestId('import-result')).toContainText('2 added · 6 already present');

  // ── Transactions ──
  await openTab(page, 'transactions');
  const list = page.getByTestId('transactions');
  await expect(list.locator('ion-item')).toHaveCount(8); // 8 posted, pending replaced
  await expect(list.getByText('Pending', { exact: true })).toHaveCount(0);
  await expect(list.getByText('Corner Cafe')).toHaveCount(2); // identical same-day purchases kept
  await activePage(page).locator('ion-searchbar input').fill('publix');
  await expect(list.locator('ion-item')).toHaveCount(2);

  // ── Balance on accounts ──
  await openTab(page, 'accounts');
  await expect(activePage(page).getByText('$2,431.17')).toBeVisible();

  // ── Partner sees the same data ──
  const ctx = await browser.newContext();
  const partner = await ctx.newPage();
  await signIn(partner, blair);
  await openTab(partner, 'transactions');
  await expect(partner.getByTestId('transactions').locator('ion-item')).toHaveCount(8);
  await ctx.close();
});
