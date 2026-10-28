import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { SankeyGraph, SankeyNode } from '../domain/flows';
import { formatCents } from '../domain/money';
import { placeSankey } from './sankeyLayout';

interface Props {
  graph: SankeyGraph;
  /** CSS colour (e.g. a var(--series-n) reference) for each node. */
  colorOf: (node: SankeyNode) => string;
  label: string;
  /** Fixed height in px; omit to fill the parent (e.g. a resizable panel). */
  height?: number;
}

/** Room above and below so labels on the outermost nodes are not clipped. */
const MARGIN = 10;

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

type Offsets = Record<string, { dx: number; dy: number }>;

/**
 * Interactive money-flow diagram drawn as SVG: hover for amounts, drag a node
 * to move it (its flows follow). Colours follow the light/dark theme through
 * CSS variables.
 */
export default function SankeyDiagram({ graph, colorOf, label, height }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const [offsets, setOffsets] = useState<Offsets>({});
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
  // Apply dragged offsets to nodes and the ends of their links.
  const moved = useMemo(() => {
    const off = (key: string) => offsets[key] ?? { dx: 0, dy: 0 };
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
  }, [placed, offsets]);

  const color = useMemo(() => new Map(graph.nodes.map((n) => [n.key, colorOf(n)])), [graph, colorOf]);
  const labelOf = (key: string) => graph.nodes.find((n) => n.key === key)?.label ?? key;

  const show = (key: string, text: string) => (e: React.PointerEvent) => {
    if (drag.current) return;
    const r = box.current!.getBoundingClientRect();
    setHover({ key, text, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  // Hovering a node highlights its links; hovering a link highlights that link.
  const lit = (from: string, to: string) =>
    !hover || hover.key === from || hover.key === to || hover.key === `${from}>${to}`;

  const startDrag = (key: string) => (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { dx, dy } = offsets[key] ?? { dx: 0, dy: 0 };
    drag.current = { key, startX: e.clientX, startY: e.clientY, dx, dy };
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const n = placed.nodes.find((x) => x.key === d.key);
    if (!n) return;
    // Keep the node inside the drawing area.
    const dx = clamp(d.dx + e.clientX - d.startX, -n.x0, size.width - n.x1);
    const dy = clamp(d.dy + e.clientY - d.startY, -n.y0 - MARGIN, size.height - MARGIN - n.y1);
    setOffsets((o) => ({ ...o, [d.key]: { dx, dy } }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div
      ref={box}
      className="chart-box sankey"
      style={{ height: height ?? '100%', position: 'relative' }}
      onPointerLeave={() => setHover(null)}
    >
      {Object.keys(offsets).length > 0 && (
        <button className="link-like sankey-reset" onClick={() => setOffsets({})}>
          Reset layout
        </button>
      )}
      <svg width={size.width} height={size.height} role="img" aria-label={label} data-testid="sankey">
        <defs>
          {moved.links.map((l, i) => (
            <linearGradient key={i} id={`${uid}-${i}`} gradientUnits="userSpaceOnUse" x1={l.sx} x2={l.tx}>
              <stop offset="0%" style={{ stopColor: color.get(l.from) }} />
              <stop offset="100%" style={{ stopColor: color.get(l.to) }} />
            </linearGradient>
          ))}
        </defs>
        <g transform={`translate(0,${MARGIN})`}>
          <g fill="none" className="sankey-links">
            {moved.links.map((l, i) => {
              const xm = (l.sx + l.tx) / 2;
              return (
                <path
                  key={`${l.from}>${l.to}`}
                  d={`M${l.sx},${l.sy}C${xm},${l.sy} ${xm},${l.ty} ${l.tx},${l.ty}`}
                  stroke={`url(#${uid}-${i})`}
                  strokeWidth={Math.max(1, l.width)}
                  strokeOpacity={lit(l.from, l.to) ? 0.45 : 0.12}
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
                show(n.key, `${n.label}: ${formatCents(n.cents)}`)(e);
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
