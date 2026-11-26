import { cn } from '../../lib/cn.js';
import { niceMax } from './BarChart.jsx';

/**
 * Line chart of several series over the same labels (e.g. expected and collected per month), each
 * with a soft area fill; HTML axes and points so text stays crisp, like LineChart.
 * labels: ['Sep', 'Oct', …]
 * series: [{ key, label, values: [number], color: 'var(--color-…)', fill?: boolean }]
 * Screen readers get a data table captioned with `label`; the drawing and the legend are visual only.
 */
export function MultiLineChart({ labels, series, label, ticks = 4, height = 'h-44', formatValue = (v) => v.toLocaleString(), formatFull = formatValue, className }) {
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)), ticks);
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * (ticks - i));
  const x = (i) => (labels.length === 1 ? 50 : (i / (labels.length - 1)) * 100);
  const y = (v) => 100 - (v / max) * 100;

  return (
    <div className={cn('flex flex-col', className)}>
      <ul aria-hidden="true" className="mb-3 flex flex-wrap justify-end gap-x-4 gap-y-1 text-caption text-fg-muted">
        {series.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-pill" style={{ backgroundColor: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div aria-hidden="true" className="flex gap-2">
        <div className={cn('flex flex-col justify-between text-right text-caption text-fg-muted tabular-nums', height)}>
          {tickValues.map((tick) => (
            <span key={tick} className="-my-2 leading-4">
              {formatValue(Math.round(tick))}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className={cn('relative mx-3', height)}>
            <div className="absolute inset-0 flex flex-col justify-between">
              {tickValues.map((tick, index) => (
                <span key={tick} className={cn('h-px w-full', index === tickValues.length - 1 ? 'bg-border' : 'bg-border-subtle')} />
              ))}
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
              {series.map((s) => {
                const line = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
                return (
                  <g key={s.key}>
                    {s.fill !== false && <polygon points={`0,100 ${line} 100,100`} style={{ fill: s.color, fillOpacity: 0.12 }} />}
                    <polyline points={line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ stroke: s.color }} />
                  </g>
                );
              })}
            </svg>
            {series.flatMap((s) =>
              s.values.map((v, i) => (
                <span
                  key={`${s.key}-${labels[i]}`}
                  title={`${labels[i]} · ${s.label}: ${formatFull(v)}`}
                  className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-surface"
                  style={{ left: `${x(i)}%`, top: `${y(v)}%`, backgroundColor: s.color }}
                />
              )),
            )}
          </div>
          <div className="relative mx-3 mt-2 h-4">
            {labels.map((l, i) => (
              <span key={l + i} className="absolute -translate-x-1/2 text-caption whitespace-nowrap text-fg-muted" style={{ left: `${x(i)}%` }}>
                {l}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {series.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l + i}>
                <th scope="row">{l}</th>
                {series.map((s) => (
                  <td key={s.key}>{formatFull(s.values[i])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
