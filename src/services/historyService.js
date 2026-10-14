'use strict';

/**
 * Business layer for calculation history.
 *
 * Three responsibilities, one per required function of the assignment:
 *   - read history (paginated, newest first, optionally filtered),
 *   - delete one record by id (404 when it does not exist),
 *   - clear the whole table (documented extended feature).
 *
 * The list response uses one stable envelope for both the paginated and the
 * "all records" view, so the front end has a single shape to render.
 */

const { AppError, ErrorCode } = require('../utils/errors');
const logger = require('../utils/logger');

/** Operation families stored in the database, used to validate filters. */
const KNOWN_OPERATIONS = Object.freeze([
  'addition',
  'subtraction',
  'multiplication',
  'division',
  'modulo',
  'power',
  'compound',
  'scientific',
  'number',
  'conversion',
]);

/**
 * Validates a deletion id coming from the URL.
 *
 * @param {string|number} raw
 * @returns {number} a positive integer id
 * @throws {AppError} VALIDATION_INVALID_PARAMETER
 */
function readId(raw) {
  const id = Number.parseInt(raw, 10);
  if (!Number.isFinite(id) || id <= 0 || String(id) !== String(raw).trim()) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_PARAMETER, {
      detail: 'The history id must be a positive integer',
    });
  }
  return id;
}

/**
 * Reads one page of history.
 *
 * `page=all` returns every record, which is what the assignment describes as
 * "the front end retrieves the calculation history". The paginated mode is the
 * documented extended feature used by the history panel.
 *
 * @param {object} query the request query string
 * @param {object} deps
 * @param {import('../storage/historyRepository').HistoryRepository} deps.historyRepository
 * @returns {Promise<object>} the JSON body
 */
async function listHistory(query, deps) {
  const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : '';
  const operation =
    typeof query.operation === 'string' && query.operation.trim() !== ''
      ? query.operation.trim()
      : '';

  if (operation !== '' && !KNOWN_OPERATIONS.includes(operation)) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_PARAMETER, {
      detail: `Unknown operation "${operation}". Supported values: ${KNOWN_OPERATIONS.join(', ')}`,
    });
  }

  if (String(query.page).toLowerCase() === 'all') {
    const records = await deps.historyRepository.findAll({ keyword, operation });
    return {
      success: true,
      total: records.length,
      returned: records.length,
      page: 'all',
      records,
    };
  }

  const page = await deps.historyRepository.findPage({
    limit: query.limit,
    offset: query.offset,
    keyword,
    operation,
  });

  return {
    success: true,
    total: page.total,
    returned: page.items.length,
    limit: page.limit,
    offset: page.offset,
    records: page.items,
  };
}

/**
 * Deletes one history record.
 *
 * @param {string|number} rawId
 * @param {object} deps
 * @param {import('../storage/historyRepository').HistoryRepository} deps.historyRepository
 * @returns {Promise<object>} the JSON body
 * @throws {AppError} HISTORY_NOT_FOUND when the record does not exist
 */
async function deleteHistory(rawId, deps) {
  const id = readId(rawId);
  const deleted = await deps.historyRepository.deleteById(id);

  if (!deleted) {
    throw new AppError(ErrorCode.HISTORY_NOT_FOUND, {
      detail: `No calculation history record has the id ${id}`,
    });
  }

  logger.info('History record deleted', { id });
  const total = await deps.historyRepository.count();
  return { success: true, deletedId: id, remaining: total };
}

/**
 * Deletes every history record.
 *
 * @param {object} deps
 * @param {import('../storage/historyRepository').HistoryRepository} deps.historyRepository
 * @returns {Promise<object>} the JSON body
 */
async function clearHistory(deps) {
  const deleted = await deps.historyRepository.deleteAll();
  return { success: true, deleted, remaining: 0 };
}

/**
 * Aggregated statistics for the dashboard.
 *
 * @param {object} query
 * @param {object} deps
 * @param {import('../storage/historyRepository').HistoryRepository} deps.historyRepository
 * @returns {Promise<object>}
 */
async function historyStatistics(query, deps) {
  const days = Number.parseInt(query.days, 10);
  const statistics = await deps.historyRepository.statistics(Number.isFinite(days) ? days : 7);
  return { success: true, ...statistics };
}

module.exports = { KNOWN_OPERATIONS, listHistory, deleteHistory, clearHistory, historyStatistics, readId };
