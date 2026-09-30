import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../app/providers/ThemeProvider.jsx';
import { Tooltip } from '../ui/Tooltip.jsx';

/** Switches between the light and dark themes. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  const Icon = theme === 'dark' ? Moon : Sun;

  return (
    <Tooltip content={label} placement="bottom">
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={label}
        className="grid size-10 place-items-center rounded-md text-fg-secondary hover:bg-muted hover:text-fg"
      >
        <Icon aria-hidden="true" className="size-5" />
      </button>
    </Tooltip>
  );
}
