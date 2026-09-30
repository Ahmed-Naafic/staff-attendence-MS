# UI / Project Implementation Log

## Phase 0 — Project Foundation

### Implemented
- Project architecture established/verified
- Feature-based structure established/verified
- Technology stack established/verified
- Neon PostgreSQL configuration established
- Prisma foundation established
- Documentation structure established
- Design reference structure established

### Important Decisions
- JavaScript instead of TypeScript
- Neon PostgreSQL instead of local/database container
- No Docker Compose
- Feature-based architecture
- Minimal documentation structure
- Super Admin operates at platform scope

### Validation
- [x] Web application starts (`npm run dev:web` serves the app; `npm run build:web` succeeds)
- [x] Backend starts (`GET /api/health` → `{"status":"ok"}`; unknown routes → 404 JSON)
- [x] Environment configuration verified (`.env.example` placeholders only; `.env` files git-ignored)
- [x] Prisma configuration verified (`prisma validate` and `prisma generate` succeed)
- [x] No TypeScript introduced
- [x] No Docker Compose introduced
- [x] No secrets committed (no credentials found in repository files)

### Deviations
- `DIRECT_URL` added to `.env.example` alongside `DATABASE_URL`. Neon's pooled connection is used by the API; Prisma migrations need the direct connection.
- `apps/web/.env.example` added for `VITE_API_URL` (browser-safe, no secrets).
- Neon connection strings use `sslmode=verify-full` (same behaviour as `require` today; avoids the `pg` driver's deprecation warning).

### Neon Connection
- Neon CLI linked to project `square-truth-27848248`, branch `production` (`.neon`, git-ignored; `neon link` added it to `.gitignore`).
- `backend/.env` created from the linked branch's connection strings (git-ignored).
- Verified: API Prisma client connects over the pooled connection (PostgreSQL 18, database `neondb`).
- Verified: Prisma CLI connects over the direct connection (`prisma migrate status`). Database is empty; no migrations yet.
- Not used: `neon config init`, `neon.ts`, `neon deploy` (TypeScript and Neon deploy are outside the agreed architecture).

### Status
PHASE 0 COMPLETE

## Phase 1 — Design System

### Implemented

- Centralized design tokens in `apps/web/src/index.css` (Tailwind v4 `@theme`); Tailwind's default color, radius, shadow and font-size scales disabled so components can only use tokens
- Light and dark themes switched by `data-theme` on `<html>` (`ThemeProvider`, saved choice, system default, no flash on load)
- Reusable UI components (`components/ui`) and layout components (`components/layout`)
- Development-only design system preview at `/design-system` (Foundations, Components, Layout & states) with neutral sample content; excluded from production builds
- Colors sampled from the Super Admin reference images

### Design Tokens

- Primary: Navy `#001D31` (scale `navy-50…950`)
- Secondary: Steel `#73819A` (scale `steel-50…900`)
- Accent: Gold `#D6982D`, dark theme `#F1B237` (scale `gold-50…800`)
- Light theme: semantic tokens for background (`page`, `surface`, `elevated`, `muted`), text (`fg`, `fg-secondary`, `fg-muted`, `fg-inverse`, `fg-disabled`), border (`border`, `border-strong`, `border-subtle`, `border-input`), status (`success`, `warning`, `error`, `info` + `-soft` / `-fg`), interactive, focus, overlay, tooltip, sidebar
- Dark theme: same token names with deep-navy values
- Typography: Inter; `display`, `page-title`, `section-title`, `card-title`, `body`, `small`, `table`, `label`, `button`, `caption`
- Radius: `sm`, `md`, `lg`, `pill` · Shadows: `none`, `subtle`, `medium`, `large` · Layout: sidebar, topbar, page width

### Components

- Button (primary, secondary, outline, ghost, danger; sm/md/lg; icon-only; loading; disabled)
- Input (text, email, tel, password with show/hide, search, number, date, time), Textarea, FormField
- Select (native), Checkbox (indeterminate), RadioGroup, Switch
- Badge (success, warning, error, info, neutral, accent)
- Card (default, elevated, interactive) with header, content and footer
- Table primitives with selected row, actions, loading, empty and error rows; Pagination
- Tabs, Modal (loading and error states), Drawer, DropdownMenu, Tooltip, Avatar
- Alert, Spinner, Skeleton, EmptyState, ErrorState, LoadingState

### Layout

- AppShell (skip link, sidebar and topbar composition, collapsed and mobile state)
- Sidebar (product, subtitle, role badge, grouped navigation, active state, collapsible, overlay on tablet/phone)
- Topbar (context, search, actions, theme toggle, user menu slots), UserMenu, ThemeToggle
- PageHeader (breadcrumbs, title, description, secondary and primary actions)
- PageContainer, ContentSection

### Accessibility

- Visible, consistent focus indicator on every interactive element (navy in light, gold in dark and in the sidebar)
- WCAG AA contrast verified for all text/background token pairs in both themes; focus indicators and form control borders ≥ 3:1
- Native semantics (`button`, `select`, `dialog`, `table`, `nav`, `fieldset`) and ARIA patterns for tabs, menu button, switch, tooltip, alerts
- Labels on all inputs; hints and errors linked with `aria-describedby`; status never shown by color alone
- Escape closes overlays; focus is trapped in modals and returned to the trigger; `prefers-reduced-motion` respected

### Responsive

- Desktop (≥ 1024px): fixed, collapsible sidebar
- Tablet (768–1023px): sidebar as overlay panel from the topbar menu button
- Mobile (< 768px): overlay sidebar, compact topbar, single-column content, horizontally scrolling tables, full-width modals, full-screen drawers
- No horizontal page overflow at 1440, 834 or 390px wide in either theme

### Documentation

- docs/design/design-system.md
- docs/design/implementation-log.md
- docs/architecture.md (web stack row and `app/` structure updated for the icon library, font and dev preview)

### Validation

- [x] Light mode
- [x] Dark mode
- [x] Desktop
- [x] Tablet
- [x] Mobile
- [x] Keyboard focus
- [x] No console errors

Checked with headless Chrome (DevTools protocol) against the dev server: all preview pages in both themes at 1440×900, 834×1112 and 390×844; 60 keyboard focus stops (all visible); modal open/Escape/focus return, loading modal not dismissible, drawer, dropdown by keyboard (including the last table row, not clipped), tooltip on focus, theme toggle persistence, mobile navigation, collapsed sidebar tooltips; no console errors or warnings. Also: automated WCAG contrast check of token pairs, `npm run build:web`, preview absent from the production bundle, no raw palette or hex colors in components, Phase 0 checks (Prisma validate, API health) still pass, no TypeScript or Docker Compose.

### Deviations

- **Primary button text:** navy on gold instead of the reference's white on gold (white fails WCAG contrast at ~2.5:1). Approved.
- **Added dependencies:** `lucide-react` (icons) and `@fontsource-variable/inter` (self-hosted Inter). Approved.
- **Form control borders** are darker than in the references to meet the 3:1 non-text contrast requirement.
- **Secondary/muted text** uses darker steel shades than the reference's `#73819A` so body-size text meets 4.5:1.
- **Dark-theme badges** use tinted backgrounds (consistent with light) rather than the reference's solid fills for some statuses.
- **Toggle "on" color** uses the interactive navy/blue token instead of the reference's teal (no teal in the approved palette).
- **Logo:** no logo asset has been supplied; the sidebar uses a placeholder book icon in a gold-bordered tile, and the favicon is left empty.
- **Tabs, Avatar, Alert** added beyond the minimum component list; they appear throughout the references.
- **Design system preview** (`src/app/dev/`, route `/design-system`) added for validation; development only.
- Reference folder had a duplicate (`Audit- logs.png`, identical to `audit-logs.png`); removed.

### Status

PHASE 1 COMPLETE

## Phase 2 — Web Application Shell

### Implemented

- AppShell — `app/layouts/RoleLayout.jsx` composes the Phase 1 `AppShell`, `Sidebar`, `Topbar` and `UserMenu` for the signed-in role; pages render only their content
- Super Admin Sidebar — product name, "Platform Administrator" subtitle, "Super Admin" role badge, two navigation groups with icons
- Topbar — page title on screens below 1024px (the page header shows it on desktop), navigation button below 1024px, theme toggle, user menu
- UserMenu — name, role, and a menu with "Profile" and "Sign out" shown disabled (arrive with authentication), labelled as a demo session
- ThemeToggle integration — Phase 1 `ThemeProvider`/`ThemeToggle`, unchanged
- PageHeader integration — every page uses the Phase 1 `PageHeader`
- PageContainer integration — every page uses the Phase 1 `PageContainer`
- Super Admin navigation — role-aware config in `app/config/navigation.js` (`navigationByRole`, `roleProfiles`, `getNavigationForRole`); only `SUPER_ADMIN` is defined
- Routing foundation — one layout route for the shell, `/` redirects to the role's start page, `handle.title` per route (topbar + browser tab title), not-found page inside the shell
- Responsive navigation — Phase 1 sidebar behaviour (fixed + collapsible on desktop, overlay panel below 1024px)
- Demo session — `features/auth/mockSession.js` + `SessionProvider`/`useSession()`; clearly marked, no login or tokens; replaced in Phase 9
- Placeholder pages — one per feature folder (`features/<feature>/<Name>Page.jsx`) using a shared `PlaceholderPage` ("Coming in Phase N")
- On navigation, focus moves to the main content and the tab title updates

### Routes

- /dashboard — Coming in Phase 3
- /schools — Coming in Phase 4
- /school-owners — Coming in Phase 5
- /platform-reports — Coming in Phase 6
- /audit-logs — Coming in Phase 7
- /platform-settings — Coming in Phase 8
- / → redirects to /dashboard (Super Admin start page)
- any other URL → "Page not found" inside the shell
- /design-system — Phase 1 preview (development only, unchanged)

### Responsive

- Desktop (≥ 1024px): fixed 240px sidebar, collapsible to 72px icons with tooltips; active item stays marked
- Tablet (768–1023px): sidebar hidden; menu button opens a 288px slide-in navigation panel
- Mobile (< 768px): same panel (max 85% of the width); topbar shows the page title, theme toggle and avatar

### Light/Dark Mode

- Light mode validated
- Dark mode validated
- Theme applied before the first render (no flash), persisted across reloads, switchable without reload

### Accessibility

- Keyboard navigation: skip link, sidebar links, collapse button, theme toggle and user menu all reachable by Tab with a visible focus indicator
- Focus states: navy outline in light, gold in dark and on the sidebar
- Accessible navigation: `<nav aria-label="Main">`, `aria-current="page"` on the active link, accessible names on icon-only links and buttons (tooltips are extra, not the only label)
- Overlay behaviour: navigation panel and user menu close with Escape and return focus to their trigger; navigating from the panel closes it and moves focus to the content

### Validation

- [x] Desktop
- [x] Tablet
- [x] Mobile
- [x] Light mode
- [x] Dark mode
- [x] No horizontal overflow
- [x] No console errors
- [x] Existing design-system preview still works

Checked with headless Chrome (DevTools protocol) against the dev server:
- All 6 routes × 5 widths (1440, 1024, 834, 768, 390px) × 2 themes = 60 page loads: correct page and placeholder, tab title, theme, no horizontal overflow, sidebar at ≥ 1024px / menu button below, exactly one correct active item.
- `/` redirect, not-found page, nested URL keeps its section active, sidebar click navigates and focuses the content.
- Collapsed sidebar: 72px, icon-only links keep accessible names, tooltip on keyboard focus, active item kept, no overflow.
- Navigation panel at 834, 768 and 390px in both themes: opens with focus inside, 6 items, active item and role shown, Escape closes and returns focus, link navigates, closes the panel and focuses the content.
- User menu opened and closed by keyboard; theme toggle by keyboard; theme persists after reload and is set before React renders.
- Focus visible on all 10 shell Tab stops in both themes; skip link works.
- Phase 1 interaction suite re-run (modal, drawer, dropdown, tooltip, mobile nav): all pass. Phase 1 `/design-system` preview renders.
- `npm run build:web` passes; preview absent from the production bundle; backend health and `prisma validate` pass; no TypeScript or Docker Compose; no raw palette or hex colours in web source.

### Deviations

- **Phase 1 change — `components/ui/DropdownMenu.jsx`:** disabled menu items are now focusable (WAI-ARIA menu pattern), and Escape on the trigger closes an open menu. Found because the demo user menu has only disabled items: keyboard focus had nowhere to go and the menu could not be closed with Escape. Impact: keyboard users can also reach disabled items in other menus; activation of disabled items is still blocked.
- **Topbar search and notifications** from the references are not included — they are features, not shell structure. The Phase 1 `Topbar` slots for them remain available.
- **Topbar page title** is shown only below 1024px, where the page header scrolls away; on desktop the page header shows it (the references show no title in the topbar).
- **Placeholder descriptions** are neutral one-liners instead of the reference subtitles, which describe functionality not yet approved.
- **Demo session** ships in production builds until Phase 9 because there is no sign-in yet; it is labelled in the user menu and isolated in `features/auth`.
- **Not-found page** added (not in the route list) so unknown URLs stay inside the shell.
- Sidebar collapsed state is not remembered across reloads (Phase 1 behaviour, unchanged).

### Status

PHASE 2 COMPLETE
