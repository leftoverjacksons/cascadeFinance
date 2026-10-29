import { useIonToast } from '@ionic/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import SankeyDiagram, { type SankeyPositions, type SankeyStacks } from '../charts/SankeyDiagram';
import {
  buildSankey,
  canZoom,
  type FlowRow,
  type SankeyGraph,
  type SankeyNode,
  type ZoomStep,
  type ZoomTransaction,
  zoomPath,
} from '../domain/flows';
import { formatCents, formatCentsWhole } from '../domain/money';
import { OTHER, UNCATEGORIZED } from '../domain/summary';
import { useRequiredHousehold } from '../household/HouseholdProvider';
import type { Json } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import type { PanelProps } from './panels';
import TransactionsPanel from './TransactionsPanel';

/** Flows below this share of the largest node are left out of the diagram (kept in the table). */
const MIN_SHARE = 0.003;
const SAVE_DELAY_MS = 800;
const JOINT = 'joint';
const VIEW_KEY = 'cascade.flows.view';

type FlowView = 'accounts' | 'people';

function storedView(): FlowView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'people' ? 'people' : 'accounts';
  } catch {
    return 'accounts';
  }
}

/**
 * Saved layout: { v: 2, nodes: { key: { x, y } }, stacks?: { "node|out": [link, ...] } }.
 * Nodes: where each dragged node was put (top-left), as fractions of the
 * drawing area; stacks: tail orders set by hand. Shared by every period.
 * (Version 1 stored offsets from the computed layout; those are ignored.)
 */
const LAYOUT_VERSION = 2;

export interface SavedLayout {
  nodes: SankeyPositions;
  stacks: SankeyStacks;
}

/** A saved layout, ignoring anything malformed or from an older version. */
export function sanitizeLayout(raw: unknown): SavedLayout {
  const out: SavedLayout = { nodes: {}, stacks: {} };
  const saved = raw as { v?: unknown; nodes?: unknown; stacks?: unknown } | null;
  if (!saved || typeof saved !== 'object' || saved.v !== LAYOUT_VERSION) return out;
  const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isRecord(saved.nodes)) {
    for (const [key, v] of Object.entries(saved.nodes)) {
      const { x, y } = (v ?? {}) as { x?: unknown; y?: unknown };
      if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
        out.nodes[key] = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
      }
    }
  }
  if (isRecord(saved.stacks)) {
    for (const [key, v] of Object.entries(saved.stacks)) {
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) out.stacks[key] = v;
    }
  }
  return out;
}

/** This person's diagram layout (dragged nodes, hand-set tail orders), saved to their preferences. */
function useSavedLayout() {
  const { session } = useAuth();
  const userId = session!.user.id;
  const [layout, setLayout] = useState<SavedLayout>({ nodes: {}, stacks: {} });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [toast] = useIonToast();

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('user_preferences')
      .select('sankey_positions')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => !cancelled && setLayout(sanitizeLayout(data?.sankey_positions)));
    return () => {
      cancelled = true;
    };
  }, [userId]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const latest = useRef(layout);
  latest.current = layout;
  const update = useCallback(
    (change: Partial<SavedLayout>) => {
      const next = { ...latest.current, ...change };
      latest.current = next;
      setLayout(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        // (A query builder only runs when awaited.)
        const { error } = await supabase
          .from('user_preferences')
          .upsert({ user_id: userId, sankey_positions: { v: LAYOUT_VERSION, ...next } as unknown as Json });
        if (error) void toast({ message: `Layout not saved: ${error.message}`, duration: 4000, color: 'danger' });
      }, SAVE_DELAY_MS);
    },
    [userId, toast],
  );
  return [layout, update] as const;
}

/** Sankey of money in -> accounts -> other accounts / spending, for the selected period. */
export default function FlowsPanel(props: PanelProps) {
  const { model, fill, flow, onFlow, transactionsShown } = props;
  const { members } = useRequiredHousehold();
  const [rows, setRows] = useState<FlowRow[] | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [view, setView] = useState<FlowView>(storedView);
  const [layout, setLayout] = useSavedLayout();
  // Zoomed into a spending node, and possibly further into one of its parts
  // (e.g. Other spending -> Pets): each step shows a node and what it is made of.
  const [path, setPath] = useState<ZoomStep[]>([]);
  const [fetched, setFetched] = useState<{ transactions: ZoomTransaction[]; rows: FlowRow[] } | null>(null);
  const zoom = path.at(-1)?.node ?? null;
  const top = path[0]?.node ?? null;
  const from = model.shown[0]?.month;
  const to = model.data.today;

  // This diagram's own selection (charts can select too); it belongs to the
  // period it was made in.
  const own = flow && !flow.origin ? flow : null;
  useEffect(() => {
    if (own && (own.from !== from || own.to !== to)) onFlow(null);
  }, [own, from, to, onFlow]);

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

  // Whose each account is: its owner, or joint.
  const personOf = useMemo(
    () => new Map(model.accounts.map((a) => [a.id, a.owner_user_id ?? JOINT])),
    [model.accounts],
  );
  const graph: SankeyGraph | null = useMemo(() => {
    if (!rows) return null;
    const accounts = new Map(model.accounts.map((a) => [a.id, a.name]));
    const people = new Map<string, string>(members.map((m) => [m.user_id, m.display_name]));
    people.set(JOINT, 'Joint');
    return buildSankey(rows, {
      account: (id) => (view === 'people' ? people.get(id) : accounts.get(id)) ?? 'Account',
      category: (id) => model.byId.get(id)?.name ?? 'Category',
      series: model.series,
      accountGroup: view === 'people' ? (id) => personOf.get(id) ?? JOINT : undefined,
    });
  }, [rows, model.accounts, model.byId, model.series, members, view, personOf]);

  // Zoom: fetch the transactions behind the first step's node (every flow into it).
  useEffect(() => {
    setFetched(null);
    if (!top || !graph || !from) return;
    const node = graph.nodes.find((n) => n.key === top.key);
    if (!node) return setPath([]); // gone in this period or view
    const rows = graph.links
      .filter((l) => l.to === node.key)
      .flatMap((l) => graph.rowsByLink?.get(`${l.from}>${l.to}`) ?? []);
    let cancelled = false;
    supabase
      .rpc('money_flow_transactions', {
        p_from: from,
        p_to: to,
        p_kinds: rows.map((r) => r.kind),
        p_sources: rows.map((r) => r.source),
        p_targets: rows.map((r) => r.target),
      })
      .then(({ data }) => {
        if (!cancelled) setFetched({ transactions: data ?? [], rows });
      });
    return () => {
      cancelled = true;
    };
  }, [top, graph, from, to]);
  const zoomed = useMemo(
    () => (path.length && fetched ? zoomPath(path, fetched.transactions, model.byId) : null),
    [path, fetched, model.byId],
  );
  const shown = zoom ? (zoomed?.graph ?? null) : graph;
  /** Show the first `depth` steps of the path (0: all money). */
  const zoomTo = useCallback(
    (next: ZoomStep[]) => {
      onFlow(null);
      setPath(next);
    },
    [onFlow],
  );
  // From all money: spending groups and "Other spending" (not Uncategorized).
  // Zoomed in: parts that are groups with categories of their own.
  const nodeActions = useCallback(
    (n: SankeyNode) => {
      if (!zoom) {
        return n.role === 'spend' && n.group !== UNCATEGORIZED
          ? [{ label: 'Zoom in', run: () => zoomTo([{ node: n }]) }]
          : [];
      }
      const id = n.key.startsWith('sub:') ? n.key.slice('sub:'.length) : null;
      if (!id || !zoomed) return []; // merchants: the lowest level
      const categoryIds = zoomed.categoryIds.get(n.key);
      // A group with categories splits into them; a lowest-level category into its merchants.
      const step = canZoom(id, model.byId)
        ? { node: { ...n, group: id }, categoryIds }
        : { node: n, categoryIds, byMerchant: true };
      return [{ label: 'Zoom in', run: () => zoomTo([...path, step]) }];
    },
    [zoom, zoomed, path, zoomTo, model.byId],
  );

  function changeView(next: FlowView) {
    setView(next);
    onFlow(null); // flows differ between the views
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private browsing: the view just isn't remembered.
    }
  }

  const largest = useMemo(() => {
    const totals = new Map<string, number>();
    for (const l of shown?.links ?? []) {
      totals.set(l.from, (totals.get(l.from) ?? 0) + l.cents);
      totals.set(l.to, (totals.get(l.to) ?? 0) + l.cents);
    }
    return Math.max(0, ...totals.values());
  }, [shown]);
  const drawn = useMemo(() => (shown?.links ?? []).filter((l) => l.cents >= largest * MIN_SHARE), [shown, largest]);
  const hidden = (shown?.links.length ?? 0) - drawn.length;

  const drawnGraph = useMemo(() => (shown ? { ...shown, links: drawn } : null), [shown, drawn]);
  // Whose an account or money-in node is: 0 or 1 (household member order), or
  // undefined (joint, or not a person's). Money in belongs to whoever's account
  // it mostly lands in.
  const personIndex = useCallback(
    (n: SankeyNode): number | undefined => {
      const ofAccount = (key: string) => {
        const id = key.slice('acct:'.length);
        const person = view === 'people' ? id : personOf.get(id);
        const i = members.findIndex((m) => m.user_id === person);
        return i === 0 || i === 1 ? i : undefined;
      };
      if (n.role === 'account') return ofAccount(n.key);
      if (n.role === 'income' || n.key.startsWith('tin:')) {
        const main = (graph?.links ?? []).filter((l) => l.from === n.key).sort((a, b) => b.cents - a.cents)[0];
        return main ? ofAccount(main.to) : undefined;
      }
      return undefined;
    },
    [members, view, personOf, graph],
  );
  // Colour: spending by category (as on the spending chart); accounts and money
  // in by person (joint neutral); the rest neutral.
  const colorOf = useCallback(
    (n: SankeyNode) => {
      if (n.role === 'spend') {
        const i = model.series.indexOf(n.group!);
        return n.group === OTHER || i < 0 ? 'var(--series-other)' : `var(--series-${i + 1})`;
      }
      if (n.role === 'account' || n.role === 'income' || n.key.startsWith('tin:')) {
        const i = personIndex(n);
        return i === undefined ? 'var(--person-joint)' : `var(--person-${i + 1})`;
      }
      return 'var(--series-other)'; // transfers out of the household's accounts
    },
    [model.series, personIndex],
  );
  // Each person's trunk (money in and accounts) keeps to their own edge.
  const sideOf = useCallback(
    (n: SankeyNode): -1 | 0 | 1 => {
      const i = personIndex(n);
      return i === 0 ? -1 : i === 1 ? 1 : 0;
    },
    [personIndex],
  );

  const select = useCallback(
    (key: string | null) => {
      const link = key ? shown?.links.find((l) => `${l.from}>${l.to}` === key) : undefined;
      if (!shown || !key || !link || !from) return onFlow(null);
      const name = (k: string) => shown.nodes.find((n) => n.key === k)?.label ?? k;
      onFlow({
        key,
        label: `${name(link.from)} → ${name(link.to)}`,
        cents: link.cents,
        from,
        to,
        // Zoomed in: the node's transactions, narrowed to the part's categories.
        ...(zoom && zoomed && fetched
          ? {
              rows: fetched.rows,
              categoryIds: zoomed.categoryIds.get(link.to) ?? [],
              merchants: zoomed.merchants?.get(link.to),
            }
          : { rows: shown.rowsByLink?.get(key) ?? [] }),
      });
    },
    [shown, zoom, zoomed, fetched, from, to, onFlow],
  );

  const zoomOut = (
    <button className="link-like" onClick={() => zoomTo([])}>
      ← All money
    </button>
  );
  if (!shown) {
    return zoom ? (
      <p className="caption">
        {zoomOut} Loading {zoom.label}…
      </p>
    ) : (
      <p className="caption">Loading…</p>
    );
  }
  if (shown.links.length === 0) {
    return zoom ? (
      <p className="caption">
        {zoomOut} Nothing to show for {zoom.label} in this period.
      </p>
    ) : (
      <p className="caption">No money movements in this period.</p>
    );
  }

  const label = (key: string) => shown.nodes.find((n) => n.key === key)?.label ?? key;
  return (
    <div className="flows">
      <div className="flows-toggle">
        {zoom ? (
          <span className="flows-zoom" data-testid="flows-zoom">
            {zoomOut}
            {/* Breadcrumbs: earlier steps zoom back out to them. */}
            {path.slice(0, -1).map((step, i) => (
              <button key={step.node.key} className="link-like" onClick={() => zoomTo(path.slice(0, i + 1))}>
                {step.node.label}
              </button>
            ))}
            <strong>
              {zoom.label} · {formatCentsWhole(shown.links.reduce((t, l) => t + l.cents, 0))}
            </strong>
          </span>
        ) : (
          <>
            <span className="flows-legend" aria-label="Colours">
              {[
                ...members.slice(0, 2).map((m, i) => [m.display_name, `var(--person-${i + 1})`]),
                ['Joint', 'var(--person-joint)'],
              ].map(([name, c]) => (
                <span key={name}>
                  <i style={{ background: c }} />
                  {name}
                </span>
              ))}
            </span>
            <span className="flows-view" role="group" aria-label="Show">
              {(['accounts', 'people'] as const).map((v) => (
                <button key={v} className="link-like" aria-pressed={view === v} onClick={() => changeView(v)}>
                  {v === 'accounts' ? 'Accounts' : 'People'}
                </button>
              ))}
            </span>
          </>
        )}
        {hidden > 0 && !showTable && (
          <span className="flows-note">
            {hidden} small flow{hidden === 1 ? '' : 's'} not drawn ·{' '}
          </span>
        )}
        <button className="link-like" onClick={() => setShowTable(!showTable)} aria-pressed={showTable}>
          {showTable ? 'Show diagram' : 'Show as table'}
        </button>
      </div>
      {own && (
        <div className="flows-selection" data-testid="flow-selection">
          <span>
            <strong>{own.label}</strong> · {formatCents(own.cents)}
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
              {[...shown.links]
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
          sideOf={sideOf}
          label={zoom ? `What ${zoom.label} is made of` : 'Money flow from income through accounts to spending'}
          height={fill ? undefined : 460}
          positions={layout.nodes}
          onPositionsChange={(nodes) => setLayout({ nodes })}
          stacks={layout.stacks}
          onStacksChange={(stacks) => setLayout({ stacks })}
          selected={own?.key ?? null}
          onSelect={select}
          nodeActions={nodeActions}
        />
      )}
      {own && !transactionsShown && (
        <div className="flows-transactions">
          <TransactionsPanel {...props} />
        </div>
      )}
    </div>
  );
}
