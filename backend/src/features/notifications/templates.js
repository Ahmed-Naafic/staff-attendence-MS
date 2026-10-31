import { DEFAULT_LANGUAGE } from './notificationTypes.js';

/*
 * Notification texts (N24: Somali is the only approved language). A notification stores its type,
 * its language and template values (params); the title and body are rendered here when it is read,
 * so a wording fix applies to history and nothing beyond the params can leak into a text.
 *
 * Adding a language later means adding a table below with every type; render() never falls back to
 * another language (a missing template is an error, not English text). Texts use the approved
 * Somali attendance labels (Xadirey, Daahay) and a "label: value" style for facts.
 */

const SO_DAYS = { MON: 'Isniin', TUE: 'Talaado', WED: 'Arbaco', THU: 'Khamiis', FRI: 'Jimce', SAT: 'Sabti', SUN: 'Axad' };
const soDays = (days = []) => days.map((d) => SO_DAYS[d] ?? d).join(', ');
const shiftLine = (s) => `${s.name} (${soDays(s.days)}) ${s.start}–${s.end}`;
const zone = (tz) => (tz ? ` (${tz})` : '');
const branchLabel = (b) => (b ? `${b.name}${b.code ? ` (${b.code})` : ''}` : '');

/** Daily digest lines (counts only, D19; no absence, D20). */
function digestLines(day, previous) {
  const lines = [
    `Imaansho: ${day.checkIns} · Xadirey: ${day.present} · Daahay: ${day.late}`,
    `Shaqaalaha yimid: ${day.staff}`,
    `Bixitaan la diiwaangeliyay: ${day.checkedOut} · Weli lama bixin: ${day.open} · Bixitaan looma baahna: ${day.notRequired}`,
  ];
  if (previous) {
    lines.push(`${previous.date} (tirada kama dambaysta ah): Imaansho ${previous.checkIns} · Daahay ${previous.late} · Bixitaan la'aan ${previous.missing}`);
  }
  lines.push('Maqnaanshaha lama xisaabin.');
  return lines;
}

const transferShiftLines = (shifts) => (shifts?.length ? ['Wareegyadaada laanta cusub:', ...shifts.map(shiftLine)] : ['Wareeg shaqo weli laguuma qoondeyn laanta cusub.']);

const SO = {
  STAFF_TRANSFERRED: (p) => ({
    title: 'Waxaa laguu wareejiyay laan kale',
    body: [
      `Laga bilaabo ${p.effectiveFrom}, laantaadu waa ${branchLabel(p.toBranch)}. Laantii hore: ${branchLabel(p.fromBranch)}.`,
      ...transferShiftLines(p.shifts),
      'Imaanshahaagii hore wuxuu ku jiraa laantii hore; waxba lagama beddelin.',
    ].join('\n'),
  }),
  STAFF_TRANSFER_IN: (p) => ({
    title: 'Shaqaale cusub ayaa laantaada ku soo biiraya',
    body: [`Shaqaale: ${p.staffName} (${p.staffCode})`, `Laga bilaabo: ${p.effectiveFrom}`, `Laanta: ${branchLabel(p.toBranch)}`].join('\n'),
  }),
  STAFF_TRANSFER_CANCELLED: (p) => ({
    title: 'Wareejinta waa la baajiyay',
    body:
      p.audience === 'staff'
        ? `Wareejintii laanta ${branchLabel(p.toBranch)} ee ${p.effectiveFrom} waa la baajiyay. Waxaad sii joogaysaa laantaada hadda.`
        : `Wareejintii ${p.staffName} (${p.staffCode}) ee laantaada, ${p.effectiveFrom}, waa la baajiyay.`,
  }),
  LATE_CHECK_IN: (p) => ({
    title: 'Imaansho daahay',
    body: [
      `Shaqaale: ${p.staffName} (${p.staffCode})`,
      `Wareegga shaqada: ${p.shiftName}, bilowga ${p.shiftStart}`,
      `Imaanshaha: ${p.date} ${p.time}${zone(p.timeZone)}`,
      'Xaaladda: Daahay',
    ].join('\n'),
  }),
  MISSING_CHECK_OUT: (p) => ({
    title: 'Bixitaan lama diiwaangelin',
    body: [
      `Taariikhda: ${p.date}`,
      `Wareegga shaqada: ${p.shiftName} (${p.shiftStart}–${p.shiftEnd})`,
      `Imaanshaha: ${p.checkInTime}${zone(p.timeZone)}`,
      'Bixitaan lama helin 24 saac kadib dhammaadka maalinta shaqada. Waqti dhammaad lama qiyaasin, saacadaha shaqadana lama xisaabin.',
    ].join('\n'),
  }),
  ASSIGNMENT_CHANGED: (p) => ({
    title: 'Wareegyadaada shaqada waa la beddelay',
    body: [`Laga bilaabo ${p.effectiveFrom}:`, ...(p.shifts?.length ? p.shifts.map(shiftLine) : ['Wareeg shaqo laguuma qoondeyn.'])].join('\n'),
  }),
  ASSIGNMENT_CANCELLED: (p) => ({
    title: 'Isbeddelka wareegyadaada waa la baajiyay',
    body: `Isbeddelkii loo qorsheeyay ${p.effectiveFrom} waa la baajiyay. Wareegyadaada hadda jira ayaa sii socda.`,
  }),
  SCHEDULE_CHANGED: (p) => ({
    title: 'Jadwalka laanta waa isbeddelay',
    body: [
      `Laga bilaabo ${p.effectiveFrom}, jadwalka laanta ${p.branchName} wuxuu beddelayaa wareegyadaada:`,
      ...(p.shifts ?? []).map((s) => (s.removed ? `${s.name}: jadwalka kama jiro` : shiftLine(s))),
      ...(p.checkOutChanged ? [p.checkOutEnabled ? 'Bixitaanka waa la diiwaangelin doonaa.' : 'Bixitaan looma baahna.'] : []),
    ].join('\n'),
  }),
  SCHEDULE_CHANGE_CANCELLED: (p) => ({
    title: 'Isbeddelka jadwalka waa la baajiyay',
    body: `Isbeddelkii jadwalka laanta ${p.branchName} ee ${p.effectiveFrom} waa la baajiyay. Wareegyadaada hadda jira ayaa sii socda.`,
  }),
  BRANCH_NO_SCHEDULE: (p) => ({
    title: 'Laantu jadwal ma leh',
    body: `Laanta ${branchLabel(p.branch)} ma laha jadwal shaqeynaya ${p.date}. Shaqaaluhu ma diiwaangelin karaan imaansho ilaa jadwal la dejiyo.`,
  }),
  MANAGER_TRANSFERRED: (p) => ({
    title: 'Waxaa laguu wareejiyay laan kale',
    body: `Hadda waxaad maamushaa laanta ${branchLabel(p.toBranch)}. Laantii hore: ${branchLabel(p.fromBranch)}. Ogeysiisyada laantii hore lagama heli karo.`,
  }),
  BRANCH_SUSPENDED: (p) => ({
    title: 'Laanta waa la hakiyay',
    body: `Laanta ${branchLabel(p.branch)} waa la hakiyay. Imaansho cusub lama diiwaangelin karo inta hakintu socoto.`,
  }),
  BRANCH_REACTIVATED: (p) => ({
    title: 'Laanta dib ayaa loo hawlgeliyay',
    body: `Laanta ${branchLabel(p.branch)} dib ayaa loo hawlgeliyay. Imaanshaha waa la diiwaangelin karaa mar kale.`,
  }),
  SCHOOL_SUSPENDED: (p) => ({
    title: 'Dugsiga waa la hakiyay',
    // The reason is stored only in the Owner's notification (N11).
    body: [`Dugsiga ${p.schoolName} waa la hakiyay. Imaansho cusub lama diiwaangelin karo inta hakintu socoto.`, ...(p.reason ? [`Sababta: ${p.reason}`] : [])].join('\n'),
  }),
  SCHOOL_REACTIVATED: (p) => ({
    title: 'Dugsiga dib ayaa loo hawlgeliyay',
    body: `Dugsiga ${p.schoolName} dib ayaa loo hawlgeliyay.`,
  }),
  BRANCH_NO_MANAGER: (p) => ({
    title: 'Laantu maamule firfircoon ma leh',
    body: `Laanta ${branchLabel(p.branch)} hadda ma laha maamule firfircoon. Ogeysiisyada imaanshaha ee laantan cidna ma gaarayaan ilaa maamule loo qoondeeyo.`,
  }),
  BRANCH_DIGEST: (p) => ({
    title: `Warbixinta imaanshaha ee ${p.date}`,
    body: [`Laanta: ${branchLabel(p.branch)}`, ...digestLines(p.day, p.previous)].join('\n'),
  }),
  SCHOOL_DIGEST: (p) => ({
    title: `Warbixinta imaanshaha dugsiga ee ${p.date}`,
    body: [`Dugsiga: ${p.schoolName} · Laamaha: ${p.branches?.length ?? 0}`, ...digestLines(p.day, p.previous)].join('\n'),
  }),
};

const TEMPLATES = { so: SO };

/** Generic push texts (N21): never a name, time, status, branch or reason on the lock screen. */
export const PUSH_TEXTS = {
  so: {
    title: 'EduTrack',
    attendance: 'Waxaad leedahay ogeysiis cusub oo imaanshaha ah.',
    announcement: 'Waxaad leedahay ogeysiis cusub oo EduTrack ah.',
  },
};

/** { title, body } of a notification. Throws for an unknown type or language (no fallback language). */
export function render(type, params, language = DEFAULT_LANGUAGE) {
  const table = TEMPLATES[language];
  if (!table) throw new Error(`No notification templates for language "${language}".`);
  const template = table[type];
  if (!template) throw new Error(`No "${language}" template for notification type "${type}".`);
  return template(params ?? {});
}

export const templateTypes = (language = DEFAULT_LANGUAGE) => Object.keys(TEMPLATES[language] ?? {});
