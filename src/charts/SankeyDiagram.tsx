import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SankeyGraph, SankeyNode } from "../domain/flows";
import { formatCents } from "../domain/money";
import { placeSankey } from "./sankeyLayout";

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

/** Money-flow diagram drawn as SVG; colours follow the light/dark theme through CSS variables. */
export default function SankeyDiagram({
  graph,
  colorOf,
  label,
  height,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hover, setHover] = useState<Hover | null>(null);
  const uid = useId().replace(/:/g, "");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((s) =>
        s.width === width && s.height === height ? s : { width, height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const placed = useMemo(
    () =>
      placeSankey(graph, {
        width: size.width,
        height: Math.max(0, size.height - 2 * MARGIN),
      }),
    [graph, size],
  );
  const color = useMemo(
    () => new Map(graph.nodes.map((n) => [n.key, colorOf(n)])),
    [graph, colorOf],
  );
  const labelOf = (key: string) =>
    graph.nodes.find((n) => n.key === key)?.label ?? key;

  const show = (key: string, text: string) => (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    setHover({ key, text, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  // Hovering a node highlights its links; hovering a link highlights that link.
  const lit = (from: string, to: string) =>
    !hover ||
    hover.key === from ||
    hover.key === to ||
    hover.key === `${from}>${to}`;

  return (
    <div
      ref={box}
      className="chart-box sankey"
      style={{ height: height ?? "100%", position: "relative" }}
      onPointerLeave={() => setHover(null)}
    >
      <svg
        width={size.width}
        height={size.height}
        role="img"
        aria-label={label}
        data-testid="sankey"
      >
        <defs>
          {placed.links.map((l, i) => (
            <linearGradient
              key={i}
              id={`${uid}-${i}`}
              gradientUnits="userSpaceOnUse"
              x1={l.sx}
              x2={l.tx}
            >
              <stop offset="0%" style={{ stopColor: color.get(l.from) }} />
              <stop offset="100%" style={{ stopColor: color.get(l.to) }} />
            </linearGradient>
          ))}
        </defs>
        <g transform={`translate(0,${MARGIN})`}>
          <g fill="none">
            {placed.links.map((l, i) => {
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
          {placed.nodes.map((n) => (
            <g
              key={n.key}
              onPointerMove={show(n.key, `${n.label}: ${formatCents(n.cents)}`)}
            >
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
                textAnchor={n.labelLeft ? "end" : "start"}
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
