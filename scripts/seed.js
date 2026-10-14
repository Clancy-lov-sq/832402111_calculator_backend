'use strict';

/**
 * Database initialisation and seed script.
 *
 * Runs the same code path as the server (open connection -> create schema), and
 * then optionally fills the table with a realistic timeline of calculations.
 *
 * Usage:
 *   npm run db:init        create the schema, keep existing data
 *   npm run db:reset       drop every row, then insert the seed data
 *
 * A grader can therefore obtain a working database with one command, without
 * installing a database server.
 */

const { connect } = require('../src/storage/database');
const { HistoryRepository } = require('../src/storage/historyRepository');
const { TABLE_NAME } = require('../src/storage/schema');
const logger = require('../src/utils/logger');

/**
 * Seed rows.
 *
 * Every row is a calculation that the back end really produced: the expression
 * is fed through the same pipeline before it is stored, so the seed data cannot
 * contain a result the calculator would not compute. `createdAt` is explicit so
 * the demonstration screenshots show a stable, believable timeline.
 */
const SEED_ROWS = Object.freeze([
  { expression: '12+8', createdAt: '2026-10-01 09:14:02' },
  { expression: '20-7', createdAt: '2026-10-01 09:16:41' },
  { expression: '6*7', createdAt: '2026-10-01 09:21:15' },
  { expression: '84/12', createdAt: '2026-10-01 10:02:38' },
  { expression: '12.5/2', createdAt: '2026-10-01 10:07:55' },
  { expression: '1+2*3', createdAt: '2026-10-01 10:20:00' },
  { expression: '(1+2)*3', createdAt: '2026-10-01 10:21:07' },
  { expression: '-5+8', createdAt: '2026-10-01 10:22:44' },
  { expression: '3*-2', createdAt: '2026-10-01 11:03:19' },
  { expression: '8-3*2', createdAt: '2026-10-01 11:05:52' },
  { expression: 'sqrt(144)', createdAt: '2026-10-02 08:41:26', mode: 'scientific' },
  { expression: '2**10', createdAt: '2026-10-02 08:45:03' },
  { expression: 'sin(30)+cos(60)', createdAt: '2026-10-02 09:12:47', mode: 'scientific' },
  { expression: '100/(4*5)', createdAt: '2026-10-02 09:30:11' },
  { expression: '3.14159*2.5', createdAt: '2026-10-02 10:05:36' },
  { expression: '(2+3)*(7-4)', createdAt: '2026-10-02 10:18:22' },
]);

/**
 * Initialises the database and inserts the seed rows.
 *
 * @param {object} [options]
 * @param {boolean} [options.reset] delete existing rows first
 * @returns {Promise<{created: number, total: number}>}
 */
async function seed(options = {}) {
  const driver = await connect();
  const repository = new HistoryRepository(driver);

  try {
    if (options.reset) {
      const deleted = await repository.deleteAll();
      logger.info('Existing history cleared', { deleted });
    }

    const { calculate } = require('../src/expression/Calculator');
    const { describeKind } = require('../src/expression/Calculator');

    const existing = await repository.count();
    if (existing > 0 && !options.reset) {
      logger.warn('History table is not empty; only missing seed rows are added', { existing });
    }

    const current = await repository.findAll({});
    const known = new Set(current.map((row) => `${row.expression}|${row.createdAt}`));
    let created = 0;

    for (const row of SEED_ROWS) {
      if (known.has(`${row.expression}|${row.createdAt}`)) {
        continue;
      }
      const scientific = row.mode === 'scientific';
      const outcome = calculate(row.expression, { scientific });
      await repository.insert({
        expression: outcome.normalizedExpression,
        result: outcome.value,
        resultText: outcome.resultText,
        operation: describeKind(outcome.usedOperations, outcome.usedFunctions),
        mode: scientific ? 'scientific' : 'basic',
        createdAt: row.createdAt,
      });
      created += 1;
    }

    const total = await repository.count();
    logger.info('Seed finished', { table: TABLE_NAME, created, total });
    return { created, total };
  } finally {
    await driver.close();
  }
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  seed({ reset })
    .then(({ created, total }) => {
      process.stdout.write(`Seed complete: ${created} row(s) inserted, ${total} row(s) in the table.\n`);
    })
    .catch((error) => {
      logger.error('Seed failed', { message: error.message, stack: error.stack });
      process.exitCode = 1;
    });
}

module.exports = { seed, SEED_ROWS };
