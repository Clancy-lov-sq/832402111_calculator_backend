/**
 * HTTP client for the calculator back end.
 *
 * This module is the single place where the browser talks to the API, which is
 * what the front-end/back-end separation of this assignment is about. It knows
 * nothing about the DOM and nothing about the calculator rules; it only:
 *
 *   1. builds the request (URL, method, JSON body),
 *   2. applies a timeout with AbortController so a dead back end cannot freeze
 *      the interface,
 *   3. normalises both the success and the failure answer into one shape:
 *        { ok: true,  data }              for a successful call
 *        { ok: false, code, message }     for a rejected or unreachable call
 *
 * No calculation happens here. The browser never computes a result, it only
 * sends the expression and displays what the back end returned.
 */
(function exposeApi(global) {
  'use strict';

  var config = global.CALCULATOR_CONFIG;

  /**
   * Error thrown for every failed API call, so callers can use one `catch`.
   */
  function ApiError(code, message, status) {
    this.name = 'ApiError';
    this.code = code;
    this.message = message;
    this.status = status || 0;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  /**
   * @param {string} path e.g. "/calculate"
   * @returns {string} the absolute URL of an API endpoint
   */
  function url(path) {
    return config.apiBase + '/api' + path;
  }

  /**
   * Sends one request and resolves with the parsed body.
   *
   * @param {string} path
   * @param {object} [options]
   * @param {string} [options.method] HTTP method, GET by default
   * @param {object} [options.body] JSON body
   * @returns {Promise<{ok: boolean, data: object, code: string|null, message: string|null, status: number}>}
   */
  async function request(path, options) {
    var settings = options || {};
    var method = settings.method || 'GET';

    // Demonstration mode: a scripted state can answer instead of the back end so
    // that a screenshot is reproducible. Without `?demo=` in the URL this branch
    // never runs and every request reaches the real service.
    if (global.CalculatorDemo && global.CalculatorDemo.isActive()) {
      var scripted = global.CalculatorDemo.getScriptedResponse(path, method);
      if (scripted !== null && scripted !== undefined) {
        return {
          ok: scripted.success !== false,
          data: scripted,
          code: scripted.error || null,
          message: scripted.error ? scripted.message : null,
          status: scripted.success === false ? 400 : 200,
        };
      }
    }

    var controller = new AbortController();
    var timer = setTimeout(function abortSlowRequest() {
      controller.abort();
    }, config.requestTimeout);

    var init = {
      method: method,
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    };

    if (settings.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(settings.body);
    }

    try {
      var response = await fetch(url(path), init);
      var text = await response.text();
      var data = text.length > 0 ? JSON.parse(text) : {};

      if (response.ok && data.success !== false) {
        return { ok: true, data: data, code: null, message: null, status: response.status };
      }

      // The back end always answers a failure with { success: false, error, message }.
      return {
        ok: false,
        data: data,
        code: data.error || 'HTTP_' + response.status,
        message: data.message || 'The request was rejected',
        status: response.status,
      };
    } catch (error) {
      // A network failure is the expected situation when the back end is stopped,
      // and it is exactly what proves the separation: the page still works, but
      // it cannot produce a new result.
      var unreachable = error && error.name === 'AbortError' ? 'The back end did not answer in time' : 'Cannot reach the back end';
      return {
        ok: false,
        data: {},
        code: 'NETWORK_UNREACHABLE',
        message: unreachable + ' (' + config.apiBase + ')',
        status: 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Unwraps a response or throws an ApiError, for callers that prefer try/catch.
   * @param {object} result
   * @returns {object}
   */
  function unwrap(result) {
    if (result.ok) {
      return result.data;
    }
    throw new ApiError(result.code, result.message, result.status);
  }

  var api = {
    ApiError: ApiError,
    url: url,
    apiBase: function getApiBase() {
      return config.apiBase;
    },

    /**
     * POST /api/calculate - the back end evaluates the expression and stores it.
     * @param {string} expression the raw expression typed by the user
     * @param {object} [options]
     * @param {string} [options.mode] "basic" or "scientific"
     * @param {number} [options.ans] previous result, used by the `ans` constant
     */
    calculate: function calculate(expression, options) {
      var settings = options || {};
      return request('/calculate', {
        method: 'POST',
        body: { expression: expression, mode: settings.mode || 'basic', ans: settings.ans },
      });
    },

    /**
     * GET /api/history - reads the history from the back-end database.
     * @param {object} [query] limit, offset, keyword, operation or page
     */
    history: function history(query) {
      var parameters = new URLSearchParams();
      Object.keys(query || {}).forEach(function append(key) {
        var value = query[key];
        if (value !== undefined && value !== null && value !== '') {
          parameters.set(key, value);
        }
      });
      var suffix = parameters.toString().length > 0 ? '?' + parameters.toString() : '';
      return request('/history' + suffix);
    },

    /** DELETE /api/history/{id} - deletes exactly one database record. */
    deleteHistory: function deleteHistory(id) {
      return request('/history/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    /** DELETE /api/history - optional "clear all" function. */
    clearHistory: function clearHistory() {
      return request('/history', { method: 'DELETE' });
    },

    /** GET /api/stats - aggregated statistics for the dashboard. */
    stats: function stats(days) {
      return request('/stats?days=' + encodeURIComponent(days || 7));
    },

    /** GET /api/health - used by the connection indicator. */
    health: function health() {
      return request('/health');
    },

    /** GET /api/capabilities - operators, functions, constants and bases. */
    capabilities: function capabilities() {
      return request('/capabilities');
    },

    /** POST /api/convert/base - number base conversion (extended feature). */
    convertBase: function convertBase(payload) {
      return request('/convert/base', { method: 'POST', body: payload });
    },

    /** POST /api/convert/unit - unit conversion (extended feature). */
    convertUnit: function convertUnit(payload) {
      return request('/convert/unit', { method: 'POST', body: payload });
    },

    /** GET /api/convert/units - every category and unit. */
    units: function units() {
      return request('/convert/units');
    },

    request: request,
    unwrap: unwrap,
  };

  global.CalculatorApi = api;
})(window);
