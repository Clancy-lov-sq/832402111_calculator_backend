/**
 * Demonstration mode.
 *
 * The application can present a scripted state so that the screenshots of the
 * assignment blog are reproducible: the same URL always produces exactly the
 * same interface, instead of depending on the data that happens to be in the
 * database or on the speed of the machine.
 *
 * A state is selected with a URL parameter and is announced in the interface, so
 * a viewer can always tell that a scripted state is being shown:
 *
 *   index.html?demo=addition
 *   index.html?demo=scientific
 *   index.html?demo=offline
 *
 * What is scripted and what is not:
 *   - scripted: the content of the expression field, the result line, the
 *     history rows, the statistics cells and the health answer;
 *   - not scripted: the layout, the styles, the button behaviour and every other
 *     code path of the application, which stay exactly the ones used in normal
 *     operation.
 *
 * `getScriptedResponse(url, method)` is consulted by js/api.js before a real
 * request is sent. When no state is active it returns `null` and the request
 * goes to the back end as usual, so normal operation is unaffected.
 */
(function exposeDemo(global) {
  'use strict';

  /** Timestamp used by every scripted state so the images are stable. */
  var SCRIPTED_TIME = '2026-10-03 09:41:26';

  /**
   * Builds the JSON answer of `POST /api/calculate` for a scripted evaluation.
   * @param {string} expression API representation, e.g. "(1+2)*3"
   * @param {number} result
   * @param {string} operation
   * @param {object} [options]
   */
  function calculation(expression, result, operation, options) {
    var settings = options || {};
    return {
      success: true,
      expression: expression,
      result: result,
      resultText: String(result),
      operation: operation,
      mode: settings.mode || 'basic',
      durationMs: settings.durationMs === undefined ? 0.28 : settings.durationMs,
      historyId: settings.historyId === undefined ? 41 : settings.historyId,
      createdAt: SCRIPTED_TIME,
    };
  }

  /**
   * Builds a `GET /api/history` answer.
   * @param {Array<object>} records newest first
   */
  function history(records) {
    return { success: true, total: records.length, returned: records.length, limit: 6, offset: 0, records: records };
  }

  /**
   * Builds one history row.
   * @param {number} id
   * @param {string} expression
   * @param {string|number} result
   * @param {string} operation
   * @param {string} createdAt
   * @param {string} [mode]
   */
  function record(id, expression, result, operation, createdAt, mode) {
    return {
      id: id,
      expression: expression,
      result: Number(result),
      resultText: String(result),
      operation: operation,
      mode: mode || 'basic',
      createdAt: createdAt,
    };
  }

  /** The nine most recent calculations of the seeded demonstration timeline. */
  var DEMO_HISTORY = [
    record(41, '12+8', 20, 'addition', '2026-10-03 09:41:26'),
    record(40, '84/12', 7, 'division', '2026-10-03 09:39:02'),
    record(39, '(1+2)*3', 9, 'compound', '2026-10-03 09:36:48'),
    record(38, '1+2*3', 7, 'compound', '2026-10-03 09:34:11'),
    record(37, '12.5/2', 6.25, 'division', '2026-10-03 09:31:57'),
    record(36, '6*7', 42, 'multiplication', '2026-10-03 09:28:33'),
    record(35, 'sqrt(144)+2^10/4', 268, 'compound', '2026-10-02 16:12:09', 'scientific'),
    record(34, '20-7', 13, 'subtraction', '2026-10-02 16:05:44'),
  ];

  /**
   * Builds statistics that are consistent with {@link DEMO_HISTORY}: the total
   * is the number of records the scripted history reports, and the operation
   * counts are derived from the same array. A dashboard that disagreed with the
   * list next to it would be a defect on display.
   */
  function statisticsFor(records) {
    var byOperation = {};
    var daily = {};

    records.forEach(function count(entry) {
      byOperation[entry.operation] = (byOperation[entry.operation] || 0) + 1;
      var day = entry.createdAt.slice(0, 10);
      daily[day] = (daily[day] || 0) + 1;
    });

    return {
      success: true,
      total: records.length,
      byOperation: byOperation,
      daily: Object.keys(daily)
        .sort()
        .reverse()
        .map(function toRow(day) {
          return { day: day, count: daily[day] };
        }),
      lastCalculationAt: records.length > 0 ? records[0].createdAt : null,
    };
  }

  /** Statistics matching {@link DEMO_HISTORY}. */
  var DEMO_STATS = statisticsFor(DEMO_HISTORY);

  /** Unit catalog used by the conversion tab while a state is active. */
  var DEMO_UNITS = {
    success: true,
    categories: [
      {
        category: 'temperature',
        name: 'Temperature',
        baseUnit: '°c',
        units: [
          { unit: '°c', name: 'Celsius', symbol: '°C' },
          { unit: '°f', name: 'Fahrenheit', symbol: '°F' },
          { unit: 'k', name: 'Kelvin', symbol: 'K' },
        ],
      },
      {
        category: 'speed',
        name: 'Speed',
        baseUnit: 'km/h',
        units: [
          { unit: 'km/h', name: 'Kilometre per hour', symbol: 'km/h' },
          { unit: 'm/s', name: 'Metre per second', symbol: 'm/s' },
          { unit: 'mph', name: 'Mile per hour', symbol: 'mph' },
        ],
      },
      {
        category: 'length',
        name: 'Length',
        baseUnit: 'm',
        units: [
          { unit: 'km', name: 'Kilometre', symbol: 'km' },
          { unit: 'm', name: 'Metre', symbol: 'm' },
          { unit: 'mi', name: 'Mile', symbol: 'mi' },
        ],
      },
    ],
  };

  /**
   * Builds a simple scripted evaluation state: one expression, one result.
   * @param {string} expression API representation
   * @param {number} result
   * @param {string} operation operation family
   * @param {number} historyId
   */
  function simpleState(expression, result, operation, historyId) {
    return {
      label: 'Demo state: ' + expression + ' = ' + result,
      expression: expression,
      result: String(result),
      message: 'Calculated by the back end in 0.28 ms',
      messageKind: 'success',
      historyId: historyId,
      responses: {
        calculate: calculation(expression, result, operation, { historyId: historyId }),
      },
    };
  }

  /**
   * Scripted states.
   *
   * `setup` runs after the application started and puts the interface into the
   * state the screenshot should show. `responses` overrides the answers of the
   * back end for the calls the page makes while the state is active.
   */
  var STATES = {
    /** The four basic operations and the compound cases of the assignment. */
    addition: simpleState('12+8', 20, 'addition', 42),
    subtraction: simpleState('20-7', 13, 'subtraction', 42),
    multiplication: simpleState('6*7', 42, 'multiplication', 42),
    division: simpleState('84/12', 7, 'division', 42),
    decimal: simpleState('12.5/2', 6.25, 'division', 42),
    precedence: simpleState('1+2*3', 7, 'compound', 42),
    parentheses: simpleState('(1+2)*3', 9, 'compound', 42),
    unary: simpleState('3*-2', -6, 'compound', 42),

    /** The history panel right after the page loaded the records. */
    history: {
      label: 'Demo state: calculation history',
      expression: '',
      result: '0',
      setup: function prepare() {
        var list = document.getElementById('historyList');
        list.scrollTop = 0;
        var first = list.querySelector('.history-item');
        if (first) {
          first.style.outline = '2px solid var(--color-primary)';
          first.style.outlineOffset = '2px';
        }
      },
    },

    /** Error message produced by an invalid expression. */
    'invalid-expression': {
      label: 'Demo state: rejected expression (1+×2)',
      expression: '1+*2',
      result: 'Error',
      message: 'PARSER_MISSING_OPERAND · Operator is missing an operand',
      messageKind: 'error',
      responses: {
        calculate: { success: false, error: 'PARSER_MISSING_OPERAND', message: 'Operator is missing an operand' },
      },
    },

    /** Error message produced by a division by zero. */
    'division-by-zero': {
      label: 'Demo state: division by zero 10÷(3−3)',
      expression: '10/(3-3)',
      result: 'Error',
      message: 'EVALUATOR_DIVISION_BY_ZERO · Division by zero',
      messageKind: 'error',
      responses: {
        calculate: { success: false, error: 'EVALUATOR_DIVISION_BY_ZERO', message: 'Division by zero' },
      },
    },

    /** Scientific mode with a compound expression. */
    scientific: {
      label: 'Demo state: scientific expression',
      tab: 'scientific',
      expression: 'sqrt(144)+2^10/4',
      result: '268',
      message: 'Calculated by the back end in 0.31 ms',
      messageKind: 'success',
      historyId: 42,
      responses: { calculate: calculation('sqrt(144)+2**10/4', 268, 'compound', { mode: 'scientific', historyId: 42, durationMs: 0.31 }) },
    },

    /** Number base conversion tab with the result of 255. */
    'base-conversion': {
      label: 'Demo state: number base conversion',
      tab: 'convert',
      setup: function prepare() {
        var rows = [
          { label: 'Binary (2)', value: '11111111' },
          { label: 'Octal (8)', value: '377' },
          { label: 'Decimal (10)', value: '255' },
          { label: 'Hexadecimal (16)', value: 'ff' },
          { label: 'Base 36', value: '73' },
        ];
        var container = document.getElementById('baseResults');
        var ui = global.CalculatorUi;
        container.textContent = '';
        rows.forEach(function append(row) {
          container.appendChild(
            ui.create('li', {}, [
              ui.create('span', { className: 'result-label', text: row.label }),
              ui.create('span', { className: 'result-value', text: row.value }),
            ]),
          );
        });
        document.getElementById('baseValue').value = '255';
      },
      responses: {
        convertBase: {
          success: true,
          value: 255,
          decimal: '255',
          conversions: [
            { base: 2, result: '11111111' },
            { base: 8, result: '377' },
            { base: 10, result: '255' },
            { base: 16, result: 'ff' },
            { base: 36, result: '83' },
          ],
          result: '11111111',
        },
        units: DEMO_UNITS,
      },
    },

    /** Unit conversion tab with a temperature conversion. */
    'unit-conversion': {
      label: 'Demo state: unit conversion',
      tab: 'convert',
      setup: function prepare() {
        global.CalculatorConverter.selectUnits('temperature', '°c', '°f');
        document.getElementById('unitValue').value = '100';
        // The value shown is the answer the scripted back end returns for this
        // pair; the conversion itself is requested by the converter module.
        document.getElementById('unitResult').textContent = '100 °C  =  212 °F';
      },
      // The units can only be selected once the catalog has arrived from the
      // back end, so the state is applied again at that moment.
      setupWhenReady: function catalogLoaded() {
        return global.CalculatorConverter.isCatalogLoaded();
      },
      responses: {
        units: DEMO_UNITS,
        convertUnit: {
          success: true,
          value: 100,
          category: 'temperature',
          from: { unit: '°c', name: 'Celsius', symbol: '°C' },
          to: { unit: '°f', name: 'Fahrenheit', symbol: '°F' },
          result: 212,
          resultText: '212',
        },
      },
    },

    /** Dashboard with the statistics of the scripted history. */
    statistics: {
      label: 'Demo state: statistics dashboard',
      setup: function prepare() {
        var panel = document.getElementById('statsPanel');
        panel.scrollIntoView({ block: 'center' });
        panel.style.outline = '2px solid var(--color-primary)';
        panel.style.outlineOffset = '6px';
        panel.style.borderRadius = '8px';
      },
      responses: { stats: DEMO_STATS },
    },

    /** Empty history list, right after "clear all". */
    'history-cleared': {
      label: 'Demo state: history cleared',
      expression: '',
      result: '0',
      responses: {
        history: { success: true, total: 0, returned: 0, limit: 6, offset: 0, records: [] },
        stats: { success: true, total: 0, byOperation: {}, daily: [], lastCalculationAt: null },
        clearHistory: { success: true, deleted: 41, remaining: 0 },
      },
    },

    /** Back end stopped: the interface still works but cannot calculate. */
    offline: {
      label: 'Demo state: back end unreachable',
      expression: '123+456',
      result: 'Error',
      message:
        'NETWORK_UNREACHABLE · Cannot reach the back end. Start it with "npm start" in the back-end repository.',
      messageKind: 'error',
      offline: true,
      responses: {
        health: { success: false, error: 'NETWORK_UNREACHABLE', message: 'Cannot reach the back end' },
        history: { success: false, error: 'NETWORK_UNREACHABLE', message: 'Cannot reach the back end' },
        stats: { success: false, error: 'NETWORK_UNREACHABLE', message: 'Cannot reach the back end' },
        calculate: { success: false, error: 'NETWORK_UNREACHABLE', message: 'Cannot reach the back end (http://127.0.0.1:8080)' },
      },
      setup: function prepare() {
        // The indicator is pinned offline and the periodic check is stopped, so
        // the frame really shows the state of a stopped back end.
        global.pinBackendOffline('Back end unreachable · calculating is disabled');
      },
    },

    /** Dark theme with a stored expression and result. */
    dark: {
      label: 'Demo state: dark theme',
      expression: '(2+3)*(7-4)',
      result: '15',
      message: 'Calculated by the back end in 0.26 ms',
      messageKind: 'success',
      historyId: 43,
      dark: true,
      responses: {
        calculate: calculation('(2+3)*(7-4)', 15, 'compound', { historyId: 43, durationMs: 0.26 }),
      },
    },
  };

  /** The active state, or null during normal operation. */
  var activeState = null;
  var activeName = null;

  /**
   * Reads the `demo` parameter of the current URL.
   * @returns {string|null}
   */
  function readName() {
    try {
      return new URLSearchParams(global.location.search).get('demo');
    } catch (error) {
      return null;
    }
  }

  /**
   * @param {string} path request path, e.g. "/calculate" or "/history/41"
   * @param {string} method HTTP method
   * @returns {object|null} a scripted answer, or null to let the request through
   */
  function getScriptedResponse(path, method) {
    if (activeState === null) {
      return null;
    }
    var responses = activeState.responses || {};

    if (path.indexOf('/calculate') === 0) {
      return responses.calculate || null;
    }
    if (path.indexOf('/convert/base') === 0) {
      return responses.convertBase || null;
    }
    if (path.indexOf('/convert/unit') === 0) {
      return responses.convertUnit || null;
    }
    if (path.indexOf('/convert/units') === 0) {
      return responses.units || null;
    }
    if (path.indexOf('/stats') === 0) {
      return responses.stats || null;
    }
    if (path.indexOf('/health') === 0) {
      return responses.health || {
        success: true,
        service: 'calculator-backend',
        status: 'ok',
        database: { client: 'sqlite', status: 'connected', storedRecords: DEMO_HISTORY.length },
      };
    }
    if (path.indexOf('/history') === 0) {
      if (method === 'DELETE') {
        return responses.clearHistory || { success: true, deletedId: 41, remaining: 40 };
      }
      return responses.history || history(DEMO_HISTORY);
    }
    return null;
  }

  /**
   * Applies the scripted state to the interface.
   * @param {object} state
   * @param {string} name
   */
  function apply(state, name) {
    activeState = state;
    activeName = name;

    // The theme is applied before the banner so the banner uses the right colours.
    if (state.dark) {
      var toggle = document.getElementById('themeToggle');
      if (toggle) {
        toggle.click();
      }
    }

    var banner = document.createElement('div');
    banner.className = 'demo-banner';
    banner.textContent = (state.label || 'Demo state') + ' — the values shown are part of a scripted demonstration';
    document.body.appendChild(banner);

    if (state.tab) {
      var tab = document.querySelector('.tab[data-tab="' + state.tab + '"]');
      if (tab) {
        tab.click();
      }
    }

    if (state.expression !== undefined) {
      document.getElementById('expressionInput').value = global.CalculatorUi.toDisplayExpression(state.expression);
      global.CalculatorPanel.setExpression(state.expression);
    }
    if (state.result !== undefined) {
      document.getElementById('resultOutput').textContent = state.result;
    }
    if (state.message !== undefined) {
      var message = document.getElementById('resultMessage');
      message.textContent = state.message;
      message.dataset.kind = state.messageKind || 'info';
    }
    document.getElementById('historyBadge').textContent = state.historyId ? 'saved as #' + state.historyId : '';

    if (typeof state.setup === 'function') {
      state.setup();
    }
  }

  /**
   * Runs a callback as soon as a condition is true.
   *
   * Used for the states that depend on data which arrives from the back end after
   * the first paint — the unit catalog in particular. Without this the units
   * could be selected before the catalog existed, and the interface would show
   * the default category next to a conversion of another one.
   *
   * @param {Function} condition evaluated in the page
   * @param {Function} callback  run when the condition first returns true
   * @param {number} [timeoutMs]
   */
  function whenReady(condition, callback, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 8000);
    (function poll() {
      var ready = false;
      try {
        ready = condition() === true;
      } catch (error) {
        ready = false;
      }
      if (ready) {
        callback();
        return;
      }
      if (Date.now() > deadline) {
        return; // give up quietly: the interface keeps its default state
      }
      setTimeout(poll, 50);
    })();
  }

  /** Activates the state named in the URL, if any. */
  function start() {
    var name = readName();
    if (!name || !STATES[name]) {
      return false;
    }
    var state = STATES[name];

    // The history and the statistics are rendered from the scripted answers, so
    // the panels are reloaded once the state is in place.
    apply(state, name);
    if (global.CalculatorHistory) {
      global.CalculatorHistory.load({ offset: 0 });
    }
    if (global.refreshConnectionStatus) {
      // Resolves the connection indicator before the frame is captured, so a
      // screenshot never shows the temporary "Connecting…" text.
      global.refreshConnectionStatus();
    }

    // States that need back-end data apply themselves a second time once that
    // data has arrived.
    if (typeof state.setupWhenReady === 'function') {
      whenReady(state.setupWhenReady, function reapply() {
        state.setup();
      });
    }
    return true;
  }

  global.CalculatorDemo = {
    STATES: STATES,
    NAME: activeName,
    start: start,
    isActive: function isActive() {
      return activeState !== null;
    },
    getScriptedResponse: getScriptedResponse,
    setResult: function setResult(result, message, kind, historyId) {
      document.getElementById('resultOutput').textContent = result;
      var node = document.getElementById('resultMessage');
      node.textContent = message;
      node.dataset.kind = kind;
      document.getElementById('historyBadge').textContent = historyId ? 'saved as #' + historyId : '';
    },
  };
})(window);
