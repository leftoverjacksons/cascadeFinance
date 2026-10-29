import { expect, test } from '@playwright/test';
import { activePage, addAccount, createHousehold, createUser, importCsv, openTab, signIn } from './helpers';

const checking = Buffer.from(
  [
    'Date,Description,Original Description,Category,Amount,Status',
    // A monthly subscription...
    '2026-07-15,"Netflix","NETFLIX.COM",Entertainment,-15.49,Posted',
    '2026-08-15,"Netflix","NETFLIX.COM",Entertainment,-15.49,Posted',
    '2026-09-15,"Netflix","NETFLIX.COM",Entertainment,-15.49,Posted',
    '2026-10-15,"Netflix","NETFLIX.COM",Entertainment,-15.49,Posted',
    // ...and shopping at no steady pace.
    '2026-07-02,"Target","TARGET #1",Shopping,-40.00,Posted',
    '2026-07-20,"Target","TARGET #1",Shopping,-25.00,Posted',
    '2026-09-29,"Target","TARGET #1",Shopping,-61.00,Posted',
    '2026-10-03,"Target","TARGET #1",Shopping,-12.00,Posted',
  ].join('\n') + '\n',
);

test('recurring charges are found, explained, and can be marked not recurring', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, await createUser('recur'));
  await createHousehold(page, 'Recurring Household', 'Alex');
  await addAccount(page, 'Main Checking');
  await importCsv(page, 'Main Checking', { name: 'bk_download.csv', buffer: checking });

  // The Overview panel sums them and links to the page (the only way there on phones).
  await openTab(page, 'overview');
  const panel = activePage(page).getByTestId('recurring-panel');
  await expect(panel).toContainText('$15 a month in 1 recurring charge');
  await panel.getByRole('link', { name: 'All recurring charges' }).click();

  const recurring = activePage(page);
  await expect(recurring.getByTestId('recurring-summary')).toContainText('About $15 a month');
  const netflix = recurring.locator('[data-recurring="netflix"]');
  await expect(netflix).toContainText('Netflix');
  await expect(netflix).toContainText('Monthly');
  await expect(recurring.locator('[data-recurring="target"]')).toHaveCount(0);

  // Its history, and "not recurring" hides it (kept, and restorable, under Hidden).
  await netflix.click();
  await expect(recurring.getByTestId('recurring-details')).toContainText('4 charges since');
  await recurring.getByRole('button', { name: 'Not recurring' }).click();
  await expect(recurring.getByTestId('recurring-Active')).toHaveCount(0);
  await expect(recurring.getByTestId('recurring-summary')).toContainText('About $0 a month');
  await page.reload();
  await expect(activePage(page).getByTestId('recurring-Hidden')).toContainText('Netflix');
  await activePage(page).locator('[data-recurring="netflix"]').click();
  await activePage(page).getByRole('button', { name: 'Show again' }).click();
  await expect(activePage(page).getByTestId('recurring-Active')).toContainText('Netflix');
  expect(errors).toEqual([]);
});
