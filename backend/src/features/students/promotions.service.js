import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { fullName, lockBranchForStudents, TX } from './students.service.js';

/*
 * Bulk Academic Year Enrollment & Promotion (approved rules: docs/business-rules.md → Academic year
 * promotion). One batch per branch and pair of years (previous → new); a Manager prepares it, reviews
 * and changes every decision, confirms it, and then it is processed. Owners read batches.
 *
 * Recommendations (never applied without the Manager's confirmation):
 *   A. Passed → PROMOTE to the next class (by order), same section name ("Grade 6A" → "Grade 7A").
 *   B. Failed → REPEAT the same class and section name in the new year.
 *   C. TRANSFER_OUT is chosen by the Manager; the student leaves promotion lists, history is kept.
 *   D. Passed the school's final class → GRADUATE.
 *   E. No result recorded → PENDING (review); a PENDING decision is excluded at confirmation.
 * A missing destination section is flagged (target null), never replaced by another section.
 *
 * Processing is idempotent and safe for large schools: items are claimed in chunks of CHUNK (FOR
 * UPDATE SKIP LOCKED) and each chunk runs in its own transaction; if a chunk fails, its items are
 * retried one by one so one bad item never blocks the others, and each failed item records its error.
 * A student's new enrollment and the item's DONE status are written in the same transaction, and the
 * database allows one enrollment per student and year, so a retry can never enroll anyone twice.
 * Each call works for at most `budgetMs` and reports progress; the web app calls again until done.
 */

const CHUNK = 50;
const lower = (value) => value?.toLowerCase() ?? null;

class ItemError extends Error {}

// ---- lookups ---------------------------------------------------------------------------------------

const batchWhere = (scope, id) => ({ id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) });

async function findBatch(client, scope, id) {
  const batch = isUuid(id)
    ? await client.promotionBatch.findFirst({ where: batchWhere(scope, id), include: { fromYear: true, toYear: true, branch: { select: { id: true, name: true, code: true } } } })
    : null;
  if (!batch) throw notFound('Promotion not found.');
  return batch;
}

async function findYear(client, scope, id, label) {
  const year = isUuid(id) ? await client.academicYear.findFirst({ where: { id, schoolId: scope.school.id } }) : null;
  if (!year) throw notFound(`${label} not found.`);
  return year;
}

/** The school's active classes in order, and the branch's active sections of the new year by class and name. */
async function structure(client, scope, branchId, toYearId) {
  const [classes, sections] = await Promise.all([
    client.schoolClass.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, orderBy: { sequence: 'asc' } }),
    client.section.findMany({ where: { branchId, academicYearId: toYearId, status: 'ACTIVE', class: { status: 'ACTIVE' } }, include: { class: true } }),
  ]);
  const byClassAndName = new Map(sections.map((s) => [`${s.classId}|${s.nameKey}`, s]));
  const nextClass = (cls) => classes.find((c) => c.sequence > cls.sequence) ?? null;
  return { classes, sections, nextClass, sectionFor: (classId, nameKey) => byClassAndName.get(`${classId}|${nameKey}`) ?? null };
}

/** Where a student would go for each decision: { PROMOTE, REPEAT } target sections (or null), and whether the class is the final one. */
function destinations(enrollment, s) {
  const cls = enrollment.section.class;
  const next = s.nextClass(cls);
  return {
    final: !next,
    nextClass: next,
    PROMOTE: next ? s.sectionFor(next.id, enrollment.section.nameKey) : null,
    REPEAT: s.sectionFor(cls.id, enrollment.section.nameKey),
  };
}

/** The recommendation for one previous-year enrollment (rules A, B, D, E). */
function recommend(enrollment, s, toYear) {
  const d = destinations(enrollment, s);
  const label = (cls, name) => sectionDisplayName(cls.name, name);
  const missing = (cls) => ` — ${label(cls, enrollment.section.name)} does not exist in ${toYear.name} yet`;
  if (enrollment.result === 'PASSED') {
    if (d.final) return { recommendation: 'GRADUATE', note: 'Passed the final class', target: null };
    return { recommendation: 'PROMOTE', note: `Passed${d.PROMOTE ? '' : missing(d.nextClass)}`, target: d.PROMOTE?.id ?? null };
  }
  if (enrollment.result === 'FAILED') {
    return { recommendation: 'REPEAT', note: `Failed${d.REPEAT ? '' : missing(enrollment.section.class)}`, target: d.REPEAT?.id ?? null };
  }
  return { recommendation: 'PENDING', note: 'No year-end result recorded: review', target: null };
}

/** Previous-year enrollments that can be promoted: ACTIVE, in the branch, of students still enrolled. */
const eligibleWhere = (batch) => ({ branchId: batch.branchId, academicYearId: batch.fromYearId, status: 'ACTIVE', student: { status: 'ENROLLED' } });
const fromInclude = { section: { include: { class: true } }, student: true };

// ---- audit --------------------------------------------------------------------------------------------

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const batchTarget = (b) => ({ type: 'promotion', id: b.id, name: `${b.branch.name} (${b.branch.code}): ${b.fromYear.name} → ${b.toYear.name}` });
const COUNT_LABELS = { PROMOTE: 'Promote', REPEAT: 'Repeat', TRANSFER_OUT: 'Transfer out', GRADUATE: 'Graduate', PENDING: 'Pending review (excluded)' };

// ---- reads ---------------------------------------------------------------------------------------------

export async function listPromotions(scope) {
  const rows = await getPrisma().promotionBatch.findMany({
    where: { schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) },
    include: { fromYear: true, toYear: true, branch: { select: { id: true, name: true, code: true } }, _count: { select: { items: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { items: rows.map((b) => ({ ...toBatch(b), students: b._count.items })) };
}

const toBatch = (b) => ({
  id: b.id,
  status: lower(b.status),
  branch: b.branch,
  fromYear: { id: b.fromYear.id, name: b.fromYear.name, status: lower(b.fromYear.status) },
  toYear: { id: b.toYear.id, name: b.toYear.name, status: lower(b.toYear.status) },
  createdByName: b.createdByName,
  createdAt: b.createdAt.toISOString(),
  confirmedByName: b.confirmedByName ?? null,
  confirmedAt: b.confirmedAt?.toISOString() ?? null,
  completedAt: b.completedAt?.toISOString() ?? null,
});

/**
 * Everything the review needs: the batch; every student with recommendation, decision, destination
 * and processing state; groups by previous section; totals; destination counts with capacity; the
 * sections that can be chosen; and what each decision would mean for each student (suggested targets).
 */
export async function getPromotion(scope, id) {
  const prisma = getPrisma();
  const batch = await findBatch(prisma, scope, id);
  const [items, s] = await Promise.all([
    prisma.promotionItem.findMany({
      where: { batchId: batch.id },
      include: { student: true, fromEnrollment: { include: fromInclude }, targetSection: { include: { class: true } }, resultEnrollment: { include: { section: { include: { class: true } } } } },
    }),
    structure(prisma, scope, batch.branchId, batch.toYearId),
  ]);
  const enrolledNow = await prisma.enrollment.groupBy({ by: ['sectionId'], where: { academicYearId: batch.toYearId, branchId: batch.branchId, status: 'ACTIVE' }, _count: { _all: true } });

  const rows = items
    .map((item) => {
      const e = item.fromEnrollment;
      const d = destinations(e, s);
      return {
        id: item.id,
        student: { id: item.student.id, studentNumber: item.student.studentNumber, fullName: fullName(item.student), status: lower(item.student.status) },
        from: { sectionId: e.section.id, displayName: sectionDisplayName(e.section.class.name, e.section.name), classSequence: e.section.class.sequence, result: lower(e.result) },
        recommendation: item.recommendation,
        recommendationNote: item.recommendationNote,
        decision: item.decision,
        target: item.targetSection ? { id: item.targetSection.id, displayName: sectionDisplayName(item.targetSection.class.name, item.targetSection.name) } : null,
        missingTarget: ['PROMOTE', 'REPEAT'].includes(item.decision) && !item.targetSectionId,
        suggestions: { PROMOTE: d.PROMOTE?.id ?? null, REPEAT: d.REPEAT?.id ?? null, final: d.final },
        status: lower(item.status),
        error: item.error,
        result: item.resultEnrollment ? sectionDisplayName(item.resultEnrollment.section.class.name, item.resultEnrollment.section.name) : null,
      };
    })
    .sort((a, b) => a.from.classSequence - b.from.classSequence || a.from.displayName.localeCompare(b.from.displayName, 'en', { numeric: true }) || a.student.fullName.localeCompare(b.student.fullName));

  const count = (pred) => rows.filter(pred).length;
  const groups = [];
  for (const row of rows) {
    let g = groups.find((x) => x.sectionId === row.from.sectionId);
    if (!g) groups.push((g = { sectionId: row.from.sectionId, displayName: row.from.displayName, students: 0, decisions: {} }));
    g.students += 1;
    g.decisions[row.decision] = (g.decisions[row.decision] ?? 0) + 1;
  }
  const targets = s.sections
    .map((sec) => {
      const incoming = count((r) => r.target?.id === sec.id && ['PROMOTE', 'REPEAT'].includes(r.decision) && r.status !== 'done');
      const already = enrolledNow.find((x) => x.sectionId === sec.id)?._count._all ?? 0;
      return {
        id: sec.id,
        displayName: sectionDisplayName(sec.class.name, sec.name),
        classId: sec.classId,
        classSequence: sec.class.sequence,
        capacity: sec.capacity,
        enrolled: already,
        incoming,
        overCapacity: sec.capacity !== null && already + incoming > sec.capacity,
      };
    })
    .sort((a, b) => a.classSequence - b.classSequence || a.displayName.localeCompare(b.displayName, 'en', { numeric: true }));

  return {
    batch: toBatch(batch),
    summary: {
      total: rows.length,
      decisions: Object.fromEntries(['PROMOTE', 'REPEAT', 'TRANSFER_OUT', 'GRADUATE', 'PENDING'].map((d) => [d, count((r) => r.decision === d)])),
      missingTargets: count((r) => r.missingTarget),
      overCapacity: targets.filter((t) => t.overCapacity).length,
      status: Object.fromEntries(['draft', 'waiting', 'done', 'failed', 'excluded'].map((st) => [st, count((r) => r.status === st)])),
    },
    groups,
    targets,
    items: rows,
  };
}

// ---- preparing (Manager, own branch) ---------------------------------------------------------------

/** Adds items for eligible enrollments not in the batch yet, drops draft items no longer eligible, and refreshes recommendations. */
async function syncItems(tx, scope, batch) {
  const s = await structure(tx, scope, batch.branchId, batch.toYearId);
  const [eligible, items] = await Promise.all([
    tx.enrollment.findMany({ where: eligibleWhere(batch), include: fromInclude }),
    tx.promotionItem.findMany({ where: { batchId: batch.id } }),
  ]);
  const eligibleIds = new Set(eligible.map((e) => e.id));
  const stale = items.filter((i) => i.status === 'DRAFT' && !eligibleIds.has(i.fromEnrollmentId));
  if (stale.length) await tx.promotionItem.deleteMany({ where: { id: { in: stale.map((i) => i.id) }, status: 'DRAFT' } });

  const byEnrollment = new Map(items.map((i) => [i.fromEnrollmentId, i]));
  const fresh = [];
  for (const e of eligible) {
    const r = recommend(e, s, batch.toYear);
    const item = byEnrollment.get(e.id);
    if (!item) {
      fresh.push({ batchId: batch.id, studentId: e.studentId, fromEnrollmentId: e.id, fromSectionId: e.sectionId, recommendation: r.recommendation, recommendationNote: r.note, decision: r.recommendation, targetSectionId: r.target });
      continue;
    }
    // A decision the Manager has not changed follows the new recommendation (e.g. a result recorded since).
    const data = { recommendation: r.recommendation, recommendationNote: r.note };
    if (item.decision === item.recommendation && r.recommendation !== item.recommendation) {
      Object.assign(data, { decision: r.recommendation, targetSectionId: r.target });
    } else if (['PROMOTE', 'REPEAT'].includes(item.decision) && !item.targetSectionId) {
      // A destination that was missing may exist now.
      data.targetSectionId = destinations(e, s)[item.decision]?.id ?? null;
    }
    await tx.promotionItem.update({ where: { id: item.id }, data });
  }
  if (fresh.length) await tx.promotionItem.createMany({ data: fresh, skipDuplicates: true });
}

/**
 * Step 1–3: starts the branch's promotion from one academic year to a later one, or resumes the existing
 * one (one per branch and pair of years). The new year must be planned or current.
 */
export async function startPromotion(scope, { fromYearId, toYearId }, user, req) {
  const prisma = getPrisma();
  const fromYear = await findYear(prisma, scope, fromYearId, 'Previous academic year');
  const toYear = await findYear(prisma, scope, toYearId, 'New academic year');
  if (toYear.startDate <= fromYear.startDate) throw conflict('WRONG_ORDER', `${toYear.name} must start after ${fromYear.name}.`);
  if (toYear.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${toYear.name} is closed. Students cannot be enrolled in it.`);

  const id = await prisma.$transaction(
    async (tx) => {
      await lockBranchForStudents(tx, scope, scope.branch.id);
      let batch = await tx.promotionBatch.findUnique({
        where: { branchId_fromYearId_toYearId: { branchId: scope.branch.id, fromYearId, toYearId } },
        include: { fromYear: true, toYear: true, branch: { select: { id: true, name: true, code: true } } },
      });
      if (!batch) {
        batch = await tx.promotionBatch.create({
          data: { schoolId: scope.school.id, branchId: scope.branch.id, fromYearId, toYearId, createdById: user.id, createdByName: user.name },
          include: { fromYear: true, toYear: true, branch: { select: { id: true, name: true, code: true } } },
        });
        await recordAuditEvent({
          client: tx,
          action: AUDIT_ACTIONS.PROMOTION_STARTED,
          actor: actorOf(user),
          target: batchTarget(batch),
          schoolId: scope.school.id,
          description: `Promotion prepared from ${fromYear.name} to ${toYear.name}.`,
          req,
        });
      }
      if (batch.status === 'DRAFT') await syncItems(tx, scope, batch);
      return batch.id;
    },
    { timeout: 60000 },
  );
  return getPromotion(scope, id);
}

/** Reloads eligible students and recommendations while the batch is a draft (e.g. after creating missing sections or recording results). */
export async function refreshPromotion(scope, id) {
  const prisma = getPrisma();
  await prisma.$transaction(
    async (tx) => {
      await lockBranchForStudents(tx, scope, scope.branch.id);
      const batch = await findBatch(tx, scope, id);
      if (batch.status !== 'DRAFT') throw conflict('NOT_DRAFT', 'This promotion has been confirmed; it can no longer be changed.');
      await syncItems(tx, scope, batch);
    },
    { timeout: 60000 },
  );
  return getPromotion(scope, id);
}

/**
 * Step 4: changes decisions and destinations. A PROMOTE destination must be a later class, a REPEAT one
 * the same class; both must be active sections of the new year in the branch. Other decisions have no
 * destination. A destination may be left empty (flagged); confirmation then refuses until it is chosen.
 */
export async function updatePromotionItems(scope, id, changes) {
  const prisma = getPrisma();
  await prisma.$transaction(
    async (tx) => {
      await lockBranchForStudents(tx, scope, scope.branch.id);
      const batch = await findBatch(tx, scope, id);
      if (batch.status !== 'DRAFT') throw conflict('NOT_DRAFT', 'This promotion has been confirmed; decisions can no longer be changed.');
      const items = await tx.promotionItem.findMany({ where: { batchId: batch.id, id: { in: changes.map((c) => c.id) } }, include: { fromSection: { include: { class: true } } } });
      if (items.length !== new Set(changes.map((c) => c.id)).size) throw notFound('Some students are not part of this promotion.');
      const targetIds = [...new Set(changes.map((c) => c.targetSectionId).filter(Boolean))];
      const targets = await tx.section.findMany({ where: { id: { in: targetIds }, branchId: batch.branchId, academicYearId: batch.toYearId, status: 'ACTIVE', class: { status: 'ACTIVE' } }, include: { class: true } });
      const byId = new Map(items.map((i) => [i.id, i]));
      const groups = new Map();
      for (const c of changes) {
        const item = byId.get(c.id);
        let target = null;
        if (['PROMOTE', 'REPEAT'].includes(c.decision) && c.targetSectionId) {
          target = targets.find((t) => t.id === c.targetSectionId);
          if (!target) throw conflict('INVALID_TARGET', `The destination section must be an active section of ${batch.toYear.name} in this branch.`);
          const from = item.fromSection.class;
          if (c.decision === 'PROMOTE' && target.class.sequence <= from.sequence) throw conflict('INVALID_TARGET', `A promoted student goes to a later class than ${from.name}.`);
          if (c.decision === 'REPEAT' && target.classId !== from.id) throw conflict('INVALID_TARGET', `A repeating student stays in ${from.name}.`);
        }
        const key = `${c.decision}|${target?.id ?? ''}`;
        if (!groups.has(key)) groups.set(key, { decision: c.decision, targetSectionId: target?.id ?? null, ids: [] });
        groups.get(key).ids.push(c.id);
      }
      for (const g of groups.values()) {
        await tx.promotionItem.updateMany({ where: { id: { in: g.ids }, batchId: batch.id }, data: { decision: g.decision, targetSectionId: g.targetSectionId } });
      }
    },
    { timeout: 60000 },
  );
  return getPromotion(scope, id);
}

/**
 * Step 6 (confirmation): every PROMOTE / REPEAT needs a destination (409 MISSING_TARGETS). PENDING
 * students are excluded (nothing happens to them); the others wait for processing.
 */
export async function confirmPromotion(scope, id, user, req) {
  const prisma = getPrisma();
  await prisma.$transaction(
    async (tx) => {
      await lockBranchForStudents(tx, scope, scope.branch.id);
      const batch = await findBatch(tx, scope, id);
      if (batch.status !== 'DRAFT') throw conflict('NOT_DRAFT', 'This promotion has already been confirmed.');
      if (batch.toYear.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${batch.toYear.name} is closed. Students cannot be enrolled in it.`);
      const missing = await tx.promotionItem.count({ where: { batchId: batch.id, decision: { in: ['PROMOTE', 'REPEAT'] }, targetSectionId: null } });
      if (missing) {
        throw conflict('MISSING_TARGETS', `${missing} student${missing === 1 ? ' has' : 's have'} no destination section. Choose one, create the section, or change the decision.`, { missing });
      }
      const counts = await tx.promotionItem.groupBy({ by: ['decision'], where: { batchId: batch.id }, _count: { _all: true } });
      const total = counts.reduce((n, c) => n + c._count._all, 0);
      if (!total) throw conflict('EMPTY', 'There are no students to process.');
      await tx.promotionItem.updateMany({ where: { batchId: batch.id, decision: 'PENDING' }, data: { status: 'EXCLUDED' } });
      await tx.promotionItem.updateMany({ where: { batchId: batch.id, decision: { not: 'PENDING' } }, data: { status: 'WAITING' } });
      await tx.promotionBatch.update({ where: { id: batch.id }, data: { status: 'PROCESSING', confirmedById: user.id, confirmedByName: user.name, confirmedAt: new Date() } });
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.PROMOTION_CONFIRMED,
        actor: actorOf(user),
        target: batchTarget(batch),
        schoolId: scope.school.id,
        description: `Promotion from ${batch.fromYear.name} to ${batch.toYear.name} confirmed for ${total} students.`,
        change: { fields: counts.map((c) => ({ field: COUNT_LABELS[c.decision], from: null, to: String(c._count._all) })) },
        req,
      });
    },
    { timeout: 60000 },
  );
  return getPromotion(scope, id);
}

// ---- processing ------------------------------------------------------------------------------------------

/**
 * Applies a chunk of confirmed decisions inside `tx` with a fixed number of queries (not per student):
 * everything is read at once, checked in memory, then written in bulk. Students that cannot be
 * processed are marked FAILED with the reason in the same transaction; the others are DONE.
 */
async function applyChunk(tx, batch, items) {
  const now = new Date();
  const [froms, targets, existing] = await Promise.all([
    tx.enrollment.findMany({ where: { id: { in: items.map((i) => i.fromEnrollmentId) } }, include: { student: true } }),
    tx.section.findMany({ where: { id: { in: items.map((i) => i.targetSectionId).filter(Boolean) }, branchId: batch.branchId, academicYearId: batch.toYearId }, include: { class: true } }),
    tx.enrollment.findMany({ where: { academicYearId: batch.toYearId, studentId: { in: items.map((i) => i.studentId) } }, include: { section: { include: { class: true } } } }),
  ]);
  const fromById = new Map(froms.map((e) => [e.id, e]));
  const targetById = new Map(targets.map((t) => [t.id, t]));
  const existingByStudent = new Map(existing.map((e) => [e.studentId, e]));

  const creates = [];
  const done = []; // [itemId, resultEnrollmentId | null]
  const failed = new Map(); // message → [itemId]
  const ends = { COMPLETED: [], TRANSFERRED_OUT: [], GRADUATED: [] };
  const leavers = { TRANSFERRED_OUT: [], GRADUATED: [] };
  const fail = (item, message) => failed.set(message, [...(failed.get(message) ?? []), item.id]);

  for (const item of items) {
    const from = fromById.get(item.fromEnrollmentId);
    if (from.status !== 'ACTIVE') {
      fail(item, `The ${batch.fromYear.name} enrollment is no longer active (${lower(from.status).replace('_', ' ')}).`);
      continue;
    }
    if (from.student.status !== 'ENROLLED') {
      fail(item, `The student is ${lower(from.student.status).replace('_', ' ')}.`);
      continue;
    }
    if (item.decision === 'PROMOTE' || item.decision === 'REPEAT') {
      const target = targetById.get(item.targetSectionId);
      if (!target || target.status !== 'ACTIVE' || target.class.status !== 'ACTIVE') {
        fail(item, 'The destination section is no longer active.');
        continue;
      }
      const already = existingByStudent.get(from.studentId);
      if (already && (already.sectionId !== target.id || already.previousEnrollmentId !== from.id)) {
        fail(item, `Already enrolled in ${sectionDisplayName(already.section.class.name, already.section.name)} for ${batch.toYear.name}.`);
        continue;
      }
      const enrollmentId = already?.id ?? randomUUID();
      if (!already) {
        creates.push({
          id: enrollmentId,
          schoolId: batch.schoolId,
          branchId: batch.branchId,
          studentId: from.studentId,
          academicYearId: batch.toYearId,
          sectionId: target.id,
          entry: item.decision === 'PROMOTE' ? 'PROMOTED' : 'REPEATED',
          previousEnrollmentId: from.id,
        });
      }
      ends.COMPLETED.push(from.id);
      done.push([item.id, enrollmentId]);
    } else if (item.decision === 'TRANSFER_OUT' || item.decision === 'GRADUATE') {
      const status = item.decision === 'GRADUATE' ? 'GRADUATED' : 'TRANSFERRED_OUT';
      ends[status].push(from.id);
      leavers[status].push(from.studentId);
      done.push([item.id, null]);
    } else {
      fail(item, 'A pending decision is not processed.');
    }
  }

  if (creates.length) await tx.enrollment.createMany({ data: creates });
  for (const [status, ids] of Object.entries(ends)) {
    if (ids.length) await tx.enrollment.updateMany({ where: { id: { in: ids }, status: 'ACTIVE' }, data: { status, endedAt: now } });
  }
  const reasons = { TRANSFERRED_OUT: `Transferred out at the end of ${batch.fromYear.name}`, GRADUATED: `Graduated at the end of ${batch.fromYear.name}` };
  for (const [status, ids] of Object.entries(leavers)) {
    if (ids.length) await tx.student.updateMany({ where: { id: { in: ids } }, data: { status, statusReason: reasons[status], statusChangedAt: now } });
  }
  if (done.length) {
    const values = Prisma.join(done.map(([itemId, enrollmentId]) => Prisma.sql`(${itemId}, ${enrollmentId})`));
    await tx.$executeRaw`
      UPDATE "PromotionItem" AS p SET "status" = 'DONE', "error" = NULL, "processedAt" = ${now}, "attempts" = p."attempts" + 1,
        "resultEnrollmentId" = v.eid, "updatedAt" = ${now}
      FROM (VALUES ${values}) AS v(id, eid) WHERE p."id" = v.id`;
  }
  for (const [message, ids] of failed) {
    await tx.promotionItem.updateMany({ where: { id: { in: ids } }, data: { status: 'FAILED', error: message, processedAt: now, attempts: { increment: 1 } } });
  }
}

/** Applies one confirmed decision inside `tx`. Throws ItemError with a message for the Manager when it cannot. */
async function applyItem(tx, batch, item) {
  const from = await tx.enrollment.findUnique({ where: { id: item.fromEnrollmentId }, include: { student: true } });
  const now = new Date();
  if (from.status !== 'ACTIVE') throw new ItemError(`The ${batch.fromYear.name} enrollment is no longer active (${lower(from.status).replace('_', ' ')}).`);
  if (from.student.status !== 'ENROLLED') throw new ItemError(`The student is ${lower(from.student.status).replace('_', ' ')}.`);

  let resultEnrollmentId = null;
  if (item.decision === 'PROMOTE' || item.decision === 'REPEAT') {
    const target = await tx.section.findFirst({ where: { id: item.targetSectionId, branchId: batch.branchId, academicYearId: batch.toYearId }, include: { class: true } });
    if (!target || target.status !== 'ACTIVE' || target.class.status !== 'ACTIVE') throw new ItemError('The destination section is no longer active.');
    const existing = await tx.enrollment.findUnique({ where: { studentId_academicYearId: { studentId: from.studentId, academicYearId: batch.toYearId } }, include: { section: { include: { class: true } } } });
    if (existing) {
      if (existing.sectionId !== target.id || existing.previousEnrollmentId !== from.id) {
        throw new ItemError(`Already enrolled in ${sectionDisplayName(existing.section.class.name, existing.section.name)} for ${batch.toYear.name}.`);
      }
      resultEnrollmentId = existing.id;
    } else {
      const created = await tx.enrollment.create({
        data: {
          schoolId: batch.schoolId,
          branchId: batch.branchId,
          studentId: from.studentId,
          academicYearId: batch.toYearId,
          sectionId: target.id,
          entry: item.decision === 'PROMOTE' ? 'PROMOTED' : 'REPEATED',
          previousEnrollmentId: from.id,
        },
      });
      resultEnrollmentId = created.id;
    }
    await tx.enrollment.update({ where: { id: from.id }, data: { status: 'COMPLETED', endedAt: now } });
  } else if (item.decision === 'TRANSFER_OUT') {
    await tx.enrollment.update({ where: { id: from.id }, data: { status: 'TRANSFERRED_OUT', endedAt: now } });
    await tx.student.update({ where: { id: from.studentId }, data: { status: 'TRANSFERRED_OUT', statusReason: `Transferred out at the end of ${batch.fromYear.name}`, statusChangedAt: now } });
  } else if (item.decision === 'GRADUATE') {
    await tx.enrollment.update({ where: { id: from.id }, data: { status: 'GRADUATED', endedAt: now } });
    await tx.student.update({ where: { id: from.studentId }, data: { status: 'GRADUATED', statusReason: `Graduated at the end of ${batch.fromYear.name}`, statusChangedAt: now } });
  } else {
    throw new ItemError('A pending decision is not processed.');
  }
  await tx.promotionItem.update({ where: { id: item.id }, data: { status: 'DONE', error: null, processedAt: now, resultEnrollmentId, attempts: { increment: 1 } } });
}

/** Claims up to `limit` waiting items of the batch (skipping ones another call is processing). */
const claim = (tx, batchId, limit, onlyId = null) =>
  onlyId
    ? tx.$queryRaw`SELECT "id" FROM "PromotionItem" WHERE "id" = ${onlyId} AND "batchId" = ${batchId} AND "status" = 'WAITING' FOR UPDATE SKIP LOCKED`
    : tx.$queryRaw`SELECT "id" FROM "PromotionItem" WHERE "batchId" = ${batchId} AND "status" = 'WAITING' ORDER BY "id" LIMIT ${limit} FOR UPDATE SKIP LOCKED`;

async function processChunk(scope, batch, ids) {
  const prisma = getPrisma();
  try {
    // Fast path: the whole chunk in one transaction.
    await prisma.$transaction(
      async (tx) => {
        await lockBranchForStudents(tx, scope, batch.branchId);
        const claimed = await tx.promotionItem.findMany({ where: { id: { in: ids }, status: 'WAITING' } });
        if (claimed.length) await applyChunk(tx, batch, claimed);
      },
      { timeout: 60000 },
    );
  } catch (error) {
    if (error?.code === 'BRANCH_NOT_OPERATING') throw error;
    // One item failed: process them one by one, so only the failing ones are marked FAILED.
    for (const id of ids) {
      try {
        await prisma.$transaction(async (tx) => {
          await lockBranchForStudents(tx, scope, batch.branchId);
          const [row] = await claim(tx, batch.id, 1, id);
          if (!row) return;
          await applyItem(tx, batch, await tx.promotionItem.findUnique({ where: { id } }));
        }, TX);
      } catch (itemError) {
        if (itemError?.code === 'BRANCH_NOT_OPERATING') throw itemError;
        const message = itemError instanceof ItemError ? itemError.message : 'Unexpected error while processing this student. Retry.';
        await prisma.promotionItem.updateMany({ where: { id, status: 'WAITING' }, data: { status: 'FAILED', error: message, attempts: { increment: 1 }, processedAt: new Date() } });
      }
    }
  }
}

/**
 * Processes waiting students in chunks for up to `budgetMs`, then reports progress: { done, remaining }.
 * When nothing is waiting any more, the batch is COMPLETED (failed students stay FAILED and are reported;
 * they can be retried). Safe to call repeatedly and concurrently.
 */
export async function processPromotion(scope, id, user, req, { budgetMs = 20000 } = {}) {
  const prisma = getPrisma();
  const batch = await findBatch(prisma, scope, id);
  if (batch.status === 'DRAFT') throw conflict('NOT_CONFIRMED', 'Confirm the promotion before processing it.');
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const ids = await prisma.$transaction(async (tx) => (await claim(tx, batch.id, CHUNK)).map((r) => r.id), TX);
    if (!ids.length) break;
    await processChunk(scope, batch, ids);
  }
  const remaining = await prisma.promotionItem.count({ where: { batchId: batch.id, status: 'WAITING' } });
  if (!remaining) {
    const finished = await prisma.promotionBatch.updateMany({ where: { id: batch.id, status: 'PROCESSING' }, data: { status: 'COMPLETED', completedAt: new Date() } });
    if (finished.count) {
      const counts = await prisma.promotionItem.groupBy({ by: ['status'], where: { batchId: batch.id }, _count: { _all: true } });
      const n = (st) => counts.find((c) => c.status === st)?._count._all ?? 0;
      await recordAuditEvent({
        action: AUDIT_ACTIONS.PROMOTION_PROCESSED,
        result: n('FAILED') ? 'FAILURE' : 'SUCCESS',
        actor: actorOf(user),
        target: batchTarget(batch),
        schoolId: scope.school.id,
        description: `Promotion from ${batch.fromYear.name} to ${batch.toYear.name} processed: ${n('DONE')} done, ${n('FAILED')} failed, ${n('EXCLUDED')} excluded for review.`,
        change: { fields: [['Done', n('DONE')], ['Failed', n('FAILED')], ['Excluded', n('EXCLUDED')]].map(([field, to]) => ({ field, from: null, to: String(to) })) },
        req,
      });
    }
  }
  return getPromotion(scope, id);
}

/** Puts failed students back in the queue (the batch processes again). */
export async function retryPromotion(scope, id) {
  const prisma = getPrisma();
  const batch = await findBatch(prisma, scope, id);
  if (batch.status === 'DRAFT') throw conflict('NOT_CONFIRMED', 'Confirm the promotion before processing it.');
  await prisma.$transaction(async (tx) => {
    const reset = await tx.promotionItem.updateMany({ where: { batchId: batch.id, status: 'FAILED' }, data: { status: 'WAITING', error: null } });
    if (!reset.count) throw conflict('NOTHING_TO_RETRY', 'No students failed processing.');
    await tx.promotionBatch.update({ where: { id: batch.id }, data: { status: 'PROCESSING', completedAt: null } });
  }, TX);
  return getPromotion(scope, id);
}
