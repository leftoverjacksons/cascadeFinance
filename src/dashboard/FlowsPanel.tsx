import { Chart, type ChartConfiguration } from 'chart.js';
import { Flow, SankeyController } from 'chartjs-chart-sankey';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ChartCanvas, { type ChartColors } from '../charts/ChartCanvas';
import { buildSankey, layoutSankey, type FlowRow, type SankeyGraph, type SankeyNode } from '../domain/flows';
import { formatCents, formatCentsWhole } from '../domain/money';
import { OTHER } from '../domain/summary';
import { supabase } from '../lib/supabase';
import type { PanelProps } from './panels';

Chart.register(SankeyController, Flow);

/** Flows below this share of the largest node are left out of the diagram (kept in the table). */
const MIN_SHARE = 0.003;

/** Sankey of money in -> accounts -> other accounts / spending, for the selected period. */
export default function FlowsPanel({ model, fill }: PanelProps) {
  const [rows, setRows] = useState<FlowRow[] | null>(null);
  const [showTable, setShowTable] = useState(false);
  const from = model.shown[0]?.month;
  const to = model.data.today;

  useEffect(() => {
    if (!from) return;
    let cancelled = false;
    supabase.rpc('money_flows', { p_from: from, p_to: to }).then(({ data }) => {
      if (!cancelled) setRows((data as FlowRow[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
    // model.data changes whenever the dashboard refreshes (e.g. after recategorising).
  }, [from, to, model.data]);

  const graph: SankeyGraph | null = useMemo(() => {
    if (!rows) return null;
    const accounts = new Map(model.accounts.map((a) => [a.id, a.name]));
    return buildSankey(rows, {
      account: (id) => accounts.get(id) ?? 'Account',
      category: (id) => model.byId.get(id)?.name ?? 'Category',
      series: model.series,
    });
  }, [rows, model.accounts, model.byId, model.series]);

  const largest = useMemo(() => {
    const totals = new Map<string, number>();
    for (const l of graph?.links ?? []) {
      totals.set(l.from, (totals.get(l.from) ?? 0) + l.cents);
      totals.set(l.to, (totals.get(l.to) ?? 0) + l.cents);
    }
    return Math.max(0, ...totals.values());
  }, [graph]);
  const drawn = useMemo(() => (graph?.links ?? []).filter((l) => l.cents >= largest * MIN_SHARE), [graph, largest]);
  const hidden = (graph?.links.length ?? 0) - drawn.length;

  const config = useCallback(
    (c: ChartColors): ChartConfiguration => {
      const g = { ...graph!, links: drawn };
      const { column, priority } = layoutSankey(g);
      const byKey = new Map(g.nodes.map((n) => [n.key, n]));
      const colorOf = (n: SankeyNode | undefined) => {
        if (!n) return c.other;
        if (n.role === 'spend') {
          const i = model.series.indexOf(n.group!);
          return n.group === OTHER || i < 0 ? c.other : c.series[i];
        }
        if (n.role === 'transfer') return c.other;
        return c.text; // income sources and accounts: neutral
      };
      return {
        type: 'sankey' as never,
        data: {
          datasets: [
            {
              label: 'Money flow',
              data: g.links.map((l) => ({ from: l.from, to: l.to, flow: l.cents / 100 })),
              labels: Object.fromEntries(g.nodes.map((n) => [n.key, n.label])),
              column,
              priority,
              colorFrom: (ctx: { raw: { from: string } }) => colorOf(byKey.get(ctx.raw.from)),
              colorTo: (ctx: { raw: { to: string } }) => colorOf(byKey.get(ctx.raw.to)),
              colorMode: 'gradient',
              alpha: 0.45,
              color: c.text,
              borderWidth: 0,
              nodeWidth: 8,
              nodePadding: 14,
              size: 'max',
            } as never,
          ],
        },
        options: {
          maintainAspectRatio: false,
          layout: { padding: { right: 8 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: () => '',
                label: (item) => {
                  const raw = item.raw as { from: string; to: string; flow: number };
                  return `${byKey.get(raw.from)?.label} → ${byKey.get(raw.to)?.label}: ${formatCents(Math.round(raw.flow * 100))}`;
                },
              },
            },
          },
        },
      };
    },
    [graph, drawn, model.series],
  );

  if (!graph) return <p className="caption">Loading…</p>;
  if (graph.links.length === 0) return <p className="caption">No money movements in this period.</p>;

  const label = (key: string) => graph.nodes.find((n) => n.key === key)?.label ?? key;
  return (
    <div className="flows">
      <div className="flows-toggle">
        {hidden > 0 && !showTable && (
          <span className="flows-note">
            {hidden} small flow{hidden === 1 ? '' : 's'} not drawn ·{' '}
          </span>
        )}
        <button className="link-like" onClick={() => setShowTable(!showTable)} aria-pressed={showTable}>
          {showTable ? 'Show diagram' : 'Show as table'}
        </button>
      </div>
      {showTable ? (
        <div className="panel-scroll">
          <table className="data-table" data-testid="flows-table">
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {[...graph.links]
                .sort((a, b) => b.cents - a.cents)
                .map((l) => (
                  <tr key={`${l.from}>${l.to}`}>
                    <td>{label(l.from)}</td>
                    <td style={{ textAlign: 'left' }}>{label(l.to)}</td>
                    <td>{formatCentsWhole(l.cents)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ChartCanvas
          config={config}
          label="Money flow from income through accounts to spending"
          height={fill ? undefined : 460}
        />
      )}
    </div>
  );
}
