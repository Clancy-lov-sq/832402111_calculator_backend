'use strict';

/**
 * Number formatting helpers.
 *
 * The evaluator works with IEEE-754 doubles, so mathematically identical
 * calculations can produce values such as 0.30000000000000004. The API returns
 * both a machine readable number (`result`) and the exact string the user sees
 * (`resultText`) so the front end never has to re-implement the rounding rules.
 */

/** Digits kept when a value is rounded for display. */
const SIGNIFICANT_DIGITS = 12;

/**
 * Rounds a value to {@link SIGNIFICANT_DIGITS} significant digits.
 *
 * `Number(value.toPrecision(12))` removes the representation noise of binary
 * floating point while keeping full accuracy for ordinary calculations:
 *   0.1 + 0.2            -> 0.30000000000000004 -> 0.3
 *   1 / 3                -> 0.3333333333333333  -> 0.333333333333
 *   2 ** 0.5             -> 1.4142135623730951  -> 1.41421356237
 *
 * @param {number} value
 * @returns {number}
 */
function roundResult(value) {
  if (!Number.isFinite(value)) {
    return value;
  }
  const rounded = Number(value.toPrecision(SIGNIFICANT_DIGITS));
  // `-0` is mathematically the same as `0` but confusing in an API response.
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Converts a number into the display string used by the front end.
 *
 * @param {number} value
 * @returns {string}
 */
function toDisplayString(value) {
  if (Number.isInteger(value) && Math.abs(value) < 1e21) {
    return String(value);
  }
  return String(value);
}

/**
 * Converts a computed result into the value/string pair stored in the database
 * and returned by the API.
 *
 * @param {number} rawValue the value produced by the evaluator
 * @returns {{value: number, text: string}}
 */
function formatResult(rawValue) {
  const value = roundResult(rawValue);
  return { value, text: toDisplayString(value) };
}

module.exports = { SIGNIFICANT_DIGITS, roundResult, toDisplayString, formatResult };
