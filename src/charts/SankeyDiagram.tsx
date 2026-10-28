import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SankeyGraph, SankeyNode } from '../domain/flows';
import { formatCents } from '../domain/money';
import { placeSankey } from './sankeyLayout';
import { initialState, linkKey, settle, stackKey, step, type PhysicsState, type PhysicsWorld } from './sankeyPhysics';

interface Props {
  graph: SankeyGraph;
  /** CSS colour (e.g. a var(--series-n) reference) for each node. */
  colorOf: (node: SankeyNode) => string;
  /** Edge a node's trunk is pulled toward: -1 top, 1 bottom, 0 none (see sankeyPhysics). */
  sideOf?: (node: SankeyNode) => -1 | 0 | 1;
  label: string;
  /** Fixed height in px; omit to fill the parent (e.g. a resizable panel). */
  height?: number;
  /** Where dragged nodes were put (top-left), as fractions of the drawing area's width and height. */
  positions: SankeyPositions;
  onPositionsChange: (positions: SankeyPositions) => void;
  /** Tail orders set by hand, top first, per node side (see sankeyPhysics stackKey). */
  stacks: SankeyStacks;
  onStacksChange: (stacks: SankeyStacks) => void;
  /** Selected link ("from>to"): stays highlighted. */
  selected: string | null;
  onSelect: (link: string | null) => void;
  /** Extra items for a node's menu (right-click, or click/tap without dragging), e.g. "Zoom in". */
  nodeActions?: (node: SankeyNode) => NodeAction[];
}

export interface NodeAction {
  label: string;
  run: () => void;
}

export type SankeyPositions = Record<string, { x: number; y: number }>;
export type SankeyStacks = Record<string, string[]>;

/** Room above and below so labels on the outermost nodes are not clipped. */
const MARGIN = 10;
/** Gap kept between nodes in a column while they move. */
const GAP = 6;
const REVEAL_MS = 1100;
/** How close to a tail's end (px along it) a press grabs that end to reorder it. */
const END_GRAB = 30;

interface TailDrag {
  link: string;
  node: string;
  side: 'out' | 'in';
  startY: number;
  moved: boolean;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

interface Hover {
  /** Node key, or "from>to" for a link. */
  key: string;
  text: string;
  x: number;
  y: number;
}

interface Drag {
  key: string;
  /** Pointer position and the node's top-left when the drag started. */
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Moved beyond a small threshold: a drag, not a click. */
  moved: boolean;
}

interface Menu {
  key: string;
  x: number;
  y: number;
}

/**
 * Interactive money-flow diagram drawn as SVG: hover for amounts, click a flow
 * to select it, drag a node to move it. Layout physics (sankeyPhysics): tails
 * pull their nodes level, nodes may pass each other in a column, tails slide
 * within their stacks; a dragged node stays where it is put (double-click
 * releases it). Settles before the first frame when the data or size changes;
 * flows are revealed left to right when the data changes. Colours follow the
 * light/dark theme through CSS variables.
 */
export default function SankeyDiagram({
  graph,
  colorOf,
  sideOf,
  label,
  height,
  positions,
  onPositionsChange,
  stacks,
  onStacksChange,
  selected,
  onSelect,
  nodeActions,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const drag = useRef<Drag | null>(null);
  const tailDrag = useRef<TailDrag | null>(null);
  const suppressClick = useRef(false);
  // Where each tail starts and ends (x), for telling an end-grab from a click.
  const linkEnds = useRef(new Map<string, { sx: number; tx: number }>());
  const uid = useId().replace(/:/g, '');

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    });
    observer.observe(el);
    // A touch that starts on a node drags it instead of scrolling the page.
    // (CSS touch-action is not honoured on SVG children, and React's touch
    // listeners are passive, so this needs a native non-passive listener.)
    const onTouchStart = (e: TouchEvent) => {
      const target = e.target as Element;
      if (target.closest('.sankey-node')) e.preventDefault();
      // Likewise a touch on a tail's end reorders it.
      const ends = linkEnds.current.get(target.closest('[data-link]')?.getAttribute('data-link') ?? '');
      const x = e.touches[0].clientX - el.getBoundingClientRect().left;
      if (ends && Math.min(Math.abs(x - ends.sx), Math.abs(x - ends.tx)) <= END_GRAB) e.preventDefault();
    };
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener('touchstart', onTouchStart);
    };
  }, []);

  const placed = useMemo(
    () => placeSankey(graph, { width: size.width, height: Math.max(0, size.height - 2 * MARGIN) }),
    [graph, size],
  );

  // ── Physics ──
  const area = { width: size.width, height: Math.max(0, size.height - 2 * MARGIN) };
  const world: PhysicsWorld = useMemo(() => {
    const columns = [...new Set(placed.nodes.map((n) => Math.round(n.x0)))].sort((a, b) => a - b);
    return {
      nodes: placed.nodes.map((n) => ({
        key: n.key,
        x: n.x0,
        y: n.y0,
        height: n.y1 - n.y0,
        column: columns.indexOf(Math.round(n.x0)),
        isAccount: n.role === 'account',
        side: sideOf?.(n),
      })),
      links: placed.links,
      pinned: new Map(
        placed.nodes
          .filter((n) => positions[n.key])
          .map((n) => [
            n.key,
            {
              x: clamp(positions[n.key].x * area.width, 0, area.width - (n.x1 - n.x0)),
              y: clamp(positions[n.key].y * area.height, 0, area.height - (n.y1 - n.y0)),
            },
          ]),
      ),
      height: area.height,
      gap: GAP,
      stacks: new Map(Object.entries(stacks)),
    };
    // (area is derived from size)
  }, [placed, positions, size, sideOf, stacks]);
  const state = useRef<PhysicsState>({ bodies: new Map(), offsets: new Map() });
  const worldRef = useRef(world);
  worldRef.current = world;
  // New data or size: start from the computed layout and settle before drawing.
  const settledFor = useRef<unknown>(null);
  if (settledFor.current !== placed) {
    settledFor.current = placed;
    const nodeTop = new Map(placed.nodes.map((n) => [n.key, n.y0]));
    state.current = initialState(
      world,
      new Map(placed.links.map((l) => [linkKey(l), { s: l.sy - nodeTop.get(l.from)!, t: l.ty - nodeTop.get(l.to)! }])),
    );
    settle(world, state.current);
  }
  const frameRef = useRef(0);
  const [, setFrame] = useState(0);
  const run = useCallback(() => {
    if (frameRef.current) return;
    const tick = () => {
      let moving = step(worldRef.current, state.current, drag.current?.key ?? null);
      // Reduced motion: jump straight to rest.
      for (let i = 0; moving && !drag.current && reducedMotion() && i < 600; i++) {
        moving = step(worldRef.current, state.current, null);
      }
      setFrame((f) => f + 1);
      frameRef.current = moving ? requestAnimationFrame(tick) : 0;
    };
    frameRef.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => run(), [world, run]);
  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0; // so a remount (e.g. React's dev double mount) can start it again
    },
    [],
  );

  // ── Reveal flows left to right when the data changes ──
  const reveal = useRef<SVGRectElement>(null);
  const widthRef = useRef(size.width);
  widthRef.current = size.width;
  useEffect(() => {
    const rect = reveal.current;
    if (!rect || reducedMotion()) return;
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / REVEAL_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      rect.setAttribute('width', t < 1 ? String(eased * widthRef.current) : '100%');
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      rect.setAttribute('width', '100%');
    };
  }, [graph]);

  // Nodes and tails where the physics has them. (Recomputed every render: the
  // physics re-renders once per animation frame.)
  const moved = (() => {
    const at = (key: string) => state.current.bodies.get(key);
    const nodes = placed.nodes.map((n) => {
      const b = at(n.key) ?? { x: n.x0, y: n.y0 };
      return { ...n, x0: b.x, x1: b.x + (n.x1 - n.x0), y0: b.y, y1: b.y + (n.y1 - n.y0) };
    });
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const links = placed.links.map((l) => {
      const o = state.current.offsets.get(linkKey(l));
      const from = byKey.get(l.from)!;
      const to = byKey.get(l.to)!;
      return { ...l, sx: from.x1, sy: from.y0 + (o?.s ?? 0), tx: to.x0, ty: to.y0 + (o?.t ?? 0) };
    });
    return { nodes, links };
  })();

  const color = useMemo(() => new Map(graph.nodes.map((n) => [n.key, colorOf(n)])), [graph, colorOf]);
  const labelOf = (key: string) => graph.nodes.find((n) => n.key === key)?.label ?? key;
  // Share of all spending, for spending nodes' tooltips.
  const spending = useMemo(
    () => new Map(graph.nodes.filter((n) => n.role === 'spend').map((n) => [n.key, n])),
    [graph],
  );
  const totalSpending = graph.links.reduce((t, l) => t + (spending.has(l.to) ? l.cents : 0), 0);
  const nodeText = (n: { key: string; label: string; cents: number }) =>
    `${n.label}: ${formatCents(n.cents)}` +
    (spending.has(n.key) && totalSpending ? ` · ${percent(n.cents / totalSpending)} of spending` : '') +
    (positions[n.key] ? ' · double-click to release' : '');

  const show = (key: string, text: string) => (e: React.PointerEvent) => {
    if (drag.current) return;
    const r = box.current!.getBoundingClientRect();
    setHover({ key, text, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  // The selected link and whatever is hovered (a node's links, or a link) are highlighted.
  const matches = (key: string | undefined | null, from: string, to: string) =>
    key === from || key === to || key === `${from}>${to}`;
  const lit = (from: string, to: string) =>
    (!hover && !selected) || matches(hover?.key, from, to) || matches(selected, from, to);

  const startDrag = (key: string) => (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const b = state.current.bodies.get(key);
    if (!b) return;
    // Start from where the node is now (it may be mid-bounce).
    drag.current = { key, startX: e.clientX, startY: e.clientY, x: b.x, y: b.y, moved: false };
    setMenu(null);
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    const n = d && placed.nodes.find((x) => x.key === d.key);
    if (!d || !n || !area.width || !area.height) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return; // still a click
    d.moved = true;
    // Keep the node inside the drawing area.
    const x = clamp(d.x + e.clientX - d.startX, 0, area.width - (n.x1 - n.x0));
    const y = clamp(d.y + e.clientY - d.startY, 0, area.height - (n.y1 - n.y0));
    Object.assign(state.current.bodies.get(d.key)!, { x, y, vx: 0, vy: 0 });
    onPositionsChange({ ...positions, [d.key]: { x: x / area.width, y: y / area.height } });
    run();
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    run();
    if (d && !d.moved && e.type === 'pointerup') openMenu(d.key, e); // a click: the node's menu
  };

  // ── Node menu ──
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuItems = (key: string): NodeAction[] => {
    const n = graph.nodes.find((x) => x.key === key);
    if (!n) return [];
    return [...(nodeActions?.(n) ?? []), ...(positions[key] ? [{ label: 'Put back', run: () => release(key) }] : [])];
  };
  const openMenu = (key: string, e: { clientX: number; clientY: number }) => {
    if (!menuItems(key).length) return setMenu(null);
    const r = box.current!.getBoundingClientRect();
    setHover(null);
    setMenu({ key, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (!(e.target as Element).closest?.('.sankey-menu')) setMenu(null);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);
  // ── Reordering a tail within a node's stack ──
  const endAt = (key: string, e: React.PointerEvent): 'out' | 'in' | null => {
    const ends = linkEnds.current.get(key);
    if (!ends) return null;
    const x = e.clientX - box.current!.getBoundingClientRect().left;
    const ds = Math.abs(x - ends.sx);
    const dt = Math.abs(x - ends.tx);
    return Math.min(ds, dt) > END_GRAB ? null : ds <= dt ? 'out' : 'in';
  };
  const startTailDrag = (l: { from: string; to: string }) => (e: React.PointerEvent) => {
    const side = endAt(linkKey(l), e);
    if (!side) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    tailDrag.current = {
      link: linkKey(l),
      node: side === 'out' ? l.from : l.to,
      side,
      startY: e.clientY,
      moved: false,
    };
  };
  const moveTailDrag = (e: React.PointerEvent) => {
    const t = tailDrag.current;
    if (!t) return;
    if (!t.moved && Math.abs(e.clientY - t.startY) < 4) return;
    t.moved = true;
    const body = state.current.bodies.get(t.node);
    if (!body) return;
    // The node's other tails, top to bottom as they are now; the dragged one goes
    // in front of the first whose centre is below the pointer.
    const y = e.clientY - box.current!.getBoundingClientRect().top - MARGIN;
    const end = (l: { from: string; to: string }) =>
      state.current.offsets.get(linkKey(l))?.[t.side === 'out' ? 's' : 't'] ?? 0;
    const others = placed.links
      .filter((l) => (t.side === 'out' ? l.from : l.to) === t.node && linkKey(l) !== t.link)
      .sort((a, b) => end(a) - end(b));
    const at = others.filter((l) => body.y + end(l) < y).length;
    const order = others.map(linkKey);
    order.splice(at, 0, t.link);
    const k = stackKey(t.node, t.side);
    if (stacks[k]?.join() !== order.join()) onStacksChange({ ...stacks, [k]: order });
    run();
  };
  const endTailDrag = () => {
    if (tailDrag.current?.moved) suppressClick.current = true; // a drag is not a click
    tailDrag.current = null;
  };
  const autoStack = (l: { from: string; to: string }) => (e: React.MouseEvent) => {
    const side = endAt(linkKey(l), e as unknown as React.PointerEvent);
    const k = side && stackKey(side === 'out' ? l.from : l.to, side);
    if (!k || !stacks[k]) return;
    const rest = { ...stacks };
    delete rest[k];
    onStacksChange(rest);
  };

  const release = (key: string) => {
    if (!positions[key]) return;
    const rest = { ...positions };
    delete rest[key];
    onPositionsChange(rest);
  };

  return (
    <div
      ref={box}
      className="chart-box sankey"
      style={{ height: height ?? '100%', position: 'relative' }}
      onPointerLeave={() => setHover(null)}
    >
      {(Object.keys(positions).length > 0 || Object.keys(stacks).length > 0) && (
        <button
          className="link-like sankey-reset"
          onClick={() => {
            onPositionsChange({});
            onStacksChange({});
          }}
        >
          Reset layout
        </button>
      )}
      <svg width={size.width} height={size.height} role="img" aria-label={label} data-testid="sankey">
        <defs>
          <clipPath id={`${uid}-reveal`}>
            <rect ref={reveal} x={0} y={-MARGIN} width="100%" height={size.height + MARGIN} />
          </clipPath>
          {moved.links.map((l, i) => (
            <linearGradient key={i} id={`${uid}-${i}`} gradientUnits="userSpaceOnUse" x1={l.sx} x2={l.tx}>
              <stop offset="0%" style={{ stopColor: color.get(l.from) }} />
              <stop offset="100%" style={{ stopColor: color.get(l.to) }} />
            </linearGradient>
          ))}
        </defs>
        <g transform={`translate(0,${MARGIN})`}>
          <g fill="none" clipPath={`url(#${uid}-reveal)`}>
            {moved.links.map((l, i) => {
              const xm = (l.sx + l.tx) / 2;
              const key = `${l.from}>${l.to}`;
              return (
                <path
                  key={key}
                  data-link={key}
                  className={key === selected ? 'sankey-link selected' : 'sankey-link'}
                  d={`M${l.sx},${l.sy}C${xm},${l.sy} ${xm},${l.ty} ${l.tx},${l.ty}`}
                  stroke={`url(#${uid}-${i})`}
                  strokeWidth={Math.max(1, l.width)}
                  strokeOpacity={key === selected ? 0.7 : lit(l.from, l.to) ? 0.45 : 0.12}
                  ref={() => linkEnds.current.set(key, { sx: l.sx, tx: l.tx })}
                  onClick={() => {
                    if (suppressClick.current) suppressClick.current = false;
                    else onSelect(key === selected ? null : key);
                  }}
                  onDoubleClick={autoStack(l)}
                  onPointerDown={startTailDrag(l)}
                  onPointerUp={endTailDrag}
                  onPointerCancel={endTailDrag}
                  onPointerMove={(e) => {
                    moveTailDrag(e);
                    // Near an end, the cursor shows the tail can be moved up and down its stack.
                    e.currentTarget.style.cursor = tailDrag.current || endAt(key, e) ? 'ns-resize' : 'pointer';
                    if (!tailDrag.current) {
                      show(
                        key,
                        `${labelOf(l.from)} → ${labelOf(l.to)}: ${formatCents(l.cents)} · drag an end to reorder`,
                      )(e);
                    }
                  }}
                />
              );
            })}
          </g>
          {moved.nodes.map((n) => (
            <g
              key={n.key}
              className="sankey-node"
              data-node={n.key}
              onPointerDown={startDrag(n.key)}
              onPointerMove={(e) => {
                moveDrag(e);
                show(n.key, nodeText(n))(e);
              }}
              onDoubleClick={() => release(n.key)}
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu(n.key, e);
              }}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              {/* Wider invisible hit area: nodes are only a few pixels wide. */}
              <rect
                x={n.x0 - 6}
                y={n.y0}
                width={n.x1 - n.x0 + 12}
                height={Math.max(8, n.y1 - n.y0)}
                fill="transparent"
              />
              <rect
                x={n.x0}
                y={n.y0}
                width={n.x1 - n.x0}
                height={Math.max(1, n.y1 - n.y0)}
                style={{ fill: color.get(n.key) }}
              />
              <text
                x={n.labelLeft ? n.x0 - 6 : n.x1 + 6}
                y={(n.y0 + n.y1) / 2}
                dy="0.35em"
                textAnchor={n.labelLeft ? 'end' : 'start'}
                className="sankey-label"
              >
                {n.label}
              </text>
            </g>
          ))}
        </g>
      </svg>
      {menu && (
        <div
          className="sankey-menu"
          role="menu"
          style={{ left: Math.min(menu.x, Math.max(0, size.width - 160)), top: menu.y }}
        >
          {menuItems(menu.key).map((a) => (
            <button
              key={a.label}
              role="menuitem"
              onClick={() => {
                setMenu(null);
                a.run();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {hover && !menu && (
        <div
          className="sankey-tip"
          style={{
            left: Math.min(hover.x + 12, Math.max(0, size.width - 220)),
            top: hover.y > size.height - 48 ? hover.y - 40 : hover.y + 12,
          }}
        >
          {hover.text}
        </div>
      )}
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** 0.234 -> "23%"; under 1% -> "<1%". */
function percent(share: number) {
  return share > 0 && share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`;
}
