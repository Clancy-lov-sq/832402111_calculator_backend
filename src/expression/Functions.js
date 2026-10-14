'use strict';

/**
 * Whitelist of scientific functions and constants.
 *
 * A whitelist (instead of a dynamic lookup such as `Math[name]`) is a security
 * requirement: only the names listed here can ever be reached from a user
 * expression, so `constructor`, `__proto__` or any other property of an object
 * can never be invoked.
 *
 * Every function receives already evaluated numeric arguments and validates its
 * own domain, throwing EVALUATOR_DOMAIN_ERROR for invalid input (`sqrt(-1)`,
 * `log(0)`, `asin(2)`, ...). The evaluator turns that into HTTP 400.
 */

const { AppError, ErrorCode } = require('../utils/errors');

/** @param {string} name @param {number} argument */
function domainError(name, argument, reason) {
  return new AppError(ErrorCode.EVALUATOR_DOMAIN_ERROR, {
    detail: `${name}(${argument}) is undefined: ${reason}`,
  });
}

/**
 * Throws unless the argument is a finite number.
 * @param {string} name
 * @param {number[]} args
 */
function requireFiniteArguments(name, args) {
  args.forEach((argument) => {
    if (typeof argument !== 'number' || Number.isNaN(argument)) {
      throw new AppError(ErrorCode.EVALUATOR_NOT_A_NUMBER, {
        detail: `${name} received an argument that is not a number`,
      });
    }
  });
}

/**
 * Function definitions.
 *
 * `argCount` is the exact number of arguments the parser must find; a mismatch
 * is reported as PARSER_INVALID_FUNCTION_CALL.
 */
const FUNCTIONS = Object.freeze({
  // --- trigonometry (radians) ---------------------------------------------
  sin: { argCount: 1, fn: (x) => Math.sin(x) },
  cos: { argCount: 1, fn: (x) => Math.cos(x) },
  tan: {
    argCount: 1,
    fn: (x) => {
      // cos(x) === 0 -> tan is undefined; |x| is compared with a small epsilon
      // so that tan(pi/2) is reported as a domain error instead of returning a
      // meaningless 1.6e16.
      if (Math.abs(Math.cos(x)) < 1e-15) {
        throw domainError('tan', x, 'the tangent is undefined at this angle');
      }
      return Math.tan(x);
    },
  },
  asin: {
    argCount: 1,
    fn: (x) => {
      if (x < -1 || x > 1) {
        throw domainError('asin', x, 'the argument must be between -1 and 1');
      }
      return Math.asin(x);
    },
  },
  acos: {
    argCount: 1,
    fn: (x) => {
      if (x < -1 || x > 1) {
        throw domainError('acos', x, 'the argument must be between -1 and 1');
      }
      return Math.acos(x);
    },
  },
  atan: { argCount: 1, fn: (x) => Math.atan(x) },
  sinh: { argCount: 1, fn: (x) => Math.sinh(x) },
  cosh: { argCount: 1, fn: (x) => Math.cosh(x) },
  tanh: { argCount: 1, fn: (x) => Math.tanh(x) },

  // --- logarithms and roots ----------------------------------------------
  sqrt: {
    argCount: 1,
    fn: (x) => {
      if (x < 0) {
        throw domainError('sqrt', x, 'the argument must not be negative');
      }
      return Math.sqrt(x);
    },
  },
  cbrt: { argCount: 1, fn: (x) => Math.cbrt(x) },
  log: {
    argCount: 1,
    fn: (x) => {
      if (x <= 0) {
        throw domainError('log', x, 'the argument must be greater than 0');
      }
      return Math.log10(x);
    },
  },
  ln: {
    argCount: 1,
    fn: (x) => {
      if (x <= 0) {
        throw domainError('ln', x, 'the argument must be greater than 0');
      }
      return Math.log(x);
    },
  },
  log10: {
    argCount: 1,
    fn: (x) => {
      if (x <= 0) {
        throw domainError('log10', x, 'the argument must be greater than 0');
      }
      return Math.log10(x);
    },
  },
  log2: {
    argCount: 1,
    fn: (x) => {
      if (x <= 0) {
        throw domainError('log2', x, 'the argument must be greater than 0');
      }
      return Math.log2(x);
    },
  },
  exp: { argCount: 1, fn: (x) => Math.exp(x) },

  // --- helpers ------------------------------------------------------------
  abs: { argCount: 1, fn: (x) => Math.abs(x) },
  round: { argCount: 1, fn: (x) => Math.round(x) },
  floor: { argCount: 1, fn: (x) => Math.floor(x) },
  ceil: { argCount: 1, fn: (x) => Math.ceil(x) },
  sign: { argCount: 1, fn: (x) => Math.sign(x) },
  pow: {
    argCount: 2,
    fn: (base, exponent) => {
      requireFiniteArguments('pow', [base, exponent]);
      // A negative base with a fractional exponent has no real result.
      if (base < 0 && !Number.isInteger(exponent)) {
        throw domainError('pow', base, 'a negative base requires an integer exponent');
      }
      return base ** exponent;
    },
  },
  min: { argCount: 2, fn: (a, b) => Math.min(a, b) },
  max: { argCount: 2, fn: (a, b) => Math.max(a, b) },
  mod: { argCount: 2, fn: (a, b) => a % b },
  hypot: { argCount: 2, fn: (a, b) => Math.hypot(a, b) },
});

/**
 * Named constants available in scientific mode.
 *
 * `ans` is resolved by the service layer before evaluation, so it is listed
 * here only to document that the parser accepts it as a constant token.
 */
const CONSTANTS = Object.freeze({
  pi: Math.PI,
  'π': Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
  /**
   * `ans` is not a mathematical constant: the evaluator resolves it from the
   * request context (the previous result). It is listed here so that the
   * tokenizer accepts it as a constant token, and the parser rejects it when
   * scientific mode is not requested.
   */
  ans: Number.NaN,
});

/**
 * @param {string} name
 * @returns {boolean} true when `name` is a supported function
 */
function isKnownFunction(name) {
  return Object.prototype.hasOwnProperty.call(FUNCTIONS, name);
}

/**
 * @param {string} name
 * @returns {boolean} true when `name` is a supported constant
 */
function isKnownConstant(name) {
  return Object.prototype.hasOwnProperty.call(CONSTANTS, name);
}

/**
 * @param {string} name
 * @returns {{argCount: number, fn: Function}|undefined}
 */
function getFunction(name) {
  return isKnownFunction(name) ? FUNCTIONS[name] : undefined;
}

/**
 * @param {string} name
 * @returns {number|undefined}
 */
function getConstant(name) {
  return isKnownConstant(name) ? CONSTANTS[name] : undefined;
}

module.exports = {
  FUNCTIONS,
  CONSTANTS,
  isKnownFunction,
  isKnownConstant,
  getFunction,
  getConstant,
};
