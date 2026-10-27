import type { ChartConfiguration, TooltipItem } from 'chart.js';
import { Fragment, useCallback, useState, type ReactNode } from 'react';
import ChartCanvas, { axes, type ChartColors } from '../charts/ChartCanvas';
import { formatDay } from '../domain/dates';
import { formatCents, formatCentsCompact, formatCentsWhole } from '../domain/money';
import { OTHER, UNCATEGORIZED, type MonthSummary } from '../domain/summary';
import { averageOf, groupValue, monthLabel, TOP_GROUPS, type DashboardModel } from './model';
import FlowsPanel from './FlowsPanel';
import TransactionsPanel from './TransactionsPanel';

export interface PanelProps {
  model: DashboardModel;
  /** True on the desktop grid: the body fills its tile. False: natural height. */
  fill: boolean;
  /** Called after a panel changes data (e.g. recategorising), so others refresh. */
  onDataChanged: () => void;
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
function CashFlowBody({ model, fill }: PanelProps) {
  const { labels, shown } = model;
  const config = useCallback(
    (c: ChartColors): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Income', data: shown.map((s) => s.income / 100), backgroundColor: c.series[0] },
          { label: 'Spending', data: shown.map((s) => s.spending / 100), backgroundColor: c.series[1] },
        ].map((d) => ({
          ...d,
          borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'start' as const,
          categoryPercentage: 0.7,
          barPercentage: 0.9,
        })),
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend, tooltip: { callbacks: { label: tooltipMoney } } },
        scales: axes(c, (v) => formatCentsCompact(v * 100)),
      },
    }),
    [labels, shown],
  );
  return <ChartCanvas config={config} label="Monthly income and spending" height={fill ? undefined : 240} />;
}

// ── Spending by group (stacked) ────────────────────────────────────────────
function SpendingChartBody({ model, fill }: PanelProps) {
  const { labels, shown, series, groupName } = model;
  const config = useCallback(
    (c: ChartColors): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels,
        datasets: series.map((g, i) => {
          const value = groupValue(model, g);
          return {
            label: groupName(g),
            // A month where refunds exceed spending in a group is drawn as zero;
            // the tooltip and table show the actual (net) amount.
            data: shown.map((s) => Math.max(0, value(s)) / 100),
            actual: shown.map((s) => value(s) / 100),
            backgroundColor: seriesColor(c, g, i),
            // 2px surface gap between stacked segments.
            borderColor: c.surface,
            borderWidth: { top: 2 },
            borderSkipped: 'start' as const,
            categoryPercentage: 0.7,
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
            },
            itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          },
        },
        scales: {
          x: { ...axes(c, String).x, stacked: true },
          y: { ...axes(c, (v) => formatCentsCompact(v * 100)).y, stacked: true, min: 0 },
        },
      },
    }),
    // `model` changes exactly when these fields do.
    [labels, shown, series, groupName],
  );
  return <ChartCanvas config={config} label="Monthly spending by category group" height={fill ? undefined : 260} />;
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
    id: 'transactions',
    title: 'Transactions',
    caption: () => 'Click a transaction to categorise it; the charts update as you go.',
    mobile: false,
    Body: TransactionsPanel,
  },
];

export const PANEL_BY_ID = new Map(PANELS.map((p) => [p.id, p]));
