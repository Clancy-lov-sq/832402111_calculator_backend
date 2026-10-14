# Architecture — `832402111_calculator_backend`

Student ID: **832402111** — Software Engineering assignment, front-end/back-end separated calculator.

This document describes the system design of the back end: the layers, the direction of
the dependencies, the request lifecycle, the design of the expression engine and of the
storage layer, the error strategy, the security posture and the deployment shapes.

---

## Table of contents

1. [Overview](#1-overview)
2. [Layers](#2-layers)
3. [Dependency direction](#3-dependency-direction)
4. [Request lifecycle](#4-request-lifecycle)
5. [The expression engine pipeline](#5-the-expression-engine-pipeline)
6. [Storage design](#6-storage-design)
7. [Error strategy](#7-error-strategy)
8. [Security posture](#8-security-posture)
9. [Deployment shapes](#9-deployment-shapes)
10. [Known limitations](#10-known-limitations)

---

## 1. Overview

The back end is a layered Node.js/Express service. A request always travels in one
direction: from the transport edge towards pure logic, and back.

```
                            ┌──────────────────────────────────────────┐
   HTTP client              │  server.js                               │
   (browser front end,      │  entry point: config → DB → app → listen │
    curl, Postman)          └───────────────────┬──────────────────────┘
            │                                   │ createApp({ historyRepository })
            │  request                          ▼
            │                    ┌──────────────────────────────────────┐
            │                    │  src/app.js  Express application     │
            │                    │  1 requestLogger                     │
            │                    │  2 cors                              │
            │                    │  3 express.json({ limit: '64kb' })   │
            │                    │  4 GET /api landing document         │
            └───────────────────▶│  5 API routes                        │
                                 │  6 static front end (public/)        │
                                 │  7 404 handler                       │
                                 │  8 error handler                     │
                                 └───────────────┬──────────────────────┘
                                                 │
                                                 ▼
                                 ┌──────────────────────────────────────┐
                                 │  src/routes/index.js                 │
                                 │  URL → controller function           │
                                 └───────────────┬──────────────────────┘
                                                 │
                                                 ▼
                                 ┌──────────────────────────────────────┐
                                 │  src/controllers/                    │
                                 │  request in → status + envelope out  │
                                 └───────────────┬──────────────────────┘
                                                 │
                                                 ▼
                                 ┌──────────────────────────────────────┐
                                 │  src/services/                       │
                                 │  validation, order of operations,    │
                                 │  persistence decisions               │
                                 └───────┬──────────────────────┬───────┘
                                         │                      │
                                         ▼                      ▼
                    ┌────────────────────────────┐  ┌────────────────────────────┐
                    │  src/expression/           │  │  src/storage/              │
                    │  Token → Tokenizer →       │  │  database → schema →       │
                    │  Parser → Evaluator →      │  │  historyRepository         │
                    │  NumberFormatter           │  │  (all SQL, ? binding)      │
                    │  (no HTTP, no SQL)         │  │  (no HTTP, no expressions) │
                    └────────────────────────────┘  └─────────────┬──────────────┘
                                                                  │
                                                                  ▼
                                                    ┌────────────────────────────┐
                                                    │  SQLite (node:sqlite) or   │
                                                    │  MySQL (optional mysql2)   │
                                                    └────────────────────────────┘

   Cross-cutting, imported by every layer:
     src/config/config.js   the only module that reads process.env
     src/utils/errors.js    ErrorCode table + AppError
     src/utils/response.js  success() / failure()
     src/utils/logger.js    level filtered console logging
     src/middleware/        requestLogger, cors, errorHandler
```

The two branches under `src/services` are independent of each other: an expression never
touches SQL, and a history query never touches the expression engine. The only module that
knows both is the calculation service, whose whole job is to decide *in which order* the
two happen.

---

## 2. Layers

| Layer | Directory / file | Responsibility | What it must **not** do |
| --- | --- | --- | --- |
| Entry point | `server.js` | Read the configuration, open the database, create the repository and the app, listen on `HOST:PORT`, install shutdown handlers | Contain route definitions or business rules |
| Application factory | `src/app.js` | Build the Express app: middleware order, the landing document, mount the routes, mount the optional static front end, install the 404 and error handlers. Takes its dependencies as arguments | Reach for a global database handle or read `process.env` |
| Routing | `src/routes/index.js` | The route table: URL + HTTP method → controller function. Wraps async handlers so a rejected promise reaches the error middleware | Contain validation, SQL or arithmetic |
| Controllers | `src/controllers/calculatorController.js`, `src/controllers/historyController.js` | Read the request (body, query, params), call exactly one service function, choose the HTTP status and send the envelope | Contain SQL, precedence rules or rounding rules |
| Services | `src/services/calculationService.js`, `historyService.js`, `baseConverter.js`, `unitConverter.js` | Own the order of a use case: validate input, call the engine or the repository, decide what is persisted. Own the accepted vocabulary (`mode`, operation families, bases, units) | Know about `req`/`res`, or emit HTTP status codes |
| Expression engine | `src/expression/` (`Token.js`, `Tokenizer.js`, `Parser.js`, `Evaluator.js`, `Functions.js`, `NumberFormatter.js`, `Calculator.js`) | Normalise, tokenize, parse and evaluate an expression; format the result | Touch HTTP, the database or the logger |
| Storage | `src/storage/` (`database.js`, `schema.js`, `historyRepository.js`) | Every SQL statement, parameter binding, row → JSON mapping, schema creation at start-up, driver selection | Know about HTTP, expressions or business rules |
| Configuration | `src/config/config.js` | The only module that reads `process.env`; provides validated values with defaults, frozen so nobody mutates them at run time | Be imported by a module that could have its own environment logic |
| Utilities | `src/utils/errors.js`, `response.js`, `logger.js` | The `ErrorCode` table plus the `AppError` class; the `success()` / `failure()` envelopes; the level-filtered logger | Hold business rules |
| Middleware | `src/middleware/requestLogger.js`, `cors.js`, `errorHandler.js` | Cross-cutting request concerns: access logging, CORS and preflight, the single place that formats every failure | Contain endpoint-specific logic |
| Scripts | `scripts/runTests.js`, `scripts/seed.js` | Test orchestration and database initialisation/seeding | Be imported by the running service |

---

## 3. Dependency direction

Dependencies point **one way only**:

```
server.js → app.js → routes → controllers → services → expression
                                                     ↘ storage → database driver
        everything ↓ may use: config, utils, middleware
```

Concretely:

* `src/routes` imports controllers, never repositories.
* `src/controllers` import services and `utils/response`, never `src/storage` and never
  `src/expression` directly.
* `src/services` import `src/expression` and receive the repository through their
  `deps` argument, so a service can be exercised with a stub repository.
* `src/expression` imports only `src/config` and `src/utils` — no HTTP, no SQL, no `fs`.
* `src/storage` imports `src/config`, `src/utils` and the driver, but no HTTP type.
* `src/app.js` receives `historyRepository` as a constructor-style argument
  (`createApp({ historyRepository })`) instead of importing a singleton.

Why this matters for this assignment:

1. **The expression engine is testable without HTTP.** `test/tokenizer.test.js`,
   `test/parser.test.js` and `test/calculator.test.js` call `tokenize`, `parse` and
   `calculate` directly. They need no server, no port, no JSON and no database, so a
   failure in those files can only come from the engine.
2. **The API is testable without a browser.** `test/api.test.js` starts the real server on
   an ephemeral port against a temporary SQLite file and uses `fetch`. No DOM, no front-end
   build step, no manual clicking is involved.
3. **The storage layer is testable without the API.** The seed script drives the same
   repository and the same schema code as the running server, which is why
   `npm run db:init` and a normal start-up cannot behave differently.
4. **A layer can be replaced without touching the others.** `DB_CLIENT=mysql` swaps the
   driver behind the same promise-based interface (`all` / `get` / `run` / `close`), and
   the repository, the services, the controllers and the routes stay unchanged.

---

## 4. Request lifecycle

### 4.1 Start-up

1. `node server.js` executes `src/config/config.js`, which reads every environment
   variable once and freezes the result. Nothing else in the project calls `process.env`.
2. `start()` calls `connect()` in `src/storage/database.js`. With the default
   `DB_CLIENT=sqlite` this requires `node:sqlite`, creates the parent directory of
   `SQLITE_PATH` when it is missing, and opens `data/calculator.db`.
3. `initializeSchema(driver)` runs `CREATE TABLE IF NOT EXISTS calculation_history` and
   both `CREATE INDEX IF NOT EXISTS` statements from `src/storage/schema.js`. Start-up is
   therefore idempotent: an existing database is never modified destructively, and a
   fresh checkout needs no manual SQL.
4. `new HistoryRepository(driver)` binds the statement set of the active driver.
5. `createApp({ historyRepository })` builds the Express application and stores the
   repository in `app.locals`, where controllers read it from `req.app.locals`.
6. `app.listen(config.server.port, config.server.host)` starts accepting connections —
   **after** the database is ready, so a client can never reach an API whose storage is
   still uninitialised.
7. `SIGINT` / `SIGTERM` handlers log the shutdown; the exported `close()` closes the HTTP
   server and then the driver.

### 4.2 One request, step by step

Example: `POST /api/calculate` with `{"expression":"12+8"}`.

| # | Where | What happens |
| --- | --- | --- |
| 1 | `src/middleware/requestLogger.js` | Records the start time and registers a `finish` listener that will log `POST /api/calculate -> 201` with the duration, the response size and the origin. Registered first, so a rejected request is logged too. |
| 2 | `src/middleware/cors.js` | Answers an `OPTIONS` preflight immediately with `204` and the CORS headers. For a normal request it sets `Access-Control-Allow-Origin` (`*` by default, or the reflected whitelisted origin). |
| 3 | `express.json({ limit: '64kb' })` | Parses the body. A body over the limit fails here with `entity.too.large`; malformed JSON fails here with a `SyntaxError` carrying `body`. Both are later classified by the error handler. |
| 4 | `src/app.js` | The landing route `GET /api` is checked; other `/api/*` URLs fall through to the router. |
| 5 | `src/routes/index.js` | Matches `POST /calculate` and calls the wrapped `calculatorController.calculate`. The wrapper forwards a rejected promise to `next(error)`. |
| 6 | `src/controllers/calculatorController.js` | Calls `calculationService.calculateAndStore(req.body || {}, { historyRepository: req.app.locals.historyRepository, persist: … })` and then chooses the status: `201` when the returned body carries a `historyId`, otherwise `200`. |
| 7 | `src/services/calculationService.js` | Validates `expression`, `mode` and `ans`; starts a `process.hrtime.bigint()` timer; calls `Calculator.calculate(expression, { scientific, ans })`. |
| 8 | `src/expression/Calculator.js` | Runs the pipeline: `tokenize` → `parse` → `evaluate` → `formatResult`, and returns `{normalizedExpression, value, resultText, usedOperations, usedFunctions}`. |
| 9 | `src/services/calculationService.js` | Derives the operation family with `describeKind`, then — only after a successful evaluation — inserts the record through `historyRepository.insert(...)`. |
| 10 | `src/storage/historyRepository.js` | Runs the parameterised `INSERT` (`?` placeholders, database-generated `created_at`), re-reads the row by `lastInsertRowid` and maps snake_case columns to the camelCase JSON shape. |
| 11 | `src/controllers/calculatorController.js` | Sends `res.status(201).json(body)` where `body` already is the success envelope (`success: true` first, then the payload). |
| 12 | `src/middleware/requestLogger.js` | The `finish` listener logs the completed request. |

If any step throws an `AppError`, steps 6–11 are skipped and the request jumps to
`errorHandler`, which produces the error envelope and the status for that code. If the
thrown value is *not* an `AppError`, the handler logs the stack trace and answers a generic
`500 INTERNAL_ERROR`.

### 4.3 Middleware order is part of the contract

| Order | Middleware | Why here and not elsewhere |
| --- | --- | --- |
| 1 | `requestLogger()` | Must see every request, including one that is rejected by CORS or by the body parser. |
| 2 | `cors(corsOptions)` | A preflight must be answered before any parsing or routing work. |
| 3 | `express.json({ limit: '64kb' })` | A body that is too large is refused early, before any service logic runs. |
| 4 | `GET /api` landing document | Registered before the router so it is not shadowed by it. |
| 5 | `app.use('/api', routes)` | The whole API lives under one prefix. |
| 6 | optional `express.static(public/)` | Only mounted when `SERVE_STATIC` is not `false` **and** the directory exists, which is what makes the two deployment shapes one code path. |
| 7 | `notFoundHandler` | Turns an unknown URL into a JSON error instead of Express's HTML page. |
| 8 | `errorHandler` | The single formatting point for every failure, with four arguments so Express recognises it as an error handler. |

---

## 5. The expression engine pipeline

```
raw string
   │
   ├─ 1. normalise      src/expression/Token.js      normalizeExpression()
   │
   ├─ 2. tokenize       src/expression/Tokenizer.js  tokenize()
   │
   ├─ 3. parse          src/expression/Parser.js     parse() → postfix program
   │
   ├─ 4. evaluate       src/expression/Evaluator.js  evaluate() → {value, usedOperations, usedFunctions}
   │
   └─ 5. format         src/expression/NumberFormatter.js  formatResult()
                                                                 │
                                                                 ▼
                       { normalizedExpression, value, resultText,
                         usedOperations, usedFunctions }
```

### 5.1 Normalise

`normalizeExpression` removes every kind of whitespace (including the ideographic space
`\u3000` and the non-breaking space `\u00a0`), folds full-width characters to ASCII
(`（ ） ，`), maps the calculator symbols the front end shows to API operators
(`× ✕ ⋅ · ∗` → `*`, `÷ ∕` → `/`, `− – —` → `-`), folds superscript digits (`2²` → `2**2`)
and rewrites `^` to `**`.

*Consequence:* `2 3` is the single number `23`, because whitespace is gone before the
tokenizer ever sees the string. This is documented rather than accidental: the normalised
form is also the string stored in the database and echoed back in the `expression` field
of the response, so the client and the history agree on what was calculated.

### 5.2 Tokenize

The tokenizer walks the normalised string once and emits `NUMBER`, `OPERATOR`, `LPAREN`,
`RPAREN`, `FUNCTION`, `CONSTANT`, `COMMA` and a terminating `EOF` token. Each token carries
its source position, which is what makes an error message like
`Character ";" at position 4 is not allowed` possible.

* Only a closed character set is accepted; everything else is
  `TOKENIZER_INVALID_CHARACTER`.
* Numbers are plain decimal literals: `12`, `12.5`, `.5`, `5.`. Scientific notation
  (`1e5`) is refused with `TOKENIZER_INVALID_NUMBER` *explicitly*, because otherwise `1e5`
  would be read as the number `1` followed by the constant `e` and produce a confusing
  message for a very common mistake. A second decimal point (`1.2.3`) is refused the same
  way.
* Identifiers are looked up in the function and constant whitelists. In `basic` mode a
  known scientific name is refused with `VALIDATION_INVALID_PARAMETER` and a message that
  tells the client to send `"mode":"scientific"`; an unknown name is
  `TOKENIZER_UNKNOWN_IDENTIFIER`.
* `MAX_EXPRESSION_LENGTH` (200) and `MAX_TOKEN_COUNT` (256) are enforced here, which
  bounds the work of every later stage.

### 5.3 Parse — and why a postfix program instead of direct evaluation

The parser is a recursive-descent parser that emits a **flat postfix program**
(`NUMBER`, `CONSTANT`, `UNARY`, `BINARY`, `CALL`) rather than an abstract syntax tree:

```
expression     := additive
additive       := multiplicative (('+' | '-') multiplicative)*
multiplicative := unary (('*' | '/' | '%') unary)*
unary          := ('+' | '-') unary | power
power          := primary ('**' unary)?          (right associative)
primary        := NUMBER | CONSTANT | '(' expression ')'
                | FUNCTION '(' expression (',' expression)* ')'
                | primary '(' expression ')'     (implicit multiplication)
                | primary CONSTANT               (implicit multiplication, "2pi")
```

Why this shape:

* **No precedence logic in the evaluator.** The order of operations is already frozen in
  the instruction order, so the evaluator is a loop over one stack with no operator table
  and no lookahead. There is exactly one place in the project where precedence can be
  wrong.
* **The program can be asserted in a test.** `test/parser.test.js` converts the program to
  text (`1 2 3 * +`) and compares it, which verifies precedence, unary handling and
  associativity without executing anything and without inspecting an object tree.
* **Evaluation cannot recurse.** A deeply nested expression produces a longer flat list
  instead of a deeper recursion, so a hostile input cannot blow the call stack during
  evaluation. Nesting is still bounded explicitly (`MAX_NESTING_DEPTH`, 32) so parsing
  itself is bounded too.
* **Recursive descent instead of a precedence table.** Precedence lives in the call order
  of `parseAdditive` → `parseMultiplicative` → `parseUnary` → `parsePower` → `parsePrimary`.
  Reading the grammar and reading the code are the same activity, and a shunting-yard style
  numeric precedence table over an operator stack cannot silently disagree with the
  documented grammar.
* **Right-associative power.** `parsePower` calls `parseUnary` for the exponent, so
  `2**3**2` is `2**(3**2) = 512`, and the exponent may carry a sign (`2**-3`).
* **Power binds tighter than a leading sign.** `parseUnary` handles a sign *around* a
  power, so `-2**2` is `-(2**2) = -4` while `(-2)**2 = 4` — the rule used by spreadsheets
  and by scientific calculators with a separate negation key.
* **Implicit multiplication** is supported where it is unambiguous (`2(3+4)`,
  `(1+2)(3+4)`, `2pi`), but a number directly followed by another number or by a function
  call stays an error (`PARSER_MISSING_OPERATOR`), because it is far more likely to be a
  typo than an intended multiplication.
* **Arities are checked while parsing.** `parseFunctionCall` compares the argument count
  with the whitelist entry and raises `PARSER_INVALID_FUNCTION_CALL`, so `sin(1,2)` fails
  before any function is called.

### 5.4 Evaluate

The evaluator executes the instruction list with a single operand stack. It contains no
precedence logic at all; it only pushes literals and constants, applies operators, calls
whitelisted functions and validates the arithmetic:

* `x / 0` and `x % 0` → `EVALUATOR_DIVISION_BY_ZERO`; `0 ** negative` is reported the same
  way, because it is a division by zero in disguise.
* A negative base with a non-integer exponent → `EVALUATOR_DOMAIN_ERROR` (no real result).
* Functions validate their own domains: `sqrt(-4)`, `ln(0)`, `log(-1)`, `asin(2)`,
  `tan(pi/2)` → `EVALUATOR_DOMAIN_ERROR`.
* `NaN` → `EVALUATOR_NOT_A_NUMBER`; `Infinity` or a magnitude beyond a double →
  `EVALUATOR_OVERFLOW`. A meaningless value is never written to the history.
* A program that does not leave exactly one value on the stack is a defect, not a user
  error, and is reported as `INTERNAL_ERROR`.
* The evaluator records which operation families and which function names were actually
  used. That record is what `describeKind` turns into the `operation` column, so a
  statistic never has to re-parse a stored expression.

**Whitelist instead of dynamic lookup.** Functions and constants are resolved through
`getFunction(name)` / `getConstant(name)`, which use `Object.prototype.hasOwnProperty.call`
on frozen tables. A dynamic lookup such as `Math[name]` would make any property of the
object reachable from a user expression; with the whitelist, `constructor`, `__proto__`,
`process`, `globalThis` and `require` are simply unknown identifiers and are refused by the
tokenizer.

### 5.5 Format

`formatResult` rounds the value to **12 significant digits** with
`Number(value.toPrecision(12))` and normalises `-0` to `0`, then produces the display
string.

* **Why 12 significant digits.** Doubles are binary, so a mathematically exact result can
  be stored as `0.30000000000000004`. Rounding at 12 significant digits removes that
  representation noise while keeping full accuracy for ordinary calculator work:
  `0.1+0.2` → `0.3`, `1/3` → `0.333333333333`, `2**0.5` → `1.41421356237`.
* **Why two result fields.** The rounding is applied once, in the engine, and its result is
  passed on twice: as the number `result` (machine-readable, used for reuse and statistics)
  and as the string `resultText` (exactly what the user saw). The front end never
  re-implements the rounding rule, so it cannot disagree with the back end, and the stored
  number stays usable if the display rule ever changes.
* `-0` is normalised because it is mathematically the same as `0` but confusing in an API
  response and in a stored record.

---

## 6. Storage design

**Schema creation on start-up.** `connect()` always runs `initializeSchema(driver)`, which
executes `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. This is why the
grader needs no SQL script and no database server: the first start creates
`data/calculator.db` with its table and indexes, and every later start is a no-op.

**One table for both clients.** `calculation_history` is the only table. It is declared
twice — once as SQLite DDL and once as MySQL DDL — in `src/storage/schema.js`, and the
differences are small and explicit: `INTEGER PRIMARY KEY AUTOINCREMENT` vs
`INT UNSIGNED AUTO_INCREMENT`, `TEXT` vs sized `VARCHAR`, `REAL` vs `DOUBLE`,
`strftime(...)` vs `CURRENT_TIMESTAMP` / `DATETIME`, plus `ENGINE=InnoDB` and `utf8mb4`.
Everything that consumes the table works identically on both, because the repository only
ever sees the promise-based `all` / `get` / `run` interface of `src/storage/database.js`.

**Two indexes, matched to the two real query shapes.**

| Index | Columns | Query it serves |
| --- | --- | --- |
| `idx_calculation_history_created_at` | `(created_at DESC, id DESC)` | the default newest-first listing and the daily aggregation that groups by `created_at` |
| `idx_calculation_history_operation` | `(operation)` | the `GROUP BY operation` aggregation of `GET /api/stats`, and the `operation = ?` filter of `GET /api/history` |

No third index is declared. The assignment's queries are exactly these two shapes, and an
unused index would only slow down inserts and add noise to the schema.

**Parameter binding.** Every value is passed as a `?` parameter and bound by the driver.
No SQL string is ever built by concatenating user input — the only string concatenation in
the repository is the composition of *static* fragments (`WHERE … AND …`,
`ORDER BY id DESC LIMIT ? OFFSET ?`), never a value. A keyword such as
`'); DROP TABLE calculation_history; --` is stored as plain text, and a search for a
literal `%` is possible because the LIKE wildcards are escaped before binding.

**Rows in, JSON out.** `mapRow` is the single place where SQL naming becomes API naming
(`result_text` → `resultText`, `created_at` → `createdAt`), so the front end never has to
know a column name.

---

## 7. Error strategy

**One classified error type.** `AppError` (`src/utils/errors.js`) carries a stable code
from the frozen `ErrorCode` table, an HTTP status, an optional safe `detail`, and a
default human message from `ERROR_MESSAGES`. Every deliberate refusal in the project is an
`AppError`: `throw new AppError(ErrorCode.EVALUATOR_DIVISION_BY_ZERO, { detail: … })`.

Default statuses are derived from the code: `404` for `HISTORY_NOT_FOUND` and
`ROUTE_NOT_FOUND`, `500` for `STORAGE_FAILURE` and `INTERNAL_ERROR`, `400` for everything
else. The two 404s are deliberately outside the error-mode switch.

**One error shape.** `failure(error)` in `src/utils/response.js` produces exactly
`{success: false, error, message}` plus `detail` when one exists, and `errorHandler` is the
only middleware that writes it. A client therefore never has to handle two failure formats,
whether the failure came from the tokenizer, the repository or an unhandled defect.

**The error HTTP mode.** `errorHandler` consults `ERROR_HTTP_MODE`: in `lenient` mode a
classified 4xx (except the two 404s) is downgraded to `200` while keeping
`success: false` and the same `error` code, which matches the simple response format used
in the assignment examples; in `strict` mode the real `400` is sent, which is what the
integration tests assert. The decision lives in exactly one `classify()` function, so the
two modes cannot drift apart per endpoint.

**Only classified errors expose their message.** `classify()` maps a thrown value to an
`AppError` in four steps:

1. `error instanceof AppError` → use it as it is (possibly downgraded to `200` in lenient
   mode).
2. `SyntaxError` with a `body` property → `VALIDATION_INVALID_JSON` (the body parser's
   malformed-JSON error).
3. `error.type === 'entity.too.large'` → `VALIDATION_INVALID_PARAMETER` with `413` and a
   message naming the 64 kb limit.
4. Anything else → `INTERNAL_ERROR` with `500`, with no information from the original
   error in the response.

**Unexpected defects are logged, not answered.** For a mapped status of `500` or more the
handler logs the method, the path, the code, the message and the **stack trace** through
`logger.error`; the client receives only the generic `INTERNAL_ERROR` body. A stack trace,
a file path or a SQL fragment therefore never reaches a browser, while the developer still
has the full detail in the server log. Rejections below 500 are logged with
`logger.warn` at the level of the code and the safe detail, which keeps normal client
mistakes out of the error log.

---

## 8. Security posture

| Control | Where it is implemented |
| --- | --- |
| **No dynamic code execution.** Neither `eval`, nor `exec`, nor `new Function` exists anywhere in the project. The expression engine is a hand-written tokenizer, parser and stack machine. | `src/expression/*` |
| **Input validated at the boundary with a closed character set.** After normalisation only digits, `.`, `(`, `)`, `,`, the six operators and known identifier names can become tokens; anything else is refused with a position in the message. | `Tokenizer.js` |
| **Whitelisted functions and constants.** Name lookup is `hasOwnProperty` on frozen tables, so object internals (`constructor`, `__proto__`) are unreachable. `process.exit()`, `require("fs")`, `globalThis` and `constructor` are refused as unknown identifiers. | `Functions.js` |
| **Prepared statements only.** All values are bound to `?` placeholders; no SQL text is ever composed from user input. LIKE wildcards are escaped before binding. | `historyRepository.js`, `schema.js` |
| **Body size limit.** `express.json({ limit: '64kb' })`, with a `413` response for anything larger. An expression needs a few dozen bytes. | `app.js`, `errorHandler.js` |
| **Work limits on expressions.** At most 200 characters, 256 tokens and 32 levels of nesting, all configurable through `MAX_EXPRESSION_LENGTH`, `MAX_TOKEN_COUNT` and `MAX_NESTING_DEPTH`. Combined with the flat postfix program this bounds both time and stack usage. | `config.js`, `Tokenizer.js`, `Parser.js` |
| **No information leak in failures.** Only `AppError` messages are exposed; internal defects answer a fixed generic body and keep their stack trace in the log. | `errorHandler.js` |
| **CORS whitelist for production.** `CORS_ORIGIN` defaults to `*` for development; setting it to the deployed page origin turns the middleware into a whitelist, and credentials are off. | `middleware/cors.js` |
| **Honest framing.** `x-powered-by` is disabled and `trust proxy` is set to one hop, so the access log reports the real client address behind a reverse proxy. | `app.js` |

---

## 9. Deployment shapes

**Shape 1 — separated front end and back end (the assignment's shape).**

```
browser ──► static front end (GitHub Pages, a static server, file://-free dev server)
   │
   └──────► this Express service  ──► SQLite file (or MySQL)
             http://<host>:8080
```

The front end is a separate application that calls the API over HTTP from another origin.
`SERVE_STATIC=false` (or the absence of `public/`) means the static middleware is not
mounted at all. `CORS_ORIGIN` is set to the exact origin of the deployed page.

**Shape 2 — a single service (convenience deployment).**

```
browser ──► this Express service
             ├──  /            static front end from public/
             └──  /api/...     the API on the same origin
```

The front-end build output is copied into `public/`, `SERVE_STATIC` keeps its default
`true`, and `express.static` serves the page next to the API. Same origin means no CORS
negotiation at all. `STATIC_DIR` can point somewhere else, for example a directory outside
the repository.

Both shapes are one code path: `src/app.js` mounts the static middleware only when
`config.static.enabled` is true **and** the directory exists, so switching between them is
an environment change, not a code change.

---

## 10. Known limitations

* **No authentication and no authorisation.** Every endpoint is public. The history is a
  single shared list; there is no notion of a user or a session, so anyone who can reach
  the service can read, delete and clear everything in it.
* **No rate limiting.** Nothing throttles repeated requests. The expression limits
  (200 characters, 256 tokens, 32 nesting levels) bound the cost of a single request, but
  they do not bound the request rate.
* **Timestamps are in the server's local time.** `created_at` is produced by the database
  with `strftime('%Y-%m-%d %H:%M:%S','now','localtime')` (SQLite) or `CURRENT_TIMESTAMP`
  (MySQL), so the stored times depend on the clock and the time zone of the host, and a
  client in another time zone sees local-server times. `GET /api/health` reports the
  server time in ISO 8601 so a client can at least detect the offset.
* **No API versioning.** The API is unversioned (no `/v1`) because it is a single
  assignment deployment. A future incompatible change would need a prefix or a new
  endpoint, since old and new clients cannot be told apart today.
