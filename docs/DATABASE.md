# Database Design — `832402111_calculator_backend`

Student ID: **832402111** — Software Engineering assignment, front-end/back-end separated calculator.

This document describes the database of the back end: the single table, its columns, the
reasons behind each design decision, the SQL statements that are actually executed, the
schema/seeding workflow, the optional MySQL variant, and how to inspect the data.

---

## Table of contents

1. [Purpose of the table](#1-purpose-of-the-table)
2. [Schema statements](#2-schema-statements)
3. [Field reference](#3-field-reference)
4. [Design decisions](#4-design-decisions)
5. [Query patterns](#5-query-patterns)
6. [Schema creation and seeding workflow](#6-schema-creation-and-seeding-workflow)
7. [Switching to MySQL](#7-switching-to-mysql)
8. [Parameter binding and SQL injection](#8-parameter-binding-and-sql-injection)
9. [Extension: per-user history](#9-extension-per-user-history)
10. [Inspecting the database](#10-inspecting-the-database)

---

## 1. Purpose of the table

`calculation_history` is the persistence of the assignment's third required function:
the front end must be able to retrieve the calculation history, and the user must be able
to delete a single entry.

One successful calculation becomes exactly one row:

* `POST /api/calculate` writes one row — and only after the evaluation succeeded, so a
  refused expression never appears in the history;
* `GET /api/history` reads rows (paged / filtered / all);
* `DELETE /api/history/{id}` removes one row;
* `DELETE /api/history` removes every row and resets the id sequence;
* `GET /api/stats` aggregates the rows.

Every other behaviour of the back end — parsing, evaluation, unit and base conversion —
is pure computation and stores nothing. That is why the whole database is one table.

**Default engine.** SQLite through the built-in `node:sqlite` module, in the file
`data/calculator.db` (configurable with `SQLITE_PATH`). The file is created automatically
on the first start-up, including its parent directory. No database server is installed and
no database driver is a declared dependency, so the default install has zero database
dependencies. MySQL is supported as an option, not as a requirement.

---

## 2. Schema statements

### 2.1 SQLite (default)

Table:

```sql
CREATE TABLE IF NOT EXISTS calculation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expression TEXT NOT NULL,
  result REAL NOT NULL,
  result_text TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'compound',
  mode TEXT NOT NULL DEFAULT 'basic',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime'))
)
```

Both indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_calculation_history_created_at
  ON calculation_history (created_at DESC, id DESC)
```

```sql
CREATE INDEX IF NOT EXISTS idx_calculation_history_operation
  ON calculation_history (operation)
```

These three statements are executed on **every** start-up, in this order, by
`initializeSchema()` in `src/storage/database.js`, from the definitions in
`src/storage/schema.js`. `IF NOT EXISTS` makes them idempotent: an existing database is
opened and reused, never modified destructively, and a first-time run needs no manual SQL.

### 2.2 MySQL variant

One statement creates the table and both indexes (MySQL has no separate `CREATE INDEX …
IF NOT EXISTS` for this purpose):

```sql
CREATE TABLE IF NOT EXISTS calculation_history (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  expression VARCHAR(512) NOT NULL,
  result DOUBLE NOT NULL,
  result_text VARCHAR(64) NOT NULL,
  operation VARCHAR(32) NOT NULL DEFAULT 'compound',
  mode VARCHAR(16) NOT NULL DEFAULT 'basic',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_calculation_history_created_at (created_at DESC, id DESC),
  KEY idx_calculation_history_operation (operation)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
```

`utf8mb4` is required, not cosmetic: the unit converter and expressions can contain
multi-byte characters such as `°C`, `斤` and `亩`, and `utf8mb4_unicode_ci` gives them a
consistent comparison. InnoDB is used for row-level locking and crash recovery.

---

## 3. Field reference

| Column | SQLite type | MySQL type | Nullable | Default | Meaning | Written by |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | `INT UNSIGNED NOT NULL AUTO_INCREMENT` | no | auto-increment | Stable identifier of the record; the value used by `DELETE /api/history/{id}` and returned as `historyId` / `records[].id`. | The database engine |
| `expression` | `TEXT` | `VARCHAR(512)` | no | none | The **normalised** expression that was evaluated (`12×8` is stored as `12*8`, `2²` as `2**2`), so the stored text matches what the response echoed. Bound from `outcome.normalizedExpression`. | `calculationService.calculateAndStore` → `historyRepository.insert` |
| `result` | `REAL` | `DOUBLE` | no | none | The numeric result after rounding to 12 significant digits — machine-readable, for statistics and reuse. | Same insert |
| `result_text` | `TEXT` | `VARCHAR(64)` | no | none | The exact display string the user saw (`"20"`, `"0.666666666667"`). | Same insert |
| `operation` | `TEXT` | `VARCHAR(32)` | no | `'compound'` | Operation family of the expression: `addition`, `subtraction`, `multiplication`, `division`, `modulo`, `power`, `compound`, `scientific`, `number`. Derived by `describeKind()` from the operators and functions actually used. | Same insert |
| `mode` | `TEXT` | `VARCHAR(16)` | no | `'basic'` | The mode the expression was evaluated in: `basic` or `scientific`. | Same insert |
| `created_at` | `TEXT` | `DATETIME` | no | `strftime('%Y-%m-%d %H:%M:%S','now','localtime')` / `CURRENT_TIMESTAMP` | Timestamp of the calculation, `YYYY-MM-DD HH:MM:SS`, produced by the database. | The database engine, unless the seed script supplies an explicit value |

The API never exposes the snake_case column names: `mapRow()` in
`src/storage/historyRepository.js` converts a row to
`{id, expression, result, resultText, operation, mode, createdAt}` in one place.

---

## 4. Design decisions

### 4.1 The timestamp is generated by the database, not by the client

`created_at` has a database-side default and the `INSERT` passes
`COALESCE(?, strftime('%Y-%m-%d %H:%M:%S','now','localtime'))` (SQLite) or
`COALESCE(?, CURRENT_TIMESTAMP)` (MySQL). In the normal request path the repository binds
`null` for that parameter, so the value always comes from the database clock.

Why: a client with a wrong or deliberately manipulated clock cannot place its record at an
arbitrary position in the history, and two clients on different machines still produce a
consistent, comparable timeline. It also removes a whole class of validation (parsing and
checking a client-supplied date) from the API.

### 4.2 The `createdAt` parameter exists only for the seed script

`historyRepository.insert()` accepts an optional `createdAt` and binds it as the first
argument of the `COALESCE`. This is *not* part of the HTTP contract — neither
`POST /api/calculate` nor any other endpoint reads a timestamp from the request body.
`scripts/seed.js` is the only caller that uses it, so the demonstration data spans a
realistic two-day timeline instead of all being created in the same second.

The safety property is preserved because the fallback is still the database clock: passing
`undefined` or `null` (which is what the service does) cannot produce a missing or
client-chosen timestamp.

### 4.3 `result` and `result_text` are both stored, on purpose

They look redundant and are not:

* `result` keeps the **numeric semantics**. It is the value statistics aggregate over and
  the value a future "reuse this result" feature would load. A string cannot be summed or
  compared numerically without re-parsing.
* `result_text` preserves **exactly what was displayed**. If the rounding rule changes
  from 12 significant digits to something else, rows written earlier keep showing the value
  the user actually saw at the time. History stays a record of the past instead of being
  retroactively rewritten by a formatting change.
* It also settles the question "who owns the display format" — the back end does. The front
  end renders `resultText` verbatim instead of re-implementing rounding, so the panel and
  the calculator cannot disagree.

### 4.4 The `operation` column turns statistics into a `GROUP BY`

The operation family is computed once, at write time, from the operators and functions the
expression really used (`describeKind()`), and stored in its own column.

Why: `GET /api/stats` needs the distribution of calculations over operation families. With
the family stored, that is a single `SELECT operation, COUNT(*) … GROUP BY operation`. The
alternative — deriving the family at read time — would mean loading every stored
expression, re-tokenising and re-parsing it on each statistics request, and it would
re-derive a value that could change if the classification rules ever changed. Storing it
makes the statistic a plain aggregate over a small indexed column and keeps the recorded
classification as historical fact.

The same column makes the `operation` filter of `GET /api/history` an indexed equality
match, and it is validated against the known families so an unknown value is refused with
`VALIDATION_INVALID_PARAMETER` instead of silently returning nothing.

### 4.5 Two indexes, matched to the two real query shapes

| Index | Definition | Query shape it serves | Why it is needed |
| --- | --- | --- | --- |
| `idx_calculation_history_created_at` | `(created_at DESC, id DESC)` | the newest-first listing (`ORDER BY id DESC LIMIT ? OFFSET ?`) and the daily series (`GROUP BY substr(created_at, 1, 10)` / `DATE_FORMAT(created_at, '%Y-%m-%d')`) | The listing is the most frequent read of the whole application, and it is a pure ordered scan; the descending index lets the engine read the first page directly instead of sorting the table. |
| `idx_calculation_history_operation` | `(operation)` | `GROUP BY operation` in `GET /api/stats`, and `WHERE operation = ?` in `GET /api/history` | Statistics must stay cheap as the table grows, and the operation filter must not degrade into a full scan. |

No other index is declared. The project executes exactly these query shapes, and every
additional index would slow down inserts (the most frequent write) and add schema noise
without serving a real query. Note also that the primary key already indexes `id`, which is
what the `ORDER BY id DESC` of the paged listing and the `DELETE … WHERE id = ?` use.

### 4.6 `AUTOINCREMENT` for a stable delete identifier

`id INTEGER PRIMARY KEY AUTOINCREMENT` (SQLite) / `AUTO_INCREMENT` (MySQL) gives every
record an identifier that:

* is unique for the lifetime of the table, so `DELETE /api/history/{id}` from the front end
  can never address the wrong row;
* is returned to the client as `historyId`, so the freshly created record can be deleted
  or highlighted without re-querying;
* makes the newest-first ordering (`ORDER BY id DESC`) equivalent to
  `ORDER BY created_at DESC` while being cheaper and unambiguous when two records share a
  timestamp.

`DELETE /api/history` clears the table **and** resets the sequence (`DELETE FROM
sqlite_sequence WHERE name = ?` for SQLite, `ALTER TABLE … AUTO_INCREMENT = 1` for MySQL),
so a cleared database starts again at `id = 1` instead of continuing from the previous
high-water mark. The integration test asserts exactly that.

---

## 5. Query patterns

Every statement lives in `src/storage/schema.js` (the `STATEMENTS` table, per driver) and is
executed by `src/storage/historyRepository.js`. Values are always `?` parameters.

| Purpose | Repository method | Endpoint |
| --- | --- | --- |
| insert one record | `insert()` | `POST /api/calculate` |
| read one record by id | `findById()` | internal, right after the insert |
| page, newest first, with optional filters | `findPage()` | `GET /api/history` |
| read every matching record | `findAll()` | `GET /api/history?page=all`, seed script |
| count all rows | `count()` | `GET /api/health`, after a delete, statistics |
| delete one record with an affected-row check | `deleteById()` | `DELETE /api/history/{id}` |
| delete everything and reset the sequence | `deleteAll()` | `DELETE /api/history` |
| aggregate by operation family | `statistics()` | `GET /api/stats` |
| aggregate per day | `statistics()` | `GET /api/stats` |

### 5.1 Insert (SQLite)

```sql
INSERT INTO calculation_history (expression, result, result_text, operation, mode, created_at)
VALUES (?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')))
```

Six bound parameters. The sixth is `null` in the normal request path, so `COALESCE` falls
through to the database clock. The repository then reads the row back with
`SELECT * FROM calculation_history WHERE id = ?` using `lastInsertRowid`, which is what
lets the response contain the real `createdAt` for the `201` reply.

### 5.2 Page (SQLite)

Conditions are composed only from **static** fragments; every value is bound:

```sql
SELECT id, expression, result, result_text, operation, mode, created_at
FROM calculation_history
WHERE expression LIKE ? AND operation = ?
ORDER BY id DESC LIMIT ? OFFSET ?
```

with the parameters `['%<escaped keyword>%', '<operation>', limit, offset]`. The matching
total comes from a second statement with the same `WHERE` clause and the same value
parameters (without `limit`/`offset`):

```sql
SELECT COUNT(*) AS total FROM calculation_history WHERE expression LIKE ? AND operation = ?
```

Both the page size and the offset are normalised in the repository before binding:
`limit` falls back to 10 and is clamped to 100 (`config.database.maxPageSize`), `offset`
falls back to 0. In the SQLite driver every statement is prepared once and cached, so a
repeated page request reuses the compiled statement.

### 5.3 Search with escaped LIKE wildcards

The keyword is escaped before it is bound:

```js
String(value).replace(/[\\%_]/g, (match) => `\\${match}`)
```

so a search for `%` matches a literal percent sign instead of "any sequence", and `_`
matches an underscore instead of "any single character". `\` itself is escaped first.
Without this step a user keyword would silently change the semantics of the query; with it,
the keyword always means exactly what the user typed.

### 5.4 Delete with an affected-row check

```sql
DELETE FROM calculation_history WHERE id = ?
```

The driver returns `changes` (SQLite) / `affectedRows` (MySQL); the repository converts it
into a boolean and the service turns `false` into
`404 HISTORY_NOT_FOUND`. This is what makes "delete a record that does not exist" an honest
`404` instead of a silent success — the check is on the row count, not on a prior `SELECT`,
so it cannot race with a concurrent deletion.

### 5.5 Clear all, plus sequence reset

```sql
DELETE FROM calculation_history
```

```sql
DELETE FROM sqlite_sequence WHERE name = ?
```

The repository counts the rows *before* deleting (the `DELETE` itself only reports affected
rows, and the count is what the API returns as `deleted`), then removes the sequence entry
so the next insert starts at `id = 1` again. In the MySQL variant the second statement is
`ALTER TABLE calculation_history AUTO_INCREMENT = 1`, because MySQL has no
`sqlite_sequence` table.

### 5.6 Aggregation by operation family

```sql
SELECT operation, COUNT(*) AS count
FROM calculation_history
GROUP BY operation
ORDER BY count DESC, operation ASC
```

An index-only aggregate on `idx_calculation_history_operation`. The repository folds the
rows into the `byOperation` object of the response, so families that never occurred are
absent rather than present with a zero.

### 5.7 Aggregation per day

```sql
SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
FROM calculation_history
GROUP BY day
ORDER BY day DESC
LIMIT ?
```

The `LIMIT ?` is the `days` parameter of `GET /api/stats` (default 7, clamped to at most
30), so the daily series is "the last N days that have records", newest first. The same
shape in MySQL uses `DATE_FORMAT(created_at, '%Y-%m-%d') AS day`.

The newest record is read with `SELECT created_at FROM calculation_history ORDER BY id DESC
LIMIT 1` for the `lastCalculationAt` field.

---

## 6. Schema creation and seeding workflow

### 6.1 Automatic creation

Nothing has to be run before the first start. `server.js` calls `connect()` →
`initializeSchema()`, which executes the three `IF NOT EXISTS` statements; the parent
directory of `SQLITE_PATH` is created with `fs.mkdirSync(..., { recursive: true })` when it
is missing. Run the service and the database exists:

```
npm start
```

### 6.2 `npm run db:init`

```
npm run db:init          →  node scripts/seed.js
```

Opens (and if necessary creates and migrates) the schema through exactly the same code path
as the server, then inserts the seed rows that are not present yet. Existing data is kept:
a row is considered already present when its `expression` and `createdAt` pair is already
in the table, so running the command twice does not duplicate anything. If the table is not
empty, a warning is logged.

### 6.3 `npm run db:reset`

```
npm run db:reset         →  node scripts/seed.js --reset
```

Deletes every row, resets the auto-increment sequence, then inserts the full set of seed
rows — a deterministic starting state for screenshots, demonstrations and a fresh grading
run.

### 6.4 What the 16 seed rows are

`scripts/seed.js` holds 16 rows. Every row is a calculation the back end really produced:
the expression is fed through the same `calculate()` pipeline and stored with the resulting
`result`, `resultText`, `operation` and `mode`, so the seed data cannot contain a value the
calculator would not compute. Only the timestamp is supplied explicitly, which is why the
timeline is stable and believable.

| # | Expression | Mode | Timestamp (`createdAt`) |
| --- | --- | --- | --- |
| 1 | `12+8` | basic | 2026-10-01 09:14:02 |
| 2 | `20-7` | basic | 2026-10-01 09:16:41 |
| 3 | `6*7` | basic | 2026-10-01 09:21:15 |
| 4 | `84/12` | basic | 2026-10-01 10:02:38 |
| 5 | `12.5/2` | basic | 2026-10-01 10:07:55 |
| 6 | `1+2*3` | basic | 2026-10-01 10:20:00 |
| 7 | `(1+2)*3` | basic | 2026-10-01 10:21:07 |
| 8 | `-5+8` | basic | 2026-10-01 10:22:44 |
| 9 | `3*-2` | basic | 2026-10-01 11:03:19 |
| 10 | `8-3*2` | basic | 2026-10-01 11:05:52 |
| 11 | `sqrt(144)` | scientific | 2026-10-02 08:41:26 |
| 12 | `2**10` | basic | 2026-10-02 08:45:03 |
| 13 | `sin(30)+cos(60)` | scientific | 2026-10-02 09:12:47 |
| 14 | `100/(4*5)` | basic | 2026-10-02 09:30:11 |
| 15 | `3.14159*2.5` | basic | 2026-10-02 10:05:36 |
| 16 | `(2+3)*(7-4)` | basic | 2026-10-02 10:18:22 |

The timestamps span **2026-10-01 .. 2026-10-02**, which gives `GET /api/stats` two days of
`daily` data and makes the newest-first ordering of `GET /api/history` visible.

---

## 7. Switching to MySQL

MySQL is optional and intentionally **not** a declared dependency: the default `npm
install` therefore pulls in no database driver at all. Three steps switch the storage:

**Step 1 — install the optional driver.**

```
npm install mysql2
```

**Step 2 — select the client.**

```
DB_CLIENT=mysql
```

On Windows PowerShell:

```
$env:DB_CLIENT="mysql"
```

**Step 3 — point it at the server.** All settings have defaults, so only the ones that
differ have to be set:

| Variable | Default | Meaning |
| --- | --- | --- |
| `MYSQL_HOST` | `127.0.0.1` | Server host |
| `MYSQL_PORT` | `3306` | Server port |
| `MYSQL_USER` | `root` | User |
| `MYSQL_PASSWORD` | *(empty)* | Password |
| `MYSQL_DATABASE` | `calculator` | Schema name; the database itself must exist beforehand |

The connection is a pool (`connectionLimit: 10`, `charset: 'utf8mb4'`), and the schema is
created on start-up exactly as for SQLite, from the MySQL DDL shown above.

If `DB_CLIENT=mysql` is set without `mysql2` installed, the service fails with
`STORAGE_FAILURE` and the detail
`DB_CLIENT=mysql requires the optional dependency mysql2. Install it with "npm install mysql2".`
— a clear message instead of a module-resolution stack trace.

**Statement differences, and nothing else.** Only three statements differ between the two
drivers; the application code above the repository is identical.

| Concern | SQLite | MySQL |
| --- | --- | --- |
| Auto-increment key | `INTEGER PRIMARY KEY AUTOINCREMENT` | `INT UNSIGNED NOT NULL AUTO_INCREMENT` + `PRIMARY KEY (id)` |
| Text columns | `TEXT` (unlimited) | `VARCHAR(512)` / `VARCHAR(64)` / `VARCHAR(32)` / `VARCHAR(16)` |
| Floating point | `REAL` | `DOUBLE` |
| Timestamp type and default | `TEXT` + `strftime('%Y-%m-%d %H:%M:%S','now','localtime')` | `DATETIME` + `CURRENT_TIMESTAMP` |
| Insert default | `COALESCE(?, strftime(...))` | `COALESCE(?, CURRENT_TIMESTAMP)` |
| Sequence reset | `DELETE FROM sqlite_sequence WHERE name = ?` | `ALTER TABLE calculation_history AUTO_INCREMENT = 1` |
| Daily grouping | `substr(created_at, 1, 10)` | `DATE_FORMAT(created_at, '%Y-%m-%d')` |
| Table options | — | `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` |

The SQLite driver is synchronous (`node:sqlite`), so it is wrapped in a promise-based facade
with prepared statements cached per SQL string; the MySQL driver is adapted to the same
`all` / `get` / `run` / `close` interface. The repository therefore never knows which
engine it is talking to.

---

## 8. Parameter binding and SQL injection

Every user-supplied value reaches the database as a bound `?` parameter:

```js
await this.driver.run(this.statements.insert, [
  record.expression,
  record.result,
  record.resultText,
  operation,
  mode,
  record.createdAt || null,
]);
```

No statement is ever assembled by concatenating a value. The only string composition in the
repository builds *static* SQL fragments — the `WHERE … AND …` clause from a fixed list of
conditions and the constant `ORDER BY id DESC LIMIT ? OFFSET ?` — while the corresponding
values (`['%keyword%', operation, limit, offset]`) are bound.

Consequences:

* A malicious expression or keyword such as `'); DROP TABLE calculation_history; --` is
  stored, matched and returned as plain text. It cannot terminate the statement, because it
  is never part of the SQL text.
* A keyword containing `%` or `_` cannot change the shape of the `LIKE` pattern, because
  the wildcards are escaped *before* binding (see [5.3](#53-search-with-escaped-like-wildcards)).
* Column and table names come from `src/storage/schema.js` constants, never from a request,
  so no part of a statement is client-controlled.

---

## 9. Extension: per-user history

Today the history is one shared list: there is no user, session or account, so every client
sees and can delete every record.

Per-user history would be added as **one nullable column plus one index**, not as a second
table:

```sql
ALTER TABLE calculation_history ADD COLUMN user_id INTEGER NULL;
CREATE INDEX idx_calculation_history_user_id ON calculation_history (user_id);
```

* The write path binds the id of the authenticated caller; unauthenticated calculations
  would store `NULL` and keep behaving exactly as today.
* Every read path gains one more condition in the same static `WHERE` composition
  (`AND user_id = ?`), so the paged listing, the search, the statistics and the two delete
  statements would each need the caller's id as one extra bound parameter.
* The two existing indexes stay useful: `(created_at DESC, id DESC)` and `(operation)` are
  still the shapes the queries use, with `user_id` as an additional equality predicate.
* Nothing else changes: the column is still written by the same repository, the response
  shape stays the same, and the front end needs no change beyond sending its credentials.

That this is an additive change — one column, one index, one bound parameter per query — is
the payoff of keeping the history in a single table with the operation family materialised.

---

## 10. Inspecting the database

### 10.1 SQLite (default client)

With the `sqlite3` command-line tool, from the repository root:

```
sqlite3 data/calculator.db ".schema calculation_history"
```

```
sqlite3 data/calculator.db "SELECT id, expression, result_text, operation, mode, created_at FROM calculation_history ORDER BY id DESC LIMIT 5;"
```

Or the equivalent using Node.js, which is always available because the project already
requires a modern Node version:

```
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('data/calculator.db');console.log(db.prepare('SELECT COUNT(*) AS total FROM calculation_history').get());db.close();"
```

Useful checks:

```sql
-- how many records are stored
SELECT COUNT(*) AS total FROM calculation_history;
```

```sql
-- the distribution that GET /api/stats reports
SELECT operation, COUNT(*) AS count FROM calculation_history GROUP BY operation ORDER BY count DESC;
```

```sql
-- confirm that the two indexes exist
SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'calculation_history';
```

```sql
-- confirm that the sequence was reset by DELETE /api/history
SELECT * FROM sqlite_sequence WHERE name = 'calculation_history';
```

The same database can be inspected with any SQLite GUI (DB Browser for SQLite, for
example) by opening `data/calculator.db`.

### 10.2 MySQL (optional client)

The equivalent reads:

```sql
SELECT id, expression, result_text, operation, mode, created_at
FROM calculation_history
ORDER BY id DESC
LIMIT 5;
```

```sql
SELECT COUNT(*) AS total FROM calculation_history;
```

```sql
SELECT operation, COUNT(*) AS count
FROM calculation_history
GROUP BY operation
ORDER BY count DESC;
```

```sql
SHOW INDEX FROM calculation_history;
```

A quick health check of both drivers is `GET /api/health`, which reports
`database.client`, `database.status` and `database.storedRecords` without touching a SQL
prompt.
