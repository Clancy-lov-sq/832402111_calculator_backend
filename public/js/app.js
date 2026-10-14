/**
 * Application bootstrap.
 *
 * Responsibilities:
 *   - start the calculator, the history panel and the converters,
 *   - switch between the three tabs and keep the back-end mode in sync,
 *   - restore and store the theme,
 *   - poll `GET /api/health` to show whether the back end is reachable.
 *
 * The health indicator is the visible part of the front-end/back-end separation:
 * when the back end is stopped the status turns red, the message line explains
 * that no new result can be produced, and the page keeps working as an
 * interface without ever calculating anything locally.
 */
(function bootstrap(global) {
  'use strict';

  var ui = global.CalculatorUi;
  var api = global.CalculatorApi;
  var config = global.CALCULATOR_CONFIG;

  /** Health polling interval in milliseconds. */
  var HEALTH_INTERVAL = 15000;

  var healthTimer = null;
  var backendOnline = null;

  /**
   * Applies a theme and stores the choice so the next visit keeps it.
   * @param {'light'|'dark'} theme
   */
  function applyTheme(theme) {
    var next = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    ui.element('themeIcon').textContent = next === 'dark' ? '☀' : '☾';
    ui.element('themeLabel').textContent = next === 'dark' ? 'Light' : 'Dark';
    try {
      global.localStorage.setItem(config.storageKeys.theme, next);
    } catch (error) {
      // Private browsing can refuse storage; the theme still applies to this page.
    }
  }

  /** Restores the theme chosen on a previous visit. */
  function restoreTheme() {
    var stored = null;
    try {
      stored = global.localStorage.getItem(config.storageKeys.theme);
    } catch (error) {
      stored = null;
    }
    var prefersDark =
      global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(stored || (prefersDark ? 'dark' : 'light'));
  }

  /** Activates one tab and, for the scientific tab, switches the back-end mode. */
  function activateTab(name) {
    var tabs = document.querySelectorAll('.tab');
    Array.prototype.forEach.call(tabs, function toggle(tab) {
      tab.classList.toggle('is-active', tab.dataset.tab === name);
    });

    ['basic', 'scientific', 'convert'].forEach(function togglePanel(panel) {
      ui.element('tab-' + panel).classList.toggle('is-active', panel === name);
    });

    // The evaluation mode is sent to the back end with every request: the basic
    // tab refuses function names, the scientific tab accepts them.
    global.CalculatorPanel.setMode(name === 'scientific' ? 'scientific' : 'basic');
    if (name === 'basic') {
      global.CalculatorPanel.setMode('basic');
    }
  }

  /**
   * Checks whether the back end and its database are reachable and updates the
   * header indicator.
   *
   * @returns {Promise<boolean>}
   */
  async function checkHealth() {
    var response = await api.health();
    if (response.ok) {
      var database = response.data.database || {};
      ui.setConnection(
        'online',
        'Back end online · ' + (database.client || 'database') + ' · ' +
          (database.storedRecords === null ? '?' : database.storedRecords) + ' records',
      );
      backendOnline = true;
      return true;
    }

    ui.setConnection('offline', 'Back end unreachable · calculating is disabled');
    backendOnline = false;
    return false;
  }

  /** Called by the calculator and the history panel when a request fails. */
  global.onBackendUnreachable = function onBackendUnreachable() {
    ui.setConnection('offline', 'Back end unreachable · calculating is disabled');
    backendOnline = false;
  };

  /**
   * Keeps the header indicator offline and stops the periodic check.
   *
   * Used by the demonstration mode, where a scripted state has to stay stable:
   * without this the next health check would overwrite the indicator with the
   * real state of the service, which is the opposite of what the state shows.
   *
   * @param {string} text text of the indicator
   */
  global.pinBackendOffline = function pinBackendOffline(text) {
    if (healthTimer !== null) {
      clearInterval(healthTimer);
      healthTimer = null;
    }
    ui.setConnection('offline', text);
    backendOnline = false;
  };

  /** Called after a successful calculation: the database changed, so reload. */
  global.onCalculationStored = function onCalculationStored() {
    global.CalculatorHistory.load({ offset: 0 });
    if (backendOnline !== true) {
      checkHealth();
    }
  };

  /**
   * Re-checks the connection immediately.
   *
   * Used by the demonstration mode so a scripted state can resolve the header
   * indicator right away instead of leaving it on "Connecting…" until the next
   * periodic check.
   *
   * @returns {Promise<boolean>}
   */
  global.refreshConnectionStatus = function refreshConnectionStatus() {
    return checkHealth();
  };

  /** Wires the header, the tabs and the periodic health check. */
  function init() {
    global.CalculatorPanel.init();
    global.CalculatorHistory.init();
    global.CalculatorConverter.init();

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function bind(tab) {
      tab.addEventListener('click', function onClick() {
        activateTab(tab.dataset.tab);
      });
    });

    ui.element('themeToggle').addEventListener('click', function onToggle() {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });

    restoreTheme();
    activateTab('basic');

    // Demonstration mode (optional): `?demo=<state>` puts the interface into a
    // scripted state. It runs before the first health check, because a scripted
    // state has to own the connection indicator: otherwise the real check would
    // overwrite it a moment later. Normal operation is unaffected.
    var demoActive = global.CalculatorDemo ? global.CalculatorDemo.start() : false;

    // First load: read the history from the database and check the connection.
    global.CalculatorHistory.load({ offset: 0 });

    if (demoActive) {
      global.CalculatorHistory.refreshStatistics();
    } else {
      checkHealth().then(function afterFirstCheck(online) {
        if (!online) {
          global.CalculatorPanel.showError(
            'NETWORK_UNREACHABLE',
            'The back end is not reachable, so no new result can be produced. Start it with "npm start" in the back-end repository.',
          );
        }
      });
    }

    healthTimer = setInterval(checkHealth, HEALTH_INTERVAL);

    // Coming back to the tab is a good moment to confirm that the back end and
    // the database still answer.
    document.addEventListener('visibilitychange', function onVisibility() {
      if (!document.hidden) {
        checkHealth();
        global.CalculatorHistory.load();
      }
    });

    global.addEventListener('beforeunload', function onUnload() {
      clearInterval(healthTimer);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
