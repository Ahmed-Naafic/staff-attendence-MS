import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Sparkline } from '../charts';
import { Card } from './Card.jsx';
import { cn } from '../../lib/cn.js';

const tones = {
  info: { tile: 'bg-info-soft text-info-fg', line: 'var(--color-info)' },
  success: { tile: 'bg-success-soft text-success-fg', line: 'var(--color-success)' },
  warning: { tile: 'bg-warning-soft text-warning-fg', line: 'var(--color-warning)' },
  error: { tile: 'bg-error-soft text-error-fg', line: 'var(--color-error)' },
};

const directions = {
  up: { icon: ArrowUp, className: 'text-success-fg', word: 'Up' },
  down: { icon: ArrowDown, className: 'text-warning-fg', word: 'Down' },
  flat: { icon: Minus, className: 'text-fg-muted', word: 'No change,' },
};

/**
 * Key figure card: icon, label, value, change versus the previous period, an optional
 * note (e.g. "+4 new") and a trend sparkline. Renders as a list item inside a <ul>.
 */
export function KpiCard({ label, value, icon: Icon, tone = 'info', changePercent, note, trend }) {
  const style = tones[tone] ?? tones.info;
  const direction = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat';
  const change = directions[direction];
  const ChangeIcon = change.icon;

  return (
    <Card as="li" className="flex-row gap-3 p-4">
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-md', style.tile)}>
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 title={label} className="truncate text-small font-medium text-fg-secondary">
          {label}
        </h3>
        <p className="text-display text-fg tabular-nums">{value.toLocaleString()}</p>
        <div className="mt-1 flex items-end justify-between gap-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption">
            {changePercent !== undefined && (
              <span className={cn('inline-flex items-center gap-0.5 font-semibold', change.className)}>
                <ChangeIcon aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
                <span className="sr-only">{change.word} </span>
                {Math.abs(changePercent)}%<span className="sr-only"> versus the previous period</span>
              </span>
            )}
            {note && <span className="whitespace-nowrap text-fg-muted">{note}</span>}
          </p>
          {trend && <Sparkline values={trend} color={style.line} className="h-7 w-14 shrink-0" />}
        </div>
      </div>
    </Card>
  );
}
