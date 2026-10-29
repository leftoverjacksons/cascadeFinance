import type { Chart, ChartConfiguration, ChartEvent, TooltipItem } from 'chart.js';
import { Fragment, useCallback, useRef, useState, type ReactNode } from 'react';
import ChartCanvas, { axes, type ChartColors } from '../charts/ChartCanvas';
import { formatDay } from '../domain/dates';
import type { FlowRow } from '../domain/flows';
import { formatCents, formatCentsCompact, formatCentsWhole } from '../domain/money';
import { OTHER, UNCATEGORIZED, type MonthSummary } from '../domain/summary';
import { averageOf, groupValue, monthLabel, TOP_GROUPS, type DashboardModel } from './model';
import FlowsPanel from './FlowsPanel';
import RecurringPanel from './RecurringPanel';
import SharedPanel from './SharedPanel';
import TransactionsPanel from './TransactionsPanel';
import { supabase } from '../lib/supabase';

export interface PanelProps {
  model: DashboardModel;
  /** True on the desktop grid: the body fills its tile. False: natural height. */
  fill: boolean;
  /** Called after a panel changes data (e.g. recategorising), so others refresh. */
  onDataChanged: () => void;
  /** Flow picked on the money-flow diagram; the transactions panel lists its transactions. */
  flow: FlowSelection | null;
  onFlow: (flow: FlowSelection | null) => void;
  /** Whether the transactions panel is on screen (if not, the money-flow panel lists them itself). */
  transactionsShown: boolean;
}

/** A flow (link) of the money-flow diagram and the money_flows rows behind it. */
export interface FlowSelection {
  key: string;
  label: string;
  cents: number;
  from: string;
  to: string;
  rows: FlowRow[];
  /** Only transactions in these categories (a zoomed-in view's subcategory). */
  categoryIds?: string[];
  /** Only transactions from these merchants (merchantKey of their description). */
  merchants?: string[];
  /** Panel that made the selection (a chart); none for the money-flow diagram. */
  origin?: string;
}

export interface PanelDef {
  id: string;
  title: string;
  /** One line under the title. */
  caption?: (model: DashboardModel) => string;
  /** Shown on phones/tablets (stacked). Desktop-only panels are omitted there. */
  mobile: boolean;
  Body: (props: PanelProps) => ReactNode;
}

const seriesColor = (colors: ChartColors, g: string, i: number) => (g === OTHER ? colors.other : colors.series[i]);

/** A #rrggbb colour at the given opacity. */
function faded(hex: string, alpha: number) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})` : hex;
}
/** How the current (last, partial) month is drawn: faded, "still filling". */
const PARTIAL = 0.35;

const monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Selects one month of a chart: its transactions (all money in, all spending,
 * or one spending group) are listed in the Transactions panel (or under the
 * chart on phones). Same click again: clears it. Uses the money-flow rows, so
 * the list matches the money-flow diagram's click-through.
 */
async function selectMonth(
  { model, flow, onFlow }: PanelProps,
  origin: string,
  index: number,
  pick: { kind: 'income' | 'spend'; group?: string; label: string; cents: number },
) {
  const month = model.shown[index]?.month;
  if (!month) return;
  const key = `${origin}:${pick.kind}:${pick.group ?? ''}:${month}`;
  if (flow?.key === key) return onFlow(null);
  const [y, m] = month.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const to = monthEnd < model.data.today ? monthEnd : model.data.today;
  const { data } = await supabase.rpc('money_flows', { p_from: month, p_to: to });
  const rows = ((data ?? []) as FlowRow[]).filter(
    (r) =>
      r.kind === pick.kind &&
      (pick.group === undefined ||
        (pick.group === OTHER ? !model.series.includes(r.target) : r.target === pick.group)),
  );
  onFlow({
    key,
    label: `${pick.label} · ${monthYear.format(new Date(`${month}T00:00:00Z`))}`,
    cents: pick.cents,
    from: month,
    to,
    rows,
    origin,
  });
}

/** Pointer cursor over the plot area: months can be clicked. */
const clickableArea = (event: ChartEvent, _: unknown, chart: Chart) => {
  const { chartArea } = chart;
  const inside =
    event.x !== null &&
    event.y !== null &&
    event.x >= chartArea.left &&
    event.x <= chartArea.right &&
    event.y >= chartArea.top &&
    event.y <= chartArea.bottom;
  chart.canvas.style.cursor = inside ? 'pointer' : 'default';
};

/** The selected month's transactions under a chart, when there is no Transactions panel (phones). */
function ChartSelection(props: PanelProps & { origin: string }) {
  if (props.flow?.origin !== props.origin || props.transactionsShown) return null;
  return (
    <div className="flows-transactions" data-testid={`${props.origin}-transactions`}>
      <TransactionsPanel {...props} />
    </div>
  );
}

/** "Month so far: day 12 of 31", for the current month's tooltip. */
function monthSoFar(today: string) {
  const [y, m, d] = today.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `Month so far: day ${d} of ${daysInMonth}`;
}

const tooltipMoney = (item: TooltipItem<'bar' | 'line'>) =>
  `${item.dataset.label}: ${formatCents(Math.round(Number(item.raw) * 100))}`;

const legend = {
  position: 'top' as const,
  align: 'start' as const,
  labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 },
};

// ── Summary tiles ──────────────────────────────────────────────────────────
function KpisBody({ model }: PanelProps) {
  const { avg, data, netWorth, hasBalances, todayBalances, accounts } = model;
  const latest = netWorth.get(data.today);
  const active = accounts.filter((a) => !a.is_archived).length;
  return (
    <div className="kpis" data-testid="kpis">
      <div className="kpi">
        <div className="label">Avg monthly spending</div>
        <div className="value">{formatCentsWhole(avg.spending)}</div>
        <div className="sub">over {avg.months} full month{avg.months === 1 ? '' : 's'}</div>
      </div>
      <div className="kpi">
        <div className="label">Avg monthly income</div>
        <div className="value">{formatCentsWhole(avg.income)}</div>
        <div className="sub">transfers excluded</div>
      </div>
      <div className="kpi">
        <div className="label">Avg saved per month</div>
        <div className="value">{formatCentsWhole(avg.net)}</div>
        <div className="sub">income − spending</div>
      </div>
      <div className="kpi">
        <div className="label">Net worth</div>
        <div className="value">{latest === undefined ? '—' : formatCentsWhole(latest)}</div>
        <div className="sub">{hasBalances ? `${todayBalances.length} of ${active} accounts` : 'no balances yet'}</div>
      </div>
    </div>
  );
}

// ── Income vs spending ─────────────────────────────────────────────────────
function CashFlowBody(props: PanelProps) {
  const { model, fill, flow } = props;
  // Read at click time, so the chart is not rebuilt on every render.
  const latest = useRef(props);
  latest.current = props;
  const { labels, shown } = model;
  const last = shown.length - 1;
  const today = model.data.today;
  // The selected bar (if this chart made the selection): outlined.
  const selected = flow?.origin === 'cashflow' ? flow.key : null;
  const isSelected = (kind: string, i: number) => selected === `cashflow:${kind}::${shown[i]?.month}`;
  const config = useCallback(
    (c: ChartColors): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Income', kind: 'income', data: shown.map((s) => s.income / 100), color: c.series[0] },
          { label: 'Spending', kind: 'spend', data: shown.map((s) => s.spending / 100), color: c.series[1] },
        ].map(({ color, kind, ...d }) => ({
          ...d,
          // The current month is still filling: faded, with a solid outline.
          // A selected bar has a text-coloured outline.
          backgroundColor: shown.map((_, i) => (i === last ? faded(color, PARTIAL) : color)),
          borderColor: shown.map((_, i) => (isSelected(kind, i) ? c.text : color)),
          borderWidth: shown.map((_, i) => (isSelected(kind, i) ? 2 : i === last ? 1.5 : 0)),
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'start' as const,
          categoryPercentage: 0.7,
          barPercentage: 0.9,
        })),
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        onHover: clickableArea,
        // Click a bar: that month's income or spending, listed.
        onClick: (event, _, chart) => {
          const [bar] = chart.getElementsAtEventForMode(event.native!, 'nearest', { intersect: true }, false);
          if (!bar) return;
          const s = shown[bar.index];
          void selectMonth(
            latest.current,
            'cashflow',
            bar.index,
            bar.datasetIndex === 0
              ? { kind: 'income', label: 'Income', cents: s.income }
              : { kind: 'spend', label: 'Spending', cents: s.spending },
          );
        },
        plugins: {
          legend,
          tooltip: {
            callbacks: {
              label: tooltipMoney,
              footer: (items) =>
                [items[0]?.dataIndex === last ? monthSoFar(today) : '', 'Click a bar for its transactions']
                  .filter(Boolean)
                  .join('\n'),
            },
          },
        },
        scales: axes(c, (v) => formatCentsCompact(v * 100)),
      },
    }),
    [labels, shown, last, today, selected],
  );
  return (
    <div className="flows">
      <ChartCanvas config={config} label="Monthly income and spending" height={fill ? undefined : 240} />
      <ChartSelection {...props} origin="cashflow" />
    </div>
  );
}

// ── Spending by group (stacked areas) ──────────────────────────────────────
function SpendingChartBody(props: PanelProps) {
  const { model, fill, flow } = props;
  const latest = useRef(props); // read at click time, so the chart is not rebuilt on every render
  latest.current = props;
  const { labels, shown, series, groupName } = model;
  const last = shown.length - 1;
  // The selected band and month (if this chart made the selection): marked with a point.
  const selected = flow?.origin === 'spending' ? flow.key : null;
  const isSelected = (g: string, i: number) => selected === `spending:spend:${g}:${shown[i]?.month}`;
  const today = model.data.today;
  const firstWithData = Math.max(0, shown.findIndex((s) => s.spending !== 0 || s.income !== 0));
  const config = useCallback(
    (c: ChartColors): ChartConfiguration => ({
      type: 'line',
      data: {
        labels,
        datasets: series.map((g, i) => {
          const value = groupValue(model, g);
          return {
            label: groupName(g),
            // A month where refunds exceed spending in a group is drawn as zero;
            // the tooltip and table show the actual (net) amount. Months before
            // the first imported money are left blank, not drawn as $0.
            data: shown.map((s, m) => (m < firstWithData ? null : Math.max(0, value(s)) / 100)),
            actual: shown.map((s) => value(s) / 100),
            backgroundColor: seriesColor(c, g, i),
            // Each band fills down to the one below; a 2px surface line separates them.
            fill: i === 0 ? 'origin' : '-1',
            // The stretch into the current month is still filling: faded.
            segment: {
              backgroundColor: (ctx: { p1DataIndex: number }) =>
                ctx.p1DataIndex === last ? faded(seriesColor(c, g, i), PARTIAL) : undefined,
            },
            borderColor: c.surface,
            borderWidth: 2,
            // Straight segments: smoothing would invent values between months.
            tension: 0,
            pointRadius: shown.map((_, m) => (isSelected(g, m) ? 6 : 0)),
            pointBackgroundColor: c.text,
            pointBorderColor: c.surface,
            pointBorderWidth: 2,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: seriesColor(c, g, i),
            pointHoverBorderColor: c.surface,
            pointHoverBorderWidth: 2,
          };
        }),
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend,
          tooltip: {
            callbacks: {
              label: (item) => {
                const actual = (item.dataset as unknown as { actual: number[] }).actual[item.dataIndex];
                return `${item.dataset.label}: ${formatCents(Math.round(actual * 100))}`;
              },
              footer: (items) =>
                [items[0]?.dataIndex === last ? monthSoFar(today) : '', 'Click a band for its transactions']
                  .filter(Boolean)
                  .join('\n'),
            },
            itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          },
        },
        onHover: clickableArea,
        // Click inside a band: that group's spending that month, listed.
        onClick: (event, _, chart) => {
          if (event.x === null || event.y === null) return;
          const index = Math.round(chart.scales.x.getValueForPixel(event.x) ?? -1);
          const y = chart.scales.y.getValueForPixel(event.y) ?? -1;
          if (index < firstWithData || index > last || y < 0) return;
          // Bands are stacked bottom-up in series order: find the one containing y.
          let top = 0;
          const band = series.findIndex((g) => {
            top += Math.max(0, groupValue(model, g)(shown[index]));
            return y * 100 <= top;
          });
          if (band < 0) return;
          const g = series[band];
          void selectMonth(latest.current, 'spending', index, {
            kind: 'spend',
            group: g,
            label: groupName(g),
            cents: groupValue(model, g)(shown[index]),
          });
        },
        scales: {
          x: axes(c, String).x,
          y: { ...axes(c, (v) => formatCentsCompact(v * 100)).y, stacked: true, min: 0 },
        },
      },
    }),
    // `model` changes exactly when these fields do.
    [labels, shown, series, groupName, firstWithData, last, today, selected],
  );
  return (
    <div className="flows">
      <ChartCanvas config={config} label="Monthly spending by category group" height={fill ? undefined : 260} />
      <ChartSelection {...props} origin="spending" />
    </div>
  );
}

// ── Spending table ─────────────────────────────────────────────────────────
function SpendingTableBody({ model }: PanelProps) {
  const { series, shown, byId, current, lastMonth, groupName } = model;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  }

  // Rows under a group: its categories, or for Other the groups folded into it.
  function childRows(g: string): { key: string; name: string; values: (s?: MonthSummary) => number }[] {
    if (g === UNCATEGORIZED) return [];
    if (g === OTHER) {
      const folded = new Set<string>();
      for (const s of shown) for (const k of s.byGroup.keys()) if (!series.includes(k)) folded.add(k);
      return [...folded].map((k) => ({ key: k, name: groupName(k), values: (s) => s?.byGroup.get(k) ?? 0 }));
    }
    return [...byId.values()]
      .filter((c) => c.parent_id === g)
      .map((c) => ({ key: c.id, name: c.name, values: (s?: MonthSummary) => s?.byCategory.get(c.id) ?? 0 }))
      .filter((r) => shown.some((s) => r.values(s) !== 0));
  }

  const rows = [...series].sort((a, b) => averageOf(model, groupValue(model, b)) - averageOf(model, groupValue(model, a)));

  return (
    <table className="data-table" data-testid="group-table">
      <thead>
        <tr>
          <th>Group</th>
          <th>Avg / month</th>
          <th>{lastMonth ? monthLabel(lastMonth.month, 1) : 'Last'}</th>
          <th>{current ? `${monthLabel(current.month, 1)} so far` : 'This'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((g) => {
          const i = series.indexOf(g);
          const f = groupValue(model, g);
          const children = childRows(g);
          const open = expanded.has(g);
          return (
            <Fragment key={g}>
              <tr>
                <td>
                  <button
                    className="expand"
                    onClick={() => toggle(g)}
                    disabled={children.length === 0}
                    aria-expanded={children.length > 0 ? open : undefined}
                    aria-label={
                      children.length > 0
                        ? `${groupName(g)}: ${open ? 'hide' : 'show'} ${g === OTHER ? 'groups' : 'categories'}`
                        : groupName(g)
                    }
                  >
                    <span className="chevron" aria-hidden="true">
                      {children.length > 0 ? (open ? '▾' : '▸') : ''}
                    </span>
                    <span
                      className="swatch"
                      style={{ background: g === OTHER ? 'var(--series-other)' : `var(--series-${i + 1})` }}
                    />
                    {groupName(g)}
                  </button>
                </td>
                <td>{formatCentsWhole(averageOf(model, f))}</td>
                <td>{formatCentsWhole(f(lastMonth))}</td>
                <td>{formatCentsWhole(f(current))}</td>
              </tr>
              {open &&
                children.map((r) => (
                  <tr key={r.key} className="child">
                    <td>{r.name}</td>
                    <td>{formatCentsWhole(averageOf(model, r.values))}</td>
                    <td>{formatCentsWhole(r.values(lastMonth))}</td>
                    <td>{formatCentsWhole(r.values(current))}</td>
                  </tr>
                ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Net worth ──────────────────────────────────────────────────────────────
function NetWorthBody({ model, fill }: PanelProps) {
  const { labels, dates, netWorth, hasBalances } = model;
  const config = useCallback(
    (c: ChartColors): ChartConfiguration => ({
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Net worth',
            data: dates.map((d) => (netWorth.has(d) ? netWorth.get(d)! / 100 : null)),
            borderColor: c.series[0],
            backgroundColor: c.series[0],
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBorderColor: c.surface,
            pointBorderWidth: 2,
            tension: 0,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: tooltipMoney } } },
        scales: axes(c, (v) => formatCentsCompact(v * 100)),
      },
    }),
    [labels, dates, netWorth],
  );
  if (!hasBalances) return <NoBalances />;
  return <ChartCanvas config={config} label="Net worth by month" height={fill ? undefined : 240} />;
}

function NoBalances() {
  return (
    <p className="caption">
      Record a balance for each account (Accounts, or when importing a file) to see net worth. For loans and cards,
      enter the amount owed from a statement.
    </p>
  );
}

// ── Account balances ───────────────────────────────────────────────────────
function BalancesBody({ model }: PanelProps) {
  const { todayBalances, accounts, hasBalances } = model;
  if (!hasBalances) return <NoBalances />;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return (
    <table className="data-table" data-testid="balances-table">
      <thead>
        <tr>
          <th>Account</th>
          <th>Balance today</th>
          <th>Based on</th>
        </tr>
      </thead>
      <tbody>
        {todayBalances.map((b) => {
          const a = byId.get(b.account_id);
          return (
            <tr key={b.account_id}>
              <td>{a?.name ?? '—'}</td>
              <td>{a?.is_liability ? `owes ${formatCentsWhole(-b.balance_cents)}` : formatCentsWhole(b.balance_cents)}</td>
              <td>{formatDay(b.anchor_date)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export const PANELS: PanelDef[] = [
  { id: 'kpis', title: 'Summary', mobile: true, Body: KpisBody },
  {
    id: 'cashflow',
    title: 'Income and spending',
    caption: () => 'Per month. Transfers between your accounts are left out; pending transactions are not included.',
    mobile: true,
    Body: CashFlowBody,
  },
  {
    id: 'flows',
    title: 'Money flow',
    caption: () => 'Where money came from and went, through your accounts. Hover for amounts.',
    mobile: true,
    Body: FlowsPanel,
  },
  {
    id: 'netWorth',
    title: 'Net worth',
    caption: () => 'Month-end balances estimated from recorded balances plus posted transactions.',
    mobile: true,
    Body: NetWorthBody,
  },
  {
    id: 'spending',
    title: 'Spending by group',
    caption: (m) => `Top ${TOP_GROUPS} groups over the last ${m.data.months.length} months; the rest combined as Other.`,
    mobile: true,
    Body: SpendingChartBody,
  },
  {
    id: 'spendingTable',
    title: 'Spending by group: table',
    caption: () => 'Tap a group to see its categories.',
    mobile: true,
    Body: SpendingTableBody,
  },
  { id: 'balances', title: 'Account balances', mobile: true, Body: BalancesBody },
  {
    id: 'shared',
    title: 'Shared between you',
    caption: () => 'Shared spending each of you paid, and who owes whom.',
    mobile: true,
    Body: SharedPanel,
  },
  {
    id: 'recurring',
    title: 'Recurring charges',
    caption: () => 'Subscriptions, bills and loans that repeat; what is due next.',
    mobile: true,
    Body: RecurringPanel,
  },
  {
    id: 'transactions',
    title: 'Transactions',
    caption: () => 'Click a transaction to categorise it; the charts update as you go.',
    mobile: false,
    Body: TransactionsPanel,
  },
];

export const PANEL_BY_ID = new Map(PANELS.map((p) => [p.id, p]));
