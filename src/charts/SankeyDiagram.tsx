import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SankeyGraph, SankeyNode } from '../domain/flows';
import { formatCents } from '../domain/money';
import { placeSankey } from './sankeyLayout';
import { step, type Body, type PhysicsWorld } from './sankeyPhysics';

interface Props {
  graph: SankeyGraph;
  /** CSS colour (e.g. a var(--series-n) reference) for each node. */
  colorOf: (node: SankeyNode) => string;
  label: string;
  /** Fixed height in px; omit to fill the parent (e.g. a resizable panel). */
  height?: number;
  /** Dragged node offsets, as fractions of the diagram's width and height. */
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
  /** Pointer position and the node's offset when the drag started. */
  startX: number;
  startY: number;
  dx: number;
  dy: number;
}

/**
 * Interactive money-flow diagram drawn as SVG: hover for amounts, click a flow
 * to select it, drag a node to move it. Nodes are on springs (sankeyPhysics):
 * a dragged node stays where it is put (double-click releases it) and tugs the
 * nodes it exchanges money with along. Flows are revealed left to right when
 * the data changes. Colours follow the light/dark theme through CSS variables.
 */
export default function SankeyDiagram({
  graph,
  colorOf,
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
  const world: PhysicsWorld = useMemo(() => {
    const columns = [...new Set(placed.nodes.map((n) => Math.round(n.x0)))].sort((a, b) => a - b);
    return {
      nodes: placed.nodes.map((n) => ({
        key: n.key,
        x: n.x0,
        y: n.y0,
        height: n.y1 - n.y0,
        column: columns.indexOf(Math.round(n.x0)),
      })),
      links: placed.links,
      pinned: new Map(
        placed.nodes
          .filter((n) => positions[n.key])
          .map((n) => [n.key, { x: n.x0 + positions[n.key].x * size.width, y: n.y0 + positions[n.key].y * size.height }]),
      ),
      height: Math.max(0, size.height - 2 * MARGIN),
      gap: GAP,
    };
  }, [placed, positions, size]);
  const bodies = useRef(new Map<string, Body>());
  const worldRef = useRef(world);
  worldRef.current = world;
  const frameRef = useRef(0);
  const [, setFrame] = useState(0);
  const run = useCallback(() => {
    if (frameRef.current) return;
    const tick = () => {
      let moving = step(worldRef.current, bodies.current, drag.current?.key ?? null);
      // Reduced motion: jump straight to rest.
      for (let i = 0; moving && reducedMotion() && i < 500; i++) {
        moving = step(worldRef.current, bodies.current, drag.current?.key ?? null);
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

  // Nodes where the physics has them; links follow their ends. (Recomputed
  // every render: the physics re-renders once per animation frame.)
  const moved = (() => {
    const off = (key: string) => {
      const b = bodies.current.get(key);
      const n = placed.nodes.find((x) => x.key === key);
      return b && n ? { dx: b.x - n.x0, dy: b.y - n.y0 } : { dx: 0, dy: 0 };
    };
    return {
      nodes: placed.nodes.map((n) => {
        const { dx, dy } = off(n.key);
        return { ...n, x0: n.x0 + dx, x1: n.x1 + dx, y0: n.y0 + dy, y1: n.y1 + dy };
      }),
      links: placed.links.map((l) => ({
        ...l,
        sx: l.sx + off(l.from).dx,
        sy: l.sy + off(l.from).dy,
        tx: l.tx + off(l.to).dx,
        ty: l.ty + off(l.to).dy,
      })),
    };
  })();

  const color = useMemo(() => new Map(graph.nodes.map((n) => [n.key, colorOf(n)])), [graph, colorOf]);
  const labelOf = (key: string) => graph.nodes.find((n) => n.key === key)?.label ?? key;

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
    const n = placed.nodes.find((x) => x.key === key);
    const b = bodies.current.get(key);
    if (!n) return;
    // Start from where the node is now (it may be mid-bounce).
    drag.current = { key, startX: e.clientX, startY: e.clientY, dx: (b?.x ?? n.x0) - n.x0, dy: (b?.y ?? n.y0) - n.y0 };
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const n = placed.nodes.find((x) => x.key === d.key);
    if (!n) return;
    // Keep the node inside the drawing area.
    const dx = clamp(d.dx + e.clientX - d.startX, -n.x0, size.width - n.x1);
    const dy = clamp(d.dy + e.clientY - d.startY, -n.y0 - MARGIN, size.height - MARGIN - n.y1);
    bodies.current.set(d.key, { x: n.x0 + dx, y: n.y0 + dy, vx: 0, vy: 0 });
    if (size.width && size.height) {
      onPositionsChange({ ...positions, [d.key]: { x: dx / size.width, y: dy / size.height } });
    }
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
                show(
                  n.key,
                  `${n.label}: ${formatCents(n.cents)}${positions[n.key] ? ' · double-click to release' : ''}`,
                )(e);
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
