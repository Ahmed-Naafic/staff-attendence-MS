import { cn } from '../../lib/cn.js';

const sizes = { sm: 'size-7 text-caption', md: 'size-9 text-small', lg: 'size-12 text-body' };

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Initials avatar. Decorative when the name is shown next to it (pass decorative). */
export function Avatar({ name, size = 'md', decorative = false, className }) {
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-pill bg-interactive font-semibold text-on-interactive',
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
