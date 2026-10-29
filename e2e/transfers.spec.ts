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
  const moved = (await node.locator('rect').nth(1).boundingBox())!.x;
  // Positions are saved for this person and survive a reload.
  await page.waitForTimeout(1500);
  await page.reload();
  await node.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await node.locator('rect').nth(1).boundingBox())!.x).toBeCloseTo(moved, 0);
  await flows.getByRole('button', { name: 'Reset layout' }).click();
  await expect.poll(async () => (await node.locator('rect').nth(1).boundingBox())!.x).toBe(before.x);

  // A tail's end can be dragged up or down its node's stack; the order is saved.
  const ends = () =>
    flows.evaluate((panel) => {
      const paths = [...panel.querySelectorAll<SVGPathElement>('path[data-link]')];
      const bySource = new Map<string, SVGPathElement[]>();
      for (const p of paths) {
        const from = p.dataset.link!.split('>')[0];
        bySource.set(from, [...(bySource.get(from) ?? []), p]);
      }
      const group = [...bySource.values()].find((g) => g.length >= 2);
      if (!group) return []; // not drawn yet
      return group
        .map((p) => {
          const pt = p.getPointAtLength(0).matrixTransform(p.getScreenCTM()!);
          return { link: p.dataset.link!, x: pt.x, y: pt.y, w: Number(p.getAttribute('stroke-width')) };
        })
        .sort((a, b) => a.y - b.y);
    });
  await expect.poll(async () => (await ends()).length).toBeGreaterThan(1);
  const drawn = await ends();
  const [first, last] = [drawn[0], drawn.at(-1)!];
  const from = { x: first.x + 15, y: first.y }; // past the node's own 6 px grab area
  const to = { x: first.x + 15, y: last.y + last.w / 2 + 2 };
  if (test.info().project.name === 'phone') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x, y: from.y + ((to.y - from.y) * i) / 6 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
  }
  await expect.poll(async () => (await ends()).at(-1)?.link).toBe(first.link);
  await page.waitForTimeout(1500);
  await page.reload();
  await expect.poll(async () => (await ends()).at(-1)?.link).toBe(first.link);
  await flows.getByRole('button', { name: 'Reset layout' }).click();
  await expect.poll(async () => (await ends())[0]?.link).toBe(first.link);

  // Clicking a flow selects it and lists its transactions (in the Transactions
  // panel on desktop, under the diagram on phones).
  // (Dispatched on the element: flows overlap, so a click at its centre may land on another.)
  await flows.locator('path[data-link^="in:"]').first().dispatchEvent('click');
  await expect(flows.getByTestId('flow-selection')).toContainText('Paycheck');
  const list = test.info().project.name === 'phone' ? flows : activePage(page).locator('[data-panel=transactions]');
  await expect(list.getByTestId('transactions-flow-filter')).toContainText('1 transaction in');
  await expect(list.getByTestId('transactions-panel')).toContainText('Example Employer Payroll');
  await expect(list.getByTestId('transactions-panel')).not.toContainText('Kroger');
  await list.getByRole('button', { name: 'Show all' }).click();
  await expect(flows.getByTestId('flow-selection')).toHaveCount(0);

  // Zoom into a spending group (right-click, or tap on a phone): it splits into its categories.
  const food = flows.locator('.sankey-node', { hasText: 'Food & Dining' }).locator('rect').nth(1);
  await food.scrollIntoViewIfNeeded();
  if (test.info().project.name === 'phone') await food.tap({ force: true });
  else await food.click({ button: 'right', force: true });
  await flows.getByRole('menuitem', { name: 'Zoom in' }).click();
  await expect(flows.getByTestId('flows-zoom')).toContainText('Food & Dining');
  await expect(flows.getByTestId('sankey')).toContainText('Groceries');
  await expect(flows.getByTestId('sankey')).toContainText('Coffee Shops');
  // A part's tail lists only its own transactions.
  await flows.locator('.sankey-node', { hasText: 'Groceries' }).waitFor();
  const groceries = await flows.evaluate((panel) => {
    const node = [...panel.querySelectorAll<SVGGElement>('.sankey-node')].find((g) => g.textContent === 'Groceries');
    return node?.dataset.node;
  });
  await flows.locator(`path[data-link$=">${groceries}"]`).dispatchEvent('click');
  await expect(list.getByTestId('transactions-panel')).toContainText('Kroger');
  await expect(list.getByTestId('transactions-panel')).not.toContainText('Corner Cafe'); // Coffee Shops

  // Groceries is a lowest-level category: zooming in splits it by merchant.
  const openMenu = async (name: string) => {
    const rect = flows.locator('.sankey-node', { hasText: name }).locator('rect').nth(1);
    if (test.info().project.name === 'phone') await rect.tap({ force: true });
    else await rect.click({ button: 'right', force: true });
  };
  await openMenu('Groceries');
  await flows.getByRole('menuitem', { name: 'Zoom in' }).click();
  await expect(flows.getByTestId('flows-zoom')).toContainText('Food & Dining'); // breadcrumb
  await expect(flows.getByTestId('flows-zoom')).toContainText('Groceries');
  await expect(flows.getByTestId('sankey')).toContainText('Kroger');
  await flows.locator('path[data-link$=">merchant:kroger"]').dispatchEvent('click');
  await expect(list.getByTestId('transactions-flow-filter')).toContainText('Groceries → Kroger');
  await expect(list.getByTestId('transactions-panel')).toContainText('Kroger');
  await expect(list.getByTestId('transactions-panel')).not.toContainText('Publix'); // same category, other merchant
  // Merchants are the lowest level.
  await openMenu('Kroger');
  await expect(flows.getByRole('menuitem', { name: 'Zoom in' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // The breadcrumb zooms back out one step.
  await flows.getByTestId('flows-zoom').getByRole('button', { name: 'Food & Dining' }).click();
  await expect(flows.getByTestId('sankey')).toContainText('Coffee Shops');
  await flows.getByRole('button', { name: '← All money' }).click();
  await expect(flows.getByTestId('flows-zoom')).toHaveCount(0);
  await expect(flows.getByTestId('sankey')).toContainText('Main Checking');
  // People view: accounts merge by owner (both accounts here are unowned, so joint).
  await flows.getByRole('button', { name: 'People' }).click();
  await expect(flows.getByTestId('sankey')).not.toContainText('Main Checking');
  await expect(flows.getByTestId('sankey')).toContainText('Joint');
  await flows.getByRole('button', { name: 'Accounts' }).click();
  await expect(flows.getByTestId('sankey')).toContainText('Main Checking');
  await flows.getByRole('button', { name: 'Show as table' }).click();
  const table = flows.getByTestId('flows-table');
  await expect(table.locator('tr', { hasText: 'Joint' }).filter({ hasText: 'Main Checking' })).toContainText('$1,000');
  await expect(table).toContainText('Paycheck');
  expect(errors).toEqual([]);
});
