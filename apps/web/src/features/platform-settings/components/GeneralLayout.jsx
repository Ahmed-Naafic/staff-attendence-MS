/**
 * General section grid, shared with the skeleton.
 * ≥ 1536px: two settings columns plus a 20rem system column (as in the reference).
 * 1024–1535px: two settings columns, system cards below in two columns.
 * Below 1024px: one column.
 * `main` cards fill the two columns in reading order: [information, logo, localization, configuration].
 */
export function GeneralLayout({ main, rail }) {
  return (
    <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">{main}</div>
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 2xl:grid-cols-1 2xl:content-start">{rail}</div>
    </div>
  );
}
