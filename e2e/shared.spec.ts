import { expect, test } from '@playwright/test';
import {
  activePage,
  addAccount,
  createHousehold,
  createUser,
  importCsv,
  openTab,
  signIn,
  transactionDetail,
  transactionRows,
} from './helpers';

const header = 'Date,Description,Original Description,Category,Amount,Status';
const alexChecking = Buffer.from(
  [
    header,
    '2026-10-01,"Kroger","KROGER #1",Groceries,-100.00,Posted',
    '2026-10-05,"USAA Transfer","USAA FUNDS TRANSFER DB",Transfer,-60.00,Posted',
    '2026-10-08,"USAA Transfer","USAA FUNDS TRANSFER DB J",Transfer,-100.00,Posted',
  ].join('\n') + '\n',
);
// Alex's $100 goes into the joint pot, which pays a $100 bill.
const jointChecking = Buffer.from(
  [
    header,
    '2026-10-09,"USAA Transfer","USAA FUNDS TRANSFER CR J",Transfer,100.00,Posted',
    '2026-10-12,"Georgia Power","GEORGIA POWER",Utilities,-100.00,Posted',
  ].join('\n') + '\n',
);
const blairChecking = Buffer.from(
  [
    header,
    '2026-10-06,"USAA Transfer","USAA FUNDS TRANSFER CR",Transfer,60.00,Posted',
    '2026-10-07,"Publix","PUBLIX #2",Groceries,-80.00,Posted',
  ].join('\n') + '\n',
);

test('shared expenses, paybacks and settling up', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const alex = await createUser('alex');
  const blair = await createUser('blair');
  await signIn(page, alex);
  await createHousehold(page, 'Shared Household', 'Alex');
  await openTab(page, 'settings');
  const settings = activePage(page);
  await settings.locator('ion-input[type=email] input').fill(blair);
  await settings.locator('ion-input').nth(1).locator('input').fill('Blair');
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByText('Alex 50%')).toBeVisible();

  await addAccount(page, 'Alex Checking', 'USAA', undefined, 'Alex');
  await addAccount(page, 'Blair Checking', 'USAA', undefined, 'Blair');
  await addAccount(page, 'Joint Checking');
  // Regression: closing a dialog that contained a dropdown left the whole app
  // aria-hidden (invisible to screen readers).
  await expect(page.locator('ion-router-outlet[aria-hidden="true"]')).toHaveCount(0);
  await importCsv(page, 'Alex Checking', { name: 'a.csv', buffer: alexChecking });
  await importCsv(page, 'Blair Checking', { name: 'b.csv', buffer: blairChecking });
  await importCsv(page, 'Joint Checking', { name: 'j.csv', buffer: jointChecking });

  // Alex's $100 groceries: Blair owes $50. Blair's $80: Alex owes $40.
  // Alex sent Blair $60 (a payback): Blair owes $60 more.
  // Alex put $100 into the joint pot (which paid the power bill): Blair owes $50 more. Net: $120.
  await openTab(page, 'settings');
  await activePage(page).getByText('Shared expenses and paybacks').click();
  const balance = page.getByTestId('shared-balance');
  await expect(balance).toContainText('Blair owes Alex');
  await expect(balance).toContainText('$120.00');
  await expect(page.getByTestId('member-transfers')).toContainText('Alex → Joint Checking · $100.00');

  // Not a payback after all.
  const transfer = page.getByTestId('member-transfers').locator('ion-item', { hasText: 'Alex → Blair' });
  await expect(transfer).toContainText('$60.00');
  await transfer.locator('ion-toggle').click();
  await expect(balance).toContainText('$60.00');

  // Settle up with a recorded payment.
  await balance.getByRole('button', { name: 'Settle up' }).click();
  const payment = page.locator('ion-modal').filter({ hasText: 'Record a payment' });
  await expect(payment.locator('ion-input').first().locator('input')).toHaveValue('60.00');
  await payment.getByRole('button', { name: 'Save' }).click();
  await expect(balance).toContainText("You're all square.");

  // A single transaction can be taken out of sharing: Blair's Publix.
  await openTab(page, 'transactions');
  await transactionRows(page).filter({ hasText: 'Publix' }).click();
  const detail = transactionDetail(page);
  await detail.getByTestId('shared-setting').locator('ion-select').click();
  await page.getByRole('radio', { name: 'Not shared' }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await detail.getByRole('button', { name: 'Save' }).click();

  // Overview panel reflects it: now Blair owes Alex her $40 share back.
  await openTab(page, 'overview');
  await expect(activePage(page).getByTestId('shared-panel')).toContainText('Blair owes Alex $40.00');
  expect(errors).toEqual([]);
});
