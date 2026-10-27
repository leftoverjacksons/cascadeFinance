import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const PASSWORD = 'correct-horse-battery';

/** Creates a confirmed user through the local Auth admin API. */
export async function createUser(prefix: string): Promise<string> {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@test.local`;
  const key = process.env.E2E_SUPABASE_SECRET_KEY!;
  const res = await fetch(`${process.env.E2E_SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  expect(res.ok, await res.text()).toBe(true);
  return email;
}

export async function signIn(page: Page, email: string) {
  await page.goto('./');
  await page.locator('ion-input[type=email] input').fill(email);
  await page.locator('ion-input[type=password] input').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The currently visible Ionic page (hidden pages stay in the DOM). */
export function activePage(page: Page) {
  return page.locator('ion-router-outlet .ion-page:not(.ion-page-hidden)');
}

/** Navigation: sidebar on desktop widths, bottom tabs on phones. */
export function navItem(page: Page, tab: string) {
  return page.locator(`ion-menu [data-nav=${tab}]:visible, ion-tab-button[tab=${tab}]:visible`).first();
}

export async function openTab(page: Page, tab: string) {
  await navItem(page, tab).click();
}

export async function createHousehold(page: Page, householdName: string, myName: string) {
  await page.getByText('Set up your household').waitFor();
  await page.locator('ion-input').nth(0).locator('input').fill(householdName);
  await page.locator('ion-input').nth(1).locator('input').fill(myName);
  await page.getByRole('button', { name: 'Create household' }).click();
  await expect(navItem(page, 'overview')).toBeVisible();
}

export async function addAccount(page: Page, name: string, institution = 'USAA', type?: string) {
  await openTab(page, 'accounts');
  await page.getByRole('button', { name: 'Add account' }).first().click();
  const modal = page.locator('ion-modal').filter({ hasText: 'New account' });
  await modal.locator('ion-input').nth(0).locator('input').fill(name);
  await modal.locator('ion-input').nth(1).locator('input').fill(institution);
  if (type) {
    await modal.locator('ion-select').first().click();
    await page.getByRole('radio', { name: type }).click();
    await page.getByRole('button', { name: 'OK' }).click();
  }
  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(activePage(page).locator('ion-item h2', { hasText: name })).toBeVisible();
}

export async function importCsv(
  page: Page,
  accountName: string,
  file: { name: string; buffer: Buffer },
  balance?: string,
) {
  await openTab(page, 'import');
  await activePage(page).locator('ion-select').click();
  await page.getByRole('radio', { name: accountName }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByTestId('csv-input').setInputFiles({ ...file, mimeType: 'text/csv' });
  if (balance) await activePage(page).locator('ion-input').nth(1).locator('input').fill(balance);
  await page.getByRole('button', { name: /Import \d+ new transactions/ }).click();
  await expect(page.getByTestId('import-result')).toBeVisible();
}

/** Picks a category in the open category picker by searching for it. */
export async function pickCategory(page: Page, name: string) {
  const picker = page.locator('ion-modal').filter({ has: page.getByTestId('category-picker') }).last();
  await picker.locator('ion-searchbar input').fill(name);
  await picker.getByTestId('category-picker').locator('ion-item', { hasText: name }).first().click();
}

/** The open transaction detail: side panel on desktop, pop-up on phones. */
export function transactionDetail(page: Page) {
  return page.locator('[data-testid=transaction-detail]:visible');
}

/** Transaction rows (table rows on desktop, list items on phones). */
export function transactionRows(page: Page) {
  return page.getByTestId('transactions').locator('[data-txn]');
}
