import { lazy } from 'react';

// Loaded on demand: the landing page's styles and art stay out of the signed-in application's bundle.
export const LandingPage = lazy(() => import('./LandingPage.jsx'));
