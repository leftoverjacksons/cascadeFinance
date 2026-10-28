import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SankeyGraph, SankeyNode } from '../domain/flows';
import { formatCents } from '../domain/money';
import { placeSankey } from './sankeyLayout';
import { initialState, linkKey, settle, step, type PhysicsState, type PhysicsWorld } from './sankeyPhysics';

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
  /** Selected link ("from>to"): stays highlighted. */
  selected: string | null;
  onSelect: (link: string | null) => void;
}

export type SankeyPositions = Record<string, { x: number; y: number }>;

/** Room above and below so labels on the outermost nodes are not clipped. */
const MARGIN = 10;
/** Gap kept between nodes in a column while they move. */
const GAP = 6;
const REVEAL_MS = 1100;

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
  selected,
  onSelect,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const drag = useRef<Drag | null>(null);
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
      if ((e.target as Element).closest('.sankey-node')) e.preventDefault();
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
    };
    // (area is derived from size)
  }, [placed, positions, size, sideOf]);
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
    drag.current = { key, startX: e.clientX, startY: e.clientY, x: b.x, y: b.y };
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    const n = d && placed.nodes.find((x) => x.key === d.key);
    if (!d || !n || !area.width || !area.height) return;
    // Keep the node inside the drawing area.
    const x = clamp(d.x + e.clientX - d.startX, 0, area.width - (n.x1 - n.x0));
    const y = clamp(d.y + e.clientY - d.startY, 0, area.height - (n.y1 - n.y0));
    Object.assign(state.current.bodies.get(d.key)!, { x, y, vx: 0, vy: 0 });
    onPositionsChange({ ...positions, [d.key]: { x: x / area.width, y: y / area.height } });
    run();
  };
  const endDrag = () => {
    drag.current = null;
    run();
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
      {Object.keys(positions).length > 0 && (
        <button className="link-like sankey-reset" onClick={() => onPositionsChange({})}>
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
                  onClick={() => onSelect(key === selected ? null : key)}
                  onPointerMove={show(
                    `${l.from}>${l.to}`,
                    `${labelOf(l.from)} → ${labelOf(l.to)}: ${formatCents(l.cents)}`,
                  )}
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
      {hover && (
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
