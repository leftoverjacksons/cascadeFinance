import {
  IonContent,
  IonHeader,
  IonLabel,
  IonPage,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  useIonViewWillEnter,
} from '@ionic/react';
import type { ChartConfiguration, TooltipItem } from 'chart.js';
import { Fragment, useCallback, useMemo, useState } from 'react';
import ChartCanvas, { axes, type ChartColors } from '../charts/ChartCanvas';
import { formatDay } from '../domain/dates';
import { formatCents, formatCentsCompact, formatCentsWhole } from '../domain/money';
import {
  averages,
  netWorthByDate,
  OTHER,
  seriesValues,
  summarise,
  topGroups,
  UNCATEGORIZED,
  type MonthSummary,
} from '../domain/summary';
import { useAccounts } from '../household/useAccounts';
import { useCategories } from '../household/useCategories';
import { balanceDates, useOverview } from '../household/useOverview';

const PERIODS = [6, 12, 24] as const;
/** Spending chart shows this many groups; the rest fold into "Other". */
const TOP_GROUPS = 6;

const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

function monthLabel(month: string, index: number): string {
  const d = new Date(`${month}T00:00:00Z`);
  const label = monthFmt.format(d);
  return index === 0 || month.endsWith('-01-01') ? `${label} ’${month.slice(2, 4)}` : label;
}

const seriesColor = (colors: ChartColors, g: string, i: number) => (g === OTHER ? colors.other : colors.series[i]);

const tooltipMoney = (item: TooltipItem<'bar' | 'line'>) =>
  `${item.dataset.label}: ${formatCents(Math.round(Number(item.raw) * 100))}`;

export default function OverviewPage() {
  const { data, error, refresh } = useOverview();
  const { byId, refresh: refreshCategories } = useCategories();
  const { accounts, refresh: refreshAccounts } = useAccounts();
  const [period, setPeriod] = useState<number>(12);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useIonViewWillEnter(() => {
    void refresh();
    void refreshCategories();
    void refreshAccounts();
  });

  const all = useMemo(
    () => (data ? summarise(data.totals, byId, data.months) : []),
    [data, byId],
  );
  // Series are chosen over the full fetched history, so changing the period
  // never repaints a group in a different colour.
  const series = useMemo(() => {
    const top = topGroups(all, TOP_GROUPS);
    const hasRest = all.some((s) => [...s.byGroup.keys()].some((g) => !top.includes(g)));
    return hasRest ? [...top, OTHER] : top;
  }, [all]);

  const shown = useMemo(() => all.slice(-period), [all, period]);
  const current = shown[shown.length - 1] as MonthSummary | undefined;
  const complete = shown.slice(0, -1);
  const avg = averages(complete.length > 0 ? complete : shown);
  const lastMonth = complete[complete.length - 1];

  const groupName = useCallback(
    (g: string) => (g === OTHER ? 'Other' : g === UNCATEGORIZED ? 'Uncategorized' : (byId.get(g)?.name ?? '—')),
    [byId],
  );

  const labels = useMemo(
    () => shown.map((s, i) => monthLabel(s.month, i) + (i === shown.length - 1 ? ' (so far)' : '')),
    [shown],
  );

  // ── Cash flow ──
  const cashFlowConfig = useCallback(
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
        plugins: {
          legend: { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 } },
          tooltip: { callbacks: { label: tooltipMoney } },
        },
        scales: axes(c, (v) => formatCentsCompact(v * 100)),
      },
    }),
    [labels, shown],
  );

  // ── Spending by group (stacked) ──
  const spendingConfig = useCallback(
    (c: ChartColors): ChartConfiguration => ({
      type: 'bar',
      data: {
        labels,
        datasets: series.map((g, i) => ({
          label: groupName(g),
          // A month where refunds exceed spending in a group is drawn as zero;
          // the tooltip and table show the actual (net) amount.
          data: shown.map((s) => Math.max(0, seriesValues(s, series).get(g) ?? 0) / 100),
          actual: shown.map((s) => (seriesValues(s, series).get(g) ?? 0) / 100),
          backgroundColor: seriesColor(c, g, i),
          // 2px surface gap between stacked segments.
          borderColor: c.surface,
          borderWidth: { top: 2 },
          borderSkipped: 'start' as const,
          categoryPercentage: 0.7,
        })),
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 2 } },
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
          ...axes(c, (v) => formatCentsCompact(v * 100)),
          x: { ...axes(c, String).x, stacked: true },
          y: { ...axes(c, (v) => formatCentsCompact(v * 100)).y, stacked: true, min: 0 },
        },
      },
    }),
    [labels, shown, series, groupName],
  );

  // ── Net worth ──
  const dates = useMemo(() => (data ? balanceDates(data.months, data.today).slice(-period) : []), [data, period]);
  const netWorth = useMemo(() => (data ? netWorthByDate(data.balances) : new Map<string, number>()), [data]);
  const hasBalances = (data?.balances.length ?? 0) > 0;
  const netWorthConfig = useCallback(
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

  const todayBalances = data ? data.balances.filter((b) => b.as_of === data.today) : [];
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const latestNetWorth = data ? netWorth.get(data.today) : undefined;

  function toggle(key: string) {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  }

  // Rows under a group in the table: its categories, or for Other the folded groups.
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

  const avgOf = (f: (s?: MonthSummary) => number) => {
    const base = complete.length > 0 ? complete : shown;
    return base.reduce((t, s) => t + f(s), 0) / Math.max(base.length, 1);
  };
  const groupValue = (g: string) => (s?: MonthSummary) => (s ? (seriesValues(s, series).get(g) ?? 0) : 0);
  const tableRows = [...series].sort((a, b) => avgOf(groupValue(b)) - avgOf(groupValue(a)));

  const noData = data && data.totals.length === 0;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Overview</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={String(period)} onIonChange={(e) => setPeriod(Number(e.detail.value))}>
            {PERIODS.map((p) => (
              <IonSegmentButton key={p} value={String(p)}>
                <IonLabel>{p} months</IonLabel>
              </IonSegmentButton>
            ))}
          </IonSegment>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={(e) => void refresh().then(() => e.detail.complete())}>
          <IonRefresherContent />
        </IonRefresher>
        {error && (
          <IonText color="danger">
            <p className="ion-padding">{error}</p>
          </IonText>
        )}
        {!data && !error && (
          <div className="center">
            <IonSpinner />
          </div>
        )}
        {noData && (
          <IonText color="medium">
            <p className="ion-padding">Import transactions to see your overview.</p>
          </IonText>
        )}
        {data && !noData && (
          <>
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
                <div className="value">{latestNetWorth === undefined ? '—' : formatCentsWhole(latestNetWorth)}</div>
                <div className="sub">
                  {hasBalances ? `${todayBalances.length} of ${accounts.filter((a) => !a.is_archived).length} accounts` : 'no balances yet'}
                </div>
              </div>
            </div>

            <section className="card">
              <h2>Income and spending</h2>
              <p className="caption">Per month. Transfers between your accounts are left out; pending transactions are not included.</p>
              <ChartCanvas config={cashFlowConfig} label="Monthly income and spending" />
            </section>

            <section className="card">
              <h2>Spending by group</h2>
              <p className="caption">Top {TOP_GROUPS} groups over the last {data.months.length} months; the rest are combined as Other. Tap a row for detail.</p>
              <ChartCanvas config={spendingConfig} label="Monthly spending by category group" height={260} />
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
                  {tableRows.map((g) => {
                    const i = series.indexOf(g);
                    const f = groupValue(g);
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
                          <td>{formatCentsWhole(avgOf(f))}</td>
                          <td>{formatCentsWhole(f(lastMonth))}</td>
                          <td>{formatCentsWhole(f(current))}</td>
                        </tr>
                        {open &&
                          children.map((r) => (
                            <tr key={r.key} className="child">
                              <td>{r.name}</td>
                              <td>{formatCentsWhole(avgOf(r.values))}</td>
                              <td>{formatCentsWhole(r.values(lastMonth))}</td>
                              <td>{formatCentsWhole(r.values(current))}</td>
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className="card">
              <h2>Net worth</h2>
              {hasBalances ? (
                <>
                  <p className="caption">
                    Month-end balances, estimated from the balances you recorded plus posted transactions.
                    Only accounts with a recorded balance are included.
                  </p>
                  <ChartCanvas config={netWorthConfig} label="Net worth by month" />
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
                        const a = accountById.get(b.account_id);
                        return (
                          <tr key={b.account_id}>
                            <td>{a?.name ?? '—'}</td>
                            <td>
                              {a?.is_liability ? `owes ${formatCentsWhole(-b.balance_cents)}` : formatCentsWhole(b.balance_cents)}
                            </td>
                            <td>{formatDay(b.anchor_date)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="caption">
                  Record a balance for each account (Accounts tab, or when importing a file) to see net worth.
                  For loans and cards, enter the amount owed from a statement.
                </p>
              )}
            </section>
          </>
        )}
      </IonContent>
    </IonPage>
  );
}
