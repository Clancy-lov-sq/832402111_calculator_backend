'use strict';

/**
 * Express application factory.
 *
 * Middleware order matters and is deliberate:
 *
 *   1. request logging        - records every request, even a rejected one
 *   2. CORS                   - answers the preflight before anything else
 *   3. JSON body parser       - 64 kb limit, so a large body is refused early
 *   4. API routes             - the whole API lives under /api
 *   5. static front end       - optional, only when `public/` exists
 *   6. 404 handler            - an unknown URL becomes a JSON error, not HTML
 *   7. error handler          - the single place that formats failures
 *
 * The factory receives its dependencies instead of importing them, so an
 * integration test can build the app with a temporary database.
 */

const path = require('node:path');
const fs = require('node:fs');

const express = require('express');

const { config } = require('./config/config');
const routes = require('./routes');
const { requestLogger } = require('./middleware/requestLogger');
const { cors, corsOptions } = require('./middleware/cors');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

/** Largest accepted JSON body. An expression is tiny; 64 kb is already generous. */
const JSON_BODY_LIMIT = '64kb';

/**
 * @param {object} deps
 * @param {import('../storage/historyRepository').HistoryRepository} deps.historyRepository
 * @param {string} [deps.version] version reported by /api/health
 * @param {boolean} [deps.persistCalculations] false in tests that only evaluate
 * @returns {import('express').Express}
 */
function createApp(deps) {
  const app = express();

  // Express runs behind a reverse proxy in the public deployment; trusting one
  // hop makes req.ip and the protocol correct in the access log.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.locals.historyRepository = deps.historyRepository;
  app.locals.version = deps.version || require('../package.json').version;
  app.locals.persistCalculations = deps.persistCalculations !== false;

  app.use(requestLogger());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  // A tiny landing document for `GET /api` so that opening the base URL in a
  // browser shows what the service offers.
  app.get('/api', (req, res) => {
    res.json({
      success: true,
      service: 'Calculator Backend API',
      version: app.locals.version,
      endpoints: [
        'POST   /api/calculate',
        'GET    /api/history',
        'DELETE /api/history/{id}',
        'DELETE /api/history',
        'GET    /api/stats',
        'POST   /api/convert/base',
        'POST   /api/convert/unit',
        'GET    /api/convert/units',
        'GET    /api/capabilities',
        'GET    /api/health',
      ],
    });
  });

  app.use('/api', routes);

  // Optional single-service deployment: when the front-end files were copied to
  // `public/`, the same origin serves the page and the API. In the separated
  // deployment this block is skipped and the page is loaded from another origin.
  if (config.static.enabled && fs.existsSync(config.static.directory)) {
    app.use(express.static(config.static.directory, { extensions: ['html'] }));
    logger.info('Serving static front end', { directory: path.relative(config.projectRoot, config.static.directory) });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, JSON_BODY_LIMIT };
