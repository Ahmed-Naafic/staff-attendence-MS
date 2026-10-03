import { cn } from '../../lib/cn.js';
import { niceMax } from './BarChart.jsx';

/**
 * Line chart with a soft area fill (SVG line, HTML axes and points so text stays crisp).
 * data:  [{ label, value }]
 * color: a CSS color written out in full, e.g. 'var(--color-chart-2)'
 * Screen readers get a data table captioned with `label`; the drawing is hidden from them.
 */
export function LineChart({
  data,
  label,
  color = 'var(--color-chart-2)',
  ticks = 4,
  height = 'h-40',
  formatValue = (value) => value.toLocaleString(),
  className,
}) {
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)), ticks);
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * (ticks - i));
  const points = data.map((d, i) => ({
    ...d,
    x: data.length === 1 ? 50 : (i / (data.length - 1)) * 100,
    y: 100 - (d.value / max) * 100,
  }));
  const line = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className={cn('flex flex-col', className)}>
      <div aria-hidden="true" className="flex gap-2">
        <div className={cn('flex flex-col justify-between text-right text-caption text-fg-muted tabular-nums', height)}>
          {tickValues.map((tick) => (
            <span key={tick} className="-my-2 leading-4">
              {formatValue(Math.round(tick))}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Side padding keeps the first and last points and labels inside the card. */}
          <div className={cn('relative mx-3', height)}>
            <div className="absolute inset-0 flex flex-col justify-between">
              {tickValues.map((tick, index) => (
                <span
                  key={tick}
                  className={cn('h-px w-full', index === tickValues.length - 1 ? 'bg-border' : 'bg-border-subtle')}
                />
              ))}
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
              <polygon points={`0,100 ${line} 100,100`} style={{ fill: color, fillOpacity: 0.14 }} />
              <polyline
                points={line}
                fill="none"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                style={{ stroke: color }}
              />
            </svg>
            {points.map((p) => (
              <span
                key={p.label}
                title={`${p.label}: ${formatValue(p.value)}`}
                className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-surface"
                style={{ left: `${p.x}%`, top: `${p.y}%`, backgroundColor: color }}
              />
            ))}
          </div>
          <div className="relative mx-3 mt-2 h-4">
            {points.map((p) => (
              <span
                key={p.label}
                className="absolute -translate-x-1/2 text-caption whitespace-nowrap text-fg-muted"
                style={{ left: `${p.x}%` }}
              >
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* sr-only on a <table> does not shrink it, so wrap it (see BarChart). */}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <th scope="row">{d.label}</th>
                <td>{formatValue(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
