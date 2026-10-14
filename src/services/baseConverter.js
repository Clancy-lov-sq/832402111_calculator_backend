'use strict';

/**
 * Number base conversion.
 *
 * Supported bases: 2 (binary), 8 (octal), 10 (decimal), 16 (hexadecimal) and
 * 36 (0-9 plus a-z). Conversion uses `BigInt` for the integer part so that
 * values beyond Number.MAX_SAFE_INTEGER keep every digit, and a separate
 * fractional part so `10.5` in base 10 becomes `1010.1` in base 2.
 *
 * This module is a documented extended feature: it is *not* part of the four
 * required functions, and it never touches the expression engine.
 */

const { AppError, ErrorCode } = require('../utils/errors');

/** Digit characters used by the base-36 representation. */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

const SUPPORTED_BASES = Object.freeze([2, 8, 10, 16, 36]);

/** How many fractional digits are produced before the value is truncated. */
const MAX_FRACTION_DIGITS = 16;

/**
 * @param {number} base
 * @returns {boolean}
 */
function isSupportedBase(base) {
  return SUPPORTED_BASES.includes(base);
}

/**
 * Converts a number into another base.
 *
 * @param {number} value the decimal value to convert
 * @param {number} base  target base (2, 8, 10, 16 or 36)
 * @param {object} [options]
 * @param {number} [options.fractionDigits] digits kept after the point
 * @returns {{value: number, base: number, result: string, fractionDigits: number}}
 * @throws {AppError} VALIDATION_INVALID_BASE / VALIDATION_INVALID_FIELD_TYPE
 */
function fromDecimal(value, base, options = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_FIELD_TYPE, {
      detail: 'The field "value" must be a finite number',
    });
  }
  if (!isSupportedBase(base)) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_BASE, {
      detail: `Supported bases are ${SUPPORTED_BASES.join(', ')}`,
    });
  }

  const fractionDigits =
    Number.isInteger(options.fractionDigits) && options.fractionDigits >= 0
      ? Math.min(options.fractionDigits, MAX_FRACTION_DIGITS)
      : 8;

  const negative = value < 0;
  const absolute = Math.abs(value);

  // The integer part is converted with BigInt so no precision is lost for
  // large values; the fractional part is converted by repeated multiplication,
  // which is the standard positional-conversion algorithm.
  const integerPart = BigInt(Math.trunc(absolute));
  let result = integerPart.toString(base);

  let fraction = absolute - Math.trunc(absolute);
  if (fraction > 0 && base !== 10) {
    let fractionText = '';
    for (let index = 0; index < fractionDigits && fraction > 0; index += 1) {
      fraction *= base;
      const digit = Math.floor(fraction);
      fractionText += DIGITS[digit];
      fraction -= digit;
    }
    if (fractionText.length > 0) {
      result += `.${fractionText}`;
    }
  } else if (fraction > 0 && base === 10) {
    // Base 10 keeps the exact JavaScript representation of the fraction.
    result = String(absolute);
  }

  return {
    value: negative ? -absolute : absolute,
    base,
    result: negative ? `-${result}` : result,
    fractionDigits,
  };
}

/**
 * Converts a string written in `base` into a decimal number.
 *
 * @param {string} text e.g. "ff.8"
 * @param {number} base source base
 * @returns {{value: number, base: number, result: string}}
 * @throws {AppError} TOKENIZER_INVALID_NUMBER when a digit is not valid for the base
 */
function toDecimal(text, base) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new AppError(ErrorCode.TOKENIZER_INVALID_NUMBER, {
      detail: 'The field "value" must be a non-empty string',
    });
  }
  if (!isSupportedBase(base)) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_BASE, {
      detail: `Supported bases are ${SUPPORTED_BASES.join(', ')}`,
    });
  }

  const normalized = text.trim().toLowerCase();
  const negative = normalized.startsWith('-');
  const body = negative ? normalized.slice(1) : normalized;
  const [integerText = '', fractionText = ''] = body.split('.');

  if (body.split('.').length > 2 || (integerText === '' && fractionText === '')) {
    throw new AppError(ErrorCode.TOKENIZER_INVALID_NUMBER, {
      detail: `"${text}" is not a valid base-${base} number`,
    });
  }

  const assertDigits = (part) => {
    for (const char of part) {
      const digit = DIGITS.indexOf(char);
      if (digit === -1 || digit >= base) {
        throw new AppError(ErrorCode.TOKENIZER_INVALID_NUMBER, {
          detail: `"${char}" is not a valid digit in base ${base}`,
        });
      }
    }
  };
  assertDigits(integerText);
  assertDigits(fractionText);

  const integerValue = integerText === '' ? 0n : BigInt(parseInt(integerText, base));
  if (Number(integerValue) > Number.MAX_SAFE_INTEGER) {
    throw new AppError(ErrorCode.EVALUATOR_OVERFLOW, {
      detail: 'The integer part is larger than Number.MAX_SAFE_INTEGER',
    });
  }

  let value = Number(integerValue);

  // Fractional digits: digit * base^-(index+1)
  for (let index = 0; index < fractionText.length; index += 1) {
    value += DIGITS.indexOf(fractionText[index]) * base ** -(index + 1);
  }

  return {
    value: negative ? -value : value,
    base,
    result: String(negative ? -value : value),
  };
}

module.exports = { SUPPORTED_BASES, fromDecimal, toDecimal, isSupportedBase };
