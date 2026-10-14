'use strict';

/**
 * Business layer for calculations.
 *
 * The service is the only place that knows the *order* of a successful
 * calculation:
 *
 *   validate input -> parse and evaluate -> persist -> answer
 *
 * A record is written to the database only after the evaluation succeeded, so a
 * failed calculation (invalid syntax, division by zero, ...) never pollutes the
 * history table. This module contains no HTTP knowledge: it throws `AppError`
 * and the controller translates that into a status code and a JSON body.
 */

const { calculate, describeKind } = require('../expression/Calculator');
const { normalizeExpression } = require('../expression/Token');
const { MAX_EXPRESSION_LENGTH } = require('../config/config');
const { AppError, ErrorCode } = require('../utils/errors');
const logger = require('../utils/logger');

/** Request mode values accepted by the API. */
const MODE = Object.freeze({
  BASIC: 'basic',
  SCIENTIFIC: 'scientific',
});

/**
 * Validates the `expression` field of a calculation request.
 *
 * @param {unknown} value
 * @returns {string} the trimmed expression
 * @throws {AppError} VALIDATION_MISSING_FIELD / VALIDATION_INVALID_FIELD_TYPE /
 *                    VALIDATION_EMPTY_EXPRESSION / VALIDATION_EXPRESSION_TOO_LONG
 */
function readExpression(value) {
  if (value === undefined || value === null) {
    throw new AppError(ErrorCode.VALIDATION_MISSING_FIELD, {
      detail: 'The field "expression" is required',
    });
  }
  if (typeof value !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_INVALID_FIELD_TYPE, {
      detail: 'The field "expression" must be a string',
    });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_EMPTY_EXPRESSION);
  }
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    throw new AppError(ErrorCode.VALIDATION_EXPRESSION_TOO_LONG, {
      detail: `At most ${MAX_EXPRESSION_LENGTH} characters are supported`,
    });
  }
  return trimmed;
}

/**
 * Validates the optional `mode` field.
 *
 * @param {unknown} value
 * @returns {'basic'|'scientific'}
 */
function readMode(value) {
  if (value === undefined || value === null || value === '') {
    return MODE.BASIC;
  }
  if (typeof value !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_INVALID_FIELD_TYPE, {
      detail: 'The field "mode" must be a string',
    });
  }
  const mode = value.toLowerCase();
  if (mode !== MODE.BASIC && mode !== MODE.SCIENTIFIC) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_PARAMETER, {
      detail: `The field "mode" must be "${MODE.BASIC}" or "${MODE.SCIENTIFIC}"`,
    });
  }
  return mode;
}

/**
 * Validates the optional `ans` field (the value of `ans` inside a scientific
 * expression).
 *
 * @param {unknown} value
 * @returns {number|undefined}
 */
function readPreviousResult(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_FIELD_TYPE, {
      detail: 'The field "ans" must be a number',
    });
  }
  return parsed;
}

/**
 * Calculates an expression and stores it in the history table.
 *
 * @param {object} payload the validated request body
 * @param {object} deps
 * @param {import('../storage/historyRepository').HistoryRepository} deps.historyRepository
 * @param {boolean} [deps.persist] when false the record is not stored (used by
 *        the seed script and by unit tests)
 * @returns {Promise<object>} the JSON body of a successful calculation
 */
async function calculateAndStore(payload, deps) {
  const expression = readExpression(payload.expression);
  const mode = readMode(payload.mode);
  const ans = readPreviousResult(payload.ans);
  const scientific = mode === MODE.SCIENTIFIC;

  const startedAt = process.hrtime.bigint();
  const outcome = calculate(expression, { scientific, ans });
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  const operation = describeKind(outcome.usedOperations, outcome.usedFunctions);

  let record = null;
  if (deps.persist !== false) {
    record = await deps.historyRepository.insert({
      expression: normalizeExpression(expression),
      result: outcome.value,
      resultText: outcome.resultText,
      operation,
      mode,
    });
  }

  logger.info('Calculation succeeded', {
    expression: outcome.normalizedExpression,
    result: outcome.resultText,
    operation,
    mode,
    durationMs: Number(durationMs.toFixed(3)),
  });

  return {
    success: true,
    expression: outcome.normalizedExpression,
    result: outcome.value,
    resultText: outcome.resultText,
    operation,
    mode,
    durationMs: Number(durationMs.toFixed(3)),
    // Only present when the record was actually written; the front end uses it
    // to refresh the history panel without an extra round trip.
    historyId: record ? record.id : null,
    createdAt: record ? record.createdAt : null,
  };
}

module.exports = {
  MODE,
  calculateAndStore,
  readExpression,
  readMode,
  readPreviousResult,
};
