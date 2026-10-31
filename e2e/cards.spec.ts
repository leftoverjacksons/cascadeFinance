import { expect, test } from '@playwright/test';
import { activePage, addAccount, createHousehold, createUser, importCsv, navItem, openTab, signIn } from './helpers';

// Invented rows in Discover's export format (not real data).
const discover = Buffer.from(
  [
    'Trans. Date,Post Date,Description,Amount,Category',
    '10/01/2026,10/01/2026,"EXAMPLE BANK ******1234BT IAPR 0.00%",2000.00,"Balance Transfers"',
    '10/03/2026,10/05/2026,"EXAMPLE GROCER #12",42.10,"Supermarkets"',
    '10/06/2026,10/06/2026,"INTERNET PAYMENT - THANK YOU",-150.00,"Payments and Credits"',
    '10/07/2026,10/07/2026,"FIRST LATE PAYMENT - NO FEE",0.00,"Fees"',
    '10/16/2026,10/16/2026,"INTEREST CHARGE ON PURCHASES",0.37,"Interest"',
  ].join('\n') + '\n',
);
// The payment leaving checking.
const checking = Buffer.from(
  [
    'Date,Description,Original Description,Category,Amount,Status',
    '2026-10-05,"Discover","DISCOVER E-PAYMENT 1234",Credit Card Payment,-150.00,Posted',
  ].join('\n') + '\n',
);

test('a credit card export imports, and its payment pairs with checking', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, await createUser('card'));
  await createHousehold(page, 'Card Household', 'Alex');
  await addAccount(page, 'Main Checking');
  await addAccount(page, 'Discover Card', 'Discover', 'Credit card');

  // The format is recognised from the file; the $0.00 notice is not imported.
  await importCsv(page, 'Discover Card', { name: 'Discover_Credit_Card.csv', buffer: discover }, '1,200.00');
  await expect(page.getByTestId('import-result')).toContainText('4 added');
  await importCsv(page, 'Main Checking', { name: 'bk_download.csv', buffer: checking });

  // The payment is a transfer between the two accounts, linked.
  if (test.info().project.name === 'phone') {
    await page.goto('./#/transfers'); // not a phone tab
  } else {
    await navItem(page, 'transfers').click();
  }
  const linked = activePage(page).getByTestId('transfers-linked');
  await expect(linked).toContainText('$150.00');

  // Spending counts the groceries and the interest, not the payment or the balance transfer.
  await openTab(page, 'overview');
  const spending = activePage(page).getByTestId('group-table');
  await expect(spending).toContainText('Food & Dining');
  await expect(spending).toContainText('Financial'); // the interest
  await expect(spending).not.toContainText('2,000'); // the balance transfer
  await expect(spending).not.toContainText('150'); // the payment
  expect(errors).toEqual([]);
});

test('an import into the wrong account can be undone, and the file imported into the right one', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, await createUser('undo'));
  await createHousehold(page, 'Undo Household', 'Alex');
  await addAccount(page, 'Amex Card', 'American Express', 'Credit card');
  await addAccount(page, 'Discover Card', 'Discover', 'Credit card');

  // Oops: the Discover export into the Amex account.
  await importCsv(page, 'Amex Card', { name: 'Discover_Credit_Card.csv', buffer: discover }, '1,200.00');
  const imports = activePage(page).locator('[data-import]');
  await expect(imports.first()).toContainText('Amex Card');
  await imports.first().getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo import' }).click();
  await expect(page.locator('ion-toast')).toContainText('Removed 4 transactions');
  await expect(imports.first()).toContainText('undone');
  await expect(imports.first().getByRole('button', { name: 'Undo' })).toHaveCount(0);

  // The same file into the right account.
  await importCsv(page, 'Discover Card', { name: 'Discover_Credit_Card.csv', buffer: discover });
  await expect(page.getByTestId('import-result')).toContainText('4 added');
  await openTab(page, 'transactions');
  await expect(activePage(page).locator('[data-txn]', { hasText: 'Example Grocer' })).toContainText('Discover Card');
  expect(errors).toEqual([]);
});
