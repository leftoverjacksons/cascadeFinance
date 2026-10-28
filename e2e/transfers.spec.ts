import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
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

const checking = readFileSync(new URL('../tests/fixtures/usaa_bank_sample.csv', import.meta.url));
// The joint account receives the $1,000 sent from checking on 2026-10-14.
const joint = Buffer.from(
  [
    'Date,Description,Original Description,Category,Amount,Status',
    '2026-10-15,"USAA Transfer","USAA FUNDS TRANSFER CR",Transfer,1000.00,Posted',
    '2026-10-18,"Kroger","KROGER #123",Groceries,-82.40,Posted',
  ].join('\n') + '\n',
);

test('transfers between accounts are linked, reviewable, and shown as money flow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await signIn(page, await createUser('xfer'));
  await createHousehold(page, 'Transfer Household', 'Alex');
  await addAccount(page, 'Main Checking');
  await addAccount(page, 'Joint');
  await importCsv(page, 'Main Checking', { name: 'bk_download.csv', buffer: checking });
  await importCsv(page, 'Joint', { name: 'bk_download (joint).csv', buffer: joint });

  // ── Linked automatically on import ──
  await openTab(page, 'transactions');
  const sent = transactionRows(page).filter({ hasText: 'USAA FUNDS TRANSFER DB' });
  await expect(sent).toContainText('→ Joint');
  await expect(sent).toContainText('Transfers › Between Accounts');

  // ── Transfers page ──
  // Sidebar on desktop; a button on the Transactions page on phones.
  await page
    .locator('ion-menu [data-nav=transfers]:visible, .ion-page:not(.ion-page-hidden) ion-header ion-button:visible', {
      hasText: 'Transfers',
    })
    .first()
    .click();
  const linked = page.getByTestId('transfers-linked');
  await expect(linked).toContainText('Main Checking → Joint');

  // Unlink: both sides become unmatched, and matching won't re-propose the pair.
  await linked.getByRole('button', { name: 'Unlink' }).click();
  await expect(linked).toContainText('None yet');
  const unmatched = page.getByTestId('transfers-unmatched');
  await expect(unmatched.locator('[data-txn]')).toHaveCount(2);
  await activePage(page).getByRole('button', { name: 'Find matches' }).click();
  await expect(page.getByText('Linked 0 new transfers.')).toBeVisible();

  // Link by hand from the unmatched list.
  await unmatched.locator('[data-txn]', { hasText: 'USAA FUNDS TRANSFER DB' }).click();
  const detail = transactionDetail(page);
  await detail.getByTestId('transfer-section').getByText('Link as a transfer…').click();
  await page.getByTestId('transfer-candidates').locator('ion-item', { hasText: 'Joint' }).first().click();
  await expect(linked).toContainText('Main Checking → Joint');
  await expect(unmatched.locator('[data-txn]')).toHaveCount(0);

  // ── Money flow on the Overview ──
  await openTab(page, 'overview');
  const flows = activePage(page).locator('[data-panel=flows]');
  await expect(flows.getByTestId('sankey')).toBeVisible();
  // Nodes can be dragged; their flows follow, and the layout can be reset.
  // (Dragged right: a first-column node always has room that way.)
  const node = flows.locator('.sankey-node[data-node^="in:"]').first();
  await node.scrollIntoViewIfNeeded();
  const before = (await node.locator('rect').nth(1).boundingBox())!;
  const [x, y] = [before.x + before.width / 2, before.y + before.height / 2];
  if (test.info().project.name === 'phone') {
    // A real touch drag (Playwright's mouse would not show a scroll taking over).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 8, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y, { steps: 5 });
    await page.mouse.up();
  }
  await expect.poll(async () => (await node.locator('rect').nth(1).boundingBox())!.x).not.toBe(before.x);
  await flows.getByRole('button', { name: 'Reset layout' }).click();
  await expect.poll(async () => (await node.locator('rect').nth(1).boundingBox())!.x).toBe(before.x);
  await flows.getByRole('button', { name: 'Show as table' }).click();
  const table = flows.getByTestId('flows-table');
  await expect(table.locator('tr', { hasText: 'Joint' }).filter({ hasText: 'Main Checking' })).toContainText('$1,000');
  await expect(table).toContainText('Paycheck');
  expect(errors).toEqual([]);
});
