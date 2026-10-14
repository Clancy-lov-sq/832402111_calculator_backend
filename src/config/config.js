'use strict';

/**
 * Central configuration.
 *
 * Everything that may change between a developer laptop, a grading machine and
 * the public deployment is read from the environment exactly once, here. No
 * other module calls `process.env` directly, so the running configuration of
 * the service can be printed in one place (see `GET /api/health`).
 */

const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Reads an integer environment variable with a fallback and validation.
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function readInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Reads a string environment variable with a fallback.
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function readString(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/** Comma separated CORS origin list; `*` means "allow every origin". */
const corsOriginRaw = readString('CORS_ORIGIN', '*');
const corsOrigins = corsOriginRaw
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const config = Object.freeze({
  server: Object.freeze({
    port: readInt('PORT', 8080),
    host: readString('HOST', '0.0.0.0'),
  }),

  cors: Object.freeze({
    /** `*` (development default) or an explicit whitelist of origins. */
    origins: Object.freeze(corsOrigins),
    allowAll: corsOrigins.includes('*'),
  }),

  database: Object.freeze({
    /** `sqlite` (default, file based) or `mysql` (external service). */
    client: readString('DB_CLIENT', 'sqlite').toLowerCase(),
    sqlitePath: path.resolve(PROJECT_ROOT, readString('SQLITE_PATH', 'data/calculator.db')),
    mysql: Object.freeze({
      host: readString('MYSQL_HOST', '127.0.0.1'),
      port: readInt('MYSQL_PORT', 3306),
      user: readString('MYSQL_USER', 'root'),
      password: readString('MYSQL_PASSWORD', ''),
      database: readString('MYSQL_DATABASE', 'calculator'),
    }),
    /** Rows returned by GET /api/history when the client sends no limit. */
    defaultPageSize: 10,
    maxPageSize: 100,
  }),

  expression: Object.freeze({
    maxLength: readInt('MAX_EXPRESSION_LENGTH', 200),
    maxTokenCount: readInt('MAX_TOKEN_COUNT', 256),
    maxNestingDepth: readInt('MAX_NESTING_DEPTH', 32),
  }),

  api: Object.freeze({
    /**
     * `lenient` (default): a rejected expression still answers HTTP 200 with
     *                        `success: false`, matching the simple response
     *                        format used in the assignment description.
     * `strict`:             a rejected expression answers HTTP 400 as well.
     * Both modes always keep `success: false` and a stable `error` code.
     */
    errorHttpMode: readString('ERROR_HTTP_MODE', 'lenient').toLowerCase(),
  }),

  /**
   * Directory that holds the static front end.
   *
   * Two deployment shapes are supported:
   *   1. front end and back end separated -> this path simply does not exist
   *      and the directory is skipped; the browser loads the page from another
   *      origin (a static server or GitHub Pages) and calls this API.
   *   2. single-service deployment -> the front-end `src` folder is copied to
   *      `public/`, and the same origin serves both the page and the API.
   */
  static: Object.freeze({
    directory: path.resolve(PROJECT_ROOT, readString('STATIC_DIR', 'public')),
    enabled: readString('SERVE_STATIC', 'true') !== 'false',
  }),

  projectRoot: PROJECT_ROOT,
});

/** Export the raw limits as flat constants for the expression modules. */
const MAX_EXPRESSION_LENGTH = config.expression.maxLength;
const MAX_TOKEN_COUNT = config.expression.maxTokenCount;
const MAX_NESTING_DEPTH = config.expression.maxNestingDepth;

module.exports = {
  config,
  MAX_EXPRESSION_LENGTH,
  MAX_TOKEN_COUNT,
  MAX_NESTING_DEPTH,
};
