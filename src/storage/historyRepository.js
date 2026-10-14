'use strict';

/**
 * History repository: every SQL statement about calculation history lives here.
 *
 * The service layer never sees SQL, and this module never sees HTTP. Parameters
 * are always bound (`?` placeholders) instead of concatenated, so a value such
 * as `'); DROP TABLE calculation_history; --` is stored as plain text and can
 * never change the shape of a statement.
 */

const { config } = require('../config/config');
const { STATEMENTS, DEFAULTS, TABLE_NAME } = require('./schema');
const { AppError, ErrorCode } = require('../utils/errors');
const logger = require('../utils/logger');

/** Columns returned to the API, in a stable order. */
const PUBLIC_COLUMNS = 'id, expression, result, result_text, operation, mode, created_at';

/**
 * Maps a database row to the JSON shape used by the API.
 *
 * Naming is converted from snake_case (SQL convention) to camelCase (JSON
 * convention) here, in one place, so the front end never has to know the column
 * names.
 *
 * @param {object} row
 * @returns {object|null}
 */
function mapRow(row) {
  if (row === undefined || row === null) {
    return null;
  }
  return {
    id: Number(row.id),
    expression: String(row.expression),
    result: Number(row.result),
    resultText: row.result_text === undefined ? String(row.result) : String(row.result_text),
    operation: row.operation === undefined ? DEFAULTS.operation : String(row.operation),
    mode: row.mode === undefined ? DEFAULTS.mode : String(row.mode),
    createdAt: String(row.created_at),
  };
}

class HistoryRepository {
  /**
   * @param {object} driver a connection from src/storage/database.js
   */
  constructor(driver) {
    this.driver = driver;
    this.statements = STATEMENTS[driver.client];
  }

  /**
   * Inserts one successful calculation.
   *
   * @param {object} record
   * @param {string} record.expression
   * @param {number} record.result
   * @param {string} record.resultText
   * @param {string} [record.operation]
   * @param {string} [record.mode]
   * @param {string} [record.createdAt] explicit timestamp ("YYYY-MM-DD HH:MM:SS").
   *        Normally omitted: the database fills the column with its own clock,
   *        so the history order cannot be influenced by the client. The seed
   *        script uses it to create a realistic timeline for the screenshots.
   * @returns {Promise<object>} the stored record, including its id and timestamp
   */
  async insert(record) {
    const operation = record.operation || DEFAULTS.operation;
    const mode = record.mode || DEFAULTS.mode;

    const { lastInsertRowid } = await this.driver.run(this.statements.insert, [
      record.expression,
      record.result,
      record.resultText,
      operation,
      mode,
      record.createdAt || null,
    ]);

    const stored = await this.driver.get(this.statements.selectById, [lastInsertRowid]);
    return mapRow(stored);
  }

  /**
   * Reads one page of history, newest first.
   *
   * @param {object} [query]
   * @param {number} [query.limit] page size
   * @param {number} [query.offset] number of rows to skip
   * @param {string} [query.keyword] substring matched against the expression
   * @param {string} [query.operation] exact operation family filter
   * @returns {Promise<{items: object[], total: number, limit: number, offset: number}>}
   */
  async findPage(query = {}) {
    const limit = normalizeLimit(query.limit);
    const offset = normalizeOffset(query.offset);
    const conditions = [];
    const params = [];

    if (query.keyword) {
      conditions.push('expression LIKE ?');
      params.push(`%${escapeLike(query.keyword)}%`);
    }
    if (query.operation) {
      conditions.push('operation = ?');
      params.push(query.operation);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const orderAndPage = ' ORDER BY id DESC LIMIT ? OFFSET ?';

    const rows = await this.driver.all(
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE_NAME}${where}${orderAndPage}`,
      [...params, limit, offset],
    );
    const totalRow = await this.driver.get(
      `SELECT COUNT(*) AS total FROM ${TABLE_NAME}${where}`,
      params,
    );

    return {
      items: rows.map(mapRow),
      total: Number(totalRow ? totalRow.total : 0),
      limit,
      offset,
    };
  }

  /**
   * Reads every record, newest first.
   *
   * Used by the plain listing required by the assignment
   * (`GET /api/history?page=all`) and by the seed script.
   *
   * @param {object} [query] same filters as {@link findPage}
   * @returns {Promise<object[]>}
   */
  async findAll(query = {}) {
    const conditions = [];
    const params = [];
    if (query.keyword) {
      conditions.push('expression LIKE ?');
      params.push(`%${escapeLike(query.keyword)}%`);
    }
    if (query.operation) {
      conditions.push('operation = ?');
      params.push(query.operation);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const rows = await this.driver.all(
      `SELECT ${PUBLIC_COLUMNS} FROM ${TABLE_NAME}${where} ORDER BY id DESC`,
      params,
    );
    return rows.map(mapRow);
  }

  /**
   * @param {number} id
   * @returns {Promise<object|null>} the record, or null when it does not exist
   */
  async findById(id) {
    const row = await this.driver.get(this.statements.selectById, [id]);
    return mapRow(row);
  }

  /**
   * Deletes one record.
   *
   * The number of affected rows is checked, so deleting an id that does not
   * exist is reported as 404 instead of a silent success.
   *
   * @param {number} id
   * @returns {Promise<boolean>} true when a row was deleted
   */
  async deleteById(id) {
    const { changes } = await this.driver.run(this.statements.deleteById, [id]);
    return changes > 0;
  }

  /**
   * Deletes every record (the optional "clear all" function).
   *
   * @returns {Promise<number>} number of deleted rows
   */
  async deleteAll() {
    const before = await this.count();
    await this.driver.run(this.statements.deleteAll);
    await this.driver.run(this.statements.resetSequence, [TABLE_NAME]);
    logger.info('Calculation history cleared', { deleted: before });
    return before;
  }

  /**
   * @returns {Promise<number>} total number of stored calculations
   */
  async count() {
    const row = await this.driver.get(this.statements.countAll);
    return Number(row ? row.total : 0);
  }

  /**
   * Aggregated statistics for the dashboard of the front end.
   *
   * @param {number} [days] number of days included in the daily series
   * @returns {Promise<{total: number, byOperation: object[], daily: object[], lastCalculationAt: string|null}>}
   */
  async statistics(days = 7) {
    const total = await this.count();
    const operations = await this.driver.all(this.statements.selectOperations);
    const daily = await this.driver.all(this.statements.selectDaily, [normalizeLimit(days, 30)]);
    const latest = await this.driver.get(
      `SELECT created_at FROM ${TABLE_NAME} ORDER BY id DESC LIMIT 1`,
    );

    const byOperation = {};
    operations.forEach((row) => {
      byOperation[String(row.operation)] = Number(row.count);
    });

    return {
      total,
      byOperation,
      daily: daily.map((row) => ({ day: String(row.day), count: Number(row.count) })),
      lastCalculationAt: latest ? String(latest.created_at) : null,
    };
  }
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number} a valid page size
 */
function normalizeLimit(value, fallback = config.database.defaultPageSize) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, config.database.maxPageSize);
}

/**
 * @param {unknown} value
 * @returns {number} a valid, non negative offset
 */
function normalizeOffset(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Escapes the wildcards of a LIKE pattern so that a user searching for `%`
 * matches a literal percent sign instead of "anything".
 * @param {string} value
 * @returns {string}
 */
function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
}

module.exports = { HistoryRepository, mapRow, PUBLIC_COLUMNS };
