# 832402111 — Front-End and Back-End Separated Calculator System (Back End)

**Student ID:** 832402111 · **Course:** Software Engineering · **Assignment:** First Assignment — Front-End and Back-End Separation Calculator System · **Deadline:** 2026-10-07 23:59

This repository is the **back end** of the assignment, published as `832402111_calculator_backend`; the matching front end is the separate repository `832402111_calculator_frontend`. The browser never calculates anything: it only sends the raw expression text exactly as the user typed it, and this service is the single owner of validation, tokenizing, parsing, evaluation, formatting and persistence. A successful calculation answers with both a machine readable number (`result`) and the exact display string the user saw (`resultText`), and it is written to a history table that the front end can list and delete through the API. Because all arithmetic lives here, two different front ends (a browser page, a mobile client, `curl`) always agree on the result and on every error message. The service is written against the Node.js standard library plus Express and cors, so it starts with `npm start` on the grading machine without a database server, and the entire expression engine is hand written — `eval`, `exec` and `new Function` appear nowhere in the code base.

## Table of contents

- [Technology stack](#technology-stack)
- [Runtime environment](#runtime-environment)
- [Installation](#installation)
- [Start-up](#start-up)
- [Configuration](#configuration)
- [Database initialisation](#database-initialisation)
- [Front-end / back-end connection](#front-end--back-end-connection)
- [API overview](#api-overview)
- [Calculation engine](#calculation-engine)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Error code reference](#error-code-reference)
- [Troubleshooting](#troubleshooting)
- [License and related repository](#license-and-related-repository)

## Technology stack

| Component | Version | Purpose |
| --- | --- | --- |
| Node.js | >= 22.5 (developed on v24.22.0) | Runtime for the HTTP server, the expression engine and the test runner. |
| Express | 4.21 | HTTP routing, JSON body parsing, static file serving and the middleware chain. |
| cors | 2.8.5 | Answers the cross-origin requests of the separately deployed front end, including the preflight. |
| `node:sqlite` | Built into Node.js (`DatabaseSync`) | Default storage engine. No package to install and no database server to run. |
| `node:test` + `node:assert/strict` | Built into Node.js | Test framework of the 65 automated tests. |
| `mysql2` | Optional, installed on demand | Only needed when `DB_CLIENT=mysql`; deliberately **not** listed in `dependencies`. |

`package.json` declares exactly two runtime dependencies:

```json
"dependencies": {
  "cors": "^2.8.5",
  "express": "^4.21.2"
}
```

## Runtime environment

- **Node.js >= 22.5 is required**, and `package.json` states it as `"engines": { "node": ">=22.5.0" }`. The reason is the storage layer: the default database driver is the built-in **`node:sqlite`** module, which became available in Node.js 22.5. On an older runtime the first `require('node:sqlite')` fails with `Cannot find module 'node:sqlite'` — see [Troubleshooting](#troubleshooting). The project was developed and verified on **v24.22.0**.
- **No flags are needed.** The server starts with a plain `node server.js`; nothing has to be enabled on the command line.
- **Operating system independent.** Paths are resolved with `node:path` from the repository root, and the database file is created with `fs.mkdirSync(..., { recursive: true })`, so Windows, macOS and Linux behave the same.
- **No database server is required.** The default configuration stores data in a single SQLite file (`data/calculator.db`) created automatically on start-up. MySQL is an optional alternative for the public deployment, not a prerequisite for grading.
- **Offline friendly.** After `npm install`, nothing else is downloaded, and no external service is contacted at run time.

## Installation

```bash
git clone <repository-url> 832402111_calculator_backend
cd 832402111_calculator_backend
npm install
```

`npm install` fetches **only Express and cors** (and their transitive dependencies). There is no database driver in the default install, no native module to compile and no post-install step: the storage layer uses the `node:sqlite` module that ships with Node.js.

`mysql2` is intentionally absent from `dependencies`. It is only required when the optional MySQL client is selected, which keeps the default install free of any database dependency:

```bash
npm install mysql2        # only for DB_CLIENT=mysql
```

## Start-up

```bash
npm start          # node server.js
npm run dev        # node --watch server.js (restarts on every file change)
```

Start-up order is fixed: the configuration is read, the database is opened and the schema is created, the repository and the Express application are built, and only then does the process listen. A client therefore can never reach an API whose storage is not ready yet.

With the default configuration the service listens on **`http://127.0.0.1:8080`** (it binds host `0.0.0.0`, port `8080`, so the same service is also reachable from another machine on the network through this host's address). The console prints the effective URL, the database client and the CORS setting:

```text
2026-10-01T09:14:02.048Z [INFO] Opening SQLite database {"path":"...\\data\\calculator.db"}
2026-10-01T09:14:02.051Z [INFO] Database schema is ready
2026-10-01T09:14:02.089Z [INFO] Calculator backend is listening {"url":"http://127.0.0.1:8080","host":"0.0.0.0","port":8080,"version":"1.0.0","database":"sqlite","cors":"*"}
2026-10-01T09:14:02.090Z [INFO] API entry point {"url":"http://127.0.0.1:8080/api"}
```

Confirm that the service is alive with the health check:

```bash
curl http://127.0.0.1:8080/api/health
```

```json
{
  "success": true,
  "service": "calculator-backend",
  "version": "1.0.0",
  "status": "ok",
  "database": { "client": "sqlite", "status": "connected", "storedRecords": 13 },
  "limits": { "maxExpressionLength": 200, "maxNestingDepth": 32 },
  "errorHttpMode": "lenient",
  "time": "2026-10-01T09:14:02.140Z"
}
```

`status` is `ok` while the database answers, and `degraded` when the storage layer fails; `database.status` is `connected` or `error`. Opening `http://127.0.0.1:8080/api` in a browser returns a small landing document listing every endpoint, which is the fastest way to show that the service is up during a demonstration.

Stopping the process with `Ctrl+C` (`SIGINT`) or `SIGTERM` is handled gracefully: the HTTP server stops accepting connections and the database connection is closed before the process exits.

## Configuration

Every setting is an environment variable, all of them optional, and all of them are read exactly once in `src/config/config.js`. No other module touches `process.env`, so the effective configuration of a running instance can always be traced back to a single file and is reported by `GET /api/health`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | TCP port of the HTTP server. Use `0` to let the operating system pick a free port. |
| `HOST` | `0.0.0.0` | Interface the server binds to. `127.0.0.1` restricts it to the local machine. |
| `CORS_ORIGIN` | `*` | Comma separated whitelist of origins allowed to read responses. `*` allows every origin and is meant for development. |
| `ERROR_HTTP_MODE` | `lenient` | `lenient`: a rejected expression answers HTTP 200 with `success: false`. `strict`: the same rejection answers HTTP 400. 404 and 500 are unaffected. |
| `DB_CLIENT` | `sqlite` | Storage driver: `sqlite` (built-in `node:sqlite`, no service) or `mysql` (external server, needs `mysql2`). |
| `SQLITE_PATH` | `data/calculator.db` | SQLite file, relative to the repository root. The parent directory is created when missing. |
| `MYSQL_HOST` | `127.0.0.1` | MySQL host; only used with `DB_CLIENT=mysql`. |
| `MYSQL_PORT` | `3306` | MySQL port; only used with `DB_CLIENT=mysql`. |
| `MYSQL_USER` | `root` | MySQL user; only used with `DB_CLIENT=mysql`. |
| `MYSQL_PASSWORD` | *(empty)* | MySQL password; only used with `DB_CLIENT=mysql`. |
| `MYSQL_DATABASE` | `calculator` | MySQL schema name; the database itself must exist, the table is created automatically. |
| `MAX_EXPRESSION_LENGTH` | `200` | Maximum number of characters accepted after normalisation. |
| `MAX_TOKEN_COUNT` | `256` | Maximum number of tokens the tokenizer may produce. |
| `MAX_NESTING_DEPTH` | `32` | Maximum parenthesis/function nesting depth. |
| `STATIC_DIR` | `public` | Directory served as the front end in the single-service deployment, relative to the repository root. |
| `SERVE_STATIC` | `true` | When `false`, static file serving is disabled even if the directory exists. |
| `LOG_LEVEL` | `info` | Log verbosity: `debug`, `info`, `warn` or `error`. |

`.env.example` documents the same variables with the defaults and short comments. Copy it, edit the values you need, and export them before starting the service:

```bash
cp .env.example .env      # Windows: copy .env.example .env
```

The file lists:

```bash
PORT=8080
HOST=0.0.0.0
CORS_ORIGIN=http://127.0.0.1:5500,http://localhost:5500
ERROR_HTTP_MODE=lenient
DB_CLIENT=sqlite
SQLITE_PATH=data/calculator.db
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=calculator
MAX_EXPRESSION_LENGTH=200
MAX_TOKEN_COUNT=256
MAX_NESTING_DEPTH=32
```

A `.env` file is a plain text convention, not something the process reads by itself; export the variables through your shell or process manager. PowerShell example:

```powershell
$env:PORT = "3000"; $env:ERROR_HTTP_MODE = "strict"; npm start
```

Bash example:

```bash
PORT=3000 ERROR_HTTP_MODE=strict npm start
```

`.env` and the SQLite files under `data/` are listed in `.gitignore`, so local overrides and local databases are never committed.

## Database initialisation

### Automatic schema creation

The schema is created **automatically on start-up** — there is nothing to run before the first request. `connect()` in `src/storage/database.js` opens the driver and then executes the DDL with `IF NOT EXISTS`, so:

- on a fresh clone the table and both indexes appear the first time the server (or the seed script, or the test runner) opens the database;
- on an existing database nothing is dropped or modified, and no data is lost;
- the same code path is used for SQLite and for MySQL.

That is why first-time setup is a no-op for the grader: `npm install` followed by `npm start` is enough.

### Demo data

```bash
npm run db:init     # node scripts/seed.js        -> create schema, add only missing demo rows
npm run db:reset    # node scripts/seed.js --reset -> delete every row, then insert the demo rows
```

`scripts/seed.js` inserts **16 realistic demo rows** whose timestamps span **2026-10-01 .. 2026-10-02**, for example `12+8` at `2026-10-01 09:14:02`, `1+2*3` at `2026-10-01 10:20:00`, `sqrt(144)` at `2026-10-02 08:41:26` and `(2+3)*(7-4)` at `2026-10-02 10:18:22`. Every seed row is produced by the real pipeline before it is stored, so the demo history can never contain a result the calculator would not compute. `db:init` skips rows that are already present (it matches on expression plus timestamp), while `db:reset` clears the table first, which is the state to use for a fresh demonstration.

### Table definition (SQLite)

```sql
CREATE TABLE IF NOT EXISTS calculation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expression TEXT NOT NULL,
  result REAL NOT NULL,
  result_text TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'compound',
  mode TEXT NOT NULL DEFAULT 'basic',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_calculation_history_created_at
  ON calculation_history (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_calculation_history_operation
  ON calculation_history (operation);
```

### Fields

| Column | Type (SQLite / MySQL) | Constraints | Meaning |
| --- | --- | --- | --- |
| `id` | `INTEGER` / `INT UNSIGNED` | Primary key, auto increment | Identifies one calculation. `POST /api/calculate` returns it as `historyId`, and `DELETE /api/history/{id}` uses it. |
| `expression` | `TEXT` / `VARCHAR(512)` | `NOT NULL` | The expression exactly as the user submitted it (normalised display symbols, no whitespace). |
| `result` | `REAL` / `DOUBLE` | `NOT NULL` | The numeric value, rounded to 12 significant digits. Keeps numeric semantics for statistics and re-use. |
| `result_text` | `TEXT` / `VARCHAR(64)` | `NOT NULL` | The exact string the user saw on screen. |
| `operation` | `TEXT` / `VARCHAR(32)` | `NOT NULL DEFAULT 'compound'` | Operation family: `addition`, `subtraction`, `multiplication`, `division`, `modulo`, `power`, `compound`, `scientific`, `number` or `conversion`. Used by the statistics endpoint and by the history filter. |
| `mode` | `TEXT` / `VARCHAR(16)` | `NOT NULL DEFAULT 'basic'` | `basic` or `scientific` — how the expression was evaluated. |
| `created_at` | `TEXT` / `DATETIME` | `NOT NULL` | `YYYY-MM-DD HH:MM:SS`, filled by the database (`strftime(..., 'localtime')` in SQLite, `CURRENT_TIMESTAMP` in MySQL), never by the client. |

**Why `result` and `result_text` are both stored.** They answer two different questions. `result` keeps the numeric semantics needed by statistics, filters and any later re-use, while `result_text` preserves exactly what the user saw. If the display rule ever changes — a different number of significant digits, a thousands separator — the history still shows the value that was actually displayed at that moment, so a formatting change cannot silently rewrite the past.

Two indexes support the two real access patterns: `idx_calculation_history_created_at (created_at DESC, id DESC)` makes the default newest-first listing cheap, and `idx_calculation_history_operation (operation)` makes the statistics aggregation and the operation filter cheap. SQLite declares them with separate `CREATE INDEX IF NOT EXISTS` statements, while MySQL declares both inline in the table definition as `KEY` entries; either way they are created automatically together with the table.

### Switching to MySQL (optional)

```bash
npm install mysql2
# Windows PowerShell:  $env:DB_CLIENT = "mysql"
export DB_CLIENT=mysql
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=your-password
export MYSQL_DATABASE=calculator
npm start
```

The MySQL schema is created **automatically on start-up as well** (`CREATE TABLE IF NOT EXISTS`, `InnoDB`, `utf8mb4`), including both indexes, so only the empty database itself has to exist beforehand. The repository code is identical for both clients: `src/storage/database.js` is the only module that chooses a driver, and it exposes the same promise based `all` / `get` / `run` / `close` interface for both. MySQL differences are handled inside the SQL text of `src/storage/schema.js` — `DOUBLE`, `DATETIME DEFAULT CURRENT_TIMESTAMP`, `KEY` declarations, `DATE_FORMAT` for the daily series, and `ALTER TABLE ... AUTO_INCREMENT = 1` instead of the SQLite `sqlite_sequence` reset.

## Front-end / back-end connection

The two repositories are independent applications, and they talk over HTTP only. The connection contract has three parts: the JSON envelope, CORS, and the deployment shape.

### The shared envelope

- A successful response always contains `"success": true`.
- A failed response always contains `"success": false`, a stable machine readable `error` code and a human readable `message`.

The front end can therefore branch on `success` alone and never has to interpret a status code. The front end also sends the raw expression text and never computes a result locally, so the displayed value always comes from this service.

### CORS in development

During development the page and the API usually run on different ports (for example the front end on `5500` and this API on `8080`). A browser treats that as a cross-origin request and blocks the response unless the server allows the origin explicitly, which is why CORS is part of the integration contract and is configured in `src/middleware/cors.js` rather than hidden inside a route.

With the default `CORS_ORIGIN=*` the server answers `Access-Control-Allow-Origin: *`, allows the methods `GET, POST, DELETE, OPTIONS` and the headers `Content-Type, Accept`, caches the preflight for 86400 seconds, and keeps credentials off (the API uses no cookies). A request without an `Origin` header — `curl`, Postman, a server-side `fetch` — is always allowed because CORS does not apply to it. A `OPTIONS` preflight is answered with HTTP 204 and no body.

### CORS in production

For the public deployment, set an explicit whitelist instead of `*`:

```bash
export CORS_ORIGIN=https://832402111-calculator-frontend.example.com
```

Only the listed origins then pass `corsOptions.origin()`; every other origin is refused by the browser. The startup log warns while `*` is still active (`CORS allows every origin; set CORS_ORIGIN before the public deployment`), which is a reminder that the permissive default belongs to development only.

### Deployment shape 1 — separated (front end and back end on different services)

The front end is deployed on its own (a static host, GitHub Pages, a container) and calls this API by its absolute URL. Nothing has to be copied into this repository. If the `public/` directory is absent, the static block in `src/app.js` is skipped — that is the separated deployment, and it is what the two-repository layout looks like right after `git clone`.

### Deployment shape 2 — single service serving `public/`

The back end can also host the front-end files, which makes one process serve both the page and the API on the same origin, so CORS is not involved for the page itself. Copy the front-end `src` folder into `public/`:

```bash
# from the parent directory that contains both repositories
cp -r 832402111_calculator_frontend/src/. 832402111_calculator_backend/public/
```

This is optional and controlled by two variables: `STATIC_DIR` (default `public`) and `SERVE_STATIC` (default `true`). When the directory exists and serving is enabled, Express serves it with `extensions: ['html']`; when it does not exist, the block is skipped silently and the service keeps working as an API-only back end.

## API overview

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/calculate` | Validate, evaluate and store one expression; returns the result. |
| `GET` | `/api/history` | Read the calculation history (newest first; paginated, filterable, or `page=all`). |
| `DELETE` | `/api/history/{id}` | Delete one history record by id. |
| `DELETE` | `/api/history` | Delete every history record and reset the auto-increment sequence. |
| `GET` | `/api/stats` | Aggregated statistics: total, counts per operation, daily series, last calculation time. |
| `POST` | `/api/convert/base` | Convert an integer between base 2, 8, 10, 16 and 36. |
| `POST` | `/api/convert/unit` | Convert a value between two units of the same category. |
| `GET` | `/api/convert/units` | List all conversion categories and units, so the front end can build its selectors. |
| `GET` | `/api/capabilities` | List the supported operators, functions, constants, bases, unit categories and modes. |
| `GET` | `/api/health` | Service, version, database status, limits and error mode. |
| `GET` | `/api` | Human readable landing document with the endpoint list. |

Every response — successful or failed — uses the JSON envelope described above; an unknown URL is answered as JSON too (`404 ROUTE_NOT_FOUND`), never as an HTML error page.

### `POST /api/calculate`

Request body:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `expression` | string | yes | The raw expression. Maximum 200 characters. |
| `mode` | string | no | `basic` (default) or `scientific`. Functions and named constants require `scientific`. |
| `ans` | number | no | Value of the `ans` constant inside a scientific expression (the previous result). |

**Success** — a history record was written, so the status is `201` and `historyId` is present:

```bash
curl -X POST http://127.0.0.1:8080/api/calculate \
  -H "Content-Type: application/json" \
  -d "{\"expression\":\"(1+2)*3\"}"
```

```json
{
  "success": true,
  "expression": "(1+2)*3",
  "result": 9,
  "resultText": "9",
  "operation": "compound",
  "mode": "basic",
  "durationMs": 1.225,
  "historyId": 15,
  "createdAt": "2026-10-01 10:20:00"
}
```

The status is `201` because a new record was created; when nothing is stored the same body shape is answered with `200` and `historyId: null`. `durationMs` measures the evaluation itself and is reported with three decimals.

**Rejected expression** — with the default `ERROR_HTTP_MODE=lenient` the status stays `200` and the envelope carries `success: false`:

```bash
curl -X POST http://127.0.0.1:8080/api/calculate \
  -H "Content-Type: application/json" \
  -d "{\"expression\":\"10/(3-3)\"}"
```

```json
{
  "success": false,
  "error": "EVALUATOR_DIVISION_BY_ZERO",
  "message": "Division by zero",
  "detail": "The expression \"10 / 0\" divides by zero"
}
```

A rejected calculation is **never** written to the history table, so a failed attempt cannot pollute the listing or the statistics. With `ERROR_HTTP_MODE=strict` the identical body is answered with HTTP `400`. `detail` is optional and only classified errors carry it; it never contains a stack trace, a file path or SQL text.

**Missing history record** — deleting an id that does not exist is always a real `404`, in both error modes, and it exploits the affected-row count instead of a pre-flight lookup:

```bash
curl -X DELETE http://127.0.0.1:8080/api/history/99999
```

```json
{
  "success": false,
  "error": "HISTORY_NOT_FOUND",
  "message": "Calculation history record does not exist",
  "detail": "No calculation history record has the id 99999"
}
```

### Status codes

| Status | When |
| --- | --- |
| `200` | Successful read, conversion, deletion, or (in `lenient` mode) a rejected expression. |
| `201` | A calculation succeeded **and** a history record was created. |
| `204` | CORS preflight (`OPTIONS`) answer, empty body. |
| `400` | Rejected input in `strict` mode; always for a malformed body or an invalid parameter. |
| `404` | Unknown endpoint (`ROUTE_NOT_FOUND`) — always; and a history id that does not exist (`HISTORY_NOT_FOUND`) — always. |
| `413` | Request body larger than the 64 kb limit. |
| `500` | Storage or internal failure (`STORAGE_FAILURE`, `INTERNAL_ERROR`). |

### The other endpoints at a glance

- `GET /api/history?limit=10&offset=0&keyword=sqrt&operation=addition` answers `{ success, total, returned, limit, offset, records: [...] }`; `?page=all` replaces `limit`/`offset` with `page: "all"` and returns every matching record. `limit` defaults to 10 and is capped at 100, `keyword` is a substring search inside the expression (wildcards are escaped), `operation` must be one of the known families. Each record is `{ id, expression, result, resultText, operation, mode, createdAt }`, newest first.
- `DELETE /api/history/{id}` answers `{ success, deletedId, remaining }`.
- `DELETE /api/history` answers `{ success, deleted, remaining: 0 }` and resets the auto-increment sequence, so the next record is `id` 1 again.
- `GET /api/stats?days=7` answers `{ success, total, byOperation, daily, lastCalculationAt }`, where `byOperation` is an object keyed by operation family and `daily` is a list of `{ day, count }`.
- `POST /api/convert/base` accepts `{ "value": 255 }` (value in every supported base), `{ "value": "ff", "fromBase": 16 }` (text to decimal) or `{ "value": 10.5, "toBase": 2 }` (one target base). Bases are 2, 8, 10, 16 and 36; the integer part is converted with `BigInt`, so values above 2^53 keep every digit.
- `POST /api/convert/unit` accepts `{ "value": 100, "from": "km/h", "to": "mph" }`. Unit ids are lower-case display symbols (`km`, `km/h`, `mib`, `°c`, `°f`, `k`), and both units must belong to the same category.
- `GET /api/convert/units` answers `{ success, categories: [{ category, name, baseUnit, units: [{ unit, name, symbol }] }] }` over 8 categories: length, mass, temperature, area, volume, time, speed and data.
- `GET /api/capabilities` answers the operators (with their display symbols), the functions with their `argCount`, the constants, the supported bases, the unit categories and the modes.

## Calculation engine

### Pipeline

```text
browser: raw expression text (never evaluated there)
        |
        v
POST /api/calculate -> requestLogger -> cors -> express.json (64 kb limit)
        |
        v
calculatorController.calculate
        |
        v
calculationService.calculateAndStore
        |
        v
expression/Calculator.calculate  (facade)
        |
        +--> Token.js         normalise: aliases, full-width chars, superscripts, whitespace
        +--> Tokenizer.js     lexical validation -> token stream (EOF terminated)
        +--> Parser.js        grammar validation -> postfix instruction program
        +--> Evaluator.js     single stack loop over the program -> numeric value
        +--> NumberFormatter.js  round to 12 significant digits -> { value, text }
        |
        v
historyRepository.insert (prepared statement, `?` binding)  ->  SQLite / MySQL
        |
        v
JSON envelope { success, expression, result, resultText, operation, mode, durationMs, historyId, createdAt }
```

The parser emits a **postfix instruction program** (`NUMBER`, `CONSTANT`, `BINARY`, `UNARY`, `CALL`) instead of building a tree: the evaluator then becomes one loop over one stack, cannot recurse deeply on hostile input, and the program itself can be asserted in unit tests — which makes precedence and unary handling verifiable without evaluating anything.

### Input normalisation

Normalisation happens before tokenizing and makes the front-end symbols interchangeable with the API symbols:

- `×`, `✕`, `⋅`, `·`, `∗` become `*`; `÷` and `∕` become `/`; `−`, `–`, `—` become `-`; full-width `（ ） ，` become `( ) ,`.
- Superscript digits become a power: `2²` is `2**2`, and `x²³` is `x**23`; a typed `^` is rewritten to `**` so the parser handles exactly one power shape.
- Every kind of whitespace (ASCII spaces, tabs, the wide `\u3000` and the non-breaking `\u00a0`) is removed. This is why `2 3` is normalised to `23` — the space is simply not part of the expression — while implicit multiplication is supported deliberately: `2(3+4)` is 14 and `2pi` is `2 * pi`. A function result directly followed by a value (`2sin(30)`) is **not** accepted, because it is far more likely to be a typo than an intended multiplication.

### Precedence and associativity

From lowest to highest binding: additive, then multiplicative, then unary signs, then power. `**` is **right associative**, so `2**3**2` is `2**(3**2) = 512`. A power binds tighter than a leading sign, so `-2**2` is `-(2**2) = -4`, while `(-2)**2` is `4` — the rule used by spreadsheets. The unary minus is recognised from position rather than from an "is the previous token an operator" heuristic, which is what makes `-5+8 = 3` and `3*-2 = -6` work without special cases, and `2**-3` is a legal exponent.

Verified behaviour of the engine:

| Expression | Result | Note |
| --- | --- | --- |
| `1+2*3` | `7` | Multiplication before addition. |
| `(1+2)*3` | `9` | Parentheses override precedence. |
| `2**3**2` | `512` | Right associative power. |
| `-2**2` | `-4` | Power applied before the leading sign. |
| `(-2)**2` | `4` | Parentheses change the meaning. |
| `2(3+4)` | `14` | Implicit multiplication. |
| `2 3` | `23` | Whitespace is removed during normalisation. |
| `0.1+0.2` | `0.3` | Rounded to 12 significant digits instead of `0.30000000000000004`. |
| `1/3` | `0.333333333333` | 12 significant digits. |
| `10/0` | `EVALUATOR_DIVISION_BY_ZERO` | Classified error, nothing stored. |

### Functions and constants

Whitelisted functions, **1 argument**: `sin` `cos` `tan` `asin` `acos` `atan` `sinh` `cosh` `tanh` `sqrt` `cbrt` `log` `ln` `log10` `log2` `exp` `abs` `round` `floor` `ceil` `sign`. **2 arguments**: `pow` `min` `max` `mod` `hypot`. The argument count is checked while parsing, so `sin(1, 2)` fails during parsing instead of at run time. Trigonometric arguments are in radians; every function validates its own domain and reports `EVALUATOR_DOMAIN_ERROR` (`sqrt(-1)`, `log(0)`, `asin(2)`, `tan` at an angle where the cosine vanishes), while a negative base with a fractional exponent is refused by `pow` for the same reason.

Constants: `pi`, `π`, `e`, `tau`, `phi`, and `ans` (the previous result, resolved from the request body). Functions and named constants require `"mode": "scientific"`; sending `sqrt(144)` in basic mode answers `VALIDATION_INVALID_PARAMETER` with the hint to use scientific mode, and `ans` is likewise rejected outside scientific mode.

### Limits

| Limit | Default | Variable | Error when exceeded |
| --- | --- | --- | --- |
| Expression length | 200 | `MAX_EXPRESSION_LENGTH` | `VALIDATION_EXPRESSION_TOO_LONG` |
| Token count | 256 | `MAX_TOKEN_COUNT` | `TOKENIZER_TOO_MANY_TOKENS` |
| Nesting depth | 32 | `MAX_NESTING_DEPTH` | `PARSER_NESTING_TOO_DEEP` |

JSON bodies are capped at 64 kb by `express.json({ limit: '64kb' })`, and a larger body is answered with `413`.

### User input is never executed as code

The engine is a hand written tokenizer, recursive-descent parser and stack evaluator. **`eval`, `exec`, `new Function` and every other API that turns text into program code are forbidden in this repository and are used nowhere in it.** User input only ever reaches a `switch` over token types, a whitelist lookup, and numeric operators; SQL parameters are bound, never concatenated. `src/expression/Functions.js` uses an explicit whitelist with `Object.prototype.hasOwnProperty.call(...)` instead of a dynamic property lookup such as `Math[name]`, so a crafted name like `constructor` or `__proto__` can never reach anything outside the list above.

## Testing

```bash
npm test            # node scripts/runTests.js
```

`scripts/runTests.js` discovers every `test/*.test.js` file, runs **each file in its own Node.js process** (`spawnSync`, `stdio: 'inherit'`) and prints a PASS/FAIL summary with the duration of each file; the exit code is non-zero as soon as one file fails. The per-file isolation is what allows the API test to create its own temporary database and its own server without interfering with the others.

| Test file | Tests | Coverage |
| --- | --- | --- |
| `test/tokenizer.test.js` | 14 | Input normalisation (display symbols, full-width characters, superscripts, whitespace), number literals, unknown identifiers, invalid characters, token-count limit. |
| `test/parser.test.js` | 13 | Precedence and associativity, unary signs, `-2**2` vs `(-2)**2`, implicit multiplication, parenthesis and function-call errors, nesting depth, the emitted postfix program. |
| `test/calculator.test.js` | 14 | The facade end to end: results, 12-significant-digit formatting, division by zero, domain errors, overflow, scientific mode, `ans`, operation classification. |
| `test/converters.test.js` | 12 | Base conversion (including values above 2^53 and fractional output) and unit conversion (including the affine temperature units and category mismatches). |
| `test/api.test.js` | 22 | The real HTTP API over a real socket: a temporary SQLite database and an ephemeral port, exercised with `fetch`. |
| **Total** | **65** | **All passing** (`65/65`). |

The API test asserts the full chain with no mocks: Express → controller → service → expression engine → repository → SQLite. It sends with `ERROR_HTTP_MODE=strict` so that a rejection is visible as a 4xx, and it covers the health check, every required expression shape, the display symbols, invalid expressions, division by zero (including that nothing is stored), body validation, scientific mode, history listing/pagination/search/filter, newest-first order, single delete, delete of a missing id, clear-all with sequence reset, statistics, both converters, capabilities, the 404 shape, the CORS header and the preflight.

Run a single file directly when iterating:

```bash
node test/parser.test.js
```

## Project structure

```text
832402111_calculator_backend/
├── .env.example              # every environment variable with its default
├── .gitignore                # node_modules, data/*.db, .env, logs
├── package.json              # scripts, engines (node >= 22.5), express + cors
├── package-lock.json
├── server.js                 # entry point: config -> database -> app -> listen -> shutdown
├── README.md                 # this document
├── codestyle.md              # the coding standard applied in this repository
├── data/                     # runtime SQLite files (generated, not committed)
├── public/                   # optional copy of the front-end sources (single-service deployment)
├── scripts/
│   ├── seed.js               # npm run db:init / db:reset (16 demo rows)
│   └── runTests.js           # test runner: one process per test file
├── src/
│   ├── app.js                # Express application factory (middleware order, static, 404)
│   ├── config/
│   │   └── config.js         # the only module that reads process.env
│   ├── controllers/
│   │   ├── calculatorController.js   # calculate, conversions, health, capabilities
│   │   └── historyController.js      # history list/delete/clear, statistics
│   ├── expression/
│   │   ├── Token.js          # token types and input normalisation
│   │   ├── Tokenizer.js      # lexical validation -> token stream
│   │   ├── Functions.js      # whitelist of functions and constants
│   │   ├── Parser.js         # recursive descent -> postfix instruction program
│   │   ├── Evaluator.js      # single-stack postfix evaluation
│   │   ├── NumberFormatter.js# 12-significant-digit rounding and display string
│   │   └── Calculator.js     # facade used by the service layer
│   ├── middleware/
│   │   ├── requestLogger.js  # one log line per request, with duration
│   │   ├── cors.js           # CORS_ORIGIN whitelist and preflight
│   │   └── errorHandler.js   # one error shape everywhere, 404 handler
│   ├── routes/
│   │   └── index.js          # the route table under /api
│   ├── services/
│   │   ├── calculationService.js  # validate -> evaluate -> persist -> answer
│   │   ├── historyService.js      # history queries, delete, clear, statistics
│   │   ├── baseConverter.js       # number base conversion (BigInt)
│   │   └── unitConverter.js       # 8 unit categories
│   ├── storage/
│   │   ├── schema.js         # DDL and prepared statements for both clients
│   │   ├── database.js       # driver selection: node:sqlite or mysql2
│   │   └── historyRepository.js   # all SQL, bound `?` parameters only
│   └── utils/
│       ├── errors.js         # ErrorCode, messages, AppError
│       ├── logger.js         # minimal structured logger
│       └── response.js       # success / failure envelope
└── test/
    ├── tokenizer.test.js     # 14 tests
    ├── parser.test.js        # 13 tests
    ├── calculator.test.js    # 14 tests
    ├── converters.test.js    # 12 tests
    └── api.test.js           # 22 tests (real HTTP, temporary SQLite database)
```

Dependency direction is strictly one way: `routes -> controllers -> services -> expression / storage`, with `utils` and `config` usable from every layer. There are no `require` cycles, and the storage layer is the only place that knows about SQL.

## Error code reference

Failures are classified with stable codes, so the front end can react to a specific situation without parsing an English message. The codes live in one module, `src/utils/errors.js`, which keeps the tokenizer, the parser, the evaluator and the service layer from drifting apart.

| Layer | Code | Typical trigger |
| --- | --- | --- |
| Validation | `VALIDATION_INVALID_JSON` | The request body is not valid JSON. |
| Validation | `VALIDATION_MISSING_FIELD` | A required field (`expression`, `value`, `from`, `to`) is absent. |
| Validation | `VALIDATION_INVALID_FIELD_TYPE` | A field has the wrong type, e.g. `expression: 42`. |
| Validation | `VALIDATION_EMPTY_EXPRESSION` | The expression is empty or only whitespace. |
| Validation | `VALIDATION_EXPRESSION_TOO_LONG` | Longer than `MAX_EXPRESSION_LENGTH` (200 by default). |
| Validation | `VALIDATION_INVALID_BASE` | A number base outside 2, 8, 10, 16, 36. |
| Validation | `VALIDATION_INVALID_PARAMETER` | Unknown mode, unknown operation filter, invalid history id, non-positive/unknown unit, `ans` outside scientific mode. |
| Tokenizer | `TOKENIZER_INVALID_CHARACTER` | A character that is not part of the accepted language, e.g. `1+2;`. |
| Tokenizer | `TOKENIZER_INVALID_NUMBER` | A malformed literal such as `1.2.3`, or scientific notation such as `1e5`. |
| Tokenizer | `TOKENIZER_TOO_MANY_TOKENS` | More than `MAX_TOKEN_COUNT` (256 by default) tokens. |
| Tokenizer | `TOKENIZER_UNKNOWN_IDENTIFIER` | An identifier that is neither a whitelisted function nor a whitelisted constant, e.g. `abc`. |
| Parser | `PARSER_SYNTAX_ERROR` | A structurally impossible expression, e.g. a stray comma. |
| Parser | `PARSER_UNMATCHED_PARENTHESIS` | `(1+2` or a closing parenthesis without an opening one. |
| Parser | `PARSER_MISSING_OPERAND` | An operator without a left operand, e.g. `1+*2`. |
| Parser | `PARSER_MISSING_OPERATOR` | Two values with nothing between them, e.g. `2sin(30)`. |
| Parser | `PARSER_TRAILING_OPERATOR` | The expression ends with an operator, e.g. `1+`. |
| Parser | `PARSER_NESTING_TOO_DEEP` | Deeper than `MAX_NESTING_DEPTH` (32 by default). |
| Parser | `PARSER_INVALID_FUNCTION_CALL` | A function used incorrectly, e.g. `sin(1, 2)`. |
| Evaluator | `EVALUATOR_DIVISION_BY_ZERO` | Division or modulo by zero, e.g. `10/(3-3)`. |
| Evaluator | `EVALUATOR_DOMAIN_ERROR` | An argument outside the domain of the function, e.g. `sqrt(-1)` or `log(0)`. |
| Evaluator | `EVALUATOR_NOT_A_NUMBER` | A result or argument that is not a finite number. |
| Evaluator | `EVALUATOR_OVERFLOW` | A result outside the representable range, e.g. `2**1024`. |
| Storage | `HISTORY_NOT_FOUND` | `DELETE /api/history/{id}` for an id that does not exist (HTTP 404). |
| Storage | `STORAGE_FAILURE` | A database operation failed, or `DB_CLIENT=mysql` without `mysql2` installed. |
| Transport | `ROUTE_NOT_FOUND` | The URL matches no route (HTTP 404). |
| Transport | `INTERNAL_ERROR` | An unexpected defect; the client sees a generic 500 and the stack stays in the server log. |

## Troubleshooting

### `EADDRINUSE` — the port is already in use

```text
Error: listen EADDRINUSE: address already in use 0.0.0.0:8080
```

Another process (often a previous run of this server) holds port 8080. Either stop it, or start on another port:

```bash
# Windows
netstat -ano | findstr :8080
taskkill /PID <pid> /F

# macOS / Linux
lsof -i :8080
kill <pid>
```

```bash
PORT=3000 npm start        # PowerShell: $env:PORT = "3000"; npm start
```

### `DB_CLIENT=mysql` fails with a missing module

```text
STORAGE_FAILURE  DB_CLIENT=mysql requires the optional dependency mysql2.
```

`mysql2` is optional and therefore not installed by default. Install it in the same project:

```bash
npm install mysql2
```

The alternative is to go back to the dependency-free default with `DB_CLIENT=sqlite` (or by removing the variable, since `sqlite` is the default). Also check that the MySQL server is reachable and that `MYSQL_DATABASE` already exists — the table and indexes are created automatically, but the schema itself is not.

### The browser blocks the request (CORS)

Symptom: the request appears in the server log with a `2xx`/`4xx` status, but the page reports a CORS error and cannot read the response. That means the response was produced but the browser refused to hand it to the page.

- In development, keep `CORS_ORIGIN=*` (the default) — the response then carries `Access-Control-Allow-Origin: *`.
- In production, put the exact origin of the deployed page into the whitelist, **including the scheme and the port**, with no trailing slash:

```bash
export CORS_ORIGIN=https://832402111-calculator-frontend.example.com
```

- A wrong or missing `Origin`, or an origin listed only as `localhost` while the page is opened as `127.0.0.1` (they are different origins for a browser), is refused. CORS is a browser rule: `curl` and Postman are never affected, so a request that works in `curl` and fails in the browser is almost always a whitelist question.
- Remember that CORS must be allowed for the API origin, not for the page origin.

### `Cannot find module 'node:sqlite'`

```text
Error: Cannot find module 'node:sqlite'
```

The runtime is older than **Node.js 22.5**, where the built-in SQLite module does not exist yet. Check and upgrade:

```bash
node --version      # must print v22.5.0 or newer (developed on v24.22.0)
```

Install a current LTS or newer release from <https://nodejs.org>, reopen the terminal so `PATH` is refreshed, and run `npm start` again. The MySQL client does not help here: `node:sqlite` is required for the default configuration, and the API tests also use it.

## License and related repository

Released under the **MIT License**, as declared in `package.json`. The matching front end lives in the separate repository **`832402111_calculator_frontend`**; the two are connected only by the HTTP contract described under [Front-end / back-end connection](#front-end--back-end-connection).

The coding rules actually applied in this repository are documented in [codestyle.md](codestyle.md).
