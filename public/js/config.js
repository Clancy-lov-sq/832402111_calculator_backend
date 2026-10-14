/**
 * Front-end configuration.
 *
 * The page and the API are separate applications, so the address of the API has
 * to be known by the browser. It is resolved in this order:
 *
 *   1. an explicit override in the URL:  index.html?api=http://127.0.0.1:8080
 *      (used to point the same build at a local or a deployed back end)
 *   2. window.CALCULATOR_API_BASE, injected by an optional `config.local.js`
 *      file that is not part of the repository, so a deployment can be adapted
 *      without touching source code
 *   3. automatic detection:
 *        - if the page is served by the back end itself (the optional
 *          single-service deployment), the API is on the same origin;
 *        - otherwise, in local development, the default local back end address;
 *        - otherwise the address of the deployed back end.
 *
 * This file is loaded before every other module and only publishes data.
 */
(function publishFrontendConfig(global) {
  'use strict';

  /** Address of the deployed back end, used when nothing else applies. */
  var DEPLOYED_API_BASE = 'http://127.0.0.1:8080';

  /** Address used while developing on the same computer. */
  var LOCAL_API_BASE = 'http://127.0.0.1:8080';

  /**
   * @param {string} value
   * @returns {string} the value without a trailing slash
   */
  function trimTrailingSlash(value) {
    return String(value).replace(/\/+$/, '');
  }

  /**
   * Reads the `api` parameter of the current URL.
   * @returns {string|null}
   */
  function readApiParameter() {
    try {
      var parameters = new URLSearchParams(global.location.search);
      var value = parameters.get('api');
      return value ? trimTrailingSlash(value) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Decides which back-end address the page should use.
   * @returns {string}
   */
  function resolveApiBase() {
    var fromUrl = readApiParameter();
    if (fromUrl) {
      return fromUrl;
    }

    if (typeof global.CALCULATOR_API_BASE === 'string' && global.CALCULATOR_API_BASE.length > 0) {
      return trimTrailingSlash(global.CALCULATOR_API_BASE);
    }

    var isLocalHost = ['127.0.0.1', 'localhost', ''].indexOf(global.location.hostname) !== -1;

    // Served by the back end (single-service deployment): same origin, so the
    // API base is the empty prefix and every request stays relative.
    if (!isLocalHost) {
      return '';
    }

    // A local static server usually listens on another port than the API.
    if (global.location.port !== '' && global.location.port !== '8080') {
      return LOCAL_API_BASE;
    }

    return global.location.port === '8080' ? '' : DEPLOYED_API_BASE;
  }

  global.CALCULATOR_CONFIG = {
    apiBase: resolveApiBase(),
    /** Milliseconds before a request to the back end is treated as failed. */
    requestTimeout: 8000,
    /** History page size; the back-end default is 10 and the maximum 100. */
    historyPageSize: 6,
    /** Default theme restored from the previous visit. */
    storageKeys: {
      theme: 'calculator.theme',
      lastMode: 'calculator.mode',
    },
    version: '1.0.0',
  };
})(window);
