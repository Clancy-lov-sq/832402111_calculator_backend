'use strict';

/**
 * Error handling middleware.
 *
 * Two layers cooperate to guarantee that **every** response - successful or
 * failed - has the same JSON shape:
 *
 *   notFoundHandler  -> a URL that matches no route becomes 404 ROUTE_NOT_FOUND
 *   errorHandler     -> every thrown error becomes
 *                       { success: false, error: <CODE>, message: <text> }
 *
 * Only `AppError` instances (errors the project raised deliberately) expose
 * their message. Anything else is logged with its stack trace and answered with
 * a generic 500, so an internal defect never leaks a file path, a SQL fragment
 * or a stack trace to the browser.
 */

const { AppError, ErrorCode } = require('../utils/errors');
const { failure } = require('../utils/response');
const { config } = require('../config/config');
const logger = require('../utils/logger');

/**
 * Handles a request that matched no route.
 */
function notFoundHandler(req, res) {
  const error = new AppError(ErrorCode.ROUTE_NOT_FOUND, {
    detail: `${req.method} ${req.path} is not a valid endpoint`,
  });
  res.status(error.status).json(failure(error));
}

/**
 * Converts any thrown value into a JSON error response.
 *
 * @param {Error} error
 * @param {object} req
 * @param {object} res
 * @param {Function} next
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(error, req, res, next) {
  const mapped = classify(error);

  if (mapped.status >= 500) {
    logger.error('Request failed', {
      method: req.method,
      path: req.path,
      code: mapped.code,
      message: error.message,
      stack: error.stack,
    });
  } else {
    logger.warn('Request rejected', {
      method: req.method,
      path: req.path,
      code: mapped.code,
      detail: mapped.detail,
    });
  }

  res.status(mapped.status).json(failure(mapped));
}

/**
 * Maps a thrown value to an `AppError` (the error type the API can describe).
 *
 * @param {Error} error
 * @returns {AppError}
 */
function classify(error) {
  if (error instanceof AppError) {
    // In "lenient" mode every rejected request answers HTTP 200 with
    // success=false, which is the simple format used in the assignment and in
    // the API examples. Storage and server errors keep their real status.
    if (
      config.api.errorHttpMode === 'lenient' &&
      error.status >= 400 &&
      error.status < 500 &&
      error.code !== ErrorCode.ROUTE_NOT_FOUND &&
      error.code !== ErrorCode.HISTORY_NOT_FOUND
    ) {
      return new AppError(error.code, { status: 200, detail: error.detail, message: error.message });
    }
    return error;
  }

  // The body could not be parsed as JSON. express.json() reports this as a
  // SyntaxError carrying a `body` property.
  if (error instanceof SyntaxError && 'body' in error) {
    return new AppError(ErrorCode.VALIDATION_INVALID_JSON);
  }

  // body-parser rejects a request that is larger than the configured limit.
  if (error.type === 'entity.too.large') {
    return new AppError(ErrorCode.VALIDATION_INVALID_PARAMETER, {
      status: 413,
      detail: 'The request body is larger than the 64 kb limit',
    });
  }

  return new AppError(ErrorCode.INTERNAL_ERROR, { status: 500 });
}

module.exports = { notFoundHandler, errorHandler, classify };
