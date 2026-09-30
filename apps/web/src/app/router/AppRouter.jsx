import { createBrowserRouter, RouterProvider } from 'react-router';

// Phase 0: a single foundation route to confirm the app boots.
// Role-based routes and navigation are added in Phase 2 (Web Application Shell).
const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm">EduTrack web foundation is running.</p>
      </main>
    ),
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
