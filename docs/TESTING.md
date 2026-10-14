# Testing — `832402111_calculator_backend`

Student ID: **832402111** — Software Engineering assignment, front-end/back-end separated calculator.

This document describes how the test suite is run, what each suite covers, how the
integration test is isolated, which technique the parser tests use, what is deliberately
not covered, how to add a test, and how a reviewer verifies the back end manually.

---

## Table of contents

1. [How to run the tests](#1-how-to-run-the-tests)
2. [Why every file runs in its own process](#2-why-every-file-runs-in-its-own-process)
3. [The five suites](#3-the-five-suites)
4. [What each unit suite covers](#4-what-each-unit-suite-covers)
5. [Isolation of the integration test](#5-isolation-of-the-integration-test)
6. [The parser test technique: asserting the postfix program](#6-the-parser-test-technique-asserting-the-postfix-program)
7. [What is deliberately not covered](#7-what-is-deliberately-not-covered)
8. [How to add a test](#8-how-to-add-a-test)
9. [Manual verification checklist for a reviewer](#9-manual-verification-checklist-for-a-reviewer)
10. [Recorded evidence](#10-recorded-evidence)

---

## 1. How to run the tests

### The whole suite

```
npm test
```

On Windows PowerShell, if script execution is restricted, the same command can be run
directly:

```
node scripts/runTests.js
```

`npm test` is defined in `package.json` as `node scripts/runTests.js` and nothing else, so
the two commands are identical.

The runner prints the reporter output of every file and ends with a summary:

```
=== Summary ===
PASS  api.test.js                    1374 ms
PASS  calculator.test.js              255 ms
PASS  converters.test.js              215 ms
PASS  parser.test.js                  253 ms
PASS  tokenizer.test.js               218 ms
5/5 test file(s) passed
```

The exit code is `0` only when every file passed, so the command is usable as a gate.

### One file

Any file can be executed on its own, which is the fastest way to iterate on a single
module:

```
node test/api.test.js
```

```
node test/parser.test.js
```

Each file uses the built-in test runner of Node.js (`node:test`) with
`node:assert/strict`, so no test framework is installed and `npm test` needs no extra
dependency.

**Total: 65 tests in 5 files, all passing.**

| File | Tests |
| --- | --- |
| `test/tokenizer.test.js` | 14 |
| `test/parser.test.js` | 13 |
| `test/calculator.test.js` | 14 |
| `test/converters.test.js` | 12 |
| `test/api.test.js` | 22 |
| **total** | **65** |

---

## 2. Why every file runs in its own process

`scripts/runTests.js` does not import the test files. It lists `test/*.test.js`, sorts the
names so the order is stable, and starts **one Node.js process per file** with
`spawnSync(process.execPath, [file], { stdio: 'inherit', cwd: <repository root> })`.

Two reasons:

1. **The API tests need their own server and their own database.** They start the real
   HTTP server and set `SQLITE_PATH`, `PORT`, `HOST`, `DB_CLIENT`, `ERROR_HTTP_MODE` and
   `SERVE_STATIC` *before* requiring the application. Those variables are read once by
   `src/config/config.js` and the module is then cached; in a single shared process a second
   test file could not obtain a different configuration, and a server started by one file
   would leak into the next.
2. **Process isolation also covers the module cache and the event loop.** A file that
   opened a database or a listener cannot affect the next file, and a failure such as an
   unhandled rejection stops only its own process and is reported as a `FAIL` line instead
   of aborting the whole run.

`stdio: 'inherit'` keeps the reporter output streaming to the console without buffering it
in memory, and the runner records the exit status and the duration of each file for the
summary.

---

## 3. The five suites

| Suite | File | Type | Tests | What it proves |
| --- | --- | --- | --- | --- |
| Tokenizer | `test/tokenizer.test.js` | unit | 14 | Lexical rules: what is a number, what is an operator, what is a legal name, and which input is refused before parsing even starts |
| Parser | `test/parser.test.js` | unit | 13 | Grammar and order of operations, verified through the emitted postfix program |
| Calculator | `test/calculator.test.js` | unit | 14 | The complete pipeline (tokenize → parse → evaluate → format) and the numeric results |
| Converters | `test/converters.test.js` | unit | 12 | The two extended conversion features, independent of the expression engine |
| API | `test/api.test.js` | integration | 22 | The whole chain over real HTTP: Express → middleware → controller → service → engine/repository → SQLite |

The first four suites call the modules directly. Only the last one needs a network, a
configurable environment and a database.

---

## 4. What each unit suite covers

### 4.1 `test/tokenizer.test.js` — 14 tests

| Behaviour | Detail |
| --- | --- |
| Splits a simple expression | `12+8` → the number, the operator and the number, terminated by an `EOF` token |
| Recognises decimals | `0.5`, `.5`, `5.` and `12.5/2` are accepted as written |
| Rejects a malformed number | `1.2.3` → `TOKENIZER_INVALID_NUMBER` |
| Normalises calculator symbols | `12×8`, `12÷8`, `12−8`, `12 ✕ 8` → ASCII operators |
| Strips every kind of whitespace | tabs, newlines and spaces disappear before tokenizing |
| Rewrites `^` and superscripts | `2^3`, `2²`, `2³` → the `**` operator |
| Rejects illegal characters | `1+2;`, `1 + $2` → `TOKENIZER_INVALID_CHARACTER` |
| Rejects code-like input | `process.exit()`, `require("fs")`, `constructor`, `__proto__`, `globalThis` → a classified refusal, nothing is executed |
| Numbers are literals, not expressions | `1e5` → `TOKENIZER_INVALID_NUMBER`; `0x10` and `Infinity` → `TOKENIZER_UNKNOWN_IDENTIFIER` |
| Rejects an empty expression | `''` and `'   '` → `VALIDATION_EMPTY_EXPRESSION` |
| Rejects an oversized expression | 400+ characters → `VALIDATION_EXPRESSION_TOO_LONG` or `TOKENIZER_TOO_MANY_TOKENS` |
| Scientific names are mode-gated | `sqrt(9)` without scientific mode → `VALIDATION_INVALID_PARAMETER`; with it → a function token, and `pi` → a constant token |
| Every token carries its position | `12+8` gives positions 0, 2, 3 and an `EOF` token |
| Normalisation is reusable | `normalizeExpression(' 12 × 8 ')` → `12*8`, `2²` → `2**2` |

### 4.2 `test/parser.test.js` — 13 tests

Covered per test: precedence, parentheses, unary signs, binary minus after a value,
right-associative power, power before a leading sign, implicit multiplication, function
arity, incomplete expressions, unmatched parentheses, two operands without an operator,
wrong argument counts and the nesting limit. The assertions are on the postfix program —
see [section 6](#6-the-parser-test-technique-asserting-the-postfix-program) for the table of
the important cases.

### 4.3 `test/calculator.test.js` — 14 tests

| Behaviour | Detail |
| --- | --- |
| The four basic operations | `12+8`, `20-7`, `6*7`, `84/12`, plus `12×8` and `12÷8` through the normaliser |
| Decimals | `12.5/2`, `.5+.25`, `1.5*1.5`, and `0.1+0.2` → `0.3` (the 12-significant-digit rule) |
| Compound expressions | `1+2*3`, `(1+2)*3`, `10/2+7`, `8-3*2`, `100/(4*5)`, `((2+3)*(7-4))/5` |
| Unary plus and minus | `-5`, `-5+8`, `3*-2`, `+7`, `--5`, `-3*-4` |
| Power and modulo | `2**10`, `2^8`, `2**3**2` → 512, `17%5`, `-2**2` → -4, `(-2)**2` → 4 |
| Scientific functions and constants | `sqrt`, `abs`, `pow`, `round`, `max`, `hypot`, and `sin(0)`, `cos(0)`, `ln(e)`, `pi` against their exact values |
| `ans` | `ans*2` with `ans: 21` → 42 |
| Division by zero | `10/0`, `10/(3-3)`, `0/0`, `5%0`, `0**-1` → `EVALUATOR_DIVISION_BY_ZERO` |
| Domain errors | `sqrt(-4)`, `ln(0)`, `log(-1)`, `asin(2)`, `(-8)**0.5` → `EVALUATOR_DOMAIN_ERROR` |
| Classified refusals | `1+*2`, `(1+2`, `1++`, `abc`, `1+2;`, `''` → the matching `PARSER_*`, `TOKENIZER_*` or `VALIDATION_*` code |
| Overflow and notation | `9**9**9` → `EVALUATOR_OVERFLOW`, `1e` → `TOKENIZER_INVALID_NUMBER` |
| Operation family | `describeKind` returns `addition`, `compound`, `scientific` and `subtraction` for the matching expressions |
| Rounding | `2/3` → `0.666666666667`, `1/3` → `0.333333333333`, `0.1+0.2` → `0.3` |
| Echoed normalised form | ` 12 × 8 ` → `12*8`, `2²` → `2**2` |

### 4.4 `test/converters.test.js` — 12 tests

| Behaviour | Detail |
| --- | --- |
| Decimal → binary/octal/hex/base-36 | `255` → `11111111`, `377`, `ff`, `73` |
| Zero and negative values | `0` → `0`, `-42` → `-2a` in hex |
| Fractional values | `10.5` → `1010.1`, `0.625` → `0.101` in binary |
| Large integers stay exact | `2**60` in binary and `9007199254740991` in hex keep every digit (the `BigInt` integer path) |
| Text in another base → decimal | `ff`/`FF` → 255, `1010.1` base 2 → 10.5, `777` base 8 → 511 |
| Invalid digit | `'12'` in base 2, `'zz'` in base 16, `'1.2.3'` → `TOKENIZER_INVALID_NUMBER` |
| Unsupported base | `7` → `VALIDATION_INVALID_BASE` in both directions |
| Length conversions | `1 km → 1000 m`, `1 in → 2.54 cm`, `1 mi → 1.609344 km`, `1 m → 3.28083989501 ft` |
| Affine temperature | `0 °C → 32 °F`, `100 °C → 212 °F`, `0 °C → 273.15 K`, `-40 °C → -40 °F`, `98.6 °F → 37 °C` |
| Mass, volume, data, speed | `1 kg → 2.20462262185 lb`, `2 l → 2000 ml`, `1 GiB → 1024 MiB`, `1 GB → 1000 MB`, `100 km/h → 27.7777777778 m/s` |
| Mixed categories | `kg → m` and the unknown unit `stone` → `VALIDATION_INVALID_PARAMETER` |
| Category listing | `describeUnits()` returns at least 8 categories, each with a name and at least one unit |

### 4.5 `test/api.test.js` — 22 tests (integration)

| Behaviour | Detail |
| --- | --- |
| Health | `200`, `status: "ok"`, `database.client: "sqlite"`, `database.status: "connected"` |
| Calculate an addition | `201`, `result: 20`, `resultText: "20"`, `operation: "addition"`, a positive `historyId` and a `createdAt` matching `YYYY-MM-DD HH:MM:SS` |
| Every required expression shape | ten expressions (`20-7` … `3*-2`) each answer `201` with the expected number |
| Display symbols | `12×8÷4` → `24`, and the response echoes the normalised `12*8/4` |
| Invalid expressions | `1+*2`, `(1+2`, `abc`, `1+2;` → `400` with `success: false`, the exact `error` code and a string `message` (strict mode) |
| Division by zero | `10/(3-3)` → `400` `EVALUATOR_DIVISION_BY_ZERO` with `message: "Division by zero"`, and the history total is unchanged — a refused expression stores nothing |
| Body validation | missing field, wrong type, empty expression, unknown mode, and a truncated body → `VALIDATION_MISSING_FIELD`, `VALIDATION_INVALID_FIELD_TYPE`, `VALIDATION_EMPTY_EXPRESSION`, `VALIDATION_INVALID_PARAMETER`, `VALIDATION_INVALID_JSON` |
| Oversized expression | 300+ characters → `VALIDATION_EXPRESSION_TOO_LONG` or `TOKENIZER_TOO_MANY_TOKENS` |
| Scientific mode | `sqrt(144)+2**3` with `"mode":"scientific"` → 20 and `mode: "scientific"`; the same expression without the mode → `VALIDATION_INVALID_PARAMETER` |
| History read-back | the record written by a calculation is found again by id, with the same expression, result and `resultText` |
| Pagination, search, filter | `limit=3&offset=0` honours `limit`/`offset`; `keyword=sqrt` returns only matching rows; `operation=addition` returns only additions; an unknown operation → `400 VALIDATION_INVALID_PARAMETER` |
| Newest first | the returned ids are in descending order |
| Delete one record | `DELETE /api/history/{id}` → `200`, `deletedId`, the record disappears, and repeating the same delete → `404 HISTORY_NOT_FOUND` |
| Invalid id | `DELETE /api/history/abc` → `400 VALIDATION_INVALID_PARAMETER` |
| Clear all | `DELETE /api/history` reports the deleted count, the table is empty afterwards, and the next calculation gets `historyId: 1` (sequence reset) |
| Statistics | `GET /api/stats?days=7` counts relatively (`total + 3`, `addition + 2`, `multiplication + 1`), returns a non-empty `daily` series and a `lastCalculationAt` |
| Base conversion | `value: 255` gives `11111111` in base 2 and `ff` in base 16; `"ff"` with `fromBase: 16` gives `value: 255`; `10.5` with `toBase: 2` gives `1010.1`; `"12"` base 2 → `TOKENIZER_INVALID_NUMBER`; `toBase: 7` → `VALIDATION_INVALID_BASE` |
| Unit conversion | `100 km/h → 62.1371192237 mph`, `100 °C → 212 °F`, `kg → k` → `VALIDATION_INVALID_PARAMETER`, and `GET /api/convert/units` returns at least 8 categories |
| Capabilities | 6 operators, `functions.sqrt` present, `constants` contains `pi`, `bases` is exactly `[2, 8, 10, 16, 36]` |
| Unknown endpoint | `404` with the standard error envelope and `error: "ROUTE_NOT_FOUND"` |
| CORS header | a request with `Origin: http://127.0.0.1:5500` receives `Access-Control-Allow-Origin: *` |
| Preflight | `OPTIONS /api/calculate` → `204`, and `Access-Control-Allow-Methods` contains `POST` |

---

## 5. Isolation of the integration test

`test/api.test.js` starts a real server and must neither depend on nor damage a developer's
database. It therefore arranges its environment **before** requiring the application,
because `src/config/config.js` reads `process.env` once and freezes the result:

| Setting | Value | Why |
| --- | --- | --- |
| temporary directory | `fs.mkdtempSync(path.join(os.tmpdir(), 'calculator-api-test-'))` | every run gets a fresh, unique directory in the operating system's temporary area |
| `SQLITE_PATH` | `<temporary dir>/test-api.db` | the real database of the project (`data/calculator.db`) is never opened, read or modified |
| `PORT` | `0` | the operating system assigns a free port, so the test cannot collide with a running service on 8080 or with a parallel test run |
| `HOST` | `127.0.0.1` | the server binds the loopback interface only |
| `DB_CLIENT` | `sqlite` | the default driver is exercised explicitly |
| `ERROR_HTTP_MODE` | `strict` | a refused expression must be visible as `400`; without this the assertions on the error status would be meaningless in `lenient` mode |
| `SERVE_STATIC` | `false` | the static middleware is not mounted, so the test only measures the API |
| `CORS_ORIGIN` | deleted | both the wildcard behaviour and the whitelist path stay under the default |

Then:

1. `test.before()` calls `start()` from `server.js`, which opens the temporary database,
   creates the schema there and listens on the ephemeral port. The base URL is built from
   `server.address().port`, so no port is ever hard-coded.
2. Every request goes over **real HTTP** with the global `fetch` of Node.js. Nothing is
   mocked or stubbed: the test therefore covers Express, the middleware chain, the routes,
   the controllers, the services, the expression engine, the repository and SQLite in one
   path.
3. `test.after()` closes the server and the database connection and then removes the
   temporary directory with `fs.rmSync(temporaryDirectory, { recursive: true, force: true })`,
   so a successful run leaves nothing behind — not even on failure, because the removal is
   registered unconditionally.

A helper turns a response into `{status, body}` by reading the text and parsing it when it
is not empty, and `postJson()` sends a JSON body with the correct `Content-Type`. That keeps
each test down to the assertions that matter.

---

## 6. The parser test technique: asserting the postfix program

`test/parser.test.js` does not execute anything. It calls `parse(tokenize(expression))` and
renders the resulting instruction list as a compact string — numbers as themselves,
constants by name, calls as `name/argCount`, operators by symbol — and compares that string
with the expected program:

```js
assert.equal(postfix('1+2*3'), '1 2 3 * +');
```

This makes the *order of operations* directly observable. A wrong precedence, a misplaced
unary sign or a broken associativity changes the text, so the failure message shows exactly
what the parser emitted instead of "expected 7, received 5" from an end-to-end value.

| Expression | Postfix program | What it demonstrates |
| --- | --- | --- |
| `1+2*3` | `1 2 3 * +` | multiplication is emitted before addition (precedence) |
| `(1+2)*3` | `1 2 + 3 *` | parentheses change the order of operations |
| `3*-2` | `3 2 - *` | a sign after an operator is unary, not a binary subtraction |
| `2**3**2` | `2 3 2 ** **` | `**` is right associative, so the value is 512 |
| `-2**2` | `2 2 ** -` | the power is applied before the leading sign, so the value is -4 |

Related cases in the same suite:

| Expression | Postfix program | Note |
| --- | --- | --- |
| `10/2+7` | `10 2 / 7 +` | division binds tighter than addition |
| `8-3*2` | `8 3 2 * -` | multiplication before subtraction |
| `2*(3+(4-1))` | `2 3 4 1 - + *` | nested groups |
| `-5` | `5 -` | unary minus on a literal |
| `3*-2` and `(-3)*-2` | `3 2 - *`, `3 - 2 - *` | unary signs in operand position |
| `8-3-2` | `8 3 - 2 -` | left-associative subtraction |
| `(-2)**2` | `2 - 2 **` | parentheses make the base negative before the power |
| `2(3+4)` | `2 3 4 + *` | implicit multiplication |
| `(1+2)(3+4)` | `1 2 + 3 4 + *` | implicit multiplication of two groups |
| `2pi` (scientific) | `2 pi *` | implicit multiplication with a constant |
| `sqrt(9)` (scientific) | `9 sqrt/1` | a call carries its arity |
| `pow(2,10)` (scientific) | `2 10 pow/2` | two-argument call |
| `2 3` | `23` | whitespace is removed during normalisation, so this is one number — and `(1+2) 3` is the real "missing operator" case |

---

## 7. What is deliberately not covered

* **No browser-level end-to-end test in this repository.** There is no Selenium,
  Playwright or Puppeteer dependency and no headless browser in the test run: the front end
  lives in its own repository, and an automated browser test would add a large dependency
  to a back-end assignment. The HTTP contract is covered completely by
  `test/api.test.js`; everything above it is the front end's responsibility.
* **The front end is verified manually, in a screenshot run.** A reviewer opens the page
  against a running back end and walks the checklist in
  [section 9](#9-manual-verification-checklist-for-a-reviewer); the screenshots of the
  working system are captured during that manual run, not by an automated browser test.
* **No load, performance or concurrency test.** The interesting performance properties here
  are the indexed queries and the flat postfix program, both of which are design decisions
  documented in `ARCHITECTURE.md` and `DATABASE.md` rather than asserted numerically.
* **No test of the MySQL driver variant.** `DB_CLIENT=mysql` needs a running MySQL server
  and the optional `mysql2` package, which the default install intentionally does not have.
  The MySQL code path is limited to the DDL and the three statement differences listed in
  `DATABASE.md`.
* **No test for `ERROR_HTTP_MODE=lenient`.** The suite pins `strict` so that a refusal is
  visible as `400`. `lenient` differs only in the status code of an already covered error
  path.

---

## 8. How to add a test

1. Decide the level. If the behaviour is pure logic (tokenizer, parser, calculator,
   converters), add it to the matching unit file. If it involves a URL, a status code or the
   database, add it to `test/api.test.js`.
2. Use `node:test` and `node:assert/strict`, exactly as the existing files do.
3. Name the test `module: behaviour` — the module name, a colon, then a short description
   of the behaviour. The reporter output then reads as a list of guarantees, for example
   `tokenizer: rejects a number with two decimal points`.

A complete, short example — a new unit test appended to `test/calculator.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { calculate } = require('../src/expression/Calculator');

test('calculator: modulo keeps the sign of the dividend', () => {
  assert.equal(calculate('-7%3').value, -1);
  assert.equal(calculate('7%-3').value, 1);
});
```

A new integration test is just as short, because the helpers already exist in
`test/api.test.js`:

```js
test('history: the operation filter accepts a compound expression', async () => {
  await postJson('/api/calculate', { expression: '1+2*3' });

  const filtered = await request('/api/history?operation=compound&limit=5');

  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.success, true);
  assert.equal(filtered.body.records.every((row) => row.operation === 'compound'), true);
});
```

Notes that keep a new test reliable:

* Assert on a **relative** change (count before versus count after) whenever the test
  stores data, so it does not depend on what earlier tests in the same file did.
* Prefer asserting the classified `error` code over asserting a message text; the codes are
  the stable contract.
* For a new *file*, only the file name matters: `scripts/runTests.js` discovers every
  `test/*.test.js` automatically and starts one process for it. Remember to set the
  environment variables at the top of the file, before requiring the modules under test.

---

## 9. Manual verification checklist for a reviewer

Run these steps in order. Steps 1–3 need a terminal in the repository root.

**1. Start the back end.**

```
npm start
```

Expected: a log line announcing the URL (`http://127.0.0.1:8080`), the active database
client and the CORS setting, followed by the API entry point line. `GET /api` in a browser
shows the landing document with the endpoint list.

**2. Confirm the service and its database are alive.**

```
curl http://127.0.0.1:8080/api/health
```

Expected: `"status": "ok"`, `"database": {"client": "sqlite", "status": "connected",
"storedRecords": <n>}`, the expression limits, the active `errorHttpMode` and the server
time. `storedRecords` must equal the number of rows `GET /api/history?page=all` returns.

**3. Walk the four required functions plus the error cases.**

| # | Check | Expected |
| --- | --- | --- |
| 3.1 | `POST /api/calculate` with `{"expression":"12+8"}` | `201`, `result: 20`, `resultText: "20"`, `operation: "addition"`, a `historyId` and a `createdAt` |
| 3.2 | `GET /api/history?page=all` | the calculation from 3.1 is present, newest first, with the normalised expression |
| 3.3 | `DELETE /api/history/{id}` with the `historyId` from 3.1 | `200`, `deletedId`, `remaining` decreased by one; repeating it gives `404 HISTORY_NOT_FOUND` |
| 3.4 | `DELETE /api/history` | `{"success": true, "deleted": n, "remaining": 0}`; the next calculation receives `historyId: 1` |
| 3.5 | `POST /api/calculate` with `{"expression":"10/(3-3)"}` | the error envelope with `EVALUATOR_DIVISION_BY_ZERO`, and the history total is **unchanged** (a refused expression stores nothing) |
| 3.6 | `POST /api/calculate` with `{"expression":"sqrt(144)"}` (no mode) | `VALIDATION_INVALID_PARAMETER` with a message telling the client to send `"mode":"scientific"` |
| 3.7 | the same expression with `"mode":"scientific"` | `201` with `result: 12` |
| 3.8 | `POST /api/calculate` with `{"expression":"1+2;"}` | `TOKENIZER_INVALID_CHARACTER` (a stable code, a readable message, no stack trace) |
| 3.9 | `GET /api/history?operation=teleportation` | `400 VALIDATION_INVALID_PARAMETER` |
| 3.10 | `GET /api/does-not-exist` | `404 ROUTE_NOT_FOUND` |
| 3.11 | `POST /api/convert/base` with `{"value":255}` | `11111111`, `377`, `255`, `ff`, `73` |
| 3.12 | `POST /api/convert/unit` with `{"value":100,"from":"°c","to":"°f"}` | `result: 212` |
| 3.13 | `GET /api/convert/units` | 8 categories with `baseUnit` and their units |
| 3.14 | `GET /api/capabilities` | 6 operators, the function list with `argCount`, the constants, `bases: [2,8,10,16,36]`, `modes: ["basic","scientific"]` |
| 3.15 | `GET /api/stats?days=7` | `total`, `byOperation`, a `daily` series and `lastCalculationAt` |

**4. Verify the CORS path.**

```
curl -i -H "Origin: http://127.0.0.1:5500" http://127.0.0.1:8080/api/health
```

Expected: `Access-Control-Allow-Origin: *` (default) while the request still answers `200`.
Set `CORS_ORIGIN` to a specific origin and confirm that only that origin is reflected.

**5. Open the front end against this back end and repeat 3.1–3.4 through the user
interface.** Every panel must show the numbers the API returned — the history panel
renders `resultText` verbatim, which is exactly what step 3.1 reported.

**6. Stop the back end and confirm that the page can no longer produce a result.**

```
Ctrl+C
```

Then repeat a calculation in the front end **with the back end stopped**. Expected: no
result appears. The page shows a connection error (or a health indicator that turns red)
and never a locally computed number — which is the proof that the front end contains no
calculation logic and that all arithmetic really happens in this back-end service. This is
also the reason `test/api.test.js` asserts on real HTTP rather than on a mock: the numbers
in the graduation screenshots must come from a real response.

**7. Restart the back end and confirm the state is intact.** The records created before
step 6 are still there and the history order is unchanged, which shows that the SQLite file
is the source of truth and not process memory.

**8. Run the automated suite once more.**

```
npm test
```

Expected: `5/5 test file(s) passed` and 65 tests passing.

---

## 10. Recorded evidence

`tools/api-transcript.txt` holds the raw transcript of a full evaluation run: the requests
that were actually sent, and the responses that were actually received, in order. It is the
recorded evidence behind the checklist above and behind the examples in `API.md` — the
reference document explains the contract, the transcript shows a real run of it.
