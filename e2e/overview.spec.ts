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
  // Only the visible account row: hidden pages (e.g. Import's account picker)
  // also contain the account name.
  const loanRow = page.locator('ion-item:visible', { has: page.locator('h2', { hasText: 'Car Loan' }) });
  await loanRow.click();
  await page.getByRole('button', { name: 'Record balance' }).click();
  const modal = page.locator('ion-modal').filter({ hasText: 'Record balance' });
  await modal.locator('ion-input').nth(1).locator('input').fill('18,000');
  await modal.getByRole('button', { name: 'Save' }).click();
  await expect(loanRow).toContainText('owes $18,000.00');

  await openTab(page, 'overview');
  const overview = activePage(page);
  await expect(overview.getByTestId('kpis')).toContainText('Avg monthly spending');
  // Both balances are as of today, so net worth is exact: 2,431.17 − 18,000.
  await expect(overview.getByTestId('kpis')).toContainText('-$15,569');
  await expect(overview.getByTestId('balances-table')).toContainText('owes $18,000');
  await expect(overview.getByTestId('group-table')).toContainText('Food & Dining');
  await expect(overview.locator('canvas')).toHaveCount(3);
  await expect(overview.getByTestId('sankey')).toBeVisible();

  // Clicking a chart lists that month's transactions (Transactions panel on
  // desktop, under the chart on phones).
  const phone = test.info().project.name === 'phone';
  const clickMark = async (panel: string, label: string) => {
    const canvas = overview.locator(`[data-panel=${panel}] canvas`);
    await canvas.scrollIntoViewIfNeeded();
    const point = await canvas.evaluate((el, name) => {
      type El = { x: number; y: number; base?: number };
      type Meta = { data: El[] };
      const chart = (el as HTMLCanvasElement & {
        chart: {
          data: { datasets: { label: string; data: (number | null)[] }[] };
          getDatasetMeta: (i: number) => Meta;
          chartArea: { bottom: number; right: number };
        };
      }).chart;
      const ds = chart.data.datasets.findIndex((d) => d.label === name);
      const values = chart.data.datasets[ds].data;
      const i = values.findLastIndex((v) => (v ?? 0) > 0); // the month with data
      const mark = chart.getDatasetMeta(ds).data[i];
      const below = mark.base ?? (ds > 0 ? chart.getDatasetMeta(ds - 1).data[i].y : chart.chartArea.bottom);
      const r = el.getBoundingClientRect();
      // The newest month sits on the plot's right edge: click just inside it.
      return { x: r.left + Math.min(mark.x, chart.chartArea.right - 4), y: r.top + (mark.y + below) / 2 };
    }, label);
    if (phone) await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
  };
  const listFor = (panel: string) => overview.locator(phone ? `[data-panel=${panel}]` : '[data-panel=transactions]');

  await clickMark('cashflow', 'Spending');
  const spending = listFor('cashflow');
  await expect(spending.getByTestId('transactions-flow-filter')).toContainText('Spending ·');
  await expect(spending.getByTestId('transactions-panel')).toContainText('Corner Cafe');
  await expect(spending.getByTestId('transactions-panel')).toContainText('Hardware, Paint & More');
  await expect(spending.getByTestId('transactions-panel')).not.toContainText('Example Employer Payroll'); // income
  await clickMark('cashflow', 'Spending'); // same bar again: cleared
  await expect(overview.getByTestId('transactions-flow-filter')).toHaveCount(0);

  await clickMark('spending', 'Food & Dining');
  const food = listFor('spending');
  await expect(food.getByTestId('transactions-flow-filter')).toContainText('Food & Dining ·');
  await expect(food.getByTestId('transactions-panel')).toContainText('Corner Cafe');
  await expect(food.getByTestId('transactions-panel')).not.toContainText('Hardware'); // another group
  await expect(food.getByTestId('transactions-panel')).not.toContainText('Example Employer Payroll');
  await food.getByRole('button', { name: 'Show all' }).click();
  await expect(overview.getByTestId('transactions-flow-filter')).toHaveCount(0);

  // Expanding a group shows its categories.
  await overview.getByRole('button', { name: 'Food & Dining: show categories' }).click();
  await expect(overview.getByTestId('group-table')).toContainText('Groceries');

  // Changing the period keeps everything rendering.
  await overview.locator('ion-segment-button', { hasText: '6 months' }).click();
  await expect(overview.locator('canvas')).toHaveCount(3);
  await expect(overview.getByTestId('sankey')).toBeVisible();
  expect(errors).toEqual([]);
});
