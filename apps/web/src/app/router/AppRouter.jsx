import { createBrowserRouter, Link, RouterProvider } from 'react-router';

// Role-based routes and navigation are added in Phase 2 (Web Application Shell).
const routes = [
  {
    path: '/',
    element: (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-body text-fg-secondary">EduTrack web foundation is running.</p>
        {import.meta.env.DEV && (
          <Link to="/design-system" className="text-body font-medium text-interactive hover:underline">
            Open the design system preview
          </Link>
        )}
      </main>
    ),
  },
];

// Development-only design system preview. Vite removes this branch from production builds.
if (import.meta.env.DEV) {
  routes.push({
    path: '/design-system',
    // Shown while the lazily loaded preview downloads on first visit.
    HydrateFallback: () => null,
    lazy:async () => ({ Component: (await import('../dev/DesignSystemLayout.jsx')).default }),
    children: [
      { index: true, lazy: async () => ({ Component: (await import('../dev/FoundationsPreview.jsx')).default }) },
      {
        path: 'components',
        lazy: async () => ({ Component: (await import('../dev/ComponentsPreview.jsx')).default }),
      },
      { path: 'layout', lazy: async () => ({ Component: (await import('../dev/LayoutPreview.jsx')).default }) },
    ],
  });
}

const router = createBrowserRouter(routes);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
