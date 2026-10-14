'use strict';

/**
 * Request logging middleware.
 *
 * One line per request with the method, the path, the status, the duration and
 * the response size. This is the first thing to look at when the front end
 * reports "the back end is unreachable": if no line appears here, the request
 * never arrived (wrong URL or blocked origin); if a line appears with 500, the
 * defect is inside the back end.
 */

const logger = require('../utils/logger');

/**
 * @returns {Function} an Express middleware
 */
function requestLogger() {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const line = `${req.method} ${req.originalUrl} -> ${res.statusCode}`;
      const meta = {
        durationMs: Number(durationMs.toFixed(2)),
        bytes: Number(res.getHeader('content-length') || 0),
        origin: req.get('origin') || '-',
      };

      if (res.statusCode >= 500) {
        logger.error(line, meta);
      } else if (res.statusCode >= 400) {
        logger.warn(line, meta);
      } else {
        logger.info(line, meta);
      }
    });

    next();
  };
}

module.exports = { requestLogger };
