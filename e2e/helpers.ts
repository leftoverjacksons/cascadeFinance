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

export async function openTab(page: Page, tab: string) {
  await page.locator(`ion-tab-button[tab=${tab}]`).click();
}
