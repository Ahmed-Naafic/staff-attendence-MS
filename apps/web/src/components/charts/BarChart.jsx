import { cn } from '../../lib/cn.js';

// Rounds the axis maximum up to a "nice" number (1, 2, 2.5, 5 × 10ⁿ) so ticks read cleanly.
function niceMax(value, tickCount) {
  if (value <= 0) return tickCount;
  const rough = value / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough);
  return step * tickCount;
}

/**
 * Vertical bar chart drawn with HTML/CSS (crisp text at any size, no chart library).
 * data:  [{ label, value }]
 * color: a CSS color, written out in full so Tailwind keeps the token,
 *        e.g. 'var(--color-chart-1)' (navy in light, gold in dark)
 * Screen readers get a data table captioned with `label`; the drawing is hidden from them.
 */
export function BarChart({
  data,
  label,
  color = 'var(--color-chart-1)',
  showValues = false,
  showAxis = true,
  ticks = 4,
  height = 'h-40',
  formatValue = (value) => value.toLocaleString(),
  className,
}) {
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)), ticks);
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * (ticks - i));

  return (
    <div className={cn('flex flex-col', className)}>
      <div aria-hidden="true" className="flex gap-2">
        {showAxis && (
          <div className={cn('flex flex-col justify-between text-right text-caption text-fg-muted tabular-nums', height)}>
            {tickValues.map((tick) => (
              <span key={tick} className="-my-2 leading-4">
                {formatValue(Math.round(tick))}
              </span>
            ))}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className={cn('relative', height)}>
            {/* Gridlines */}
            <div className="absolute inset-0 flex flex-col justify-between">
              {tickValues.map((tick, index) => (
                <span
                  key={tick}
                  className={cn('h-px w-full', index === tickValues.length - 1 ? 'bg-border' : 'bg-border-subtle')}
                />
              ))}
            </div>
            {/* Bars */}
            <div className="absolute inset-0 flex items-end justify-around gap-1.5">
              {data.map((d) => (
                <div key={d.label} className="flex h-full max-w-8 flex-1 flex-col items-center justify-end">
                  {showValues && (
                    <span className="mb-1 text-caption font-semibold text-fg tabular-nums">{formatValue(d.value)}</span>
                  )}
                  <span
                    title={`${d.label}: ${formatValue(d.value)}`}
                    className="w-full max-w-5 rounded-t-sm"
                    style={{
                      height: `${(d.value / max) * 100}%`,
                      minHeight: d.value > 0 ? 2 : 0,
                      backgroundColor: color,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          {/* X labels */}
          <div className="mt-2 flex justify-around gap-1.5">
            {data.map((d) => (
              // Centred and allowed to overflow its narrow column rather than being cut off.
              <span key={d.label} className="flex max-w-8 flex-1 justify-center">
                <span className="text-caption whitespace-nowrap text-fg-muted">{d.label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* sr-only on a <table> does not shrink it (tables ignore the 1px width), so wrap it. */}
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
