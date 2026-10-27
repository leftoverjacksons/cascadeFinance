import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from 'chart.js';
import { useEffect, useRef, useState } from 'react';

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

/** Chart colours resolved from CSS variables for the current light/dark mode. */
export interface ChartColors {
  surface: string;
  text: string;
  grid: string;
  series: string[]; // slots 1..7, fixed order
  other: string;
}

function readColors(): ChartColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    surface: v('--chart-surface'),
    text: v('--chart-text'),
    grid: v('--chart-grid'),
    series: [1, 2, 3, 4, 5, 6, 7].map((i) => v(`--series-${i}`)),
    other: v('--series-other'),
  };
}

/** Re-reads colours when the OS switches between light and dark. */
function useChartColors(): ChartColors {
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setColors(readColors());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return colors;
}

interface Props {
  /** Builds the chart configuration from the current colours. */
  config: (colors: ChartColors) => ChartConfiguration;
  label: string;
  /** Fixed height in px; omit to fill the parent (e.g. a resizable panel). */
  height?: number;
}

export default function ChartCanvas({ config, label, height }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const colors = useChartColors();

  useEffect(() => {
    if (!canvas.current) return;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = colors.text;
    const chart = new Chart(canvas.current, config(colors));
    return () => chart.destroy();
  }, [config, colors]);

  return (
    <div className="chart-box" style={{ height: height ?? '100%' }}>
      <canvas ref={canvas} role="img" aria-label={label} />
    </div>
  );
}

/** Shared axis styling: hairline solid grid, recessive text, no axis border. */
export function axes(colors: ChartColors, formatY: (v: number) => string) {
  return {
    x: {
      grid: { display: false },
      border: { color: colors.grid },
      ticks: { color: colors.text, maxRotation: 0, autoSkipPadding: 8 },
    },
    y: {
      grid: { color: colors.grid, lineWidth: 1 },
      border: { display: false },
      ticks: { color: colors.text, callback: (v: string | number) => formatY(Number(v)), maxTicksLimit: 5 },
    },
  };
}
