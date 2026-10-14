'use strict';

/**
 * Back-end entry point.
 *
 * Startup sequence:
 *   1. read the configuration (src/config/config.js),
 *   2. open the database and create the schema if needed,
 *   3. build the repository and the Express application,
 *   4. listen on the configured host and port,
 *   5. install the shutdown handlers.
 *
 * The process only starts listening after the database is ready, so a client can
 * never reach an API whose storage is still uninitialised.
 */

const { config } = require('./src/config/config');
const { connect } = require('./src/storage/database');
const { HistoryRepository } = require('./src/storage/historyRepository');
const { createApp } = require('./src/app');
const logger = require('./src/utils/logger');

/**
 * Boots the service.
 *
 * @returns {Promise<{server: object, close: Function}>}
 */
async function start() {
  const driver = await connect();
  const historyRepository = new HistoryRepository(driver);
  const app = createApp({ historyRepository });
  const version = require('./package.json').version;

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(config.server.port, config.server.host, () => resolve(instance));
    instance.on('error', reject);
  });

  const address = server.address();
  const displayHost = config.server.host === '0.0.0.0' ? '127.0.0.1' : config.server.host;

  logger.info('Calculator backend is listening', {
    url: `http://${displayHost}:${address.port}`,
    host: config.server.host,
    port: address.port,
    version,
    database: config.database.client,
    cors: config.cors.allowAll ? '*' : config.cors.origins.join(','),
  });
  logger.info('API entry point', { url: `http://${displayHost}:${address.port}/api` });

  /** Closes the HTTP server and the database connection. */
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    await driver.close();
    logger.info('Calculator backend stopped');
  };

  return { server, close, historyRepository, driver };
}

// `require.main === module` keeps the module importable from tests: importing it
// must not start a listener as a side effect.
if (require.main === module) {
  start().catch((error) => {
    logger.error('Failed to start the calculator backend', {
      message: error.message,
      detail: error.detail || null,
      stack: error.stack,
    });
    process.exitCode = 1;
  });

  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => {
      logger.info(`Received ${signal}, shutting down`);
      process.exit(0);
    });
  });
}

module.exports = { start };
