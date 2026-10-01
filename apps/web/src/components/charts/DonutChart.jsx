/**
 * Donut chart (SVG). Decorative for screen readers: always pair it with a visible
 * legend that states each value (see the dashboard status card).
 * segments: [{ key, value, color }] — color is a CSS color, usually 'var(--color-…)'.
 */
export function DonutChart({ segments, centerValue, centerLabel, size = 128, thickness = 16 }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let offset = 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg aria-hidden="true" viewBox={`0 0 ${size} ${size}`} className="-rotate-90" width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          style={{ stroke: 'var(--color-muted)' }}
        />
        {total > 0 &&
          segments
            .filter((s) => s.value > 0)
            .map((s) => {
              const length = (s.value / total) * circumference;
              const circle = (
                <circle
                  key={s.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  strokeWidth={thickness}
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={-offset}
                  style={{ stroke: s.color }}
                />
              );
              offset += length;
              return circle;
            })}
      </svg>
      {(centerValue !== undefined || centerLabel) && (
        <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-section-title text-fg tabular-nums">{centerValue}</span>
          {centerLabel && <span className="text-caption text-fg-muted">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}
