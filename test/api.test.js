'use strict';

/**
 * Integration tests for the HTTP API.
 *
 * A real server is started on an ephemeral port with a temporary SQLite
 * database, and every request is sent over HTTP. Nothing is mocked, so these
 * tests cover the whole chain: Express -> controller -> service -> expression
 * engine -> repository -> SQLite.
 *
 * Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// --- configuration must exist before the modules read it -------------------
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'calculator-api-test-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test-api.db');
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
process.env.DB_CLIENT = 'sqlite';
process.env.ERROR_HTTP_MODE = 'strict'; // rejections must be visible as 4xx here
process.env.SERVE_STATIC = 'false';
delete process.env.CORS_ORIGIN;

const { start } = require('../server');

/** @type {{baseUrl: string, close: Function}} */
let context;

test.before(async () => {
  const instance = await start();
  context = { baseUrl: `http://127.0.0.1:${instance.server.address().port}`, close: instance.close };
});

test.after(async () => {
  await context.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

/**
 * @param {string} url
 * @param {object} [init]
 * @returns {Promise<{status: number, body: object}>}
 */
async function request(url, init) {
  const response = await fetch(`${context.baseUrl}${url}`, init);
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
}

/**
 * @param {string} url
 * @param {object} payload
 * @returns {Promise<{status: number, body: object}>}
 */
function postJson(url, payload) {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

test('health: reports a connected database', async () => {
  const { status, body } = await request('/api/health');
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.status, 'ok');
  assert.equal(body.database.client, 'sqlite');
  assert.equal(body.database.status, 'connected');
});

test('calculate: addition returns the back-end result and stores it', async () => {
  const { status, body } = await postJson('/api/calculate', { expression: '12+8' });
  assert.equal(status, 201); // 201: a history record was created
  assert.equal(body.success, true);
  assert.equal(body.result, 20);
  assert.equal(body.resultText, '20');
  assert.equal(body.operation, 'addition');
  assert.ok(body.historyId > 0);
  assert.match(body.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('calculate: every required expression shape', async () => {
  const cases = [
    ['20-7', 13],
    ['6*7', 42],
    ['84/12', 7],
    ['12.5/2', 6.25],
    ['1+2*3', 7],
    ['(1+2)*3', 9],
    ['10/2+7', 12],
    ['8-3*2', 2],
    ['-5+8', 3],
    ['3*-2', -6],
  ];

  for (const [expression, expected] of cases) {
    const { status, body } = await postJson('/api/calculate', { expression });
    assert.equal(status, 201, `${expression} should be accepted`);
    assert.equal(body.result, expected, `${expression} should evaluate to ${expected}`);
  }
});

test('calculate: the display symbols of the front end are accepted', async () => {
  const { body } = await postJson('/api/calculate', { expression: '12×8÷4' });
  assert.equal(body.result, 24);
  assert.equal(body.expression, '12*8/4');
});

test('calculate: invalid expressions answer 400 with a stable error code', async () => {
  const cases = [
    ['1+*2', 'PARSER_MISSING_OPERAND'],
    ['(1+2', 'PARSER_UNMATCHED_PARENTHESIS'],
    ['abc', 'TOKENIZER_UNKNOWN_IDENTIFIER'],
    ['1+2;', 'TOKENIZER_INVALID_CHARACTER'],
  ];

  for (const [expression, expectedCode] of cases) {
    const { status, body } = await postJson('/api/calculate', { expression });
    assert.equal(status, 400, `${expression} should be rejected`);
    assert.equal(body.success, false);
    assert.equal(body.error, expectedCode);
    assert.equal(typeof body.message, 'string');
  }
});

test('calculate: division by zero is refused and never stored', async () => {
  const before = (await request('/api/history?page=all')).body.total;
  const { status, body } = await postJson('/api/calculate', { expression: '10/(3-3)' });
  const after = (await request('/api/history?page=all')).body.total;

  assert.equal(status, 400);
  assert.equal(body.error, 'EVALUATOR_DIVISION_BY_ZERO');
  assert.equal(body.message, 'Division by zero');
  assert.equal(after, before, 'a failed calculation must not create a history record');
});

test('calculate: validates the shape of the request body', async () => {
  assert.equal((await postJson('/api/calculate', {})).body.error, 'VALIDATION_MISSING_FIELD');
  assert.equal((await postJson('/api/calculate', { expression: 42 })).body.error, 'VALIDATION_INVALID_FIELD_TYPE');
  assert.equal((await postJson('/api/calculate', { expression: '   ' })).body.error, 'VALIDATION_EMPTY_EXPRESSION');
  assert.equal((await postJson('/api/calculate', { expression: '1+1', mode: 'quantum' })).body.error, 'VALIDATION_INVALID_PARAMETER');

  const malformed = await request('/api/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"expression": ',
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error, 'VALIDATION_INVALID_JSON');
});

test('calculate: a too long expression is refused', async () => {
  const { status, body } = await postJson('/api/calculate', { expression: '9+'.repeat(150) + '9' });
  assert.equal(status, 400);
  assert.ok(['VALIDATION_EXPRESSION_TOO_LONG', 'TOKENIZER_TOO_MANY_TOKENS'].includes(body.error));
});

test('calculate: scientific mode enables functions and constants', async () => {
  const { body } = await postJson('/api/calculate', { expression: 'sqrt(144)+2**3', mode: 'scientific' });
  assert.equal(body.result, 20);
  assert.equal(body.mode, 'scientific');

  const rejected = await postJson('/api/calculate', { expression: 'sqrt(144)' });
  assert.equal(rejected.body.error, 'VALIDATION_INVALID_PARAMETER');
});

test('history: the record written by a calculation is readable', async () => {
  const { status, body } = await postJson('/api/calculate', { expression: '7*6' });
  const id = body.historyId;

  const all = await request('/api/history?page=all');
  assert.equal(all.status, 200);
  assert.equal(all.body.success, true);
  const record = all.body.records.find((item) => item.id === id);
  assert.ok(record, 'the new record must appear in the history listing');
  assert.equal(record.expression, '7*6');
  assert.equal(record.result, 42);
  assert.equal(record.resultText, '42');
  assert.ok(record.createdAt);
});

test('history: pagination, search and operation filter', async () => {
  const page = await request('/api/history?limit=3&offset=0');
  assert.equal(page.body.returned <= 3, true);
  assert.equal(page.body.limit, 3);
  assert.equal(page.body.offset, 0);
  assert.equal(typeof page.body.total, 'number');

  const search = await request('/api/history?keyword=sqrt&page=all');
  assert.equal(search.body.records.every((row) => row.expression.includes('sqrt')), true);

  const filtered = await request('/api/history?operation=addition&limit=5');
  assert.equal(filtered.body.records.every((row) => row.operation === 'addition'), true);

  const invalid = await request('/api/history?operation=teleportation');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'VALIDATION_INVALID_PARAMETER');
});

test('history: records are returned newest first', async () => {
  const { body } = await request('/api/history?limit=10');
  const ids = body.records.map((row) => row.id);
  const sorted = [...ids].sort((a, b) => b - a);
  assert.deepEqual(ids, sorted);
});

test('history: deleting one record removes it from the database', async () => {
  const created = await postJson('/api/calculate', { expression: '999-1' });
  const id = created.body.historyId;

  const deleted = await request(`/api/history/${id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.success, true);
  assert.equal(deleted.body.deletedId, id);

  const all = await request('/api/history?page=all');
  assert.equal(all.body.records.some((row) => row.id === id), false);

  const again = await request(`/api/history/${id}`, { method: 'DELETE' });
  assert.equal(again.status, 404);
  assert.equal(again.body.error, 'HISTORY_NOT_FOUND');
});

test('history: an invalid id is rejected', async () => {
  const { status, body } = await request('/api/history/abc', { method: 'DELETE' });
  assert.equal(status, 400);
  assert.equal(body.error, 'VALIDATION_INVALID_PARAMETER');
});

test('history: clearing removes every record and resets the sequence', async () => {
  const cleared = await request('/api/history', { method: 'DELETE' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.success, true);
  assert.ok(cleared.body.deleted > 0);

  const all = await request('/api/history?page=all');
  assert.equal(all.body.total, 0);
  assert.deepEqual(all.body.records, []);

  const recreated = await postJson('/api/calculate', { expression: '1+1' });
  assert.equal(recreated.body.historyId, 1, 'the auto increment sequence starts at 1 again');
});

test('stats: aggregates the stored history', async () => {
  const before = (await request('/api/stats')).body;
  const totalsBefore = before.total;
  const additionsBefore = before.byOperation.addition || 0;
  const multiplicationsBefore = before.byOperation.multiplication || 0;

  await postJson('/api/calculate', { expression: '2+2' });
  await postJson('/api/calculate', { expression: '3+3' });
  await postJson('/api/calculate', { expression: '4*4' });

  const { body } = await request('/api/stats?days=7');
  assert.equal(body.success, true);
  // Counted relatively, so the assertion does not depend on what the previous
  // tests in this file stored.
  assert.equal(body.total, totalsBefore + 3);
  assert.equal(body.byOperation.addition, additionsBefore + 2);
  assert.equal(body.byOperation.multiplication, multiplicationsBefore + 1);
  assert.equal(body.daily.length > 0, true);
  assert.ok(body.lastCalculationAt);
});

test('extended: number base conversion in both directions', async () => {
  const decimal = await postJson('/api/convert/base', { value: 255 });
  assert.equal(decimal.body.conversions.find((item) => item.base === 2).result, '11111111');
  assert.equal(decimal.body.conversions.find((item) => item.base === 16).result, 'ff');

  const fromHex = await postJson('/api/convert/base', { value: 'ff', fromBase: 16 });
  assert.equal(fromHex.body.value, 255);

  const fraction = await postJson('/api/convert/base', { value: 10.5, toBase: 2 });
  assert.equal(fraction.body.result, '1010.1');

  const invalid = await postJson('/api/convert/base', { value: '12', fromBase: 2 });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'TOKENIZER_INVALID_NUMBER');

  const badBase = await postJson('/api/convert/base', { value: 10, toBase: 7 });
  assert.equal(badBase.body.error, 'VALIDATION_INVALID_BASE');
});

test('extended: unit conversion with an affine unit (temperature)', async () => {
  const distance = await postJson('/api/convert/unit', { value: 100, from: 'km/h', to: 'mph' });
  assert.equal(distance.body.resultText, '62.1371192237');

  const temperature = await postJson('/api/convert/unit', { value: 100, from: '°c', to: '°f' });
  assert.equal(temperature.body.result, 212);

  const mismatch = await postJson('/api/convert/unit', { value: 1, from: 'kg', to: 'k' });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.error, 'VALIDATION_INVALID_PARAMETER');

  const units = await request('/api/convert/units');
  assert.equal(units.status, 200);
  assert.ok(units.body.categories.length >= 8);
});

test('capabilities: describes operators, functions and constants', async () => {
  const { body } = await request('/api/capabilities');
  assert.equal(body.success, true);
  assert.equal(body.operators.length, 6);
  assert.ok(body.functions.sqrt);
  assert.ok(body.constants.includes('pi'));
  assert.deepEqual(body.bases, [2, 8, 10, 16, 36]);
});

test('http: an unknown endpoint answers 404 with the standard error shape', async () => {
  const { status, body } = await request('/api/does-not-exist');
  assert.equal(status, 404);
  assert.equal(body.success, false);
  assert.equal(body.error, 'ROUTE_NOT_FOUND');
});

test('http: CORS headers allow another origin to read the response', async () => {
  const response = await fetch(`${context.baseUrl}/api/health`, {
    headers: { Origin: 'http://127.0.0.1:5500' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

test('http: preflight requests are answered without a body', async () => {
  const response = await fetch(`${context.baseUrl}/api/calculate`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://127.0.0.1:5500',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods').includes('POST'), true);
});
