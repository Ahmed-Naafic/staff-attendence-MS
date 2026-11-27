import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../app/providers/ThemeProvider.jsx';
import { saveTheme } from '../../features/auth/authApi.js';
import { Tooltip } from '../ui/Tooltip.jsx';

/**
 * Switches between the light and dark themes and saves the choice to the account, so the mobile app
 * uses it too (a failed save keeps the theme on this browser only).
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    saveTheme(next).catch(() => {});
  };
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
