import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addAccount, createHousehold, createUser, importCsv, openTab, signIn } from './helpers';

const sample = readFileSync(new URL('../tests/fixtures/usaa_bank_sample.csv', import.meta.url));

test.describe('desktop workspace', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('panels tile two per row, can be hidden, re-added and moved; layout persists', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await signIn(page, await createUser('ws'));
    await createHousehold(page, 'Workspace Household', 'Alex');
    await addAccount(page, 'Main Checking');
    await importCsv(page, 'Main Checking', { name: 'bk_download.csv', buffer: sample });
    await openTab(page, 'overview');

    const panel = (id: string) => page.locator(`.workspace [data-panel=${id}]`);
    await expect(panel('cashflow')).toBeVisible();

    // Default: two half-width panels side by side (wait for the grid's entry animation).
    await expect
      .poll(async () => Math.abs((await panel('cashflow').boundingBox())!.y - (await panel('netWorth').boundingBox())!.y))
      .toBeLessThan(2);
    const a = (await panel('cashflow').boundingBox())!;
    const b = (await panel('netWorth').boundingBox())!;
    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
    const grid = (await page.locator('.workspace .react-grid-layout').boundingBox())!;
    expect(a.width / grid.width).toBeGreaterThan(0.45);
    expect(a.width / grid.width).toBeLessThan(0.55);

    // Hide a panel, then drag another into the right-hand column.
    await page.getByRole('button', { name: 'Hide Net worth' }).click();
    await expect(panel('netWorth')).toHaveCount(0);
    const handle = panel('cashflow').locator('.panel-drag');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + grid.width / 2, box.y + 12, { steps: 12 });
    await page.mouse.move(box.x + grid.width / 2 + 40, box.y + 12, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => (await panel('cashflow').boundingBox())!.x)
      .toBeGreaterThan(grid.x + grid.width / 2 - 10);

    // Layout is saved per person (debounced) and restored on reload.
    await page.waitForTimeout(1500);
    await page.reload();
    await expect(panel('cashflow')).toBeVisible();
    await expect(panel('netWorth')).toHaveCount(0);
    await expect
      .poll(async () => (await panel('cashflow').boundingBox())!.x)
      .toBeGreaterThan(grid.x + grid.width / 2 - 10);

    // Add it back from the menu.
    await page.getByRole('button', { name: /Add panel \(1\)/ }).click();
    await page.getByRole('button', { name: 'Net worth' }).click();
    await expect(panel('netWorth')).toBeVisible();

    // Reset restores the default arrangement.
    await page.getByRole('button', { name: 'Reset layout' }).click();
    await expect.poll(async () => (await panel('cashflow').boundingBox())!.x).toBeLessThan(grid.x + 10);
    expect(errors).toEqual([]);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test('stacked panels; the grid library is never loaded', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await signIn(page, await createUser('wsphone'));
    await createHousehold(page, 'Phone Household', 'Alex');
    await addAccount(page, 'Main Checking');
    await importCsv(page, 'Main Checking', { name: 'bk_download.csv', buffer: sample });
    await openTab(page, 'overview');
    await expect(page.locator('.stack [data-panel=cashflow]')).toBeVisible();
    await expect(page.locator('.workspace')).toHaveCount(0);
    await expect(page.locator('ion-tab-bar')).toBeVisible();
    expect(requests.filter((u) => /Workspace|react-grid-layout|react-resizable|react-draggable/.test(u))).toEqual([]);
  });
});
