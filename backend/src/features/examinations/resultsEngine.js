/*
 * Results (docs/business-rules.md → Examinations → Results): pure calculation, no database.
 *
 * A section's results in one examination:
 *   paper     percent = marks ÷ marks out of × 100; absent counts as 0 % when the school says so (else
 *             left out, shown Absent); excused is left out. Grade from the grading scale; passed when
 *             the percent reaches the paper pass mark.
 *   student   total marks ÷ total marks out of (papers counted) → percent; grade from the scale;
 *             passed when the percent reaches the overall pass mark AND the papers failed are at most
 *             the most failed subjects allowed. No paper counted: no result (incomplete).
 *   rank      by percent, highest first; equal percents share a rank (1, 2, 2, 4).
 * The year's final result (yearFinal) combines a student's published examination results with the
 * year's result formula: weighted by examination type (and period), the average, or the last.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/** The grade band reached by a percent (highest minimum reached): { label, points, passes, remark } | null. */
export function gradeFor(bands, percent) {
  if (percent === null || percent === undefined || !bands?.length) return null;
  const band = [...bands].sort((a, b) => Number(b.minPercent) - Number(a.minPercent)).find((b) => percent >= Number(b.minPercent));
  return band ? { label: band.label, points: band.points === null || band.points === undefined ? null : Number(band.points), passes: band.passes, remark: band.remark ?? null } : null;
}

/**
 * students: [{ id, name, number }]; papers: [{ id, subject, maxMarks }]; entries: Map(`${paperId}|${studentId}` →
 * { marks, absent, excused }); settings: { passPercent, overallPassPercent, maxFailedSubjects, absentCountsAsZero };
 * bands: the grading scale. → { students: [result], summary }.
 */
export function computeSection({ students, papers, entries, settings, bands }) {
  const results = students.map((student) => {
    let totalMarks = 0;
    let totalMax = 0;
    let failed = 0;
    let counted = 0;
    let missing = 0;
    const paperResults = papers.map((p) => {
      const e = entries.get(`${p.id}|${student.id}`) ?? null;
      const base = { paperId: p.id, subject: p.subject, maxMarks: p.maxMarks };
      if (!e || (e.marks === null && !e.absent && !e.excused)) {
        missing += 1;
        return { ...base, marks: null, percent: null, grade: null, passed: null, status: 'missing' };
      }
      if (e.excused) return { ...base, marks: null, percent: null, grade: null, passed: null, status: 'excused' };
      if (e.absent && !settings.absentCountsAsZero) return { ...base, marks: null, percent: null, grade: null, passed: null, status: 'absent' };
      const marks = e.absent ? 0 : e.marks;
      const percent = round2((marks / p.maxMarks) * 100);
      const passed = percent >= settings.passPercent;
      totalMarks += marks;
      totalMax += p.maxMarks;
      counted += 1;
      if (!passed) failed += 1;
      return { ...base, marks, percent, grade: gradeFor(bands, percent)?.label ?? null, passed, status: e.absent ? 'absent' : 'sat' };
    });
    const percent = counted ? round2((totalMarks / totalMax) * 100) : null;
    const grade = gradeFor(bands, percent);
    return {
      student,
      papers: paperResults,
      totalMarks: round2(totalMarks),
      totalMax,
      percent,
      grade: grade?.label ?? null,
      points: grade?.points ?? null,
      remark: grade?.remark ?? null,
      failedPapers: failed,
      missingPapers: missing,
      passed: percent === null ? null : percent >= settings.overallPassPercent && failed <= settings.maxFailedSubjects,
      rank: null,
    };
  });
  // Competition ranking among students with a result.
  const ranked = results.filter((r) => r.percent !== null).sort((a, b) => b.percent - a.percent);
  ranked.forEach((r, i) => {
    r.rank = i > 0 && ranked[i - 1].percent === r.percent ? ranked[i - 1].rank : i + 1;
  });
  return { students: results, summary: summarize(results, papers) };
}

/** Class figures: students, with results, passed, pass rate, average, highest, lowest, grades, per paper. */
export function summarize(results, papers) {
  const withResult = results.filter((r) => r.percent !== null);
  const passed = withResult.filter((r) => r.passed).length;
  const avg = (list) => (list.length ? round2(list.reduce((n, v) => n + v, 0) / list.length) : null);
  const grades = {};
  for (const r of withResult) if (r.grade) grades[r.grade] = (grades[r.grade] ?? 0) + 1;
  return {
    students: results.length,
    withResult: withResult.length,
    incomplete: results.filter((r) => r.missingPapers > 0).length,
    passed,
    failed: withResult.length - passed,
    passRate: withResult.length ? round2((passed / withResult.length) * 100) : null,
    average: avg(withResult.map((r) => r.percent)),
    highest: withResult.length ? Math.max(...withResult.map((r) => r.percent)) : null,
    lowest: withResult.length ? Math.min(...withResult.map((r) => r.percent)) : null,
    grades,
    papers: papers.map((p) => {
      const sat = results.map((r) => r.papers.find((x) => x.paperId === p.id)).filter((x) => x?.percent !== null && x?.percent !== undefined);
      return { paperId: p.id, subject: p.subject, sat: sat.length, average: avg(sat.map((x) => x.percent)), passRate: sat.length ? round2((sat.filter((x) => x.passed).length / sat.length) * 100) : null };
    }),
  };
}

/**
 * A student's final result of the year from their published examination results:
 * exams: [{ examTypeId, periodId, endDate, percent }] (percent null: no result); formula: { method,
 * typeWeights: [{ examTypeId, weight }], periodWeights: [{ periodId, weight }] } or null (average).
 * → { percent, basis } where basis explains which examinations counted. Null when nothing counts.
 */
export function yearFinal(exams, formula) {
  const counted = exams.filter((e) => e.percent !== null && e.percent !== undefined);
  if (!counted.length) return { percent: null, basis: 'no published result' };
  const avg = (list) => list.reduce((n, v) => n + v, 0) / list.length;
  const method = formula?.method ?? 'AVERAGE';
  if (method === 'LAST') {
    const last = [...counted].sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0];
    return { percent: round2(last.percent), basis: 'last examination' };
  }
  const byPeriod = (list) => {
    const groups = new Map();
    for (const e of list) groups.set(e.periodId ?? 'year', [...(groups.get(e.periodId ?? 'year') ?? []), e]);
    return groups;
  };
  const periodScore = (list) => {
    if (method !== 'WEIGHTED') return avg(list.map((e) => e.percent));
    // Weighted by type: each type's average, weighted; types without a result are left out (weights rescaled).
    let sum = 0;
    let weights = 0;
    for (const w of formula.typeWeights ?? []) {
      const ofType = list.filter((e) => e.examTypeId === w.examTypeId);
      if (!ofType.length || !w.weight) continue;
      sum += w.weight * avg(ofType.map((e) => e.percent));
      weights += w.weight;
    }
    return weights ? sum / weights : null;
  };
  const periods = byPeriod(counted);
  const scores = [...periods.entries()].map(([periodId, list]) => ({ periodId, score: periodScore(list) })).filter((p) => p.score !== null);
  if (!scores.length) return { percent: null, basis: 'no examination of a weighted type' };
  const pw = formula?.periodWeights ?? [];
  if (pw.length) {
    let sum = 0;
    let weights = 0;
    for (const s of scores) {
      const w = pw.find((x) => x.periodId === s.periodId)?.weight ?? 0;
      sum += w * s.score;
      weights += w;
    }
    if (weights) return { percent: round2(sum / weights), basis: method === 'WEIGHTED' ? 'weighted by type and period' : 'average, weighted by period' };
  }
  return { percent: round2(avg(scores.map((s) => s.score))), basis: method === 'WEIGHTED' ? 'weighted by type' : 'average' };
}
