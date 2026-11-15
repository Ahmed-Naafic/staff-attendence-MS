/* Sidebar menu groups: which page of a group is shown (plain JS so it can be unit-tested). */

/** Whether `pathname` is the page `to` or one of its sub-pages (e.g. /timetables/… for /timetables). */
export const isWithin = (pathname, to) => pathname === to || pathname.startsWith(`${to}/`);

/**
 * A group's pages as shown for `pathname`: only the closest page lights up, so on
 * /student-attendance/reports "Student Reports" does and "Student Attendance" does not.
 */
export function groupChildren(children, pathname) {
  const best = children.filter((c) => isWithin(pathname, c.to)).sort((a, b) => b.to.length - a.to.length)[0];
  return children.map((c) => (best && c !== best && isWithin(pathname, c.to) ? { ...c, end: true } : c));
}
