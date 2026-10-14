/**
 * Calculator panel: expression state, keypad behaviour and result display.
 *
 * The important rule of the assignment is visible in this file: the module never
 * evaluates anything. `submit()` sends the expression to the back end through
 * `CalculatorApi.calculate()` and displays the answer. If the back end is
 * stopped, the only thing that happens is an error message - the page can still
 * be typed into, but it cannot produce a result on its own.
 */
(function exposeCalculator(global) {
  'use strict';

  var ui = global.CalculatorUi;
  var api = global.CalculatorApi;

  /** Runtime state of the calculator panel. */
  var state = {
    /** The expression in the API representation, e.g. "1+2*3". */
    apiExpression: '',
    /** "basic" or "scientific". */
    mode: 'basic',
    /** Value of the previous result, offered to the back end as `ans`. */
    lastResult: null,
    /** True while a request is in flight, used to disable the equals key. */
    busy: false,
    /** Number of parenthesis pairs currently open, used by the "( )" key. */
    openParens: 0,
  };

  /** Elements, resolved once. */
  var nodes = {
    input: ui.element('expressionInput'),
    result: ui.element('resultOutput'),
    message: ui.element('resultMessage'),
    modeBadge: ui.element('modeBadge'),
    historyBadge: ui.element('historyBadge'),
    keypadBasic: ui.element('keypadBasic'),
    keypadScientific: ui.element('keypadScientific'),
  };

  /**
   * Shows the message line under the result.
   * @param {string} text
   * @param {string} [kind] "error", "success", "pending" or "info"
   */
  function setMessage(text, kind) {
    nodes.message.textContent = text || '';
    nodes.message.dataset.kind = kind || 'info';
  }

  /**
   * Shows a result produced by the back end.
   * @param {object} data the parsed response of POST /api/calculate
   */
  function showResult(data) {
    nodes.result.textContent = data.resultText !== undefined ? data.resultText : String(data.result);
    state.lastResult = data.result;
    nodes.historyBadge.textContent = data.historyId ? 'saved as #' + data.historyId : '';
    setMessage(
      'Calculated by the back end in ' + (data.durationMs !== undefined ? data.durationMs : '?') + ' ms',
      'success',
    );
  }

  /**
   * Shows an error returned by the back end.
   * @param {string} code stable error code, e.g. EVALUATOR_DIVISION_BY_ZERO
   * @param {string} message human readable explanation
   */
  function showError(code, message) {
    nodes.result.textContent = 'Error';
    nodes.historyBadge.textContent = '';
    setMessage(code + ' · ' + message, 'error');
  }

  /** Renders the current expression into the input field. */
  function render() {
    nodes.input.value = ui.toDisplayExpression(state.apiExpression);
    nodes.modeBadge.textContent = state.mode === 'scientific' ? 'Scientific' : 'Basic';
  }

  /**
   * Appends text to the expression.
   * @param {string} text API representation fragment
   */
  function insert(text) {
    state.apiExpression += text;
    if (text === '(') {
      state.openParens += 1;
    } else if (text === ')' && state.openParens > 0) {
      state.openParens -= 1;
    }
    render();
    setMessage('', 'info');
  }

  /** Removes the last character of the expression. */
  function backspace() {
    var removed = state.apiExpression.slice(-1);
    // "sin(" is removed as a whole: deleting three characters at once is what a
    // user expects when the last thing typed was a function name.
    var functionMatch = state.apiExpression.match(/(sqrt|sin|cos|tan|log|ln|abs|pow|exp|min|max)\($/);
    if (functionMatch) {
      state.apiExpression = state.apiExpression.slice(0, -functionMatch[0].length);
    } else {
      state.apiExpression = state.apiExpression.slice(0, -1);
    }
    if (removed === '(') {
      state.openParens = Math.max(0, state.openParens - 1);
    }
    if (removed === ')') {
      state.openParens += 1;
    }
    render();
    setMessage('', 'info');
  }

  /** Clears the expression and the result area. */
  function clear() {
    state.apiExpression = '';
    state.openParens = 0;
    nodes.result.textContent = '0';
    nodes.historyBadge.textContent = '';
    render();
    setMessage('', 'info');
  }

  /**
   * Inserts "(" or ")" depending on how many parentheses are currently open.
   */
  function parentheses() {
    insert(state.openParens > 0 ? ')' : '(');
  }

  /**
   * Toggles a leading minus sign, or wraps the last number in parentheses when
   * the expression is longer than a single number (`3*2` -> `3*(-2)`).
   */
  function negate() {
    if (state.apiExpression === '') {
      insert('-');
      return;
    }
    var match = state.apiExpression.match(/(\d+\.?\d*)$/);
    if (match) {
      state.apiExpression = state.apiExpression.slice(0, -match[0].length) + '(-' + match[0] + ')';
    } else {
      state.apiExpression += '-';
    }
    render();
  }

  /**
   * Appends an operator, replacing a trailing operator so that "1+" followed by
   * "×" becomes "1×" instead of an invalid "1+×".
   *
   * @param {string} operator
   */
  function insertOperator(operator) {
    if (/[+\-*/^]$/.test(state.apiExpression)) {
      state.apiExpression = state.apiExpression.slice(0, -1);
    }
    if (state.apiExpression === '' && operator !== '-') {
      return;
    }
    insert(operator);
  }

  /**
   * Sends the expression to the back end and displays the returned result.
   *
   * This is the only place in the front end where a result can appear, which is
   * what "the front end is not allowed to calculate" means in practice.
   *
   * @returns {Promise<object|null>} the response body, or null when it failed
   */
  async function submit() {
    var expression = state.apiExpression.trim();
    if (expression === '' || state.busy) {
      return null;
    }

    state.busy = true;
    setMessage('Sending the expression to the back end…', 'pending');

    var response = await api.calculate(expression, {
      mode: state.mode,
      ans: state.lastResult === null ? undefined : state.lastResult,
    });

    state.busy = false;

    if (response.ok) {
      showResult(response.data);
      if (typeof global.onCalculationStored === 'function') {
        global.onCalculationStored(response.data);
      }
      return response.data;
    }

    showError(response.code, response.message);
    if (typeof global.onBackendUnreachable === 'function' && response.code === 'NETWORK_UNREACHABLE') {
      global.onBackendUnreachable();
    }
    return null;
  }

  /**
   * Handles one keypad press.
   * @param {object} key a key description from the button table
   */
  function handleKey(key) {
    switch (key.action) {
      case 'digit':
      case 'insert':
        insert(key.value);
        break;
      case 'operator':
        insertOperator(key.value);
        break;
      case 'clear':
        clear();
        break;
      case 'backspace':
        backspace();
        break;
      case 'parentheses':
        parentheses();
        break;
      case 'negate':
        negate();
        break;
      case 'equals':
        submit();
        break;
      default:
        break;
    }
  }

  /**
   * Switches between the basic and the scientific evaluation mode.
   * @param {string} mode "basic" or "scientific"
   */
  function setMode(mode) {
    state.mode = mode === 'scientific' ? 'scientific' : 'basic';
    render();
  }

  /** Binds every event of the calculator panel. */
  function init() {
    ui.renderKeypad(nodes.keypadBasic, ui.BASIC_KEYS, handleKey);
    ui.renderKeypad(nodes.keypadScientific, ui.SCIENTIFIC_KEYS, handleKey);

    // Direct typing is allowed; the value is converted to the API representation
    // before it is sent, so `×` typed or clicked behaves identically.
    nodes.input.addEventListener('input', function onInput() {
      state.apiExpression = ui.toApiExpression(nodes.input.value);
      state.openParens = (state.apiExpression.match(/\(/g) || []).length -
        (state.apiExpression.match(/\)/g) || []).length;
    });

    nodes.input.addEventListener('keydown', function onKeyDown(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });

    // Physical keyboard: the same actions as the on-screen keypad.
    document.addEventListener('keydown', function onDocumentKeyDown(event) {
      var target = event.target;
      var typingInField =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
      if (typingInField && target !== nodes.input) {
        return;
      }

      if (event.key === 'Enter' && target !== nodes.input) {
        event.preventDefault();
        submit();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        clear();
        return;
      }
      if (target === nodes.input) {
        // The field is being edited directly; let the browser handle the key.
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        backspace();
        return;
      }
      if (/^[0-9.]$/.test(event.key)) {
        event.preventDefault();
        insert(event.key);
        return;
      }
      if (['+', '-', '*', '/', '%', '^', '(', ')'].indexOf(event.key) !== -1) {
        event.preventDefault();
        insert(event.key);
      }
    });

    render();
  }

  global.CalculatorPanel = {
    init: init,
    submit: submit,
    insert: insert,
    setMode: setMode,
    clear: clear,
    showError: showError,
    getState: function getState() {
      return {
        expression: state.apiExpression,
        mode: state.mode,
        busy: state.busy,
        lastResult: state.lastResult,
      };
    },
    setExpression: function setExpression(expression) {
      state.apiExpression = ui.toApiExpression(expression);
      state.openParens = (state.apiExpression.match(/\(/g) || []).length -
        (state.apiExpression.match(/\)/g) || []).length;
      render();
    },
  };
})(window);
