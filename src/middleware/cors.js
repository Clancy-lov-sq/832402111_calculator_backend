'use strict';

/**
 * CORS configuration.
 *
 * The front end and the back end are separate applications, so in development
 * they listen on different ports (for example the page on 5500 and this API on
 * 8080). A browser blocks such a cross-origin request unless the server allows
 * it explicitly, which is why CORS belongs to the integration contract and is
 * configured here rather than hidden in a route.
 *
 * `CORS_ORIGIN=*` (the default) allows every origin, which is convenient while
 * developing. The public deployment uses an explicit whitelist so only the
 * deployed page can call the API.
 */

const cors = require('cors');

const { config } = require('../config/config');
const logger = require('../utils/logger');

if (config.cors.allowAll) {
  logger.warn('CORS allows every origin; set CORS_ORIGIN before the public deployment');
}

const corsOptions = {
  /**
   * Decides whether the browser is allowed to read the response.
   *
   * `callback(null, '*')` answers with a literal wildcard, while
   * `callback(null, true)` reflects the origin of the request. The wildcard is
   * used in development so the header is identical for every origin; whitelist
   * mode reflects the origin, which is what a browser needs when several origins
   * are allowed.
   *
   * @param {string|undefined} origin
   * @param {Function} callback
   */
  origin(origin, callback) {
    // A request without an Origin header (curl, Postman, a server-side fetch)
    // is not subject to CORS and is always allowed.
    if (!origin) {
      callback(null, true);
      return;
    }
    if (config.cors.allowAll) {
      callback(null, '*');
      return;
    }
    callback(null, config.cors.origins.includes(origin));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept'],
  // The browser does not need cookies for this API, so credentials stay off.
  credentials: false,
  maxAge: 86400,
};

module.exports = { corsOptions, cors };
