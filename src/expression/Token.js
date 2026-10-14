'use strict';

/**
 * Token definitions and input normalisation for the expression engine.
 *
 * The tokenizer is the first stage of the pipeline:
 *
 *   raw string -> normalise -> token stream -> parser -> evaluator
 *
 * Only this module knows how user-visible characters map to operators, which
 * keeps the display symbols of the calculator interface (`×`, `÷`, `−`) out of
 * the parser and the evaluator.
 */

const { AppError, ErrorCode } = require('../utils/errors');

/**
 * Token kinds produced by the tokenizer.
 * @readonly
 * @enum {string}
 */
const TokenType = Object.freeze({
  NUMBER: 'NUMBER',
  OPERATOR: 'OPERATOR',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  FUNCTION: 'FUNCTION',
  CONSTANT: 'CONSTANT',
  COMMA: 'COMMA',
  EOF: 'EOF',
});

/**
 * Characters that are accepted as input and the ASCII operator they mean.
 *
 * Users type calculator symbols (`×`, `÷`, `−`) while the API contract uses the
 * programming symbols (`*`, `/`, `-`). Normalising here means every later stage
 * only ever sees ASCII operators.
 */
const CHARACTER_ALIASES = Object.freeze({
  '×': '*',
  '✕': '*',
  '⋅': '*',
  '·': '*',
  '∗': '*',
  '÷': '/',
  '∕': '/',
  '−': '-',
  '–': '-',
  '—': '-',
  '（': '(',
  '）': ')',
  '，': ',',
});

/** Superscript digits are folded to normal ASCII digits ("2²" -> "2^2"). */
const SUPERSCRIPT_DIGITS = Object.freeze({
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
});

/** The `^` operator is rewritten to `**` so the parser handles one power shape. */
const MAX_EXPONENT_LENGTH = 2;

/**
 * Human readable operation family of every operator.
 *
 * The value is stored in `calculation_history.operation`, which is what makes
 * the statistics endpoint (`GET /api/stats`) possible without re-parsing the
 * stored expressions.
 * @readonly
 * @enum {string}
 */
const OPERATION_FAMILY = Object.freeze({
  ADDITION: 'addition',
  SUBTRACTION: 'subtraction',
  MULTIPLICATION: 'multiplication',
  DIVISION: 'division',
  MODULO: 'modulo',
  POWER: 'power',
});

/** Maps an operator symbol to its operation family. */
const OPERATOR_FAMILIES = Object.freeze({
  '+': OPERATION_FAMILY.ADDITION,
  '-': OPERATION_FAMILY.SUBTRACTION,
  '*': OPERATION_FAMILY.MULTIPLICATION,
  '/': OPERATION_FAMILY.DIVISION,
  '%': OPERATION_FAMILY.MODULO,
  '**': OPERATION_FAMILY.POWER,
});

/**
 * @param {string} operator
 * @returns {string|undefined} the operation family of an operator
 */
function familyOfOperator(operator) {
  return OPERATOR_FAMILIES[operator];
}

/**
 * Normalises a raw user expression.
 *
 * Steps: strip every kind of whitespace, fold full-width characters to ASCII,
 * translate calculator symbols to API symbols, rewrite `²`/`³`/`^` to `**`.
 *
 * @param {string} raw
 * @returns {string} the normalised expression
 */
function normalizeExpression(raw) {
  if (typeof raw !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_INVALID_FIELD_TYPE, {
      detail: 'The field "expression" must be a string',
    });
  }

  let text = '';
  for (const char of raw) {
    // \s covers ASCII spaces; the explicit list adds the wide spaces that a
    // mobile keyboard or a copied formula may contain.
    if (/\s/.test(char) || char === '\u3000' || char === '\u00a0') {
      continue;
    }
    const alias = CHARACTER_ALIASES[char];
    text += alias === undefined ? char : alias;
  }

  // Fold superscript digits: x² -> x**2, x²³ -> x**23
  let folded = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const digit = SUPERSCRIPT_DIGITS[char];
    if (digit === undefined) {
      folded += char;
      continue;
    }
    let exponent = digit;
    while (
      index + 1 < text.length &&
      SUPERSCRIPT_DIGITS[text[index + 1]] !== undefined &&
      exponent.length < MAX_EXPONENT_LENGTH
    ) {
      index += 1;
      exponent += SUPERSCRIPT_DIGITS[text[index]];
    }
    folded += `**${exponent}`;
  }

  return folded.replace(/\^/g, '**');
}

/** @param {string} char @returns {boolean} true for 0-9 */
function isDigit(char) {
  return char >= '0' && char <= '9';
}

/**
 * @param {string} char
 * @returns {boolean} true for a-z, A-Z and `_`
 */
function isIdentifierStart(char) {
  return /[A-Za-z_]/.test(char);
}

/**
 * @param {string} char
 * @returns {boolean} true for a-z, A-Z, 0-9 and `_`
 */
function isIdentifierPart(char) {
  return /[A-Za-z0-9_]/.test(char);
}

module.exports = {
  TokenType,
  CHARACTER_ALIASES,
  OPERATION_FAMILY,
  familyOfOperator,
  normalizeExpression,
  isDigit,
  isIdentifierStart,
  isIdentifierPart,
};
