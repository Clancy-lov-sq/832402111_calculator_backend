'use strict';

/**
 * History controller.
 *
 * Provides the three HTTP operations the assignment requires for calculation
 * history, plus the optional "clear all" and the statistics endpoint used by
 * the dashboard of the front end.
 */

const historyService = require('../services/historyService');
const { success } = require('../utils/response');

/**
 * GET /api/history
 *
 * Query parameters:
 *   page=all            every record (the plain listing of the assignment)
 *   limit, offset       pagination (default 10 per page, maximum 100)
 *   keyword             substring search inside the expression
 *   operation           exact operation family filter
 */
async function list(req, res) {
  const body = await historyService.listHistory(req.query, {
    historyRepository: req.app.locals.historyRepository,
  });
  res.json(body);
}

/**
 * DELETE /api/history/:id
 *
 * 404 is returned when the id does not exist, which requires the delete to
 * report the number of affected rows.
 */
async function remove(req, res) {
  const body = await historyService.deleteHistory(req.params.id, {
    historyRepository: req.app.locals.historyRepository,
  });
  res.json(success(body));
}

/**
 * DELETE /api/history
 *
 * Optional extended function: clears the whole table and resets the sequence.
 */
async function clear(req, res) {
  const body = await historyService.clearHistory({
    historyRepository: req.app.locals.historyRepository,
  });
  res.json(success(body));
}

/**
 * GET /api/stats
 *
 * Documented extended function: aggregated statistics for the dashboard.
 */
async function statistics(req, res) {
  const body = await historyService.historyStatistics(req.query, {
    historyRepository: req.app.locals.historyRepository,
  });
  res.json(body);
}

module.exports = { list, remove, clear, statistics, success };
