# Coding Standard — 832402111_calculator_backend

## Source of the standard

This document records the coding rules that are **actually applied** in this repository. It is not an independent invention: the standard is derived from existing, widely used guides, in this order of authority.

1. **Primary basis — *Google JavaScript Style Guide*** (<https://google.github.io/styleguide/jsguide.html>). Naming, language features, JSDoc requirements, comments, error handling philosophy and the "prefer explicit and boring over clever" attitude all follow Google's guide.
2. **Supplement — *Airbnb JavaScript Style Guide*** (<https://github.com/airbnb/javascript>). Used mainly for the rules Google leaves open: semicolons, quote style, trailing commas, the ban on floating promises and the treatment of `require`-based module structure.
3. **Supplement — Node.js documentation conventions** (<https://nodejs.org/docs/latest/api/>). Used for module layout, the `node:` prefix on built-in imports, `async`/`await` usage, error-first thinking in I/O code and the built-in test runner.

**Deviations from the Google guide are deliberate and are listed here**, so a reviewer comparing the two documents knows exactly where this project departs from the primary source.

| Topic | Google JavaScript Style Guide | This project | Why |
| --- | --- | --- | --- |
| Indentation width | 2 spaces (Google also uses 2, unlike the Java guide's 4) | **2 spaces** | Identical to Google; stated explicitly because many university templates use 4. |
| Module system | ES modules (`import` / `export`) are preferred | **CommonJS (`require` / `module.exports`)** | The assignment targets a plain `node server.js` start on any Node.js >= 22.5 without a build step, `"type": "module"` or import-map questions. |
| Column limit | 80 columns | **100 columns** | The storage and route modules carry readable SQL and English detail strings; 100 keeps those lines intact instead of forcing artificial breaks. |
| Line breaks | Continuation lines indented +4 | Continuation lines indented **+4 from the statement**, closing brackets on their own line | Matches Google's block-indent continuation rule; the project applies it to long argument lists. |
| `require` of built-ins | `import ... from 'node:fs'` | `require('node:fs')` — with the **`node:` prefix**, never a bare `'fs'` | Same prefix rule as Google/Node, expressed in CommonJS. |
| Test framework | Jasmine / Mocha historically | **`node:test` + `node:assert/strict`** | Built in, no dependency, and works with the "one process per file" runner. |

The language level is fixed by the runtime: **Node.js >= 22.5**, developed on **v24.22.0**. `'use strict';` is therefore redundant in CommonJS (strict mode is implied by the module wrapper in modern Node.js), yet it is still written as the first statement of every module: it is one line, it is explicit, and it survives being copied into a script that is executed outside the module wrapper.

---

## 1. File and directory naming

- **Files use `lowerCamelCase`**: `historyRepository.js`, `unitConverter.js`, `requestLogger.js`, `errorHandler.js`, `runTests.js`.
- **Directories use `lowerCase` singular nouns** for a layer (`src/expression`, `src/storage`, `src/service`-style names, `src/middleware`, `src/utils`) and plural only where the folder really is a collection read by a script (`scripts/`, `test/`).
- **A module name states its content, not its position**: `src/storage/schema.js` holds DDL and prepared statements, `src/expression/Tokenizer.js` holds the tokenizer. Numbers are not used as name prefixes.
- **Tests are `<module>.test.js`** and live in `test/`: `tokenizer.test.js`, `parser.test.js`, `calculator.test.js`, `converters.test.js`, `api.test.js`. The runner discovers them by the `*.test.js` suffix, so the suffix is part of the contract.
- **Entry points keep their conventional names**: `server.js` at the repository root, `src/app.js` for the Express factory, `scripts/<task>.js` for a CLI task (`seed.js`, `runTests.js`).
- The `src` sub-directory name is always **singular** when it names a role (`config`, `storage`, `middleware`, `controller`-style modules live in `controllers/` as a role collection — a folder named after the layer it contains).
- Documentation files are `README.md` and `codestyle.md` at the repository root, in Markdown, in English.
- No spaces, no non-ASCII characters and no uppercase letters in file and directory names.

## 2. Identifier naming

| Kind | Convention | Example from this repository |
| --- | --- | --- |
| Local variable, parameter, property | `lowerCamelCase` | `rawExpression`, `maxNestingDepth`, `historyRepository`, `resultText` |
| Function and method | `lowerCamelCase`, verb first | `tokenize`, `parseImplicitMultiplication`, `calculateAndStore`, `deleteById` |
| Class | `UpperCamelCase`, noun | `AppError`, `Parser`, `HistoryRepository` |
| Module-level constant object or value | `UPPER_SNAKE_CASE` | `ErrorCode`, `ERROR_MESSAGES`, `MAX_TOKEN_COUNT`, `SUPPORTED_BASES`, `SEED_ROWS`, `DEFAULT_PAGE_SIZE` |
| Frozen "enum-like" object | `UpperCamelCase` for the object, `UPPER_SNAKE_CASE` for the keys | `TokenType.NUMBER`, `InstructionType.BINARY`, `OPERATION_FAMILY.ADDITION` |
| Private/internal helper | Plain `lowerCamelCase`, not exported | `mapRow`, `escapeLike`, `wrapSqlite`, `normalizeOffset` |
| Boolean | `is` / `has` / `can` / `allow` prefix | `isKnownFunction`, `hasOperator`, `allowScientific`, `isSupportedBase` |
| File and directory | `lowerCamelCase` / `lowercase` | `NumberFormatter.js`, `src/middleware` |

The canonical example of the constant rule is `ErrorCode` in `src/utils/errors.js`: the exported binding is `UPPER_SNAKE_CASE` because it is one module-level constant object, and every key and value inside it is `UPPER_SNAKE_CASE` because the values are public, machine readable strings that must not change:

```js
const ErrorCode = Object.freeze({
  VALIDATION_EMPTY_EXPRESSION: 'VALIDATION_EMPTY_EXPRESSION',
  TOKENIZER_TOO_MANY_TOKENS: 'TOKENIZER_TOO_MANY_TOKENS',
  PARSER_UNMATCHED_PARENTHESIS: 'PARSER_UNMATCHED_PARENTHESIS',
  EVALUATOR_DIVISION_BY_ZERO: 'EVALUATOR_DIVISION_BY_ZERO',
  HISTORY_NOT_FOUND: 'HISTORY_NOT_FOUND',
  STORAGE_FAILURE: 'STORAGE_FAILURE',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});
```

Further naming rules:

- Names are **English and descriptive**; no abbreviations except universally understood ones (`id`, `db`, `api`, `min`, `max`).
- **No Hungarian notation** and no type prefixes (`strName`, `arrRows` are rejected); the JSDoc carries the type.
- Data that crosses the storage boundary is converted once: **SQL columns are `snake_case`** (`result_text`, `created_at`) and **JSON fields are `camelCase`** (`resultText`, `createdAt`). The single conversion point is `mapRow` in `src/storage/historyRepository.js`; no other module renames a field.
- A constant that is a collection of accepted values is frozen: `Object.freeze([...])` for arrays, `Object.freeze({...})` for objects. This is what makes an accidental `push` or property assignment a visible failure instead of a silent mutation.
- Error codes are **never** typed as string literals at the throw site; the `ErrorCode` member is used, so a rename is a single-file change.

## 3. Formatting

- **Indentation: 2 spaces per level.** Tabs are never used.
- **Statements end with a semicolon.** No automatic-semicolon-insertion reliance.
- **Strings: single quotes** (`'use strict';`, `'sqlite'`, `'Division by zero'`). Template literals are used only when interpolation or a multi-line string is genuinely needed, as in the SQL statements of `src/storage/schema.js` and the error details of `src/utils/errors.js`.
- **Trailing commas are required** in multi-line object literals, array literals, parameter lists and argument lists:
  ```js
  const MODE = Object.freeze({
    BASIC: 'basic',
    SCIENTIFIC: 'scientific',
  });
  ```
- **Whitespace:** one space around binary operators, after a comma, and before the opening brace of a block; no space before the parentheses of a call; no space inside parentheses or brackets.
  ```js
  if (tokens.length > MAX_TOKEN_COUNT) {
    throw new AppError(ErrorCode.TOKENIZER_TOO_MANY_TOKENS, {
      detail: `At most ${MAX_TOKEN_COUNT} tokens are supported`,
    });
  }
  ```
- **Braces are always used**, also for a single-statement `if`, with the opening brace on the same line. `else` goes on the same line as the closing brace.
- **One statement per line**, one declaration per statement. A variable is declared where it is first needed and never re-declared in the same scope.
- **`const` by default**, `let` only for a value that genuinely changes (`let exponent = digit;` in `normalizeExpression`). `var` is never used.
- **Arrow functions** for callbacks and small module-private helpers; `function` declarations for named, hoisted, documented functions and for the exported factory functions (`createApp`, `tokenize`).
- **Early return over nesting.** Guard clauses are used (`if (!Number.isFinite(value)) { throw ... }`) instead of an `if` that wraps the whole function body. Deep nesting is a review finding.
- **Comparison:** `===` and `!==` always; `==` only where the standard explicitly allows it (`value === undefined || value === null` is written out instead of `== null`, to keep the intent visible).
- **Chained calls** are broken after the dot when they do not fit, one call per line:
  ```js
  const files = fs
    .readdirSync(testDirectory)
    .filter((name) => name.endsWith('.test.js'))
    .sort();
  ```
- **Blank lines** separate the module header comment, the requires, the constants and each function; exactly one blank line between functions, never two in a row inside a function.
- **Maximum line length is 100 columns.** A URL, a long SQL fragment or a base64 blob may exceed it; nothing else may.
- **No trailing whitespace**, and **UTF-8 without BOM**; files end with exactly one newline.

## 4. Documentation (JSDoc)

**Every exported function, class, method and constant carries a JSDoc block.** Unexported helpers carry one when their purpose is not obvious from the name. Rules:

- `@param {type} name` for every parameter, with a short description when the name alone is not enough; optional parameters are written `@param {type} [name]` and documented properties `@param {type} [options.detail]`.
- `@returns {type}` for everything that returns a value (omit only for `void`).
- `@throws {AppError} CODE` for every function that can throw a classified error, listing the codes it may produce.
- `@type` on a variable whose type cannot be inferred from the initialiser (a `{}` or `[]` literal, a module-level map).
- Types are JSDoc types (`{string}`, `{number}`, `{boolean}`, `{object}`, `{Array<object>}`, `{Promise<object>}`, `{import('../storage/historyRepository').HistoryRepository}`), never TypeScript syntax.
- The first sentence is a complete sentence in the imperative or the third person, ending with a period. It must be useful in isolation, because it is what an editor shows on hover.

Real example, taken in spirit and in shape from `src/services/calculationService.js`:

```js
/**
 * Validates the `expression` field of a calculation request.
 *
 * @param {unknown} value
 * @returns {string} the trimmed expression
 * @throws {AppError} VALIDATION_MISSING_FIELD / VALIDATION_INVALID_FIELD_TYPE /
 *                    VALIDATION_EMPTY_EXPRESSION / VALIDATION_EXPRESSION_TOO_LONG
 */
function readExpression(value) {
  if (value === undefined || value === null) {
    throw new AppError(ErrorCode.VALIDATION_MISSING_FIELD, {
      detail: 'The field "expression" is required',
    });
  }
  if (typeof value !== 'string') {
    throw new AppError(ErrorCode.VALIDATION_INVALID_FIELD_TYPE, {
      detail: 'The field "expression" must be a string',
    });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_EMPTY_EXPRESSION);
  }
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    throw new AppError(ErrorCode.VALIDATION_EXPRESSION_TOO_LONG, {
      detail: `At most ${MAX_EXPRESSION_LENGTH} characters are supported`,
    });
  }
  return trimmed;
}
```

Further documentation rules:

- **Module header comment** on every file: a block comment directly after `'use strict';` explaining what the module owns, what it deliberately does *not* own, and any design decision a reader would otherwise question. See the header of `src/expression/Parser.js` for the reference form.
- The API layer is documented with the **HTTP contract inline**, one short block per endpoint (`POST /api/calculate`, request shape, response shape), as in `src/controllers/calculatorController.js`.
- **`// eslint-disable-next-line` annotations are kept where they are meaningful** (`global-require`, `import/no-extraneous-dependencies`, `no-unused-vars` in the error middleware) so that introducing a linter later does not require re-reading every file. They are annotations only: no ESLint configuration is committed yet (see the last section).
- Documentation is written **in English**, in full sentences, without marketing language.

## 5. Module design

- **One responsibility per module.** `Tokenizer.js` performs lexical validation only; `Parser.js` validates structure only; `Evaluator.js` computes only; `NumberFormatter.js` formats only; `historyRepository.js` owns every SQL statement about history and nothing else; `unitConverter.js` knows nothing about HTTP or about expressions.
- **The dependency direction is one way, top to bottom:**

  ```text
  server.js
    -> src/app.js
       -> src/middleware/*          (requestLogger, cors, errorHandler)
       -> src/routes/index.js
          -> src/controllers/*      (read the request, choose the status, shape the body)
             -> src/services/*      (business rules, no HTTP knowledge)
                -> src/expression/* (tokenizer, parser, evaluator, formatter, facade)
                -> src/storage/*    (schema, driver, repository; the only place with SQL)
  src/config/config.js   <- readable from every layer
  src/utils/*            <- readable from every layer (errors, logger, response)
  ```

  A lower layer **never** imports a higher one. `src/expression/Evaluator.js` cannot `require` a controller, and `src/storage/database.js` cannot `require` a service. If a rule seems to need an upward import, the rule belongs in the layer below or must be passed in as a dependency.
- **Dependency injection over hidden imports at the boundaries.** `createApp(deps)` receives its repository, and the controllers read it from `app.locals`; the services receive it as a parameter (`deps.historyRepository`). This is what lets `test/api.test.js` build the whole application against a temporary database without touching global state.
- **No `require` cycles.** Because the direction is strictly downward, a cycle is a design error, not something to work around with a late `require`. The single late `require('mysql2/promise')` inside `openMysql()` is not a cycle: it is deliberate lazy loading of an optional dependency, and it is annotated as such.
- **Configuration is read only through `src/config/config.js`.** That module is the only place in the repository that reads `process.env`, and it freezes the result, so a value cannot change under a running request. **`process.env` must not appear anywhere else.**
  - Documented exception: `src/utils/logger.js` reads `LOG_LEVEL` directly, because the logger is the lowest module in the tree and requiring the configuration module from it would create the only cycle in the project. The exception is written into the module header so it is not copied elsewhere by accident.
  - Documented exception: **test files** assign `process.env` (`SQLITE_PATH`, `PORT`, `HOST`, `DB_CLIENT`, `ERROR_HTTP_MODE`, `SERVE_STATIC`) at the very top of the file, **before** the modules under test are required, so that the configuration is read with the test values. This is test setup, not configuration handling, and it is confined to `test/`.
- **Built-in modules are imported with the `node:` prefix** (`require('node:path')`, `require('node:sqlite')`, `require('node:test')`), which makes the difference between a built-in and an npm package obvious at a glance.
- **Singleton state is forbidden.** No module-level mutable map that survives a request, except the statement cache inside the SQLite driver facade, which is keyed by SQL text and is purely an optimisation.
- **Exports are explicit and minimal.** Only what another module needs is exported; a helper that is only used in one file stays unexported. A module that exports a facade (`Calculator.js`) hides its collaborators on purpose.
- **The public surface of a layer is a small, named object**, not a default export: `module.exports = { tokenize }`, `module.exports = { connect, initializeSchema }`.
- **Constants live next to the thing they describe**, or in `src/config/config.js` when they are limits that a user may want to change through the environment.

## 6. Error handling

- **Never `throw` a bare string** and never `throw new Error('something')` for an expected failure. Every anticipated failure is a classified `AppError` carrying an `ErrorCode`:
  ```js
  throw new AppError(ErrorCode.EVALUATOR_DIVISION_BY_ZERO, {
    detail: 'The expression "10 / 0" divides by zero',
  });
  ```
  `detail` is optional, is written in English, and must be safe to show to a user: no stack trace, no file path, no SQL text.
- **Stable codes, one registry.** The codes live in `src/utils/errors.js` and follow `<LAYER>_<REASON>` in `UPPER_SNAKE_CASE`. A new code is added there, never invented inline in a controller or a service.
- **The HTTP status belongs to the error**, not to the call site: `AppError.defaultStatusFor(code)` decides between 4xx and 5xx, and a call site may override it only with a documented reason.
- **Never swallow an exception silently.** An empty `catch` block is forbidden. A caught error is either rethrown, converted into an `AppError`, or logged with enough context to diagnose it. `catch (error) { throw new AppError(ErrorCode.STORAGE_FAILURE, { detail: '...' }); }` is the accepted pattern when the underlying message must not be exposed.
- **Never leak internals to a client.** Only an `AppError` exposes its message and its `detail`. Anything else is logged with its stack trace and answered as a generic `500 INTERNAL_ERROR`, which is exactly what `classify()` in `src/middleware/errorHandler.js` enforces.
- **One error shape everywhere.** A failed response is always
  ```json
  { "success": false, "error": "<CODE>", "message": "<text>", "detail": "<optional>" }
  ```
  produced by `failure(error)` in `src/utils/response.js`. A controller never builds an error body by hand.
- **Export errors are declared in JSDoc.** If a function can throw `AppError`, its `@throws` line names the codes; an invisible throw is a review finding.
- **Async failures must reach the middleware.** Express 4 does not await handlers, so every `async` route handler is wrapped in `asyncHandler(...)`, which turns a rejected promise into `next(error)`. Without the wrapper the failure would become an unhandled rejection instead of a response.
- **A failed start-up sets `process.exitCode = 1`** instead of calling `process.exit()`, so pending output is flushed and the exit status still reports the failure honestly. The only `process.exit(0)` in the repository is inside the graceful shutdown handler of `server.js`, immediately after the stop has been logged.
- **Domain errors are errors, not `NaN`.** `sqrt(-1)`, `log(0)`, `asin(2)` and the tangent at an undefined angle throw `EVALUATOR_DOMAIN_ERROR`. Silently returning `NaN` or a meaningless `1.6e16` is a defect.
- **A failed calculation is never persisted.** The record is written only after the evaluation succeeded, so an invalid input can never appear in the history or in the statistics.

## 7. Security rules

These rules are non-negotiable; a violation is a blocker, not a review comment.

- **`eval`, `exec`, `new Function`, `setTimeout('code')`, `vm.runInNewContext` and every other API that turns text into program code are forbidden**, anywhere in the repository, including in tests and in scripts. User input is parsed by the hand written tokenizer and evaluated by a `switch` over token types; it is never treated as source code.
- **SQL is only executed through prepared statements with `?` placeholders.** String concatenation of user input into SQL is forbidden. `src/storage/historyRepository.js` binds every value (`expression LIKE ?`, `operation = ?`, `WHERE id = ?`), and the DDL is parameter-free by nature. Dynamic SQL is limited to *constant* fragments chosen by the code (`const where = conditions.length > 0 ? ' WHERE ...' : '';`) and to values supplied as bound parameters; nothing in the SQL text ever comes from a request.
- **User input is validated at the boundary of its layer, before it is used.** The service layer validates the request body (`readExpression`, `readMode`, `readPreviousResult`, `readId`), and the tokenizer validates the language. A lower layer may rely on its input being already validated, but never on it being *safe* — the parser re-checks what it needs.
- **Whitelists, never dynamic property lookups.** Supported functions and constants come from the frozen `FUNCTIONS` and `CONSTANTS` objects and are reached through `Object.prototype.hasOwnProperty.call(...)`, never through `Math[name]`, `obj[userInput]` or `global[...]`. Objects that hold whitelists are created with `Object.freeze` and with no prototype-based lookup shortcut, so `constructor`, `__proto__` or `toString` can never be reached from an expression.
- **Operation filters and unit ids are validated against a closed set** (`KNOWN_OPERATIONS.includes(...)`, `findCategory(unit)`) instead of being passed through to the database or used as a lookup key.
- **LIKE patterns are escaped** (`escapeLike`) so that a `%` typed by a user is a literal percent sign rather than "match anything".
- **Resource limits are enforced before the expensive work**: maximum expression length (200), maximum token count (256), maximum nesting depth (32), and a 64 kb JSON body limit. Reaching a limit answers a classified 4xx error, never a crash.
- **A stack trace never reaches a client.** Errors are logged server-side; the response body contains only the classified code, a safe message and an optional safe detail.
- **Secrets and local state are not committed.** `.env` and the SQLite files under `data/` are in `.gitignore`; no credential, token or personal path appears in the source, in the documentation or in an example.
- **Sensitive response headers are reduced** (`app.disable('x-powered-by')`) and CORS defaults to an explicit whitelist for the public deployment rather than to `*`.

## 8. Logging

- **`src/utils/logger.js` is the only logging module.** `console.log` is not used in application code; the logger writes structured lines (`<ISO timestamp> [LEVEL] message {json meta}`) to stdout, and `warn`/`error` to stderr.
- **Every HTTP request produces exactly one access line** with method, path, status, duration in milliseconds, response size and origin (`src/middleware/requestLogger.js`), including requests that end in an error.
- **Log a rejection at `warn` with its code and detail, a defect at `error` with its stack trace.** This is the split implemented in `errorHandler`.
- **Log records describe events, not internals**: `Calculation succeeded`, `History record deleted`, `Database schema is ready`. A log line never contains a password, a full connection string or user content that is not needed for diagnosis.
- **Logging never changes control flow.** A log call does not decide a status code, does not throw and does not swallow an error.
- **Verbosity is configurable** through `LOG_LEVEL` (`debug`, `info`, `warn`, `error`), and the default `info` is quiet enough to read during a demonstration.
- `JSON.stringify(meta)` is applied to the metadata object only; the message stays a plain, greppable string.

## 9. Comments

- **Comments are written in English**, in full sentences, with correct capitalisation and punctuation.
- **A module header comment is mandatory** on every file: what the module owns, where it sits in the flow, and which decisions are not obvious. The header is placed after `'use strict';` and before the requires.
- **Comments explain *why*, not *what*.** Code that needs a comment to explain *what* it does is rewritten instead. A comment earns its place when it records a decision, a rejected alternative, a domain rule or a risk:
  ```js
  // Step 1: source unit -> base unit of the category
  const baseValue = value * source.factor + (source.offset || 0);
  ```
  ```js
  // A `+` or `-` seen *here* is the sign of the operand that follows, never a
  // binary subtraction, because `parseMultiplicative` only calls `parseUnary`
  // where an operand is required.
  ```
- **A non-obvious constant carries its reason** (`JSON_BODY_LIMIT`, `SIGNIFICANT_DIGITS`, `MAX_FRACTION_DIGITS`), typically with a one-line justification or an example value.
- **No commented-out code.** It is deleted; `git` remembers it. No "temporary" debugging statements.
- **`TODO` comments are not used** as a substitute for a decision. If work is genuinely pending it is recorded in the project notes with an owner and a reason, not left in the source.
- **Section dividers inside a long file** use a short `// --- name -----` line, as in `src/utils/errors.js` and `src/expression/Functions.js`, so a reader can navigate a 200-line module.
- Doc comments (`/** ... */`) follow the JSDoc rules of section 4; a JSDoc block is not a substitute for a module header, and vice versa.

## 10. Async rules

- **`async` / `await` only.** Promise chains with `.then(...)` are not used in application code; callbacks are not used for new code.
- **No floating promises.** Every promise is either `await`ed, returned, or explicitly handled with a comment explaining why it is safe to ignore. `start().catch(...)` at the bottom of `server.js` and `seed(...).then(...).catch(...)` in `scripts/seed.js` are the accepted top-level forms: the rejection is handled, not dropped.
- **Asynchronous failures must propagate.** In a route, the handler is wrapped in `asyncHandler(handler)` so a rejected promise becomes `next(error)`; a rejected promise that no middleware sees is a defect, not a warning.
- **`await` inside a loop is a deliberate choice.** `scripts/seed.js` awaits each insert on purpose: the rows are small, the order and the resulting ids must be deterministic, and reporting a partial insert is easier than batching. Any such loop carries a reason in the code when it is not obvious.
- **Sequential work is not started in parallel by accident.** `Promise.all` is used only for genuinely independent operations that are safe to run at the same time.
- **A blocking API is wrapped, not spread.** `node:sqlite` is synchronous; `src/storage/database.js` wraps it into the same promise based `all` / `get` / `run` / `close` interface as the MySQL driver, so no caller has to know which driver it is talking to.
- **`process.hrtime.bigint()` for durations**, converted to milliseconds at the edge (`Number(... ) / 1e6`), never `Date.now()` around an algorithm whose cost is being measured.
- **Shutdown is asynchronous and awaited**: the HTTP server is closed and the database connection is released before the process reports that it stopped.
- No module starts listening, opens a connection or writes a file as an import side effect: the entry point is guarded by `if (require.main === module)`, which is what allows tests to import `start()`.

## 11. Testing rules

- **One test file per module or per integration surface, named `<module>.test.js`** in `test/`, run by `scripts/runTests.js` in a separate process per file.
- **Framework: the built-in `node:test` and `node:assert/strict`.** No test framework dependency. Every test file starts with the same three requires:
  ```js
  const test = require('node:test');
  const assert = require('node:assert/strict');
  ```
- **Test names follow the form `module: behaviour`**, in lower case, describing the observable behaviour rather than the implementation:
  - `tokenizer: display symbols are normalised to ASCII operators`
  - `parser: power is right associative (2**3**2 = 512)`
  - `calculator: division by zero is reported as EVALUATOR_DIVISION_BY_ZERO`
  - `history: deleting one record removes it from the database`
- **Assertions carry a message when the failure would otherwise be ambiguous**, especially inside a table-driven loop:
  ```js
  assert.equal(body.result, expected, `${expression} should evaluate to ${expected}`);
  ```
- **`assert.equal` on structured data is replaced by `assert.deepEqual`**; a floating point comparison asserts the rounded value the API actually promises (12 significant digits), never the raw double.
- **`assert.ok(x > 0)` is preferred over `assert.equal(x > 0, true)`** unless the stricter form is the point of the test.
- **Error paths are tested with the same care as the happy path**: the exact `error` code, the status, and — where it matters — that the side effect did *not* happen (a rejected calculation must not add a history row).
- **Isolation is mandatory.** No test depends on another test's data or on the developer's database. `test/api.test.js` sets `SQLITE_PATH` to a temporary file, uses `PORT=0` for an ephemeral port, and deletes the directory afterwards. Configuration is set **before** the modules under test are required, because the configuration is read at import time.
- **Integration tests use real components.** Nothing is mocked in `api.test.js`: a real Express server, a real SQLite database and real `fetch` calls over a socket. A mock would hide exactly the wiring this project has to prove.
- Balanced assertions: a test that asserts only `success === true` is incomplete when the result value and the stored record are the real contract.
- **All tests must pass before a commit.** The current state is **65 tests across 5 files, all passing**.
- The suite is run with `npm test` (or `node scripts/runTests.js`); a single file can be run directly with `node test/parser.test.js` while iterating.

## 12. Git commit message convention

- **Subject line in the imperative mood**, no trailing period, at most 72 characters:
  - `Add division-by-zero handling to the evaluator`
  - `Reject scientific notation in the tokenizer with a clearer hint`
  - `Keep result_text so a formatting change cannot rewrite history`
  - `Bind history query parameters instead of concatenating SQL`
  - `Document the environment variables in .env.example`
- Capitalise the subject, and describe **what the change makes true**, not which file was touched (`Fix bug` and `Update files` are rejected).
- **One logical change per commit.** A commit that mixes a feature, a refactor and a formatting pass is split.
- Use the body for the *why* when it is not obvious, wrapped at 72 columns, separated from the subject by one blank line. Reference the error code or the endpoint involved (`POST /api/calculate`, `EVALUATOR_DOMAIN_ERROR`).
- **No secrets, database files or generated folders are committed**: `.env`, `data/*.db`, `node_modules/` and logs are ignored by `.gitignore`.
- Avoid noise-only commits; a whitespace-only reformat is committed alone, or not at all.

## 13. What is not allowed

- `eval`, `exec`, `new Function` or any other text-to-code API — anywhere, including tests and scripts.
- SQL built by concatenating user input; any query without bound `?` parameters.
- A cast or a lookup through a user supplied name (`Math[name]`, `object[input]`, `global[...]`).
- `throw` of a bare string, or of a plain `Error`, for an expected failure.
- An empty `catch` block, or swallowing an error without logging or rethrowing it.
- Returning a stack trace, a SQL fragment or a file path to a client.
- `process.env` outside `src/config/config.js` in application code (the documented `LOG_LEVEL` exception in the logger, and the `process.env` setup block at the top of a test file, aside).
- Duplicated logic across layers: validation in a controller that the service already performs, or SQL outside `src/storage/`.
- An upward `require` (a lower layer importing a higher one) or a `require` cycle.
- `var`, `==`, tabs, a missing semicolon, a line longer than 100 columns, or two statements on one line.
- An unhandled promise, a floating `.then(...)` without a rejection handler, or a `setTimeout`-based race.
- `console.log` in application code instead of the logger.
- `TODO` comments, placeholders, commented-out code, or non-English comments, messages and identifiers.
- A commit that leaves `npm test` failing, or that adds a test which mocks the component it is supposed to verify.
- Committing `.env`, a SQLite file, `node_modules/` or a log file.

## How these rules are checked in this project

Honest description of the current state: the rules above are enforced **by review and by hand**, not by an automated linter.

1. **Manual review before every commit.** The changed files are read once specifically for this list: naming, 100-column limit, JSDoc on every exported function, `ErrorCode` instead of a bare string, no `eval`-family call, no `process.env` outside the configuration module, no floating promise, no silent `catch`, English comments.
2. **`node --check` on every changed file**, which catches a syntax error or a broken edit before the test suite is started:
   ```bash
   node --check src/expression/Parser.js
   node --check server.js
   ```
3. **The test suite is run and must be green** before the commit:
   ```bash
   npm test        # node scripts/runTests.js -> 5/5 test files, 65/65 tests
   ```
4. **A manual start-up check** for changes that touch the transport or the storage layer: `npm start`, then `curl http://127.0.0.1:8080/api/health`, plus one `POST /api/calculate` and one rejected expression, in both `lenient` and `strict` mode if the change concerns the error path.

**Known gap, listed as a future improvement.** No ESLint configuration is committed to this repository yet, so the style rules of this document are not machine-checked. The source already carries the `// eslint-disable-next-line ...` annotations that the intended configuration needs (for `global-require`, `import/no-extraneous-dependencies` and `no-unused-vars` in the error middleware), which is the preparation for it. The planned step is to add an ESLint configuration based on `eslint-config-google` with the Airbnb rules that this document adopts, wire it into an `npm run lint` script, and run it in the same pre-commit check as `node --check`. Until that exists, a reviewer — not a tool — is responsible for applying this standard.
