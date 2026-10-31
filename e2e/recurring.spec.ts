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

const renamed = Buffer.from(
  [
    'Date,Description,Original Description,Category,Amount,Status',
    // One subscription, billed under a new name from July.
    '2026-04-06,"Widget.ai Subscription","WIDGET.AI SUBSCRIPTION",Software,-20.00,Posted',
    '2026-05-06,"Widget.ai Subscription","WIDGET.AI SUBSCRIPTION",Software,-20.00,Posted',
    '2026-06-06,"Widget.ai Subscription","WIDGET.AI SUBSCRIPTION",Software,-20.00,Posted',
    '2026-07-06,"Acme.com","ACME.COM",Software,-20.00,Posted',
    '2026-08-06,"Acme.com","ACME.COM",Software,-20.00,Posted',
    '2026-09-06,"Acme.com","ACME.COM",Software,-20.00,Posted',
    '2026-10-06,"Acme.com","ACME.COM",Software,-20.00,Posted',
  ].join('\n') + '\n',
);

test('a renamed merchant can be marked "same as" the new name, and undone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, await createUser('alias'));
  await createHousehold(page, 'Alias Household', 'Alex');
  await addAccount(page, 'Main Checking');
  await importCsv(page, 'Main Checking', { name: 'bk_download.csv', buffer: renamed });
  await openTab(page, 'overview');
  await activePage(page).getByTestId('recurring-panel').getByRole('link', { name: 'All recurring charges' }).click();
  const recurring = activePage(page);

  // Apart: the old name looks stopped, the new one active.
  await expect(recurring.getByTestId('recurring-May have stopped')).toContainText('Widget.ai Subscription');
  await expect(recurring.getByTestId('recurring-Active')).toContainText('Acme.com');

  // Same as: one active subscription with both names.
  await recurring.locator('[data-recurring="widget"]').click();
  await recurring.locator('.recurring-same-as').click();
  await page.locator('ion-popover').getByText('Acme.com').click();
  await expect(recurring.getByTestId('recurring-May have stopped')).toHaveCount(0);
  await recurring.locator('[data-recurring="acme"]').click();
  await expect(recurring.getByTestId('recurring-aliases')).toContainText('Also billed as Widget.ai Subscription');
  await expect(recurring.getByTestId('recurring-details')).toContainText('7 charges since');

  // Undo: apart again (and it was saved: survives a reload first).
  await page.reload();
  await activePage(page).locator('[data-recurring="acme"]').click();
  await activePage(page).getByTestId('recurring-aliases').getByRole('button', { name: 'Undo' }).click();
  await expect(activePage(page).getByTestId('recurring-May have stopped')).toContainText('Widget.ai Subscription');
  expect(errors).toEqual([]);
});
