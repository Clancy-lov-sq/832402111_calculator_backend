'use strict';

/**
 * Recursive-descent parser for arithmetic expressions.
 *
 * The parser turns the token stream of the tokenizer into a *postfix program*
 * (a flat instruction list). A flat list was chosen over an abstract syntax
 * tree on purpose:
 *
 *   - the evaluator becomes a trivial loop over one stack, which is easy to
 *     read, easy to test and cannot recurse deeply on hostile input;
 *   - the postfix program can be logged and asserted in unit tests, which makes
 *     operator precedence and unary handling verifiable without evaluating.
 *
 * Grammar (highest precedence last):
 *
 *   expression     := additive
 *   additive       := multiplicative (('+' | '-') multiplicative)*
 *   multiplicative := unary (('*' | '/' | '%') unary)*
 *   unary          := ('+' | '-') unary | power
 *   power          := primary ('**' unary)?            (right associative)
 *   primary        := NUMBER
 *                   | CONSTANT
 *                   | '(' expression ')'
 *                   | FUNCTION '(' expression (',' expression)* ')'
 *                   | primary '(' expression ')'        (implicit multiply)
 *                   | primary CONSTANT                  (implicit multiply, 2pi)
 *
 * Consequence of this shape: `**` is applied before a leading sign, so
 * `-2**2` is `-(2**2) = -4` and `(-2)**2 = 4`. That is the rule followed by
 * spreadsheets and by most scientific calculators when the power key is used;
 * it is documented in the README so the behaviour is explicit.
 *
 * The parser validates *structure*. It never executes anything and never calls
 * `eval`, `exec` or `new Function`.
 */

const { AppError, ErrorCode } = require('../utils/errors');
const { TokenType } = require('./Token');
const { getFunction } = require('./Functions');
const { MAX_NESTING_DEPTH } = require('../config/config');

/**
 * Instruction kinds of the postfix program.
 * @readonly
 * @enum {string}
 */
const InstructionType = Object.freeze({
  NUMBER: 'NUMBER', // push a literal
  CONSTANT: 'CONSTANT', // push a named constant (pi, e, ...)
  BINARY: 'BINARY', // pop 2 values, apply `operator`
  UNARY: 'UNARY', // pop 1 value, apply `operator` (+ or -)
  CALL: 'CALL', // pop `argCount` values, call the whitelisted function
});

/**
 * Binary operator table.
 *
 * `precedence` is used only to document the grammar above; the precedence is
 * actually enforced by the shape of the recursive descent functions, which is
 * less error prone than a numeric table over a stack.
 */
const BINARY_OPERATORS = Object.freeze({
  '+': { precedence: 1, symbol: '+' },
  '-': { precedence: 1, symbol: '-' },
  '*': { precedence: 2, symbol: '*' },
  '/': { precedence: 2, symbol: '/' },
  '%': { precedence: 2, symbol: '%' },
  '**': { precedence: 3, symbol: '**' },
});

/** Class that walks the token stream once and emits the postfix program. */
class Parser {
  /**
   * @param {Array<object>} tokens token stream from the tokenizer, EOF terminated
   * @param {object} [options]
   * @param {boolean} [options.allowScientific] when false, `ans` is not a valid
   *        constant because the basic tab has no previous-result concept.
   */
  constructor(tokens, options = {}) {
    this.tokens = tokens;
    this.position = 0;
    /** @type {Array<object>} the emitted postfix program */
    this.instructions = [];
    /** Current parenthesis depth, used to reject overly nested input. */
    this.depth = 0;
    this.allowScientific = options.allowScientific === true;
  }

  /** @returns {object} the current token without consuming it */
  peek() {
    return this.tokens[this.position];
  }

  /** @returns {object} the current token and advances the cursor */
  next() {
    const token = this.tokens[this.position];
    this.position += 1;
    return token;
  }

  /** @param {string} type @returns {boolean} */
  check(type) {
    return this.peek().type === type;
  }

  /**
   * @param {string} operator
   * @returns {boolean} true when the current token is the given operator
   */
  checkOperator(operator) {
    const token = this.peek();
    return token.type === TokenType.OPERATOR && token.value === operator;
  }

  /**
   * Consumes the current token when it is the expected operator.
   * @param {string} operator
   * @returns {boolean} whether the operator was consumed
   */
  matchOperator(operator) {
    if (this.checkOperator(operator)) {
      this.next();
      return true;
    }
    return false;
  }

  /**
   * Consumes the current token, or fails when it is not of the expected type.
   * @param {string} type
   * @param {string} errorCode
   * @param {string} detail
   */
  expect(type, errorCode, detail) {
    if (!this.check(type)) {
      throw new AppError(errorCode, { detail });
    }
    return this.next();
  }

  /** @param {object} instruction */
  emit(instruction) {
    this.instructions.push(instruction);
  }

  /**
   * Parses the whole token stream.
   *
   * @returns {Array<object>} the postfix program
   * @throws {AppError} PARSER_* codes for every structural problem
   */
  parse() {
    if (this.check(TokenType.EOF)) {
      throw new AppError(ErrorCode.VALIDATION_EMPTY_EXPRESSION);
    }

    this.parseAdditive();

    const token = this.peek();
    if (token.type === TokenType.RPAREN) {
      throw new AppError(ErrorCode.PARSER_UNMATCHED_PARENTHESIS, {
        detail: 'There is a closing parenthesis without a matching opening parenthesis',
      });
    }
    if (token.type === TokenType.OPERATOR) {
      throw new AppError(ErrorCode.PARSER_TRAILING_OPERATOR, {
        detail: `The expression ends with the operator "${token.value}"`,
      });
    }
    if (token.type !== TokenType.EOF) {
      throw new AppError(ErrorCode.PARSER_SYNTAX_ERROR, {
        detail: `Unexpected "${token.text}" after a complete expression`,
      });
    }
    return this.instructions;
  }

  /** additive := multiplicative (('+' | '-') multiplicative)* */
  parseAdditive() {
    this.parseMultiplicative();
    while (this.checkOperator('+') || this.checkOperator('-')) {
      const operator = this.next().value;
      this.parseMultiplicative();
      this.emit({ type: InstructionType.BINARY, operator });
    }
  }

  /** multiplicative := unary (('*' | '/' | '%') unary)* */
  parseMultiplicative() {
    this.parseUnary();
    while (this.checkOperator('*') || this.checkOperator('/') || this.checkOperator('%')) {
      const operator = this.next().value;
      this.parseUnary();
      this.emit({ type: InstructionType.BINARY, operator });
    }
  }

  /**
   * unary := ('+' | '-') unary | power
   *
   * A `+` or `-` seen *here* is the sign of the operand that follows, never a
   * binary subtraction, because `parseMultiplicative` only calls `parseUnary`
   * where an operand is required. That is how `-5` and `3*-2` are recognised
   * without a separate "previous token" heuristic.
   */
  parseUnary() {
    if (this.checkOperator('+') || this.checkOperator('-')) {
      const operator = this.next().value;
      this.parseUnary();
      this.emit({ type: InstructionType.UNARY, operator });
      return;
    }
    this.parsePower();
  }

  /**
   * power := primary ('**' unary)?
   *
   * Right associative, so `2**3**2` is `2**(3**2) = 512`, and the exponent may
   * carry a sign (`2**-3`).
   */
  parsePower() {
    this.parsePrimary();
    if (this.checkOperator('**')) {
      this.next();
      this.parseUnary();
      this.emit({ type: InstructionType.BINARY, operator: '**' });
    }
  }

  /**
   * primary := NUMBER | CONSTANT | '(' expression ')' | FUNCTION '(' args ')'
   *          | primary '(' expression ')' | primary CONSTANT
   */
  parsePrimary() {
    const token = this.peek();

    if (token.type === TokenType.NUMBER) {
      this.next();
      this.emit({ type: InstructionType.NUMBER, value: token.value });
      this.parseImplicitMultiplication();
      return;
    }

    if (token.type === TokenType.CONSTANT) {
      if (token.value === 'ans' && !this.allowScientific) {
        throw new AppError(ErrorCode.VALIDATION_INVALID_PARAMETER, {
          detail: '"ans" is only available in scientific mode',
        });
      }
      this.next();
      this.emit({ type: InstructionType.CONSTANT, name: token.value });
      this.parseImplicitMultiplication();
      return;
    }

    if (token.type === TokenType.FUNCTION) {
      this.parseFunctionCall(token);
      // 2sin(30) is intentionally *not* supported: a function result followed
      // by a number is almost always a typing mistake, so it stays an error.
      return;
    }

    if (token.type === TokenType.LPAREN) {
      this.enterGroup();
      this.next();
      this.parseAdditive();
      this.expect(
        TokenType.RPAREN,
        ErrorCode.PARSER_UNMATCHED_PARENTHESIS,
        'An opening parenthesis is never closed',
      );
      this.exitGroup();
      this.parseImplicitMultiplication();
      return;
    }

    if (token.type === TokenType.RPAREN) {
      throw new AppError(ErrorCode.PARSER_MISSING_OPERAND, {
        detail: 'A closing parenthesis is not preceded by a value',
      });
    }

    if (token.type === TokenType.OPERATOR) {
      throw new AppError(ErrorCode.PARSER_MISSING_OPERAND, {
        detail: `The operator "${token.value}" has no left operand`,
      });
    }

    if (token.type === TokenType.COMMA) {
      throw new AppError(ErrorCode.PARSER_SYNTAX_ERROR, {
        detail: 'A comma is only allowed between function arguments',
      });
    }

    if (token.type === TokenType.EOF) {
      // The expression stops where an operand should start, e.g. "1+" or "1*".
      throw new AppError(ErrorCode.PARSER_TRAILING_OPERATOR, {
        detail: 'The expression ends with an operator that has no right operand',
      });
    }

    throw new AppError(ErrorCode.PARSER_MISSING_OPERAND, {
      detail: 'An operand is missing',
    });
  }

  /**
   * Handles `2(3+4)`, `(1+2)(3+4)` and `2pi`, which are common in a calculator.
   *
   * A number directly followed by another number (`2 3`) is *not* accepted:
   * it is far more likely to be a typo than an intended multiplication.
   */
  parseImplicitMultiplication() {
    const token = this.peek();

    if (token.type === TokenType.LPAREN) {
      this.enterGroup();
      this.next();
      this.parseAdditive();
      this.expect(
        TokenType.RPAREN,
        ErrorCode.PARSER_UNMATCHED_PARENTHESIS,
        'An opening parenthesis is never closed',
      );
      this.exitGroup();
      this.emit({ type: InstructionType.BINARY, operator: '*' });
      this.parseImplicitMultiplication();
      return;
    }

    if (token.type === TokenType.CONSTANT) {
      this.next();
      this.emit({ type: InstructionType.CONSTANT, name: token.value });
      this.emit({ type: InstructionType.BINARY, operator: '*' });
      this.parseImplicitMultiplication();
      return;
    }

    if (token.type === TokenType.NUMBER) {
      throw new AppError(ErrorCode.PARSER_MISSING_OPERATOR, {
        detail: 'Two numbers must be separated by an operator',
      });
    }

    if (token.type === TokenType.FUNCTION) {
      throw new AppError(ErrorCode.PARSER_MISSING_OPERATOR, {
        detail: `A function call must be separated from the previous value by an operator`,
      });
    }
  }

  /**
   * Parses `name(arg, arg)` and checks the argument count against the
   * whitelist, so `sin(1, 2)` fails during parsing instead of at run time.
   *
   * @param {object} token the FUNCTION token
   */
  parseFunctionCall(token) {
    const definition = getFunction(token.value);
    if (definition === undefined) {
      // Unreachable: the tokenizer only emits known functions. Kept as a
      // defensive check so a new tokenizer cannot bypass the whitelist.
      throw new AppError(ErrorCode.TOKENIZER_UNKNOWN_IDENTIFIER, {
        detail: `"${token.text}" is not a supported function`,
      });
    }

    this.next();
    this.enterGroup();
    this.expect(
      TokenType.LPAREN,
      ErrorCode.PARSER_INVALID_FUNCTION_CALL,
      `The function "${token.value}" must be followed by "("`,
    );

    let argumentCount = 0;
    if (!this.check(TokenType.RPAREN)) {
      this.parseAdditive();
      argumentCount = 1;
      while (this.check(TokenType.COMMA)) {
        this.next();
        this.parseAdditive();
        argumentCount += 1;
      }
    }

    this.expect(
      TokenType.RPAREN,
      ErrorCode.PARSER_UNMATCHED_PARENTHESIS,
      `The argument list of "${token.value}" is not closed`,
    );
    this.exitGroup();

    if (argumentCount !== definition.argCount) {
      throw new AppError(ErrorCode.PARSER_INVALID_FUNCTION_CALL, {
        detail: `"${token.value}" expects ${definition.argCount} argument(s) but received ${argumentCount}`,
      });
    }

    this.emit({ type: InstructionType.CALL, name: token.value, argCount: argumentCount });
  }

  /** Tracks parenthesis depth and rejects expressions that are nested too deeply. */
  enterGroup() {
    this.depth += 1;
    if (this.depth > MAX_NESTING_DEPTH) {
      throw new AppError(ErrorCode.PARSER_NESTING_TOO_DEEP, {
        detail: `At most ${MAX_NESTING_DEPTH} nested parentheses are supported`,
      });
    }
  }

  /** Releases one level of parenthesis depth. */
  exitGroup() {
    this.depth -= 1;
  }
}

/**
 * Convenience wrapper: tokens -> postfix program.
 *
 * @param {Array<object>} tokens
 * @param {object} [options] forwarded to the {@link Parser} constructor
 * @returns {Array<object>} postfix instruction list
 */
function parse(tokens, options = {}) {
  return new Parser(tokens, options).parse();
}

module.exports = { Parser, parse, InstructionType, BINARY_OPERATORS };
