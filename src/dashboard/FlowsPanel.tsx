import { useIonToast } from '@ionic/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import SankeyDiagram, { type SankeyPositions } from '../charts/SankeyDiagram';
import { buildSankey, type FlowRow, type SankeyGraph, type SankeyNode } from '../domain/flows';
import { formatCents, formatCentsWhole } from '../domain/money';
import { OTHER } from '../domain/summary';
import type { Json } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import type { PanelProps } from './panels';
import TransactionsPanel from './TransactionsPanel';

/** Flows below this share of the largest node are left out of the diagram (kept in the table). */
const MIN_SHARE = 0.003;
const SAVE_DELAY_MS = 800;

/** Saved positions, ignoring anything malformed. */
export function sanitizePositions(raw: unknown): SankeyPositions {
  const out: SankeyPositions = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const { x, y } = (v ?? {}) as { x?: unknown; y?: unknown };
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      out[key] = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
    }
  }
  return out;
}

/** This person's dragged node positions, saved to their preferences. */
function useSavedPositions() {
  const { session } = useAuth();
  const userId = session!.user.id;
  const [positions, setPositions] = useState<SankeyPositions>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [toast] = useIonToast();

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('user_preferences')
      .select('sankey_positions')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => !cancelled && setPositions(sanitizePositions(data?.sankey_positions)));
    return () => {
      cancelled = true;
    };
  }, [userId]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = useCallback(
    (next: SankeyPositions) => {
      setPositions(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        // (A query builder only runs when awaited.)
        const { error } = await supabase
          .from('user_preferences')
          .upsert({ user_id: userId, sankey_positions: next as unknown as Json });
        if (error) void toast({ message: `Positions not saved: ${error.message}`, duration: 4000, color: 'danger' });
      }, SAVE_DELAY_MS);
    },
    [userId, toast],
  );
  return [positions, update] as const;
}

/** Sankey of money in -> accounts -> other accounts / spending, for the selected period. */
export default function FlowsPanel(props: PanelProps) {
  const { model, fill, flow, onFlow, transactionsShown } = props;
  const [rows, setRows] = useState<FlowRow[] | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [positions, setPositions] = useSavedPositions();
  const from = model.shown[0]?.month;
  const to = model.data.today;

  // A selection belongs to the period it was made in.
  useEffect(() => {
    if (flow && (flow.from !== from || flow.to !== to)) onFlow(null);
  }, [flow, from, to, onFlow]);

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

  const drawnGraph = useMemo(() => (graph ? { ...graph, links: drawn } : null), [graph, drawn]);
  const colorOf = useCallback(
    (n: SankeyNode) => {
      if (n.role === 'spend') {
        const i = model.series.indexOf(n.group!);
        return n.group === OTHER || i < 0 ? 'var(--series-other)' : `var(--series-${i + 1})`;
      }
      if (n.role === 'transfer') return 'var(--series-other)';
      return 'var(--chart-text)'; // income sources and accounts: neutral
    },
    [model.series],
  );

  const select = useCallback(
    (key: string | null) => {
      const link = key ? graph?.links.find((l) => `${l.from}>${l.to}` === key) : undefined;
      if (!graph || !key || !link || !from) return onFlow(null);
      const name = (k: string) => graph.nodes.find((n) => n.key === k)?.label ?? k;
      onFlow({
        key,
        label: `${name(link.from)} → ${name(link.to)}`,
        cents: link.cents,
        from,
        to,
        rows: graph.rowsByLink?.get(key) ?? [],
      });
    },
    [graph, from, to, onFlow],
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
      {flow && (
        <div className="flows-selection" data-testid="flow-selection">
          <span>
            <strong>{flow.label}</strong> · {formatCents(flow.cents)}
            {transactionsShown && ' · listed in Transactions'}
          </span>
          <button className="link-like" onClick={() => onFlow(null)}>
            Clear
          </button>
        </div>
      )}
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
                  <tr
                    key={`${l.from}>${l.to}`}
                    className={flow?.key === `${l.from}>${l.to}` ? 'clickable selected' : 'clickable'}
                    onClick={() => select(flow?.key === `${l.from}>${l.to}` ? null : `${l.from}>${l.to}`)}
                  >
                    <td>{label(l.from)}</td>
                    <td style={{ textAlign: 'left' }}>{label(l.to)}</td>
                    <td>{formatCentsWhole(l.cents)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <SankeyDiagram
          graph={drawnGraph!}
          colorOf={colorOf}
          label="Money flow from income through accounts to spending"
          height={fill ? undefined : 460}
          positions={positions}
          onPositionsChange={setPositions}
          selected={flow?.key ?? null}
          onSelect={select}
        />
      )}
      {flow && !transactionsShown && (
        <div className="flows-transactions">
          <TransactionsPanel {...props} />
        </div>
      )}
    </div>
  );
}
