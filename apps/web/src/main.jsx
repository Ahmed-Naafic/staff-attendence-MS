import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import AppRouter from './app/router/AppRouter.jsx';
import { ThemeProvider } from './app/providers/ThemeProvider.jsx';
import { SessionProvider } from './features/auth/SessionProvider.jsx';
import { BrandingProvider } from './features/branding';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <BrandingProvider>
        <SessionProvider>
          <AppRouter />
        </SessionProvider>
      </BrandingProvider>
    </ThemeProvider>
  </StrictMode>,
);
