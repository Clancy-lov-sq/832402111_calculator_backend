'use strict';

/**
 * Tokenizer: turns a normalised expression string into a token stream.
 *
 * The tokenizer performs *lexical* validation only:
 *   - which characters are allowed,
 *   - whether a number literal is well formed,
 *   - whether an identifier is a known function or constant.
 *
 * Grammar and semantics (operator precedence, unary signs, parenthesis
 * matching, division by zero, ...) belong to the parser and the evaluator.
 * Keeping the three stages apart makes every error message point at exactly one
 * layer, which is what the assignment asks for.
 *
 * The tokenizer never calls `eval`, `exec`, `new Function` or any other
 * mechanism that executes user input as program code.
 */

const { AppError, ErrorCode } = require('../utils/errors');
const {
  TokenType,
  normalizeExpression,
  isDigit,
  isIdentifierStart,
  isIdentifierPart,
} = require('./Token');
const { isKnownFunction, isKnownConstant } = require('./Functions');
const { MAX_TOKEN_COUNT, MAX_EXPRESSION_LENGTH } = require('../config/config');

/** Two-character operators must be tested before single-character ones. */
const TWO_CHAR_OPERATORS = Object.freeze(['**']);
const ONE_CHAR_OPERATORS = Object.freeze(['+', '-', '*', '/', '%']);

/**
 * Turns the raw request string into tokens.
 *
 * @param {string} rawExpression the expression exactly as the user typed it
 * @param {object} [options]
 * @param {boolean} [options.allowScientific] when false (the default for the
 *        basic calculator tab) function names and named constants are rejected,
 *        so the basic tab cannot silently use the scientific engine.
 * @returns {Array<{type: string, value: string|number, text: string, position: number}>}
 *          the token stream, always terminated by an EOF token
 * @throws {AppError} VALIDATION_EMPTY_EXPRESSION, VALIDATION_EXPRESSION_TOO_LONG,
 *                    TOKENIZER_INVALID_CHARACTER, TOKENIZER_INVALID_NUMBER,
 *                    TOKENIZER_TOO_MANY_TOKENS
 */
function tokenize(rawExpression, options = {}) {
  const expression = normalizeExpression(rawExpression);

  if (expression.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_EMPTY_EXPRESSION);
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new AppError(ErrorCode.VALIDATION_EXPRESSION_TOO_LONG, {
      detail: `At most ${MAX_EXPRESSION_LENGTH} characters are supported`,
    });
  }

  const allowScientific = options.allowScientific === true;

  /** @type {Array<{type: string, value: string|number, text: string, position: number}>} */
  const tokens = [];
  let index = 0;

  const pushToken = (token) => {
    tokens.push(token);
    if (tokens.length > MAX_TOKEN_COUNT) {
      throw new AppError(ErrorCode.TOKENIZER_TOO_MANY_TOKENS, {
        detail: `At most ${MAX_TOKEN_COUNT} tokens are supported`,
      });
    }
  };

  while (index < expression.length) {
    const char = expression[index];
    const position = index;

    // --- numbers: 12, 12.5, .5, 5. -----------------------------------------
    if (isDigit(char) || (char === '.' && isDigit(expression[index + 1] || ''))) {
      let literal = '';
      let dotCount = 0;
      let digitCount = 0;

      while (index < expression.length) {
        const current = expression[index];
        if (isDigit(current)) {
          literal += current;
          digitCount += 1;
          index += 1;
          continue;
        }
        if (current === '.') {
          dotCount += 1;
          if (dotCount > 1) {
            throw new AppError(ErrorCode.TOKENIZER_INVALID_NUMBER, {
              detail: `Number "${literal}." contains more than one decimal point`,
            });
          }
          literal += current;
          index += 1;
          continue;
        }
        // Scientific notation is refused explicitly. Without this check "1e5"
        // would be read as the number 1 followed by the constant e, which is a
        // confusing message for a very common mistake.
        if (current === 'e' || current === 'E') {
          const following = expression[index + 1];
          if (following === undefined || isDigit(following) || following === '+' || following === '-') {
            throw new AppError(ErrorCode.TOKENIZER_INVALID_NUMBER, {
              detail: 'Scientific notation such as "1e5" is not supported; use "1*10**5" instead',
            });
          }
        }
        break;
      }

      // "1.2.3" is caught above; a literal without any digit cannot happen
      // because the scanner only starts on a digit or on ".digit".
      const value = Number(literal);
      if (!Number.isFinite(value) || digitCount === 0) {
        throw new AppError(ErrorCode.TOKENIZER_INVALID_NUMBER, {
          detail: `"${literal}" is not a valid number`,
        });
      }

      pushToken({ type: TokenType.NUMBER, value, text: literal, position });
      continue;
    }

    // --- identifiers: function names and constants --------------------------
    if (isIdentifierStart(char)) {
      let name = '';
      while (index < expression.length && isIdentifierPart(expression[index])) {
        name += expression[index];
        index += 1;
      }
      const lower = name.toLowerCase();

      if (allowScientific && isKnownFunction(lower)) {
        pushToken({ type: TokenType.FUNCTION, value: lower, text: name, position });
        continue;
      }
      if (allowScientific && isKnownConstant(lower)) {
        pushToken({ type: TokenType.CONSTANT, value: lower, text: name, position });
        continue;
      }
      if (!allowScientific && (isKnownFunction(lower) || isKnownConstant(lower))) {
        throw new AppError(ErrorCode.VALIDATION_INVALID_PARAMETER, {
          detail: `"${name}" is only available in scientific mode; send "mode": "scientific"`,
        });
      }
      throw new AppError(ErrorCode.TOKENIZER_UNKNOWN_IDENTIFIER, {
        detail: `"${name}" is not a supported function or constant`,
      });
    }

    // --- structural characters ---------------------------------------------
    if (char === '(') {
      index += 1;
      pushToken({ type: TokenType.LPAREN, value: '(', text: '(', position });
      continue;
    }
    if (char === ')') {
      index += 1;
      pushToken({ type: TokenType.RPAREN, value: ')', text: ')', position });
      continue;
    }
    if (char === ',') {
      index += 1;
      pushToken({ type: TokenType.COMMA, value: ',', text: ',', position });
      continue;
    }

    // --- operators ----------------------------------------------------------
    const twoChar = expression.slice(index, index + 2);
    if (TWO_CHAR_OPERATORS.includes(twoChar)) {
      index += 2;
      pushToken({ type: TokenType.OPERATOR, value: twoChar, text: twoChar, position });
      continue;
    }
    if (ONE_CHAR_OPERATORS.includes(char)) {
      index += 1;
      pushToken({ type: TokenType.OPERATOR, value: char, text: char, position });
      continue;
    }

    // --- anything else is rejected -----------------------------------------
    throw new AppError(ErrorCode.TOKENIZER_INVALID_CHARACTER, {
      detail: `Character "${char}" at position ${position + 1} is not allowed`,
    });
  }

  tokens.push({ type: TokenType.EOF, value: '', text: '', position: expression.length });
  return tokens;
}

module.exports = { tokenize };
