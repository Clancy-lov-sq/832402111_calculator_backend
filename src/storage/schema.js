'use strict';

/**
 * Database schema.
 *
 * One table is enough for this project: every successful calculation becomes
 * one row, and every other required behaviour (query, delete, statistics) is a
 * query over that table.
 *
 *   calculation_history
 *   -------------------
 *   id            auto increment primary key, used by DELETE /api/history/{id}
 *   expression    the expression exactly as the user submitted it
 *   result        DOUBLE PRECISION value calculated by the back end
 *   result_text   the rounded string the user actually saw
 *   operation     operation family (addition, compound, scientific, ...)
 *   mode          "basic" or "scientific", how the expression was evaluated
 *   created_at    timestamp of the calculation, filled by the database itself
 *
 * Design notes
 * ------------
 *  - `result` and `result_text` are both stored on purpose. `result` keeps the
 *    numeric semantics needed by statistics and re-use, `result_text` preserves
 *    exactly what was displayed, so a later change of the rounding rule cannot
 *    rewrite history.
 *  - `created_at` is produced by the database (`CURRENT_TIMESTAMP` in SQLite,
 *    `CURRENT_TIMESTAMP` in MySQL), never by the client, so the history order
 *    cannot be influenced by a wrong clock on the browser side.
 *  - Two indexes are declared: `created_at DESC` for the default newest-first
 *    listing, and `operation` for the statistics aggregation.
 */

/** Name of the history table, referenced by the repository as well. */
const TABLE_NAME = 'calculation_history';

/** SQLite statements used by the SQLite driver. */
const SQLITE = Object.freeze({
  createTable: `
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expression TEXT NOT NULL,
      result REAL NOT NULL,
      result_text TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'compound',
      mode TEXT NOT NULL DEFAULT 'basic',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
    )
  `,
  createCreatedAtIndex: `
    CREATE INDEX IF NOT EXISTS idx_calculation_history_created_at
      ON ${TABLE_NAME} (created_at DESC, id DESC)
  `,
  createOperationIndex: `
    CREATE INDEX IF NOT EXISTS idx_calculation_history_operation
      ON ${TABLE_NAME} (operation)
  `,
});

/** MySQL statements used by the MySQL driver (InnoDB, utf8mb4). */
const MYSQL = Object.freeze({
  createTable: `
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      expression VARCHAR(512) NOT NULL,
      result DOUBLE NOT NULL,
      result_text VARCHAR(64) NOT NULL,
      operation VARCHAR(32) NOT NULL DEFAULT 'compound',
      mode VARCHAR(16) NOT NULL DEFAULT 'basic',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_calculation_history_created_at (created_at DESC, id DESC),
      KEY idx_calculation_history_operation (operation)
    ) ENGINE = InnoDB
      DEFAULT CHARSET = utf8mb4
      COLLATE = utf8mb4_unicode_ci
  `,
});

/**
 * Statements per driver.
 *
 * Every statement uses positional `?` parameters; the repository never builds
 * SQL by string concatenation, which is what keeps user input out of the SQL
 * text (parameter binding instead of escaping).
 */
const STATEMENTS = Object.freeze({
  sqlite: Object.freeze({
    ...SQLITE,
    insert: `
      INSERT INTO ${TABLE_NAME} (expression, result, result_text, operation, mode, created_at)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')))
    `,
    selectById: `SELECT * FROM ${TABLE_NAME} WHERE id = ?`,
    deleteById: `DELETE FROM ${TABLE_NAME} WHERE id = ?`,
    deleteAll: `DELETE FROM ${TABLE_NAME}`,
    countAll: `SELECT COUNT(*) AS total FROM ${TABLE_NAME}`,
    resetSequence: `DELETE FROM sqlite_sequence WHERE name = ?`,
    selectOperations: `
      SELECT operation, COUNT(*) AS count
      FROM ${TABLE_NAME}
      GROUP BY operation
      ORDER BY count DESC, operation ASC
    `,
    selectDaily: `
      SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
      FROM ${TABLE_NAME}
      GROUP BY day
      ORDER BY day DESC
      LIMIT ?
    `,
  }),
  mysql: Object.freeze({
    ...MYSQL,
    insert: `
      INSERT INTO ${TABLE_NAME} (expression, result, result_text, operation, mode, created_at)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `,
    selectById: `SELECT * FROM ${TABLE_NAME} WHERE id = ?`,
    deleteById: `DELETE FROM ${TABLE_NAME} WHERE id = ?`,
    deleteAll: `DELETE FROM ${TABLE_NAME}`,
    countAll: `SELECT COUNT(*) AS total FROM ${TABLE_NAME}`,
    // MySQL has no sqlite_sequence table; TRUNCATE resets AUTO_INCREMENT.
    resetSequence: `ALTER TABLE ${TABLE_NAME} AUTO_INCREMENT = 1`,
    selectOperations: `
      SELECT operation, COUNT(*) AS count
      FROM ${TABLE_NAME}
      GROUP BY operation
      ORDER BY count DESC, operation ASC
    `,
    selectDaily: `
      SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS count
      FROM ${TABLE_NAME}
      GROUP BY day
      ORDER BY day DESC
      LIMIT ?
    `,
  }),
});

/** Default values used when a column is not provided. */
const DEFAULTS = Object.freeze({
  operation: 'compound',
  mode: 'basic',
});

module.exports = { TABLE_NAME, STATEMENTS, DEFAULTS };
