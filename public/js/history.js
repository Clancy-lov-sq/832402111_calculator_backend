/**
 * Calculation history panel.
 *
 * The history shown here always comes from the back-end database:
 *
 *   - opening the page queries `GET /api/history`,
 *   - deleting a record calls `DELETE /api/history/{id}` and then queries the
 *     list again, because the database is the authoritative source and a local
 *     DOM edit could disagree with it,
 *   - pagination, search and the operation filter are query parameters handled
 *     by the back end, not client-side filtering of a cached array.
 *
 * Nothing is stored in localStorage or in memory between page loads, so
 * refreshing or reopening the page cannot make a record disappear.
 */
(function exposeHistory(global) {
  'use strict';

  var ui = global.CalculatorUi;
  var api = global.CalculatorApi;
  var config = global.CALCULATOR_CONFIG;

  var state = {
    records: [],
    total: 0,
    offset: 0,
    limit: config.historyPageSize,
    keyword: '',
    operation: '',
    loading: false,
  };

  var nodes = {
    list: ui.element('historyList'),
    subtitle: ui.element('historySubtitle'),
    pageInfo: ui.element('historyPageInfo'),
    prev: ui.element('historyPrev'),
    next: ui.element('historyNext'),
    refresh: ui.element('historyRefresh'),
    clear: ui.element('historyClear'),
    search: ui.element('historySearch'),
    filter: ui.element('historyFilter'),
    statsGrid: ui.element('statsGrid'),
  };

  /** Shows a placeholder row in the history list. */
  function showPlaceholder(text) {
    ui.replaceChildren(nodes.list, [ui.create('li', { className: 'empty-hint', text: text })]);
  }

  /**
   * Builds one history row.
   *
   * The expression and the result are written with `textContent`, so a stored
   * value can never be executed or rendered as markup.
   *
   * @param {object} record a record returned by GET /api/history
   * @returns {HTMLElement}
   */
  function buildRow(record) {
    var expression = ui.create('span', {
      className: 'history-item__expression',
      text: ui.toDisplayExpression(record.expression),
    });
    var result = ui.create('span', {
      className: 'history-item__result',
      text: '= ' + (record.resultText !== undefined ? record.resultText : record.result),
    });

    var operationTag = ui.create('span', {
      className: 'tag' + (record.mode === 'scientific' ? ' tag--scientific' : ''),
      text: ui.operationLabel(record.operation),
    });
    var time = ui.create('span', { text: ui.formatTimestamp(record.createdAt) });
    var tags = ui.create('span', { className: 'history-item__tags' }, [operationTag, time]);

    var idLabel = ui.create('span', { text: '#' + record.id });
    var meta = ui.create('div', { className: 'history-item__meta' }, [tags, idLabel]);

    var deleteButton = ui.create('button', {
      type: 'button',
      className: 'delete-button',
      text: 'Delete',
      dataset: { id: String(record.id) },
      title: 'Delete record #' + record.id + ' from the database',
    });
    deleteButton.addEventListener('click', function onDelete() {
      remove(record.id, deleteButton);
    });

    return ui.create('li', { className: 'history-item', dataset: { id: String(record.id) } }, [
      expression,
      deleteButton,
      result,
      meta,
    ]);
  }

  /** Renders the records currently held in `state`. */
  function render() {
    if (state.records.length === 0) {
      showPlaceholder(
        state.keyword || state.operation
          ? 'No record matches the current search or filter.'
          : 'No calculation yet. Evaluate an expression and it will be stored in the database.',
      );
    } else {
      ui.replaceChildren(nodes.list, state.records.map(buildRow));
    }

    var first = state.total === 0 ? 0 : state.offset + 1;
    var last = state.offset + state.records.length;
    nodes.subtitle.textContent =
      state.total === 0
        ? 'The back-end database is empty'
        : 'Read from the database · ' + state.total + ' record' + (state.total === 1 ? '' : 's');
    nodes.pageInfo.textContent = state.total === 0 ? 'Page 0 / 0' : 'Showing ' + first + '–' + last + ' of ' + state.total;
    nodes.prev.disabled = state.offset === 0;
    nodes.next.disabled = state.offset + state.records.length >= state.total;
  }

  /**
   * Loads one page of history from the back end.
   *
   * @param {object} [options]
   * @param {number} [options.offset] overrides the current offset
   * @returns {Promise<boolean>} whether the request succeeded
   */
  async function load(options) {
    if (state.loading) {
      return false;
    }
    state.loading = true;

    var settings = options || {};
    if (settings.offset !== undefined) {
      state.offset = Math.max(0, settings.offset);
    }

    var response = await api.history({
      limit: state.limit,
      offset: state.offset,
      keyword: state.keyword,
      operation: state.operation,
    });

    state.loading = false;

    if (!response.ok) {
      showPlaceholder('History is unavailable: ' + response.message);
      nodes.subtitle.textContent = 'The back end could not be reached';
      if (response.code === 'NETWORK_UNREACHABLE' && typeof global.onBackendUnreachable === 'function') {
        global.onBackendUnreachable();
      }
      return false;
    }

    state.records = response.data.records || [];
    state.total = response.data.total || 0;

    // A deletion can leave the last page empty; step back one page instead of
    // showing an empty list.
    if (state.records.length === 0 && state.offset > 0 && state.total > 0) {
      return load({ offset: Math.max(0, state.offset - state.limit) });
    }

    render();
    refreshStatistics();
    return true;
  }

  /**
   * Deletes one record and re-reads the list from the database.
   *
   * @param {number} id
   * @param {HTMLElement} button the button that was pressed, disabled meanwhile
   */
  async function remove(id, button) {
    if (button) {
      button.disabled = true;
    }

    var response = await api.deleteHistory(id);

    if (!response.ok) {
      if (button) {
        button.disabled = false;
      }
      if (response.status === 404) {
        ui.toast('Record #' + id + ' no longer exists; the list was refreshed', 'error');
        await load();
        return;
      }
      ui.toast('Delete failed: ' + response.message, 'error');
      return;
    }

    ui.toast('Record #' + id + ' deleted from the database', 'success');
    // The database is the source of truth: query it again instead of removing the
    // row from the DOM only.
    await load();
  }

  /** Deletes every record (optional extended function). */
  async function clearAll() {
    var response = await api.clearHistory();
    if (!response.ok) {
      ui.toast('Clear failed: ' + response.message, 'error');
      return;
    }
    state.offset = 0;
    ui.toast('Deleted ' + response.data.deleted + ' record(s) from the database', 'success');
    await load({ offset: 0 });
  }

  /**
   * Loads the statistics of the back end and renders the dashboard cells.
   * Extended feature; a failure here never blocks the history list.
   */
  async function refreshStatistics() {
    var response = await api.stats(7);
    if (!response.ok) {
      ui.replaceChildren(nodes.statsGrid, [
        ui.create('div', { className: 'empty-hint', text: 'Statistics unavailable' }),
      ]);
      return;
    }

    var data = response.data;
    var cells = [
      { label: 'Total', value: data.total },
      { label: 'Addition', value: data.byOperation.addition || 0 },
      { label: 'Subtraction', value: data.byOperation.subtraction || 0 },
      { label: 'Multiplication', value: data.byOperation.multiplication || 0 },
      { label: 'Division', value: data.byOperation.division || 0 },
      { label: 'Compound', value: data.byOperation.compound || 0 },
      { label: 'Scientific', value: data.byOperation.scientific || 0 },
      { label: 'Today', value: (data.daily && data.daily[0] ? data.daily[0].count : 0) },
    ];

    ui.replaceChildren(
      nodes.statsGrid,
      cells.map(function build(cell) {
        return ui.create('div', { className: 'stats-cell' }, [
          ui.create('span', { className: 'stats-cell__label', text: cell.label }),
          ui.create('span', { className: 'stats-cell__value', text: String(cell.value) }),
        ]);
      }),
    );
  }

  /** Binds the toolbar, the pagination and the refresh button. */
  function init() {
    nodes.refresh.addEventListener('click', function onRefresh() {
      load({ offset: 0 });
      ui.toast('History re-read from the back end', 'success');
    });

    nodes.clear.addEventListener('click', function onClear() {
      clearAll();
    });

    nodes.prev.addEventListener('click', function onPrevious() {
      load({ offset: Math.max(0, state.offset - state.limit) });
    });

    nodes.next.addEventListener('click', function onNext() {
      load({ offset: state.offset + state.limit });
    });

    nodes.search.addEventListener(
      'input',
      ui.debounce(function onSearch(event) {
        state.keyword = event.target.value.trim();
        load({ offset: 0 });
      }, 320),
    );

    nodes.filter.addEventListener('change', function onFilter(event) {
      state.operation = event.target.value;
      load({ offset: 0 });
    });

    showPlaceholder('Loading calculation history…');
  }

  global.CalculatorHistory = {
    init: init,
    load: load,
    refreshStatistics: refreshStatistics,
    getState: function getState() {
      return { total: state.total, offset: state.offset, records: state.records };
    },
  };
})(window);
