'use strict';

/**
 * Test runner.
 *
 * Runs every `*.test.js` file in `test/` in its own Node.js process and reports a
 * summary. Each file is isolated, which matters for the API tests: they create
 * their own temporary SQLite database and start a real HTTP server on an
 * ephemeral port.
 *
 * Child processes inherit the stdio of this process (`stdio: 'inherit'`), so the
 * output of the built-in test reporter is shown as it is produced and no output
 * is buffered in memory.
 *
 * Usage: node scripts/runTests.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testDirectory = path.resolve(__dirname, '..', 'test');
const files = fs
  .readdirSync(testDirectory)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

if (files.length === 0) {
  process.stderr.write('No test file found in test/\n');
  process.exitCode = 1;
} else {
  const results = [];

  for (const file of files) {
    process.stdout.write(`\n=== ${file} ===\n`);
    const started = Date.now();
    const result = spawnSync(process.execPath, [path.join(testDirectory, file)], {
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
    });
    results.push({ file, status: result.status, durationMs: Date.now() - started });
  }

  process.stdout.write('\n=== Summary ===\n');
  let failed = 0;
  for (const entry of results) {
    const ok = entry.status === 0;
    if (!ok) {
      failed += 1;
    }
    process.stdout.write(
      `${ok ? 'PASS' : 'FAIL'}  ${entry.file.padEnd(28)} ${String(entry.durationMs).padStart(6)} ms\n`,
    );
  }
  process.stdout.write(`${results.length - failed}/${results.length} test file(s) passed\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}
