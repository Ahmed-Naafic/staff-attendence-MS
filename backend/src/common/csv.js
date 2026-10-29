/*
 * CSV writing (RFC 4180) with spreadsheet formula-injection protection.
 *
 * Strategy, applied to every text cell (numbers are written as numbers; empty values as empty cells):
 *  1. Neutralize: a text value that a spreadsheet could read as a formula gets a leading apostrophe
 *     ('), the widely used OWASP mitigation; the spreadsheet then shows it as text. That is a value
 *     whose first character is a tab, carriage return or line feed, or whose first character after
 *     any leading whitespace is =, +, -, @ or their full-width forms (＝ ＋ － ＠).
 *  2. Quote: a value containing a comma, a double quote, a carriage return or a line feed, or with
 *     leading or trailing whitespace, is wrapped in double quotes, and each double quote inside is
 *     doubled.
 * Lines end with CRLF. Files start with a UTF-8 byte-order mark so spreadsheet programs read
 * non-ASCII names correctly.
 */

export const CSV_BOM = '﻿';
const FORMULA = /^(?:[\t\r\n]|\s*[=+\-@＝＋－＠])/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/** The value with a leading apostrophe when a spreadsheet could read it as a formula. */
export const neutralize = (text) => (FORMULA.test(text) ? `'${text}` : text);

/** One CSV cell: null/undefined → empty; numbers as they are; text neutralized, then quoted when needed. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = neutralize(String(value));
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV line (CRLF-terminated) from a list of values. */
export const csvLine = (values) => `${values.map(csvCell).join(',')}\r\n`;
