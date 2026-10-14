'use strict';

/**
 * Result envelope shared by every endpoint.
 *
 * Two fixed rules keep the API predictable for the front end and for grading:
 *   1. a successful response always contains `success: true`,
 *   2. a failed response always contains `success: false`, a stable machine
 *      readable `error` code and a human readable `message`.
 *
 * The front end can therefore branch on `success` alone and never has to guess
 * what a status code means.
 */

/**
 * @param {object} payload additional fields merged into the body
 * @returns {object}
 */
function success(payload = {}) {
  return { success: true, ...payload };
}

/**
 * @param {import('../utils/errors').AppError} error
 * @returns {object}
 */
function failure(error) {
  return {
    success: false,
    error: error.code,
    message: error.message,
    ...(error.detail ? { detail: error.detail } : {}),
  };
}

module.exports = { success, failure };
