/**
 * DOM helpers and presentation rules.
 *
 * Everything that knows about HTML lives here: element lookup, button tables,
 * formatting of expressions, toast messages and the connection indicator. The
 * calculation modules stay free of DOM code, which keeps them testable and easy
 * to read.
 */
(function exposeUi(global) {
  'use strict';

  /**
   * @param {string} id
   * @returns {HTMLElement}
   */
  function element(id) {
    return document.getElementById(id);
  }

  /**
   * Creates one element with attributes and children.
   *
   * `textContent` is used for every piece of dynamic text, so a value coming from
   * the database (an expression, a result) can never be interpreted as HTML.
   *
   * @param {string} tag
   * @param {object} [properties]
   * @param {Array<Node|string>} [children]
   * @returns {HTMLElement}
   */
  function create(tag, properties, children) {
    var node = document.createElement(tag);
    Object.keys(properties || {}).forEach(function apply(key) {
      var value = properties[key];
      if (key === 'className') {
        node.className = value;
      } else if (key === 'text') {
        node.textContent = value;
      } else if (key === 'dataset') {
        Object.keys(value).forEach(function applyData(dataKey) {
          node.dataset[dataKey] = value[dataKey];
        });
      } else if (value !== null && value !== undefined) {
        node.setAttribute(key, value);
      }
    });
    (children || []).forEach(function append(child) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  /** Replaces every child of a container. */
  function replaceChildren(container, children) {
    container.textContent = '';
    (children || []).forEach(function append(child) {
      container.appendChild(child);
    });
  }

  /**
   * Turns an API expression into what a calculator user expects to read.
   * The API keeps `*` and `/`; the display uses `×` and `÷`.
   *
   * @param {string} expression
   * @returns {string}
   */
  function toDisplayExpression(expression) {
    return String(expression === undefined || expression === null ? '' : expression)
      .replace(/\*\*/g, '^')
      .replace(/\*/g, '×')
      .replace(/\//g, '÷')
      .replace(/-/g, '−');
  }

  /**
   * Turns what the user typed back into the API representation.
   * @param {string} expression
   * @returns {string}
   */
  function toApiExpression(expression) {
    return String(expression === undefined || expression === null ? '' : expression)
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .replace(/–/g, '-')
      .replace(/\^/g, '**');
  }

  /**
   * Formats a stored timestamp ("2026-10-01 10:20:00") for the history list.
   * @param {string} value
   * @returns {string}
   */
  function formatTimestamp(value) {
    var text = String(value || '');
    var match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!match) {
      return text;
    }
    return match[2] + '-' + match[3] + ' ' + match[4] + ':' + match[5] + ':' + match[6];
  }

  /** Human readable label of an operation family. */
  var OPERATION_LABELS = {
    addition: 'Addition',
    subtraction: 'Subtraction',
    multiplication: 'Multiplication',
    division: 'Division',
    modulo: 'Modulo',
    power: 'Power',
    compound: 'Compound',
    scientific: 'Scientific',
    number: 'Number',
    conversion: 'Conversion',
  };

  /**
   * @param {string} operation
   * @returns {string}
   */
  function operationLabel(operation) {
    return OPERATION_LABELS[operation] || operation || 'Calculation';
  }

  /**
   * Shows a short message at the bottom of the screen.
   * @param {string} message
   * @param {string} [kind] "success", "error" or "info"
   */
  var toastTimer = null;
  function toast(message, kind) {
    var node = element('toast');
    node.textContent = message;
    node.dataset.kind = kind || 'info';
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function hideToast() {
      node.classList.remove('is-visible');
    }, 2600);
  }

  /**
   * Updates the connection indicator in the header.
   * @param {'connecting'|'online'|'offline'} state
   * @param {string} text
   */
  function setConnection(state, text) {
    var node = element('connectionStatus');
    node.dataset.state = state;
    element('connectionText').textContent = text;
  }

  /** Debounces a function, used for the history search field. */
  function debounce(fn, delay) {
    var timer = null;
    return function debounced() {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function run() {
        fn.apply(null, args);
      }, delay);
    };
  }

  /** Button tables: layout and behaviour are described by the same data. */
  var BASIC_KEYS = [
    { label: 'C', action: 'clear', variant: 'function' },
    { label: '( )', action: 'parentheses', variant: 'function' },
    { label: '⌫', action: 'backspace', variant: 'function' },
    { label: '÷', action: 'operator', value: '/', variant: 'operator' },

    { label: '7', action: 'digit', value: '7' },
    { label: '8', action: 'digit', value: '8' },
    { label: '9', action: 'digit', value: '9' },
    { label: '×', action: 'operator', value: '*', variant: 'operator' },

    { label: '4', action: 'digit', value: '4' },
    { label: '5', action: 'digit', value: '5' },
    { label: '6', action: 'digit', value: '6' },
    { label: '−', action: 'operator', value: '-', variant: 'operator' },

    { label: '1', action: 'digit', value: '1' },
    { label: '2', action: 'digit', value: '2' },
    { label: '3', action: 'digit', value: '3' },
    { label: '+', action: 'operator', value: '+', variant: 'operator' },

    { label: '±', action: 'negate', variant: 'function' },
    { label: '0', action: 'digit', value: '0' },
    { label: '.', action: 'digit', value: '.' },
    { label: '=', action: 'equals', variant: 'equals' },
  ];

  var SCIENTIFIC_KEYS = [
    { label: 'C', action: 'clear', variant: 'function' },
    { label: '( )', action: 'parentheses', variant: 'function' },
    { label: '⌫', action: 'backspace', variant: 'function' },
    { label: 'xʸ', action: 'insert', value: '^', variant: 'function' },
    { label: 'x²', action: 'insert', value: '^2', variant: 'function' },

    { label: 'sin', action: 'insert', value: 'sin(', variant: 'function' },
    { label: 'cos', action: 'insert', value: 'cos(', variant: 'function' },
    { label: 'tan', action: 'insert', value: 'tan(', variant: 'function' },
    { label: 'ln', action: 'insert', value: 'ln(', variant: 'function' },
    { label: 'log', action: 'insert', value: 'log(', variant: 'function' },

    { label: '7', action: 'digit', value: '7' },
    { label: '8', action: 'digit', value: '8' },
    { label: '9', action: 'digit', value: '9' },
    { label: '÷', action: 'operator', value: '/', variant: 'operator' },
    { label: '√', action: 'insert', value: 'sqrt(', variant: 'function' },

    { label: '4', action: 'digit', value: '4' },
    { label: '5', action: 'digit', value: '5' },
    { label: '6', action: 'digit', value: '6' },
    { label: '×', action: 'operator', value: '*', variant: 'operator' },
    { label: 'π', action: 'insert', value: 'pi', variant: 'function' },

    { label: '1', action: 'digit', value: '1' },
    { label: '2', action: 'digit', value: '2' },
    { label: '3', action: 'digit', value: '3' },
    { label: '−', action: 'operator', value: '-', variant: 'operator' },
    { label: 'e', action: 'insert', value: 'e', variant: 'function' },

    { label: '±', action: 'negate', variant: 'function' },
    { label: '0', action: 'digit', value: '0' },
    { label: '.', action: 'digit', value: '.' },
    { label: '+', action: 'operator', value: '+', variant: 'operator' },
    { label: '=', action: 'equals', variant: 'equals' },
  ];

  /**
   * Renders a keypad into a container.
   *
   * @param {HTMLElement} container
   * @param {Array<object>} keys
   * @param {Function} onKey called with the key description
   */
  function renderKeypad(container, keys, onKey) {
    var buttons = keys.map(function build(key) {
      var classes = ['key'];
      if (key.variant) {
        classes.push('key--' + key.variant);
      }

      var button = create('button', {
        type: 'button',
        className: classes.join(' '),
        text: key.label,
        'aria-label': key.value ? key.label + ' (' + key.value + ')' : key.label,
        dataset: { action: key.action, value: key.value || '' },
      });

      button.addEventListener('click', function handleClick() {
        onKey(key);
      });
      return button;
    });

    replaceChildren(container, buttons);
  }

  global.CalculatorUi = {
    element: element,
    create: create,
    replaceChildren: replaceChildren,
    toDisplayExpression: toDisplayExpression,
    toApiExpression: toApiExpression,
    formatTimestamp: formatTimestamp,
    operationLabel: operationLabel,
    toast: toast,
    setConnection: setConnection,
    debounce: debounce,
    renderKeypad: renderKeypad,
    BASIC_KEYS: BASIC_KEYS,
    SCIENTIFIC_KEYS: SCIENTIFIC_KEYS,
  };
})(window);
