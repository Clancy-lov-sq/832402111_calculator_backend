'use strict';

/**
 * Stable error codes shared by every layer of the back end.
 *
 * The value of each key is the public error code that the API returns in the
 * `error` field of a failed response. Keeping the codes in one module means the
 * tokenizer, the parser, the evaluator and the service layer cannot drift
 * apart, and the front end can rely on a closed set of strings.
 *
 * Naming convention: <LAYER>_<REASON>, upper snake case.
 */
const ErrorCode = Object.freeze({
  // --- input validation ---------------------------------------------------
  VALIDATION_INVALID_JSON: 'VALIDATION_INVALID_JSON',
  VALIDATION_MISSING_FIELD: 'VALIDATION_MISSING_FIELD',
  VALIDATION_INVALID_FIELD_TYPE: 'VALIDATION_INVALID_FIELD_TYPE',
  VALIDATION_EMPTY_EXPRESSION: 'VALIDATION_EMPTY_EXPRESSION',
  VALIDATION_EXPRESSION_TOO_LONG: 'VALIDATION_EXPRESSION_TOO_LONG',
  VALIDATION_INVALID_BASE: 'VALIDATION_INVALID_BASE',
  VALIDATION_INVALID_PARAMETER: 'VALIDATION_INVALID_PARAMETER',

  // --- tokenizer ----------------------------------------------------------
  TOKENIZER_INVALID_CHARACTER: 'TOKENIZER_INVALID_CHARACTER',
  TOKENIZER_INVALID_NUMBER: 'TOKENIZER_INVALID_NUMBER',
  TOKENIZER_TOO_MANY_TOKENS: 'TOKENIZER_TOO_MANY_TOKENS',
  TOKENIZER_UNKNOWN_IDENTIFIER: 'TOKENIZER_UNKNOWN_IDENTIFIER',

  // --- parser -------------------------------------------------------------
  PARSER_SYNTAX_ERROR: 'PARSER_SYNTAX_ERROR',
  PARSER_UNMATCHED_PARENTHESIS: 'PARSER_UNMATCHED_PARENTHESIS',
  PARSER_MISSING_OPERAND: 'PARSER_MISSING_OPERAND',
  PARSER_MISSING_OPERATOR: 'PARSER_MISSING_OPERATOR',
  PARSER_TRAILING_OPERATOR: 'PARSER_TRAILING_OPERATOR',
  PARSER_NESTING_TOO_DEEP: 'PARSER_NESTING_TOO_DEEP',
  PARSER_INVALID_FUNCTION_CALL: 'PARSER_INVALID_FUNCTION_CALL',

  // --- evaluator ----------------------------------------------------------
  EVALUATOR_DIVISION_BY_ZERO: 'EVALUATOR_DIVISION_BY_ZERO',
  EVALUATOR_DOMAIN_ERROR: 'EVALUATOR_DOMAIN_ERROR',
  EVALUATOR_NOT_A_NUMBER: 'EVALUATOR_NOT_A_NUMBER',
  EVALUATOR_OVERFLOW: 'EVALUATOR_OVERFLOW',

  // --- storage ------------------------------------------------------------
  HISTORY_NOT_FOUND: 'HISTORY_NOT_FOUND',
  STORAGE_FAILURE: 'STORAGE_FAILURE',

  // --- transport ----------------------------------------------------------
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

/**
 * Human readable, non-leaking message for every error code.
 *
 * These messages are safe to return to a browser: they never contain a stack
 * trace, a SQL statement or a file path.
 */
const ERROR_MESSAGES = Object.freeze({
  [ErrorCode.VALIDATION_INVALID_JSON]: 'Request body is not valid JSON',
  [ErrorCode.VALIDATION_MISSING_FIELD]: 'Required field is missing',
  [ErrorCode.VALIDATION_INVALID_FIELD_TYPE]: 'A field has an invalid type',
  [ErrorCode.VALIDATION_EMPTY_EXPRESSION]: 'Expression must not be empty',
  [ErrorCode.VALIDATION_EXPRESSION_TOO_LONG]: 'Expression is too long',
  [ErrorCode.VALIDATION_INVALID_BASE]: 'Unsupported number base',
  [ErrorCode.VALIDATION_INVALID_PARAMETER]: 'Invalid request parameter',

  [ErrorCode.TOKENIZER_INVALID_CHARACTER]: 'Expression contains an invalid character',
  [ErrorCode.TOKENIZER_INVALID_NUMBER]: 'Invalid number format',
  [ErrorCode.TOKENIZER_TOO_MANY_TOKENS]: 'Expression is too complex',
  [ErrorCode.TOKENIZER_UNKNOWN_IDENTIFIER]: 'Unknown function or constant',

  [ErrorCode.PARSER_SYNTAX_ERROR]: 'Invalid expression syntax',
  [ErrorCode.PARSER_UNMATCHED_PARENTHESIS]: 'Unmatched parenthesis',
  [ErrorCode.PARSER_MISSING_OPERAND]: 'Operator is missing an operand',
  [ErrorCode.PARSER_MISSING_OPERATOR]: 'Two operands are not separated by an operator',
  [ErrorCode.PARSER_TRAILING_OPERATOR]: 'Expression ends with an operator',
  [ErrorCode.PARSER_NESTING_TOO_DEEP]: 'Expression is nested too deeply',
  [ErrorCode.PARSER_INVALID_FUNCTION_CALL]: 'Function is used incorrectly',

  [ErrorCode.EVALUATOR_DIVISION_BY_ZERO]: 'Division by zero',
  [ErrorCode.EVALUATOR_DOMAIN_ERROR]: 'Argument outside the function domain',
  [ErrorCode.EVALUATOR_NOT_A_NUMBER]: 'Result is not a number',
  [ErrorCode.EVALUATOR_OVERFLOW]: 'Result is out of the supported range',

  [ErrorCode.HISTORY_NOT_FOUND]: 'Calculation history record does not exist',
  [ErrorCode.STORAGE_FAILURE]: 'Database operation failed',

  [ErrorCode.ROUTE_NOT_FOUND]: 'API endpoint not found',
  [ErrorCode.INTERNAL_ERROR]: 'Internal server error',
});

/**
 * An error that is expected, classified and safe to expose through the API.
 *
 * Anything that is *not* an AppError is treated as an unexpected defect: the
 * response becomes a generic 500 and the details stay in the server log.
 */
class AppError extends Error {
  /**
   * @param {string} code    one of the ErrorCode values
   * @param {object} [options]
   * @param {number} [options.status]  HTTP status code to use for this error
   * @param {string} [options.detail]  extra, non-sensitive explanation that is
   *                                   safe to show to the user
   * @param {string} [options.message] override the default message
   */
  constructor(code, options = {}) {
    super(options.message || ERROR_MESSAGES[code] || code);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status || AppError.defaultStatusFor(code);
    this.detail = options.detail || null;
    /** Marks the error as "expected": the handler may expose it verbatim. */
    this.expose = true;
  }

  /**
   * Default HTTP status for an error code.
   *
   * 4xx means "the client sent something wrong", 5xx means "the server or the
   * database failed". 422 vs 400 is not used on purpose: the assignment only
   * needs a clear distinction between a rejected request and a broken server.
   * @param {string} code
   * @returns {number}
   */
  static defaultStatusFor(code) {
    switch (code) {
      case ErrorCode.HISTORY_NOT_FOUND:
      case ErrorCode.ROUTE_NOT_FOUND:
        return 404;
      case ErrorCode.STORAGE_FAILURE:
      case ErrorCode.INTERNAL_ERROR:
        return 500;
      default:
        return 400;
    }
  }

  /** Plain object used by the API layer to build the JSON body. */
  toJSON() {
    return { code: this.code, message: this.message, detail: this.detail };
  }
}

module.exports = { ErrorCode, ERROR_MESSAGES, AppError };
