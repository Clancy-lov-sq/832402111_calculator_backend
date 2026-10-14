# API Reference — `832402111_calculator_backend`

Student ID: **832402111** — Software Engineering assignment, front-end/back-end separated calculator.

This document is the complete reference for every HTTP endpoint of the back end. Every
example below is written by hand from the authoritative behaviour of the code, so the
shapes, status codes and values match what the service actually returns.

---

## Table of contents

1. [Introduction](#1-introduction)
2. [Conventions](#2-conventions)
3. [GET /api](#3-get-api)
4. [GET /api/health](#4-get-apihealth)
5. [GET /api/capabilities](#5-get-apicapabilities)
6. [POST /api/calculate](#6-post-apicalculate)
7. [GET /api/history](#7-get-apihistory)
8. [DELETE /api/history/{id}](#8-delete-apihistoryid)
9. [DELETE /api/history](#9-delete-apihistory)
10. [GET /api/stats](#10-get-apistats)
11. [POST /api/convert/base](#11-post-apiconvertbase)
12. [POST /api/convert/unit](#12-post-apiconvertunit)
13. [GET /api/convert/units](#13-get-apiconvertunits)
14. [Quick reference: endpoints × error codes](#14-quick-reference-endpoints--error-codes)
15. [Recorded transcript](#15-recorded-transcript)

---

## 1. Introduction

### Base URL

| Deployment shape | Base URL |
| --- | --- |
| Local development (defaults) | `http://127.0.0.1:8080` |
| Single service (back end also serves `public/`) | `http://<host>:<port>` — same origin for the page and the API |
| Separated deployment (front end on GitHub Pages or a static server) | `http://<host>:<port>` with `CORS_ORIGIN` set to the page origin |

The default host is `0.0.0.0` and the default port is `8080`, both configurable with
`HOST` and `PORT`. Every endpoint lives under the `/api` prefix.

### Content type

* Request bodies are JSON: send `Content-Type: application/json`.
* Every response is JSON: `Content-Type: application/json; charset=utf-8`.
* `GET` and `DELETE` endpoints take all of their input from the path or the query string
  and need no body.
* The maximum accepted request body is **64 kb** (`express.json({ limit: '64kb' })`).

### The two envelopes

Every response of this API — success or failure, on every endpoint — has one of exactly
two shapes.

**Success envelope**

```json
{
  "success": true
}
```

Concrete fields follow `success`; the exact set depends on the endpoint.

**Error envelope**

```json
{
  "success": false,
  "error": "<STABLE_CODE>",
  "message": "<human text>",
  "detail": "<optional extra>"
}
```

| Field | Type | Always present | Meaning |
| --- | --- | --- | --- |
| `success` | boolean | yes | `false` on every failure. Branch on this flag first. |
| `error` | string | yes | Stable `LAYER_REASON` code. This is the value a client program may depend on. |
| `message` | string | yes | Human-readable, non-leaking text (never a stack trace, a SQL fragment or a file path). |
| `detail` | string | no | Present only when the back end can add a safe extra explanation, for example which field is wrong. |

The error codes are grouped by the layer that raised them:

| Layer | Codes |
| --- | --- |
| validation | `VALIDATION_INVALID_JSON`, `VALIDATION_MISSING_FIELD`, `VALIDATION_INVALID_FIELD_TYPE`, `VALIDATION_EMPTY_EXPRESSION`, `VALIDATION_EXPRESSION_TOO_LONG`, `VALIDATION_INVALID_BASE`, `VALIDATION_INVALID_PARAMETER` |
| tokenizer | `TOKENIZER_INVALID_CHARACTER`, `TOKENIZER_INVALID_NUMBER`, `TOKENIZER_TOO_MANY_TOKENS`, `TOKENIZER_UNKNOWN_IDENTIFIER` |
| parser | `PARSER_SYNTAX_ERROR`, `PARSER_UNMATCHED_PARENTHESIS`, `PARSER_MISSING_OPERAND`, `PARSER_MISSING_OPERATOR`, `PARSER_TRAILING_OPERATOR`, `PARSER_NESTING_TOO_DEEP`, `PARSER_INVALID_FUNCTION_CALL` |
| evaluator | `EVALUATOR_DIVISION_BY_ZERO`, `EVALUATOR_DOMAIN_ERROR`, `EVALUATOR_NOT_A_NUMBER`, `EVALUATOR_OVERFLOW` |
| storage | `HISTORY_NOT_FOUND`, `STORAGE_FAILURE` |
| transport | `ROUTE_NOT_FOUND`, `INTERNAL_ERROR` |

### The lenient / strict error mode (`ERROR_HTTP_MODE`)

A *refused expression* is an expression the back end evaluated and rejected: invalid
syntax, an unknown name, division by zero, a domain error, an overflow. The HTTP status
of that refusal is controlled by `ERROR_HTTP_MODE`:

| Mode | Behaviour of a refused expression |
| --- | --- |
| `lenient` (default) | **HTTP 200** with `success: false` and the stable `error` code |
| `strict` | **HTTP 400** with `success: false` and the stable `error` code |

In both modes the body is the same error envelope, so a client that branches on
`success` behaves identically in both modes and only the status code changes. The test
suite runs in `strict` mode, which is why the integration tests assert `400`.

Two refusals keep their real status in **both** modes:

* `404 ROUTE_NOT_FOUND` — the URL matches no endpoint.
* `404 HISTORY_NOT_FOUND` — `DELETE /api/history/{id}` for a record that does not exist.

Server-side failures (`STORAGE_FAILURE`, `INTERNAL_ERROR`) always answer `500`.

### Versioning

The API is **unversioned**. There is no `/v1` prefix and no `Accept-Version` header. This
is a single assignment deployment with one front end and one back end built together, so
a version prefix would add a contract that nobody can consume. The service version is
reported by `GET /api/health` (from `package.json`, currently `1.0.0`) purely for
diagnostics. A future incompatible change would have to introduce a prefix at that point;
until then the envelope plus the stable `error` codes are the compatibility surface.

---

## 2. Conventions

### Methods used

| Method | Used for | Endpoints |
| --- | --- | --- |
| `GET` | read-only information | `/api`, `/api/health`, `/api/capabilities`, `/api/history`, `/api/stats`, `/api/convert/units` |
| `POST` | an operation that computes a new value | `/api/calculate`, `/api/convert/base`, `/api/convert/unit` |
| `DELETE` | removal of stored data | `/api/history/{id}`, `/api/history` |
| `OPTIONS` | CORS preflight, answered by the `cors` middleware | every endpoint |

### Status codes

| Status | When it is used |
| --- | --- |
| `200 OK` | a normal successful read, conversion or deletion; also a refused expression in `lenient` mode |
| `201 Created` | `POST /api/calculate` when a history record was created (the response carries `historyId`) |
| `204 No Content` | `OPTIONS` preflight — answered with headers and no body |
| `400 Bad Request` | a refused expression in `strict` mode, and every validation failure (both modes) |
| `404 Not Found` | `ROUTE_NOT_FOUND` for an unknown endpoint, `HISTORY_NOT_FOUND` for deleting a missing record (both modes) |
| `413 Payload Too Large` | the request body is larger than the 64 kb limit |
| `500 Internal Server Error` | `STORAGE_FAILURE` or `INTERNAL_ERROR` |

There is no `204` for a deletion: both delete endpoints report what happened in a JSON
body (`deletedId` / `deleted` / `remaining`), which the front end uses to refresh its
history panel without a second request.

### Reading the `success` flag

1. Send the request.
2. Branch on `body.success`.
3. If `true`, read the endpoint-specific fields. The HTTP status may be `200` or `201`
   and both are successes.
4. If `false`, read `body.error` — never the HTTP status alone, because `lenient` mode
   reports a refused expression as `200`. `body.message` (and `body.detail` when present)
   is safe to display to the user.

### Body limit and JSON parsing

* Bodies larger than 64 kb are answered with `413` and
  `error: "VALIDATION_INVALID_PARAMETER"`.
* A body that is not valid JSON (for example a truncated `{"expression": `) is answered
  with `400` and `error: "VALIDATION_INVALID_JSON"`, in both error modes.
* A `POST` with no body at all reaches the controller as an empty object and fails the
  field validation of that endpoint (`VALIDATION_MISSING_FIELD`).

### CORS and preflight

`cors` 2.8.5 is applied before the routes, so a browser on another origin can read every
response.

* `CORS_ORIGIN` defaults to `*`: the response carries
  `Access-Control-Allow-Origin: *` and no credentials.
* A comma-separated list (for example `CORS_ORIGIN=http://127.0.0.1:5500`) switches to a
  whitelist; the allowed origin is then reflected, and any other origin is refused.
* Allowed methods: `GET`, `POST`, `DELETE`, `OPTIONS`.
* Allowed request headers: `Content-Type`, `Accept`.
* Credentials are **off** — this API needs no cookies.
* Preflight results may be cached by the browser for 24 hours (`max-age=86400`).
* A request without an `Origin` header (curl, Postman, a server-side `fetch`) is always
  allowed.

Preflight example:

```json
{
  "request": "OPTIONS /api/calculate",
  "status": 204,
  "headers": {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept",
    "Access-Control-Max-Age": "86400"
  }
}
```

### Parameter tables

Each endpoint below documents `name`, `type`, `required`, `default` and a description for
every parameter. `required` is `yes` only when omitting the parameter always fails.

---

## 3. `GET /api`

**Purpose.** A small landing document, so opening the base URL in a browser shows what
the service offers.

**Method and path.** `GET /api`

**Parameters.** None.

**Request example**

```json
{
  "method": "GET",
  "url": "http://127.0.0.1:8080/api"
}
```

**Success response — `200 OK`**

```json
{
  "success": true,
  "service": "Calculator Backend API",
  "version": "1.0.0",
  "endpoints": [
    "POST   /api/calculate",
    "GET    /api/history",
    "DELETE /api/history/{id}",
    "DELETE /api/history",
    "GET    /api/stats",
    "POST   /api/convert/base",
    "POST   /api/convert/unit",
    "GET    /api/convert/units",
    "GET    /api/capabilities",
    "GET    /api/health"
  ]
}
```

**Error cases**

| Case | Code | Status (lenient) | Status (strict) |
| --- | --- | --- | --- |
| Never fails on its own | — | — | — |
| Wrong method on the same URL (for example `POST /api`) | `ROUTE_NOT_FOUND` | 404 | 404 |

---

## 4. `GET /api/health`

**Purpose.** Reports the state of the service and of its database. The front end shows a
connection indicator from it; a reviewer uses it as the first check that the service and
its storage are alive.

**Method and path.** `GET /api/health`

**Parameters.** None.

**Request example**

```json
{
  "method": "GET",
  "url": "http://127.0.0.1:8080/api/health"
}
```

**Success response — `200 OK`**

```json
{
  "success": true,
  "service": "calculator-backend",
  "version": "1.0.0",
  "status": "ok",
  "database": {
    "client": "sqlite",
    "status": "connected",
    "storedRecords": 16
  },
  "limits": {
    "maxExpressionLength": 200,
    "maxNestingDepth": 32
  },
  "errorHttpMode": "lenient",
  "time": "2026-10-02T10:18:22.104Z"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `service` | string | Fixed name of the service. |
| `version` | string | Version from `package.json`. |
| `status` | `"ok"` \| `"degraded"` | `ok` when a `COUNT(*)` on the history table succeeded, `degraded` otherwise. |
| `database.client` | `"sqlite"` \| `"mysql"` | Active driver, from `DB_CLIENT`. |
| `database.status` | `"connected"` \| `"error"` \| `"unknown"` | Result of the probe query. |
| `database.storedRecords` | number \| null | Number of rows in `calculation_history`, `null` when the probe failed. |
| `limits` | object | Expression limits currently in force. |
| `errorHttpMode` | `"lenient"` \| `"strict"` | Which status a refused expression uses. |
| `time` | string | Server time in ISO 8601, for clock comparisons with the client. |

**Error cases**

| Case | Code | Status (lenient) | Status (strict) |
| --- | --- | --- | --- |
| Database unreachable | Not an error response: `status: "degraded"`, `database.status: "error"`, `database.storedRecords: null` | 200 | 200 |
| Wrong method on the same URL | `ROUTE_NOT_FOUND` | 404 | 404 |

---

## 5. `GET /api/capabilities`

**Purpose.** Describes the operators, scientific functions, constants, number bases, unit
categories and modes that this service supports. The front end builds the scientific
keypad from this document instead of hard-coding a list, so the API stays the single
source of truth.

**Method and path.** `GET /api/capabilities`

**Parameters.** None.

**Request example**

```json
{
  "method": "GET",
  "url": "http://127.0.0.1:8080/api/capabilities"
}
```

**Success response — `200 OK`**

```json
{
  "success": true,
  "operators": [
    { "symbol": "+", "display": "+", "family": "addition" },
    { "symbol": "-", "display": "−", "family": "subtraction" },
    { "symbol": "*", "display": "×", "family": "multiplication" },
    { "symbol": "/", "display": "÷", "family": "division" },
    { "symbol": "%", "display": "%", "family": "modulo" },
    { "symbol": "**", "display": "xʸ", "family": "power" }
  ],
  "functions": {
    "sin": { "argCount": 1 },
    "cos": { "argCount": 1 },
    "tan": { "argCount": 1 },
    "asin": { "argCount": 1 },
    "acos": { "argCount": 1 },
    "atan": { "argCount": 1 },
    "sinh": { "argCount": 1 },
    "cosh": { "argCount": 1 },
    "tanh": { "argCount": 1 },
    "sqrt": { "argCount": 1 },
    "cbrt": { "argCount": 1 },
    "log": { "argCount": 1 },
    "ln": { "argCount": 1 },
    "log10": { "argCount": 1 },
    "log2": { "argCount": 1 },
    "exp": { "argCount": 1 },
    "abs": { "argCount": 1 },
    "round": { "argCount": 1 },
    "floor": { "argCount": 1 },
    "ceil": { "argCount": 1 },
    "sign": { "argCount": 1 },
    "pow": { "argCount": 2 },
    "min": { "argCount": 2 },
    "max": { "argCount": 2 },
    "mod": { "argCount": 2 },
    "hypot": { "argCount": 2 }
  },
  "constants": ["pi", "π", "e", "tau", "phi", "ans"],
  "bases": [2, 8, 10, 16, 36],
  "unitCategories": [
    "length",
    "mass",
    "temperature",
    "area",
    "volume",
    "time",
    "speed",
    "data"
  ],
  "modes": ["basic", "scientific"]
}
```

Notes on the payload:

* Operators are the six symbols `+ - * / % **`. `display` is the symbol as a user sees it
  on the keypad; `family` is the value stored in the `operation` column of the history.
* `log` is base 10 and `ln` is natural. All trigonometric functions take **radians**.
* A function name or constant is only accepted in `scientific` mode.
* `constants` includes `ans`, the value of the previous calculation, which the client
  sends back in the `ans` field of `POST /api/calculate`.

**Error cases**

| Case | Code | Status (lenient) | Status (strict) |
| --- | --- | --- | --- |
| Wrong method on the same URL | `ROUTE_NOT_FOUND` | 404 | 404 |

---

## 6. `POST /api/calculate`

**Purpose.** Evaluate one arithmetic expression and, on success, store it in the
calculation history.

**Method and path.** `POST /api/calculate`

**Parameters (JSON body)**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `expression` | string | yes | — | The expression to evaluate. Must not be empty after trimming; at most **200** characters (`MAX_EXPRESSION_LENGTH`). Calculator symbols (`× ÷ − ² ³ ^`), full-width characters and whitespace are normalised. |
| `mode` | `"basic"` \| `"scientific"` | no | `"basic"` | Enables the scientific function and constant whitelist. In `basic` mode a function name or a constant is refused. |
| `ans` | number | no | — | The previous result, available inside the expression as the constant `ans` (scientific mode). Only meaningful together with `mode: "scientific"`. |

Limits in force in every mode: **200** characters, **256** tokens, **32** levels of nested
parentheses. Results are rounded to **12 significant digits** before they are stored and
displayed, and `-0` is normalised to `0`.

**Request example**

```json
{
  "method": "POST",
  "url": "http://127.0.0.1:8080/api/calculate",
  "headers": { "Content-Type": "application/json" },
  "body": { "expression": "12+8" }
}
```

**Success response — `201 Created`** (a history record was created)

```json
{
  "success": true,
  "expression": "12+8",
  "result": 20,
  "resultText": "20",
  "operation": "addition",
  "mode": "basic",
  "durationMs": 0.412,
  "historyId": 17,
  "createdAt": "2026-10-02 10:31:07"
}
```

`200 OK` instead of `201` when no history record was created — the same body, with
`historyId: null` and `createdAt: null`. This happens only when persistence is switched
off for the process (used by unit tests and by the seed script); a normal client always
receives `201`.

| Field | Type | Meaning |
| --- | --- | --- |
| `expression` | string | The **normalised** expression, not the raw input. `12×8` is echoed as `12*8`, `2²` as `2**2`, `2 3` as `23`. |
| `result` | number | The numeric result, rounded to 12 significant digits. |
| `resultText` | string | Exactly the string the user sees; store or display this one. |
| `operation` | string | Operation family of the expression: `addition`, `subtraction`, `multiplication`, `division`, `modulo`, `power`, `compound`, `scientific` or `number`. |
| `mode` | string | The mode that was actually used (`basic` or `scientific`). |
| `durationMs` | number | Evaluation time in milliseconds, rounded to three decimals. |
| `historyId` | number \| null | Primary key of the stored record, or `null` when nothing was stored. |
| `createdAt` | string \| null | Database-generated timestamp `YYYY-MM-DD HH:MM:SS`, or `null`. |

The `operation` family is derived from the operators and functions the expression really
used: one operator family alone gives that family (`12+8` → `addition`), more than one
gives `compound` (`1+2*3`), an expression that only calls scientific functions gives
`scientific` (`sqrt(9)`), and a plain value gives `number`.

More success examples:

```json
{
  "success": true,
  "expression": "12*8/4",
  "result": 24,
  "resultText": "24",
  "operation": "compound",
  "mode": "basic",
  "durationMs": 0.388,
  "historyId": 18,
  "createdAt": "2026-10-02 10:32:15"
}
```

```json
{
  "success": true,
  "expression": "sqrt(144)+2**3",
  "result": 20,
  "resultText": "20",
  "operation": "compound",
  "mode": "scientific",
  "durationMs": 0.531,
  "historyId": 19,
  "createdAt": "2026-10-02 10:33:02"
}
```

```json
{
  "success": true,
  "expression": "0.1+0.2",
  "result": 0.3,
  "resultText": "0.3",
  "operation": "addition",
  "mode": "basic",
  "durationMs": 0.297,
  "historyId": 20,
  "createdAt": "2026-10-02 10:33:41"
}
```

With `ans`:

```json
{
  "method": "POST",
  "url": "http://127.0.0.1:8080/api/calculate",
  "body": { "expression": "ans*2", "mode": "scientific", "ans": 21 }
}
```

```json
{
  "success": true,
  "expression": "ans*2",
  "result": 42,
  "resultText": "42",
  "operation": "multiplication",
  "mode": "scientific",
  "durationMs": 0.244,
  "historyId": 21,
  "createdAt": "2026-10-02 10:34:10"
}
```

**Error cases.** A refused expression **stores nothing**: the history table is untouched,
so a failed request can never pollute the record of successful calculations. The numbers
in this table were produced by real runs of the pipeline.

| Input | Code | Status (lenient) | Status (strict) |
| --- | --- | --- | --- |
| `10/(3-3)` | `EVALUATOR_DIVISION_BY_ZERO` | 200 | 400 |
| `sqrt(144)` without `"mode":"scientific"` | `VALIDATION_INVALID_PARAMETER` | 200 | 400 |
| `1+*2` | `PARSER_MISSING_OPERAND` | 200 | 400 |
| `(1+2` | `PARSER_UNMATCHED_PARENTHESIS` | 200 | 400 |
| `1+` | `PARSER_TRAILING_OPERATOR` | 200 | 400 |
| `(1+2) 3` | `PARSER_MISSING_OPERATOR` | 200 | 400 |
| `sin(1,2)` | `PARSER_INVALID_FUNCTION_CALL` | 200 | 400 |
| 40 nested parentheses | `PARSER_NESTING_TOO_DEEP` | 200 | 400 |
| `abc` | `TOKENIZER_UNKNOWN_IDENTIFIER` | 200 | 400 |
| `1+2;` | `TOKENIZER_INVALID_CHARACTER` | 200 | 400 |
| `1e5` | `TOKENIZER_INVALID_NUMBER` | 200 | 400 |
| `1.2.3` | `TOKENIZER_INVALID_NUMBER` | 200 | 400 |
| more than 256 tokens | `TOKENIZER_TOO_MANY_TOKENS` | 200 | 400 |
| `sqrt(-4)` in scientific mode | `EVALUATOR_DOMAIN_ERROR` | 200 | 400 |
| `9**9**9` | `EVALUATOR_OVERFLOW` | 200 | 400 |
| `0/0` | `EVALUATOR_DIVISION_BY_ZERO` | 200 | 400 |
| missing `expression` field | `VALIDATION_MISSING_FIELD` | 400 | 400 |
| `{"expression": 42}` | `VALIDATION_INVALID_FIELD_TYPE` | 400 | 400 |
| `{"expression": "   "}` | `VALIDATION_EMPTY_EXPRESSION` | 400 | 400 |
| expression with more than 200 characters | `VALIDATION_EXPRESSION_TOO_LONG` | 400 | 400 |
| `{"expression":"1+1","mode":"quantum"}` | `VALIDATION_INVALID_PARAMETER` | 400 | 400 |
| body `{"expression": ` (not valid JSON) | `VALIDATION_INVALID_JSON` | 400 | 400 |
| body larger than 64 kb | `VALIDATION_INVALID_PARAMETER` | 413 | 413 |
| database write fails | `STORAGE_FAILURE` | 500 | 500 |
| unclassified defect | `INTERNAL_ERROR` | 500 | 500 |

Note the distinction between the two `VALIDATION_INVALID_PARAMETER` rows: the `mode` and
`ans` fields are validated *before* evaluation, so they answer `400` even in `lenient`
mode, while a scientific name used in basic mode is refused by the tokenizer *during*
evaluation and therefore follows `ERROR_HTTP_MODE`.

Error example — division by zero, in `strict` mode (`ERROR_HTTP_MODE=strict`):

```json
{
  "success": false,
  "error": "EVALUATOR_DIVISION_BY_ZERO",
  "message": "Division by zero",
  "detail": "The expression \"10 / 0\" divides by zero"
}
```

The same request in the default `lenient` mode returns the identical body with
**HTTP 200**.

Error example — scientific call without scientific mode:

```json
{
  "success": false,
  "error": "VALIDATION_INVALID_PARAMETER",
  "message": "Invalid request parameter",
  "detail": "\"sqrt\" is only available in scientific mode; send \"mode\": \"scientific\""
}
```

Error example — invalid character:

```json
{
  "success": false,
  "error": "TOKENIZER_INVALID_CHARACTER",
  "message": "Expression contains an invalid character",
  "detail": "Character \";\" at position 4 is not allowed"
}
```

Error example — missing field (no `detail`-less body is possible here, the field name is
always named):

```json
{
  "success": false,
  "error": "VALIDATION_MISSING_FIELD",
  "message": "Required field is missing",
  "detail": "The field \"expression\" is required"
}
```

---

## 7. `GET /api/history`

**Purpose.** Read the stored calculation history, newest first. Two shapes are supported:
a page (`limit`/`offset`) used by the history panel of the front end, and `page=all`, which
returns every record and is the plain listing described by the assignment.

**Method and path.** `GET /api/history`

**Parameters (query string)**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `limit` | integer | no | `10` | Page size. Values above **100** are clamped to 100; a value that is not a positive integer falls back to the default. |
| `offset` | integer | no | `0` | Number of records to skip. A negative or non-numeric value becomes `0`. |
| `keyword` | string | no | — | Case-insensitive substring match on the stored expression. `LIKE` wildcards (`%`, `_`, `\`) in the keyword are escaped, so `%` searches for a literal percent sign. |
| `operation` | string | no | — | Exact operation family filter. Accepted values: `addition`, `subtraction`, `multiplication`, `division`, `modulo`, `power`, `compound`, `scientific`, `number`, `conversion`. Any other value is rejected. |
| `page` | string | no | — | `page=all` returns every matching record and replaces `limit`/`offset` with `"page": "all"` in the response. |

Ordering is always newest first (`ORDER BY id DESC`).

**Request example**

```json
{
  "method": "GET",
  "url": "http://127.0.0.1:8080/api/history?limit=3&keyword=sqrt"
}
```

**Success response — `200 OK` (paged)**

```json
{
  "success": true,
  "total": 16,
  "returned": 1,
  "limit": 3,
  "offset": 0,
  "records": [
    {
      "id": 11,
      "expression": "sqrt(144)",
      "result": 12,
      "resultText": "12",
      "operation": "scientific",
      "mode": "scientific",
      "createdAt": "2026-10-02 08:41:26"
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `total` | number | Number of records matching the filters (not only the ones on this page). |
| `returned` | number | Number of records in `records`. |
| `limit` | number | The page size actually applied, after clamping. |
| `offset` | number | The offset actually applied. |
| `records` | array | The page, newest first. |

Each record has `id`, `expression` (the normalised expression), `result` (number),
`resultText` (displayed string), `operation`, `mode` and `createdAt`.

**Success response — `200 OK` (`page=all`)** — no `limit`, no `offset`, and `page: "all"`
is added:

```json
{
  "success": true,
  "total": 16,
  "returned": 16,
  "page": "all",
  "records": [
    {
      "id": 16,
      "expression": "(2+3)*(7-4)",
      "result": 15,
      "resultText": "15",
      "operation": "compound",
      "mode": "basic",
      "createdAt": "2026-10-02 10:18:22"
    },
    {
      "id": 15,
      "expression": "3.14159*2.5",
      "result": 7.853975,
      "resultText": "7.853975",
      "operation": "multiplication",
      "mode": "basic",
      "createdAt": "2026-10-02 10:05:36"
    },
    {
      "id": 14,
      "expression": "100/(4*5)",
      "result": 5,
      "resultText": "5",
      "operation": "compound",
      "mode": "basic",
      "createdAt": "2026-10-02 09:30:11"
    }
  ]
}
```

An empty result set is still a success:

```json
{
  "success": true,
  "total": 0,
  "returned": 0,
  "page": "all",
  "records": []
}
```

**Error cases**

| Case | Code | Status (lenient) | Status (strict) |
| --- | --- | --- | --- |
| `?operation=teleportation` | `VALIDATION_INVALID_PARAMETER` | 400 | 400 |
| database read fails | `STORAGE_FAILURE` | 500 | 500 |
| wrong method on the same URL | `ROUTE_NOT_FOUND` | 404 | 404 |

An out-of-range `limit` or a negative `offset` is **not** an error: both are normalised
(`limit` clamped to 100, `offset` set to 0). Only an unknown `operation` value is refused:

```json
{
  "success": false,
  "error": "VALIDATION_INVALID_PARAMETER",
  "message": "Invalid request parameter",
  "detail": "Unknown operation \"teleportation\". Supported values: addition, subtraction, multiplication, division, modulo, power, compound, scientific, number, conversion"
}
```

---

## 8. `DELETE /api/history/{id}`

**Purpose.** Delete exactly one history record by its id — the function the assignment
requires for the "delete" button of the history panel.

**Method and path.** `DELETE /api/history/{id}`

**Parameters (path)**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | integer | yes | — | Primary key of the record. Must be a positive integer without extra characters; `12 ` is accepted (trimmed), `12.5`, `abc` and `-3` are not. |

**Request example**

```json
{
  "method": "DELETE",
  "url": "http://127.0.0.1:8080/api/history/7"
}
```

**Success response — `200 OK`**

```json
{
  "success": true,
  "deletedId": 7,
  "remaining": 15
}
```

`remaining` is the number of records left in the table after the deletion, counted with a
second query, so the front end can update its counter without another request.

**Error cases**

| Case | Code | Status (lenient) | Status (strict) |
| --- | --- | --- | --- |
| `DELETE /api/history/abc` | `VALIDATION_INVALID_PARAMETER` | 400 | 400 |
| `DELETE /api/history/12.5` | `VALIDATION_INVALID_PARAMETER` | 400 | 400 |
| `DELETE /api/history/999999` (no such record) | `HISTORY_NOT_FOUND` | **404** | **404** |
| database failure | `STORAGE_FAILURE` | 500 | 500 |

A missing record is `404` in **both** error modes, because the repository checks the
number of affected rows instead of reporting a silent success.

Error example — non-integer id:

```json
{
  "success": false,
  "error": "VALIDATION_INVALID_PARAMETER",
  "message": "Invalid request parameter",
  "detail": "The history id must be a positive integer"
}
```

Error example — missing record:

```json
{
  "success": false,
  "error": "HISTORY_NOT_FOUND",
  "message": "Calculation history record does not exist",
  "detail": "No calculation history record has the id 999999"
}
```

---

## 9. `DELETE /api/history`

**Purpose.** Clear the entire history (documented extension). Deletes every row and resets
the auto-increment sequence, so the next stored calculation starts again at `id = 1`.

**Method and path.** `DELETE /api/history`

**Parameters.** None. This route is registered separately from `/:id`, so it is never
matched by a missing id.

**Request example**

```json
{
  "method": "DELETE",
  "url": "http://127.0.0.1:8080/api/history"
}
```

**Success response — `200 OK`**

```json
{
  "success": true,
  "deleted": 16,
  "remaining": 0
}
```

`deleted` is the number of rows counted immediately before the deletion, so it is accurate
even though the `DELETE` itself only reports affected rows. Clearing an already empty table
is a success with `"deleted": 0`.

**Error cases**

| Case | Code | Status (lenient) | Status (strict) |
| --- | --- | --- | --- |
| database failure | `STORAGE_FAILURE` | 500 | 500 |
| wrong method on the same URL | `ROUTE_NOT_FOUND` | 404 | 404 |

---

## 10. `GET /api/stats`

**Purpose.** Aggregated statistics over the stored history, used by the dashboard of the
front end.

**Method and path.** `GET /api/stats`

**Parameters (query string)**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `days` | integer | no | `7` | Number of days included in the `daily` series. A value that is not a positive integer falls back to 7; values above 30 are clamped to 30. |

**Request example**

```json
{
  "method": "GET",
  "url": "http://127.0.0.1:8080/api/stats?days=7"
}
```

**Success response — `200 OK`**

```json
{
  "success": true,
  "total": 16,
  "byOperation": {
    "compound": 5,
    "addition": 3,
    "multiplication": 3,
    "subtraction": 2,
    "division": 2,
    "scientific": 1
  },
  "daily": [
    { "day": "2026-10-02", "count": 6 },
    { "day": "2026-10-01", "count": 10 }
  ],
  "lastCalculationAt": "2026-10-02 10:18:22"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `total` | number | Total number of stored records. |
| `byOperation` | object | `operation` → count, in descending count order. Families that never occurred are absent. |
| `daily` | array | `{day, count}` per day, newest day first, limited to `days` entries. |
| `lastCalculationAt` | string \| null | Timestamp of the newest record, or `null` when the table is empty. |

Because the operation family is stored in its own column at write time, `byOperation` is a
plain `GROUP BY` and never re-parses a stored expression.

**Error cases**

| Case | Code | Status (lenient) | Status (strict) |
| --- | --- | --- | --- |
| database failure | `STORAGE_FAILURE` | 500 | 500 |
| wrong method on the same URL | `ROUTE_NOT_FOUND` | 404 | 404 |

---

## 11. `POST /api/convert/base`

**Purpose.** Convert a number between the supported bases **2, 8, 10, 16 and 36**
(documentation extension). Three input modes are accepted:

1. `{ "value": <number> }` — convert a decimal number into **every** supported base;
2. `{ "value": <string>, "fromBase": <number> }` — parse a text value written in
   `fromBase` and convert it into every supported base;
3. `{ "value": <number>, "toBase": <number> }` — convert a decimal number into one
   specific base.

The integer part is converted with `BigInt`, so integers beyond 2^53 keep every digit
exactly. The fractional part uses up to 8 digits by default.

**Method and path.** `POST /api/convert/base`

**Parameters (JSON body)**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `value` | number \| string | yes | — | The value to convert. A string is only valid together with `fromBase`. |
| `fromBase` | number | no | — | Source base for a string `value`. One of `2`, `8`, `10`, `16`, `36`. |
| `toBase` | number | no | — | Target base for a numeric `value`. One of `2`, `8`, `10`, `16`, `36`. When omitted, every supported base is returned. |

`fromBase` and `toBase` are mutually exclusive in practice: when `fromBase` is present it
takes precedence and the full conversion list is returned.

**Request example 1 — all bases**

```json
{
  "method": "POST",
  "url": "http://127.0.0.1:8080/api/convert/base",
  "headers": { "Content-Type": "application/json" },
  "body": { "value": 255 }
}
```

**Success response — `200 OK`**

```json
{
  "success": true,
  "value": 255,
  "decimal": "255",
  "conversions": [
    { "base": 2, "result": "11111111" },
    { "base": 8, "result": "377" },
    { "base": 10, "result": "255" },
    { "base": 16, "result": "ff" },
    { "base": 36, "result": "73" }
  ],
  "result": "11111111"
}
```

`result` is the first entry of `conversions`; with `toBase` it is the requested base:

**Request example 2 — one target base**

```json
{
  "body": { "value": 10.5, "toBase": 2 }
}
```

```json
{
  "success": true,
  "value": 10.5,
  "decimal": "10.5",
  "toBase": 2,
  "conversions": [{ "base": 2, "result": "1010.1" }],
  "result": "1010.1"
}
```

**Request example 3 — parse from a base**

```json
{
  "body": { "value": "ff", "fromBase": 16 }
}
```

```json
{
  "success": true,
  "input": "ff",
  "fromBase": 16,
  "value": 255,
  "decimal": "255",
  "conversions": [
    { "base": 2, "result": "11111111" },
    { "base": 8, "result": "377" },
    { "base": 10, "result": "255" },
    { "base": 16, "result": "ff" },
    { "base": 36, "result": "73" }
  ]
}
```

Field summary: `value` is the decimal number (a number in modes 1 and 3, the parsed decimal
value in mode 2), `decimal` is its string form, `conversions` lists `{base, result}` pairs,
and `result` is the single requested representation (absent in mode 2, where the whole list
is the answer).

**Error cases**

| Case | Code | Status (lenient) | Status (strict) |
| --- | --- | --- | --- |
| `{"value": "12", "fromBase": 2}` — `2` is not a binary digit | `TOKENIZER_INVALID_NUMBER` | 400 | 400 |
| `{"value": 10, "toBase": 7}` | `VALIDATION_INVALID_BASE` | 400 | 400 |
| `{"value": "10", "fromBase": 7}` | `VALIDATION_INVALID_BASE` | 400 | 400 |
| `{"value": true}` (not a number, no `fromBase`) | `VALIDATION_INVALID_FIELD_TYPE` | 400 | 400 |
| `{"value": "12"}` without `fromBase` | `VALIDATION_INVALID_FIELD_TYPE` | 400 | 400 |
| integer part larger than `Number.MAX_SAFE_INTEGER` in a parsed string | `EVALUATOR_OVERFLOW` | 400 | 400 |
| body not valid JSON | `VALIDATION_INVALID_JSON` | 400 | 400 |

These validations happen in the controller and in the converter service, so — unlike a
refused expression — they do **not** depend on `ERROR_HTTP_MODE` and answer `400` in both
modes.

Error example — invalid digit for the base:

```json
{
  "success": false,
  "error": "TOKENIZER_INVALID_NUMBER",
  "message": "Invalid number format",
  "detail": "\"2\" is not a valid digit in base 2"
}
```

Error example — unsupported base:

```json
{
  "success": false,
  "error": "VALIDATION_INVALID_BASE",
  "message": "Unsupported number base",
  "detail": "Supported bases are 2, 8, 10, 16, 36"
}
```

---

## 12. `POST /api/convert/unit`

**Purpose.** Convert a value between two units of the same category (documentation
extension). Eight categories are supported: length, mass, temperature, area, volume, time,
speed and data.

**Method and path.** `POST /api/convert/unit`

**Parameters (JSON body)**

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `value` | number | yes | — | The numeric value to convert. A numeric string is coerced; `true`/`null` are refused. |
| `from` | string | yes | — | Source unit id, lower-case display symbol (for example `km`, `°c`, `km/h`, `mib`). Whitespace around it is trimmed. |
| `to` | string | yes | — | Target unit id, same rules, and it must belong to the same category as `from`. |

Unit ids by category:

| Category | Unit ids |
| --- | --- |
| length | `mm` `cm` `m` `km` `in` `ft` `yd` `mi` `nmi` |
| mass | `mg` `g` `kg` `t` `oz` `lb` `斤` |
| temperature | `°c` `°f` `k` |
| area | `cm2` `m2` `km2` `ha` `acre` `ft2` `亩` |
| volume | `ml` `l` `m3` `gal` `qt` `cup` |
| time | `ms` `s` `min` `h` `d` `wk` |
| speed | `m/s` `km/h` `mph` `kn` |
| data | `b` `kb` `kib` `mb` `mib` `gb` `gib` `tb` `tib` |

Temperature is **affine**, not a pure ratio: `C → F` uses factor `5/9` and offset
`-32 × (5/9)`, and `K` uses offset `-273.15`. Hence `100 °C = 212 °F` and
`98.6 °F = 37 °C`, and `0 °C = 273.15 K`. Results are rounded to 12 significant digits.

**Request example**

```json
{
  "method": "POST",
  "url": "http://127.0.0.1:8080/api/convert/unit",
  "headers": { "Content-Type": "application/json" },
  "body": { "value": 100, "from": "°c", "to": "°f" }
}
```

**Success response — `200 OK`**

```json
{
  "success": true,
  "value": 100,
  "category": "temperature",
  "from": { "unit": "°c", "name": "Celsius", "symbol": "°C" },
  "to": { "unit": "°f", "name": "Fahrenheit", "symbol": "°F" },
  "result": 212,
  "resultText": "212"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `value` | number | The input value, echoed back. |
| `category` | string | The shared category of both units. |
| `from` / `to` | object | `unit` (the id), `name` (display name) and `symbol` (display symbol) of each side. |
| `result` | number | Converted value, rounded to 12 significant digits, `-0` normalised to `0`. |
| `resultText` | string | The same value as the string to display. |

More examples:

```json
{
  "body": { "value": 100, "from": "°f", "to": "°c" }
}
```

```json
{
  "success": true,
  "value": 100,
  "category": "temperature",
  "from": { "unit": "°f", "name": "Fahrenheit", "symbol": "°F" },
  "to": { "unit": "°c", "name": "Celsius", "symbol": "°C" },
  "result": 37.7777777778,
  "resultText": "37.7777777778"
}
```

```json
{
  "body": { "value": 98.6, "from": "°f", "to": "°c" }
}
```

```json
{
  "success": true,
  "value": 98.6,
  "category": "temperature",
  "from": { "unit": "°f", "name": "Fahrenheit", "symbol": "°F" },
  "to": { "unit": "°c", "name": "Celsius", "symbol": "°C" },
  "result": 37,
  "resultText": "37"
}
```

```json
{
  "body": { "value": 100, "from": "km/h", "to": "mph" }
}
```

```json
{
  "success": true,
  "value": 100,
  "category": "speed",
  "from": { "unit": "km/h", "name": "Kilometre per hour", "symbol": "km/h" },
  "to": { "unit": "mph", "name": "Mile per hour", "symbol": "mph" },
  "result": 62.1371192237,
  "resultText": "62.1371192237"
}
```

**Error cases**

| Case | Code | Status (lenient) | Status (strict) |
| --- | --- | --- | --- |
| `{"value": 1, "from": "kg", "to": "k"}` — different categories | `VALIDATION_INVALID_PARAMETER` | 400 | 400 |
| `{"value": 1, "from": "stone", "to": "kg"}` — unknown unit | `VALIDATION_INVALID_PARAMETER` | 400 | 400 |
| `{"value": 1, "to": "kg"}` — missing `from` | `VALIDATION_MISSING_FIELD` | 400 | 400 |
| `{"value": "abc", "from": "m", "to": "km"}` | `VALIDATION_INVALID_FIELD_TYPE` | 400 | 400 |
| body not valid JSON | `VALIDATION_INVALID_JSON` | 400 | 400 |

Error example — different categories:

```json
{
  "success": false,
  "error": "VALIDATION_INVALID_PARAMETER",
  "message": "Invalid request parameter",
  "detail": "\"kg\" and \"k\" belong to different categories (mass and temperature)"
}
```

---

## 13. `GET /api/convert/units`

**Purpose.** List every conversion category and its units, so the front end can build the
unit selectors from the back end instead of hard-coding them.

**Method and path.** `GET /api/convert/units`

**Parameters.** None.

**Request example**

```json
{
  "method": "GET",
  "url": "http://127.0.0.1:8080/api/convert/units"
}
```

**Success response — `200 OK`** (abridged; the real response contains all 8 categories and
all 54 units)

```json
{
  "success": true,
  "categories": [
    {
      "category": "length",
      "name": "Length",
      "baseUnit": "m",
      "units": [
        { "unit": "mm", "name": "Millimetre", "symbol": "mm" },
        { "unit": "cm", "name": "Centimetre", "symbol": "cm" },
        { "unit": "m", "name": "Metre", "symbol": "m" },
        { "unit": "km", "name": "Kilometre", "symbol": "km" },
        { "unit": "in", "name": "Inch", "symbol": "in" },
        { "unit": "ft", "name": "Foot", "symbol": "ft" },
        { "unit": "yd", "name": "Yard", "symbol": "yd" },
        { "unit": "mi", "name": "Mile", "symbol": "mi" },
        { "unit": "nmi", "name": "Nautical mile", "symbol": "nmi" }
      ]
    },
    {
      "category": "temperature",
      "name": "Temperature",
      "baseUnit": "°C",
      "units": [
        { "unit": "°c", "name": "Celsius", "symbol": "°C" },
        { "unit": "°f", "name": "Fahrenheit", "symbol": "°F" },
        { "unit": "k", "name": "Kelvin", "symbol": "K" }
      ]
    },
    {
      "category": "data",
      "name": "Digital storage",
      "baseUnit": "B",
      "units": [
        { "unit": "b", "name": "Byte", "symbol": "B" },
        { "unit": "kb", "name": "Kilobyte (1000 B)", "symbol": "kB" },
        { "unit": "kib", "name": "Kibibyte (1024 B)", "symbol": "KiB" },
        { "unit": "gb", "name": "Gigabyte (1000³ B)", "symbol": "GB" },
        { "unit": "tib", "name": "Tebibyte (1024⁴ B)", "symbol": "TiB" }
      ]
    }
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `category` | string | Category id used by `POST /api/convert/unit` indirectly (through the unit ids). |
| `name` | string | Display name of the category. |
| `baseUnit` | string | The unit every value of the category is normalised to internally. |
| `units[].unit` | string | The id to send as `from` / `to`. |
| `units[].name` | string | Display name. |
| `units[].symbol` | string | Display symbol. |

The 8 categories, in response order, with their base unit: `length` (m), `mass` (kg),
`temperature` (°C), `area` (m²), `volume` (L), `time` (s), `speed` (m/s), `data` (B).

**Error cases**

| Case | Code | Status (lenient) | Status (strict) |
| --- | --- | --- | --- |
| wrong method on the same URL | `ROUTE_NOT_FOUND` | 404 | 404 |

---

## 14. Quick reference: endpoints × error codes

`L` = status in `lenient` mode (default), `S` = status in `strict` mode
(`ERROR_HTTP_MODE=strict`, the mode the test suite uses).

| Endpoint | Error code | L | S | Typical trigger |
| --- | --- | --- | --- | --- |
| `POST /api/calculate` | `VALIDATION_MISSING_FIELD` | 400 | 400 | `expression` missing |
| | `VALIDATION_INVALID_FIELD_TYPE` | 400 | 400 | `expression` is not a string, `ans` is not a number |
| | `VALIDATION_EMPTY_EXPRESSION` | 400 | 400 | `expression` is empty or whitespace only |
| | `VALIDATION_EXPRESSION_TOO_LONG` | 400 | 400 | more than 200 characters |
| | `VALIDATION_INVALID_PARAMETER` | 400 / 200 | 400 | unknown `mode` (400); scientific name in basic mode (follows the mode) |
| | `VALIDATION_INVALID_JSON` | 400 | 400 | body is not valid JSON |
| | `TOKENIZER_INVALID_CHARACTER` | 200 | 400 | `1+2;` |
| | `TOKENIZER_INVALID_NUMBER` | 200 | 400 | `1e5`, `1.2.3` |
| | `TOKENIZER_TOO_MANY_TOKENS` | 200 | 400 | more than 256 tokens |
| | `TOKENIZER_UNKNOWN_IDENTIFIER` | 200 | 400 | `abc`, `0x10` |
| | `PARSER_SYNTAX_ERROR` | 200 | 400 | `sqrt(4) 2` |
| | `PARSER_UNMATCHED_PARENTHESIS` | 200 | 400 | `(1+2`, `1+2)` |
| | `PARSER_MISSING_OPERAND` | 200 | 400 | `1+*2` |
| | `PARSER_MISSING_OPERATOR` | 200 | 400 | `(1+2) 3` |
| | `PARSER_TRAILING_OPERATOR` | 200 | 400 | `1+` |
| | `PARSER_NESTING_TOO_DEEP` | 200 | 400 | more than 32 nested parentheses |
| | `PARSER_INVALID_FUNCTION_CALL` | 200 | 400 | `sin(1,2)`, `pow(2)` |
| | `EVALUATOR_DIVISION_BY_ZERO` | 200 | 400 | `10/(3-3)`, `5%0`, `0**-1` |
| | `EVALUATOR_DOMAIN_ERROR` | 200 | 400 | `sqrt(-4)`, `ln(0)`, `(-8)**0.5` |
| | `EVALUATOR_NOT_A_NUMBER` | 200 | 400 | an operation with no numeric result |
| | `EVALUATOR_OVERFLOW` | 200 | 400 | `9**9**9` |
| | `STORAGE_FAILURE` | 500 | 500 | insert failed |
| | `INTERNAL_ERROR` | 500 | 500 | unclassified defect |
| `GET /api/history` | `VALIDATION_INVALID_PARAMETER` | 400 | 400 | unknown `operation` value |
| | `STORAGE_FAILURE` | 500 | 500 | read failed |
| `DELETE /api/history/{id}` | `VALIDATION_INVALID_PARAMETER` | 400 | 400 | id is not a positive integer |
| | `HISTORY_NOT_FOUND` | 404 | 404 | no record with this id |
| | `STORAGE_FAILURE` | 500 | 500 | delete failed |
| `DELETE /api/history` | `STORAGE_FAILURE` | 500 | 500 | clear failed |
| `GET /api/stats` | `STORAGE_FAILURE` | 500 | 500 | aggregation failed |
| `POST /api/convert/base` | `VALIDATION_INVALID_BASE` | 400 | 400 | `toBase`/`fromBase` not in 2, 8, 10, 16, 36 |
| | `TOKENIZER_INVALID_NUMBER` | 400 | 400 | digit is invalid for the base |
| | `VALIDATION_INVALID_FIELD_TYPE` | 400 | 400 | `value` is neither a number nor a string with `fromBase` |
| | `EVALUATOR_OVERFLOW` | 400 | 400 | integer part above `Number.MAX_SAFE_INTEGER` |
| | `VALIDATION_INVALID_JSON` | 400 | 400 | body is not valid JSON |
| `POST /api/convert/unit` | `VALIDATION_MISSING_FIELD` | 400 | 400 | `from` or `to` missing |
| | `VALIDATION_INVALID_FIELD_TYPE` | 400 | 400 | `value` is not numeric |
| | `VALIDATION_INVALID_PARAMETER` | 400 | 400 | unknown unit, or units of different categories |
| | `VALIDATION_INVALID_JSON` | 400 | 400 | body is not valid JSON |
| `GET /api/convert/units` | — | — | — | never fails |
| `GET /api/capabilities` | — | — | — | never fails |
| `GET /api/health` | — | — | — | reports `degraded` instead of failing |
| `GET /api` | — | — | — | never fails |
| **any endpoint** | `ROUTE_NOT_FOUND` | 404 | 404 | unknown URL |
| **any endpoint** | `INTERNAL_ERROR` | 500 | 500 | unclassified defect |
| **any `POST`** | `VALIDATION_INVALID_PARAMETER` | 413 | 413 | body larger than 64 kb |

Supported methods per path, for completeness:

| Path | Methods |
| --- | --- |
| `/api` | `GET` |
| `/api/health`, `/api/capabilities`, `/api/history`, `/api/stats`, `/api/convert/units` | `GET` |
| `/api/calculate`, `/api/convert/base`, `/api/convert/unit` | `POST` |
| `/api/history`, `/api/history/{id}` | `DELETE` |
| every path | `OPTIONS` (preflight, `204`) |

---

## 15. Recorded transcript

`tools/api-transcript.txt` holds the raw transcript of a real run: the requests that were
actually sent and the responses that were actually received, in order. Use it as evidence
next to this document — the reference explains *why* a response looks the way it does,
the transcript shows that it does.
