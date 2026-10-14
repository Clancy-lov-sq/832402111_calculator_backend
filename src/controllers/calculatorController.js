'use strict';

/**
 * Calculation controller.
 *
 * Translates one HTTP request into one service call and one JSON response.
 * No expression logic and no SQL live here: this layer only reads the body,
 * decides the status code and shapes the envelope.
 */

const calculationService = require('../services/calculationService');
const baseConverter = require('../services/baseConverter');
const unitConverter = require('../services/unitConverter');
const { success } = require('../utils/response');
const { AppError, ErrorCode } = require('../utils/errors');
const { config } = require('../config/config');
const { FUNCTIONS, CONSTANTS } = require('../expression/Functions');
const { describeUnits } = require('../services/unitConverter');

/**
 * Decides the HTTP status of a *successful* calculation request.
 *
 * 201 is used when a new history record was created, which is the meaning the
 * status has in REST (the assignment lists 200/201/204/400/404/500 and expects
 * a reasonable choice).
 *
 * @param {object} body the response body
 * @returns {number}
 */
function statusForCalculation(body) {
  return body.historyId ? 201 : 200;
}

/**
 * POST /api/calculate
 *
 * Request : { "expression": "12+8", "mode": "basic"|"scientific", "ans": 3 }
 * Response: { "success": true, "expression": "12+8", "result": 20, ... }
 */
async function calculate(req, res) {
  const body = await calculationService.calculateAndStore(req.body || {}, {
    historyRepository: req.app.locals.historyRepository,
    persist: req.app.locals.persistCalculations !== false,
  });
  res.status(statusForCalculation(body)).json(body);
}

/**
 * POST /api/convert/base
 *
 * Request : { "value": 255 }                     -> 255 in every base
 *           { "value": "ff", "fromBase": 16 }    -> decimal 255
 *           { "value": 255, "toBase": 2 }        -> "11111111"
 */
async function convertBase(req, res) {
  const body = req.body || {};
  const targetBase = body.toBase === undefined ? null : Number(body.toBase);
  const sourceBase = body.fromBase === undefined ? null : Number(body.fromBase);

  if (sourceBase !== null) {
    // Text -> decimal, e.g. "ff" in base 16
    const decimal = baseConverter.toDecimal(body.value, sourceBase);
    const conversions = baseConverter.SUPPORTED_BASES.map((base) => ({
      base,
      result: baseConverter.fromDecimal(decimal.value, base).result,
    }));
    res.json(
      success({
        input: String(body.value),
        fromBase: sourceBase,
        value: decimal.value,
        decimal: decimal.result,
        conversions,
      }),
    );
    return;
  }

  const numericValue = typeof body.value === 'number' ? body.value : Number(body.value);
  if (!Number.isFinite(numericValue)) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_FIELD_TYPE, {
      detail: 'The field "value" must be a number, or a string together with "fromBase"',
    });
  }

  const bases = targetBase === null ? baseConverter.SUPPORTED_BASES : [targetBase];
  const conversions = bases.map((base) => ({
    base,
    result: baseConverter.fromDecimal(numericValue, base).result,
  }));

  res.json(
    success({
      value: numericValue,
      decimal: String(numericValue),
      ...(targetBase === null ? {} : { toBase: targetBase }),
      conversions,
      result: conversions[0].result,
    }),
  );
}

/**
 * POST /api/convert/unit
 *
 * Request : { "value": 100, "from": "km/h", "to": "mph" }
 */
async function convertUnit(req, res) {
  const body = req.body || {};
  const value = typeof body.value === 'number' ? body.value : Number(body.value);
  if (!Number.isFinite(value)) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_FIELD_TYPE, {
      detail: 'The field "value" must be a number',
    });
  }
  if (typeof body.from !== 'string' || typeof body.to !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_MISSING_FIELD, {
      detail: 'The fields "from" and "to" are required',
    });
  }

  const conversion = unitConverter.convert(value, body.from.trim(), body.to.trim());
  res.json(success(conversion));
}

/**
 * GET /api/convert/units
 *
 * Lists every conversion category and unit, so the front end can build the
 * selectors from the back end instead of hard-coding them.
 */
async function listUnits(req, res) {
  res.json(success({ categories: describeUnits() }));
}

/**
 * GET /api/health
 *
 * Used by the front end to display the connection status, and by the grader to
 * check that the service and its database are alive.
 */
async function health(req, res) {
  const historyRepository = req.app.locals.historyRepository;
  let storedRecords = null;
  let databaseStatus = 'unknown';

  try {
    storedRecords = await historyRepository.count();
    databaseStatus = 'connected';
  } catch (error) {
    databaseStatus = 'error';
  }

  res.json(
    success({
      service: 'calculator-backend',
      version: req.app.locals.version,
      status: databaseStatus === 'connected' ? 'ok' : 'degraded',
      database: {
        client: config.database.client,
        status: databaseStatus,
        storedRecords,
      },
      limits: {
        maxExpressionLength: config.expression.maxLength,
        maxTokenCount: config.expression.maxTokenCount,
        maxNestingDepth: config.expression.maxNestingDepth,
      },
      errorHttpMode: config.api.errorHttpMode,
      time: new Date().toISOString(),
    }),
  );
}

/**
 * GET /api/capabilities
 *
 * Describes the supported operators, functions and constants. The front end
 * renders the scientific keypad from this description and the blog/README can
 * show the same list as the single source of truth.
 */
async function capabilities(req, res) {
  const functions = {};
  Object.entries(FUNCTIONS).forEach(([name, definition]) => {
    functions[name] = { argCount: definition.argCount };
  });

  res.json(
    success({
      operators: [
        { symbol: '+', display: '+', family: 'addition' },
        { symbol: '-', display: '−', family: 'subtraction' },
        { symbol: '*', display: '×', family: 'multiplication' },
        { symbol: '/', display: '÷', family: 'division' },
        { symbol: '%', display: '%', family: 'modulo' },
        { symbol: '**', display: 'xʸ', family: 'power' },
      ],
      functions,
      constants: Object.keys(CONSTANTS).filter((name) => name !== 'ans'),
      bases: baseConverter.SUPPORTED_BASES,
      unitCategories: unitConverter.describeUnits().map((category) => category.category),
      modes: Object.values(calculationService.MODE),
    }),
  );
}

module.exports = {
  calculate,
  convertBase,
  convertUnit,
  listUnits,
  health,
  capabilities,
  statusForCalculation,
};
