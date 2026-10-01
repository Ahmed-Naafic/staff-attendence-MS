import { cn } from '../../lib/cn.js';

/**
 * Small trend line (SVG). Decorative: the trend must also be stated in text next to it.
 * color: a CSS color, usually 'var(--color-…)'.
 */
export function Sparkline({ values, color, className }) {
  const width = 100;
  const height = 32;
  const padding = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);

  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    // A flat series sits at the bottom when it is all zeros, otherwise in the middle.
    const ratio = max === min ? (max === 0 ? 0 : 0.5) : (value - min) / (max - min);
    const y = height - padding - ratio * (height - padding * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-8 w-20', className)}
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: color }}
      />
    </svg>
  );
}
