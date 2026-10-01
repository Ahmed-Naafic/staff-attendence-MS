# Design System

The visual foundation for the EduTrack web application. Visual references: `docs/design/references/super-admin/` (look and feel only — not business requirements).

- **Tokens:** `apps/web/src/index.css` (Tailwind CSS v4 `@theme`)
- **Theme switching:** `apps/web/src/app/providers/ThemeProvider.jsx`
- **Shared UI:** `apps/web/src/components/ui/` · **Shared layout:** `apps/web/src/components/layout/`
- **Live preview (development only):** run `npm run dev:web` and open `/design-system`. It is not included in production builds.

## Rules

1. Components use **semantic tokens only** (`bg-surface`, `text-fg`, `border-border`…). Tailwind's default palette, radius, shadow and font-size scales are disabled, so classes like `bg-blue-500` or `text-lg` do not exist.
2. Never hardcode hex/rgb values in components. Add or adjust a token in `index.css` instead.
3. Gold is an accent: one primary (gold) button per view, selected states, key highlights.
4. Status colors are functional and separate from the brand palette. Status is never shown by color alone — badges always carry text.
5. Shared components stay generic. Feature-specific UI (e.g. a schools table) lives in `src/features/<feature>/`.

## Brand

| Role | Color | Used for |
|---|---|---|
| Primary — **Navy** | `navy-900` `#001D31` | Sidebar, brand structure, text on gold |
| Secondary — **Steel** | `steel-500` `#73819A` | Supporting elements, secondary text and borders (text uses darker steel shades for contrast) |
| Accent — **Gold** | `gold-500` `#D6982D` (dark theme `gold-400` `#F1B237`) | Primary actions, active navigation, selected tabs, highlights |

Full raw scales (`navy-50…950`, `steel-50…900`, `gold-50…800`) exist in `index.css` for defining tokens; components should not use them directly.

## Theme

Two themes, switched with `data-theme="light|dark"` on `<html>`. The choice is saved in `localStorage` (`edutrack-theme`); first visit follows the operating system. An inline script in `index.html` applies it before first paint (no flash). Components never branch on the theme — tokens change underneath them.

| Token (Tailwind class stem) | Purpose | Light | Dark |
|---|---|---|---|
| `primary` / `secondary` / `accent` | Brand | Navy / Steel / Gold | Navy / Steel 400 / Gold 400 |
| `accent-hover`, `accent-soft`, `accent-fg`, `on-accent` | Gold states; gold as text; text on gold | | |
| `interactive`, `interactive-hover`, `interactive-soft`, `on-interactive` | Links, checked controls, current page, selected rows | Navy 600 `#025584` | Blue `#4B9AD4` |
| `page` | Page background | `#F3F7FB` | `#051622` |
| `surface` | Cards, tables, inputs | `#FFFFFF` | `#081E2E` |
| `elevated` | Modals, drawers, menus | `#FFFFFF` + shadow | `#0E2536` |
| `muted` | Table header, read-only, hover | `#EEF3F8` | `#0B2232` |
| `fg` | Primary text | `#0D1932` | `#E8EEF5` |
| `fg-secondary` | Secondary text | `#4A566B` | `#B4C1D0` |
| `fg-muted` | Captions, placeholders, meta | `#617087` | `#8E9DB1` |
| `fg-inverse` | Text on dark (light theme) / light (dark theme) fills | `#FFFFFF` | `#0D1932` |
| `fg-disabled` | Disabled text | `#9AA6B6` | `#4E5D70` |
| `border` / `border-strong` / `border-subtle` | Default / emphasised / hairline borders | | |
| `border-input` | Form control boundaries (≥ 3:1) | `#7F8EA3` | `#56708C` |
| `success`, `warning`, `error`, `info` | Solid status color (dots, icons) | | |
| `*-soft` / `*-fg` | Status background / text on it (badges, alerts) | | |
| `focus` | Focus outline | Navy 600 | Gold 400 |
| `overlay` | Modal/drawer backdrop | | |
| `tooltip` | Tooltip background (text: `fg-inverse`) | Navy 900 | Steel 100 |
| `chart-1`, `chart-2` | Chart data series (added Phase 3) | Navy 800 / Blue `#2B7FC1` | Gold 400 / Gold 300 |
| `sidebar*` | Sidebar background, text, hover, active, border, focus | Navy in both themes | |

**Light theme:** near-white page, white surfaces, subtle borders, controlled shadows, navy sidebar, gold accents.
**Dark theme:** deep-navy page, slightly lighter navy surfaces with a three-step hierarchy (`page` → `surface` → `elevated`), borders instead of heavy shadows, brighter gold and blue for contrast. It is designed separately, not inverted.

## Typography

Font: **Inter** (variable, self-hosted via `@fontsource-variable/inter`), falling back to the system UI font.

| Class | Use | Size / line height | Weight |
|---|---|---|---|
| `text-display` | Key figures (statistics) | 30 / 38 px, −0.02em | 700 |
| `text-page-title` | Page title (`h1`) | 26 / 32 px, −0.015em | 700 |
| `text-section-title` | Section, modal and drawer titles | 18 / 26 px, −0.01em | 600 |
| `text-card-title` | Card titles | 15 / 22 px | 600 |
| `text-body` | Default text, form values | 14 / 22 px | 400 |
| `text-small` | Secondary information, descriptions | 13 / 20 px | 400 |
| `text-table` | Table cells | 13 / 20 px | 400 |
| `text-label` | Form labels | 13 / 20 px | 500 |
| `text-button` | Buttons | 14 / 20 px | 600 |
| `text-caption` | Helper text, badges, table headers | 12 / 16 px | 400 |

Only these sizes exist. Weights can be adjusted with `font-medium` / `font-semibold` where needed.

## Spacing

Tailwind's 4px scale (`1` = 4px). Standard uses:

| Area | Value |
|---|---|
| Page padding | `px-4` (phone) → `sm:px-6` → `lg:px-8`; `py-6` → `lg:py-8` (`PageContainer`) |
| Between page sections | `gap-6` (24px) |
| Inside a section (title → content) | `gap-4` (16px) |
| Card padding | `px-5` / `pt-5` header, `py-4` content, `py-3` footer (20 / 16 / 12px) |
| Form fields | `gap-4` between fields; `gap-1.5` label → control → hint |
| Table cells | `px-4`; row height 48px (`h-12`); header 40px |
| Sidebar | width 240px (`w-sidebar`), collapsed 72px; items 40px high, `px-3`, `gap-1` |
| Topbar | height 64px (`h-topbar`), `px-4` → `sm:px-6` |
| Modal / drawer | `px-5 py-4` header and footer, `py-5` body (`sm:px-6` in modals) |
| Max content width | 1440px (`max-w-page`) |

## Radius

| Token | Size | Used for |
|---|---|---|
| `rounded-sm` | 4px | Badges, checkboxes, menu items |
| `rounded-md` | 6px | Buttons, inputs, selects, menus, tooltips, alerts |
| `rounded-lg` | 10px | Cards, tables, modals, drawers |
| `rounded-pill` | full | Switches, radios, avatars, dots |

## Shadows

| Token | Used for |
|---|---|
| `shadow-none` | Default for cards and tables (borders define them) |
| `shadow-subtle` | Primary buttons, switch thumb |
| `shadow-medium` | Elevated and hovered interactive cards, tooltips |
| `shadow-large` | Modals, drawers, dropdown menus |

Dark theme uses stronger, darker shadow values, but relies mainly on surface contrast and borders.

## Components (`components/ui`)

Import from `components/ui` (barrel `index.js`).

| Component | Variants / states | Notes |
|---|---|---|
| **Button** | `primary` (gold), `secondary` (navy), `outline`, `ghost`, `danger`; sizes `sm`/`md`/`lg`; `iconOnly`; default, hover, active, focus, disabled, `loading` | Primary uses navy text on gold. Icon-only needs `aria-label`. Loading shows a spinner and ignores clicks. |
| **Input** | text, email, tel, password (show/hide), search, number, date, time; default, focus, error, disabled, read-only; `hideLabel` | Always labelled; hint and error linked with `aria-describedby`. |
| **Textarea** | same states as Input | |
| **Select** | default/placeholder, selected, disabled, error; open state is the native list | Native `<select>` for keyboard, screen reader and mobile support. |
| **Checkbox** | unchecked, checked, indeterminate, disabled, error; optional description | |
| **RadioGroup** | selected, unselected, disabled, error; vertical/horizontal | Fieldset + legend; arrow keys move between options. |
| **Switch** | on, off, disabled; optional description | `role="switch"`. |
| **Badge** | `success`, `warning`, `error`, `info`, `neutral`, `accent`; optional dot | Features map business statuses (Active, Pending, PRESENT, LATE…) to a variant. |
| **Card** (+ `CardHeader`, `CardContent`, `CardFooter`) | `default`, `elevated`, `interactive` (as button/link) | Header has title, description and a right-aligned action. |
| **Table** (+ `TableContainer`, `TableHead`, `TableBody`, `TableRow`, `TableHeaderCell`, `TableCell`, `TableActions`, `TableLoading`, `TableEmpty`, `TableError`) | header, hover, selected row, actions, status badges, loading (skeleton rows), empty, error with retry | Scrolls horizontally on small screens. |
| **Pagination** | current page, previous/next, disabled ends, ellipses; "Showing X to Y of Z" | |
| **Tabs** / **TabPanel** | selected (gold underline), hover, disabled; optional icons | Arrow keys, Home, End. |
| **Modal** | header, content, footer, close, `loading` (not dismissible), `error`; sizes `sm`/`md`/`lg` | Native `<dialog>`: focus trap, Escape, focus restored to the trigger. |
| **Drawer** | header (+ custom header slot), content, sticky footer actions, close, overlay; `md`/`lg` | Right side panel; full width on phones. |
| **DropdownMenu** | default, hover/focus, selected (check), disabled, destructive, separator, group label | Menu button pattern; arrow keys; Escape returns focus; never clipped by tables (fixed position, flips up when needed). |
| **Tooltip** | top, bottom, left, right | Hover and keyboard focus; supplements, never replaces, an accessible label. |
| **LinkButton** | same variants and sizes as Button | A link that looks like a button, for actions that go to another page (added Phase 3). Shares `buttonClassName()` with Button. |
| **Avatar** | initials; `sm`/`md`/`lg` | |
| **Alert** | `success`, `warning`, `error`, `info`; optional title, action, dismiss | Errors/warnings use `role="alert"`. |
| **Spinner**, **Skeleton** | sizes | |
| **EmptyState**, **ErrorState**, **LoadingState** | compact and full | See States below. |

## Charts (`components/charts`)

Added in Phase 3. No chart library. Pass colors in full, e.g. `'var(--color-chart-1)'`: Tailwind only keeps CSS variables it can see written out in the source.

| Component | Purpose | Accessibility |
|---|---|---|
| **BarChart** | Vertical bars with optional axis, gridlines and value labels | Drawing hidden from screen readers; a visually hidden data table with a caption carries the values |
| **DonutChart** | Share of a total, with a centre value | Decorative; always pair with a visible legend that states each value |
| **Sparkline** | Small trend line | Decorative; state the trend in text next to it |

Chart colors: `chart-1` for the main series, `chart-2` for a second series, status tokens for statuses (active = `interactive`, pending = `accent`, suspended = `error`).

## Layout (`components/layout`)

| Component | Purpose |
|---|---|
| **AppShell** | Sidebar + topbar + main area; "Skip to main content" link; shares sidebar state (collapsed, mobile open). Role-agnostic. |
| **Sidebar** | Navy navigation showing product, subtitle, current role badge and grouped links. Active link: gold text, gold-tinted background and gold left bar (`aria-current="page"`). Collapsible to icons (tooltips show labels). Each role passes its own sections. |
| **Topbar** | Sticky bar with slots: `context`, `search`, `actions` (e.g. notifications once approved), `user`; theme toggle always present; menu button on tablet/phone. |
| **UserMenu** | Avatar, name and role with a dropdown; the caller supplies the items. |
| **ThemeToggle** | Light/dark switch. |
| **PageHeader** | Breadcrumbs (optional), title, description, secondary actions and one primary action. |
| **PageContainer** | Page padding, max width, 24px rhythm between sections. |
| **ContentSection** | Titled region with optional description and actions. |

## States

| State | Pattern |
|---|---|
| Loading | `Spinner` inside buttons; `LoadingState` for a section; `Skeleton` / `TableLoading` for content with a known shape; modal `loading` overlay. |
| Empty | `EmptyState` / `TableEmpty`: icon, title, description, optional action. |
| Error | `ErrorState` / `TableError`: message, helpful description, retry; `Alert variant="error"`; field errors under the control with an icon. |
| Success | `Alert variant="success"`; success badges. |
| Disabled | Muted background, `fg-disabled` text, `not-allowed` cursor; disabled controls keep their label readable. |

## Accessibility

- Visible focus on every interactive element: 2px outline in `focus` (navy in light, gold in dark and in the sidebar); inputs use a focus ring.
- Contrast checked for all token pairs (WCAG AA): body text ≥ 4.5:1 in both themes; focus indicators and form control borders ≥ 3:1.
- Semantic HTML: native `<button>`, `<select>`, `<dialog>`, `<table>` with `scope="col"`, `<nav>` landmarks, `fieldset`/`legend`.
- Labels on every input; hints and errors linked via `aria-describedby`; `aria-invalid` on errors.
- ARIA patterns for tabs, menu button, switch, tooltip, alert/status.
- Status never relies on color alone; icon-only buttons have `aria-label`.
- Keyboard: Tab order follows the layout; Escape closes modals, drawers, menus and tooltips; focus returns to the trigger.
- `prefers-reduced-motion` disables transitions and animations.

## Responsive

| Breakpoint | Behaviour |
|---|---|
| **Desktop** (`lg`, ≥ 1024px) | Fixed sidebar (collapsible); topbar search visible; multi-column grids. |
| **Tablet** (`md`, 768–1023px) | Sidebar hidden behind the topbar menu button (overlay panel); search visible; grids drop to two columns. |
| **Mobile** (< 768px) | Overlay sidebar; topbar search hidden and user name reduced to the avatar; single-column content; page header actions wrap under the title; tables scroll horizontally inside their card; modals fill the width with stacked footer buttons; drawers are full screen. |

There is one design system for all sizes; components adapt with Tailwind breakpoints (`sm` 640, `md` 768, `lg` 1024, `xl` 1280).
