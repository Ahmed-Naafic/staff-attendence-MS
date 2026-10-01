/**
 * Dashboard grid, shared by the page and its loading skeleton so both line up.
 *
 * Key figures: 5 across from 1360px (85rem; rem keeps it ordered after md), 3 + 2 on medium screens, 2 or 1 column below.
 * ≥ 1280px: charts and recent schools on the left,
 *           activity, quick actions and locations in a 20rem right column.
 * ≥ 1536px: the three charts sit in one row, as in the reference.
 * Smaller:  sections stack; two columns where there is room.
 */
export function DashboardLayout({ kpis, growth, status, newSchools, recentSchools, activity, quickActions, locations }) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="dashboard-kpis">
        <h2 id="dashboard-kpis" className="sr-only">
          Key figures
        </h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 min-[85rem]:grid-cols-5">{kpis}</ul>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-[1.35fr_1fr_1fr]">
            <div className="md:col-span-2 2xl:col-span-1">{growth}</div>
            {status}
            {newSchools}
          </div>
          {recentSchools}
        </div>

        <div className="grid grid-cols-1 content-start gap-6 md:grid-cols-2 xl:grid-cols-1">
          {activity}
          {quickActions}
          <div className="md:col-span-2 xl:col-span-1">{locations}</div>
        </div>
      </div>
    </div>
  );
}
