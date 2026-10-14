'use strict';

/**
 * Calculator facade: the only entry point the service layer uses.
 *
 * It wires the three stages of the expression pipeline together and returns the
 * metadata that the history table needs, so callers never touch the tokenizer,
 * the parser or the evaluator directly:
 *
 *   Calculator.calculate('(1+2)*3')
 *     -> { normalizedExpression, value, resultText, usedOperations, usedFunctions }
 */

const { tokenize } = require('./Tokenizer');
const { parse } = require('./Parser');
const { evaluate } = require('./Evaluator');
const { formatResult } = require('./NumberFormatter');
const { normalizeExpression } = require('./Token');
const { AppError, ErrorCode } = require('../utils/errors');

/**
 * Runs the complete pipeline for one expression.
 *
 * @param {string} rawExpression the expression as sent by the client
 * @param {object} [options]
 * @param {boolean} [options.scientific] enable the scientific function whitelist
 * @param {number} [options.ans] previous result, available as `ans` in
 *        scientific mode
 * @returns {{
 *   normalizedExpression: string,
 *   value: number,
 *   resultText: string,
 *   usedOperations: string[],
 *   usedFunctions: string[]
 * }}
 * @throws {AppError} any classified user error (invalid character, syntax,
 *         division by zero, domain error, overflow, ...)
 */
function calculate(rawExpression, options = {}) {
  const scientific = options.scientific === true;

  const tokens = tokenize(rawExpression, { allowScientific: scientific });
  const instructions = parse(tokens, { allowScientific: scientific });
  const evaluation = evaluate(instructions, { ans: options.ans });
  const formatted = formatResult(evaluation.value);

  return {
    normalizedExpression: normalizeExpression(rawExpression),
    value: formatted.value,
    resultText: formatted.text,
    usedOperations: [...evaluation.usedOperations].filter(Boolean),
    usedFunctions: [...evaluation.usedFunctions],
  };
}

/**
 * Returns the operation family that best describes the expression.
 *
 * A value is stored in every history row so that statistics can be grouped by
 * operation without re-parsing stored expressions. Expressions that only use
 * scientific functions are classified as `scientific`, and a plain number is
 * classified as `number`.
 *
 * @param {string[]} usedOperations
 * @param {string[]} usedFunctions
 * @returns {string}
 */
function describeKind(usedOperations, usedFunctions) {
  if (usedOperations.length === 1) {
    return usedOperations[0];
  }
  if (usedOperations.length > 1) {
    return 'compound';
  }
  if (usedFunctions.length > 0) {
    return 'scientific';
  }
  return 'number';
}

/**
 * @param {string} expression
 * @returns {boolean} whether the expression contains at least one operator
 */
function hasOperator(expression) {
  return /[+\-*/%]/.test(expression.replace(/^\s*[-+]/, ''));
}

module.exports = { calculate, describeKind, hasOperator, AppError, ErrorCode };
