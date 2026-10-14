'use strict';

/**
 * Route table.
 *
 * The URL layout follows the one suggested by the assignment:
 *
 *   POST   /api/calculate        calculate an expression
 *   GET    /api/history          read calculation history
 *   DELETE /api/history/{id}     delete one history record
 *   DELETE /api/history          clear the whole history (optional extension)
 *
 * The endpoints below the first group are documented extended features; they are
 * grouped under their own prefixes so the required API stays easy to find.
 */

const express = require('express');

const calculatorController = require('../controllers/calculatorController');
const historyController = require('../controllers/historyController');

const router = express.Router();

/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 *
 * Express 4 does not await handlers; without this wrapper an exception inside an
 * `async` handler would become an unhandled rejection instead of a 500 response.
 *
 * @param {Function} handler
 * @returns {Function}
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// --- required API ----------------------------------------------------------
router.post('/calculate', asyncHandler(calculatorController.calculate));
router.get('/history', asyncHandler(historyController.list));
router.delete('/history/:id', asyncHandler(historyController.remove));
router.delete('/history', asyncHandler(historyController.clear));

// --- service information ---------------------------------------------------
router.get('/health', asyncHandler(calculatorController.health));
router.get('/capabilities', asyncHandler(calculatorController.capabilities));

// --- extended features -----------------------------------------------------
router.get('/stats', asyncHandler(historyController.statistics));
router.post('/convert/base', asyncHandler(calculatorController.convertBase));
router.post('/convert/unit', asyncHandler(calculatorController.convertUnit));
router.get('/convert/units', asyncHandler(calculatorController.listUnits));

module.exports = router;
