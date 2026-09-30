import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Theme is stored as data-theme on <html>; tokens in index.css switch on it.
// index.html applies the initial theme before React loads.
const STORAGE_KEY = 'edutrack-theme';
export const THEMES = ['light', 'dark'];

const ThemeContext = createContext(null);

function readInitialTheme() {
  const current = document.documentElement.dataset.theme;
  return THEMES.includes(current) ? current : 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialTheme);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the theme still applies for this session.
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return context;
}
