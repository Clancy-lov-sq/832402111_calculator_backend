/**
 * Conversion tab (documented extended feature).
 *
 * Two independent converters:
 *   - number base conversion  -> POST /api/convert/base
 *   - unit conversion         -> POST /api/convert/unit
 *
 * Both send the value to the back end and display the answer, so this feature
 * follows the same separation rule as the calculator: no conversion is computed
 * in the browser.
 */
(function exposeConverter(global) {
  'use strict';

  var ui = global.CalculatorUi;
  var api = global.CalculatorApi;

  /** Maps the select values of the front end to numeric bases. */
  var BASE_BY_KEY = { dec: 10, bin: 2, oct: 8, hex: 16 };

  var nodes = {
    baseValue: ui.element('baseValue'),
    baseSource: ui.element('baseSource'),
    baseConvert: ui.element('baseConvert'),
    baseResults: ui.element('baseResults'),
    unitCategory: ui.element('unitCategory'),
    unitValue: ui.element('unitValue'),
    unitFrom: ui.element('unitFrom'),
    unitTo: ui.element('unitTo'),
    unitSwap: ui.element('unitSwap'),
    unitConvert: ui.element('unitConvert'),
    unitResult: ui.element('unitResult'),
  };

  /** Categories and units fetched from GET /api/convert/units. */
  var unitCatalog = [];

  /**
   * True once a caller has chosen the units explicitly (`selectUnits`).
   *
   * `loadUnitCatalog()` fills the selects with a useful default when the catalog
   * arrives. If that answer arrives after the units were already chosen — which
   * happens on start-up, where the catalog request and the caller run
   * concurrently — the default must not overwrite the choice.
   */
  var unitsChosen = false;

  /**
   * Renders the conversion results as a list.
   * @param {Array<{label: string, value: string}>} rows
   */
  function renderBaseResults(rows) {
    if (rows.length === 0) {
      ui.replaceChildren(nodes.baseResults, [
        ui.create('li', { className: 'empty-hint', text: 'Enter a value and press Convert.' }),
      ]);
      return;
    }
    ui.replaceChildren(
      nodes.baseResults,
      rows.map(function build(row) {
        return ui.create('li', {}, [
          ui.create('span', { className: 'result-label', text: row.label }),
          ui.create('span', { className: 'result-value', text: row.value }),
        ]);
      }),
    );
  }

  /** POST /api/convert/base and display every base the back end returned. */
  async function convertBase() {
    var rawValue = nodes.baseValue.value.trim();
    var sourceKey = nodes.baseSource.value;
    var sourceBase = BASE_BY_KEY[sourceKey];

    if (rawValue === '') {
      renderBaseResults([]);
      return;
    }

    var payload =
      sourceBase === 10
        ? { value: rawValue.replace(',', '.') }
        : { value: rawValue.toLowerCase(), fromBase: sourceBase };

    nodes.baseConvert.disabled = true;
    var response = await api.convertBase(payload);
    nodes.baseConvert.disabled = false;

    if (!response.ok) {
      renderBaseResults([{ label: 'Error', value: response.message }]);
      ui.toast('Base conversion failed: ' + response.message, 'error');
      return;
    }

    var baseLabels = { 2: 'Binary (2)', 8: 'Octal (8)', 10: 'Decimal (10)', 16: 'Hexadecimal (16)', 36: 'Base 36' };
    var rows = (response.data.conversions || []).map(function map(item) {
      return { label: baseLabels[item.base] || 'Base ' + item.base, value: item.result };
    });
    renderBaseResults(rows);
    ui.toast('Converted by the back end', 'success');
  }

  /**
   * Fills the unit selects for one category.
   * @param {string} category
   * @param {string} [preferredFrom]
   * @param {string} [preferredTo]
   */
  function fillUnits(category, preferredFrom, preferredTo) {
    var entry = unitCatalog.find(function find(item) {
      return item.category === category;
    });
    if (!entry) {
      return;
    }

    var options = entry.units.map(function build(unit) {
      return ui.create('option', { value: unit.unit, text: unit.name + ' (' + unit.symbol + ')' });
    });

    ui.replaceChildren(nodes.unitFrom, options.map(function clone(option) {
      return option.cloneNode(true);
    }));
    ui.replaceChildren(nodes.unitTo, options);

    nodes.unitFrom.value = preferredFrom && entry.units.some(function has(unit) { return unit.unit === preferredFrom; })
      ? preferredFrom
      : entry.units[0].unit;
    nodes.unitTo.value = preferredTo && entry.units.some(function has(unit) { return unit.unit === preferredTo; })
      ? preferredTo
      : entry.units[Math.min(1, entry.units.length - 1)].unit;

    // The category select is written here as well, so a caller can switch the
    // whole converter with one call and the three selects always agree.
    nodes.unitCategory.value = category;
  }

  /** Loads the category and unit catalog from the back end. */
  async function loadUnitCatalog() {
    var response = await api.units();
    if (!response.ok) {
      nodes.unitResult.textContent = 'Unit list unavailable: ' + response.message;
      return;
    }

    unitCatalog = response.data.categories || [];
    ui.replaceChildren(
      nodes.unitCategory,
      unitCatalog.map(function build(category) {
        return ui.create('option', { value: category.category, text: category.name });
      }),
    );

    // Defaults that make the converter immediately useful, unless a caller has
    // already selected a category and a unit pair.
    if (!unitsChosen) {
      nodes.unitCategory.value = 'length';
      fillUnits('length', 'km', 'mi');
    }
    return true;
  }

  /**
   * Guards against a slow answer overwriting a newer one.
   *
   * Every unit conversion request gets a sequence number. When several
   * conversions are started in a row — which happens on start-up and when the
   * category is changed, because the selects fire `change` as they are filled —
   * the answers can arrive out of order. Only the answer of the newest request
   * is rendered, so the box under the selects always describes the units that
   * are actually selected.
   */
  var conversionSequence = 0;

  /** POST /api/convert/unit and display the answer. */
  async function convertUnit() {
    var value = Number(nodes.unitValue.value);
    if (!Number.isFinite(value)) {
      nodes.unitResult.textContent = 'Enter a numeric value first.';
      return;
    }

    var from = nodes.unitFrom.value;
    var to = nodes.unitTo.value;
    conversionSequence += 1;
    var sequence = conversionSequence;

    nodes.unitConvert.disabled = true;
    var response = await api.convertUnit({ value: value, from: from, to: to });
    nodes.unitConvert.disabled = false;

    if (sequence !== conversionSequence) {
      return; // a newer conversion was started while this one was in flight
    }

    if (!response.ok) {
      nodes.unitResult.textContent = 'Error: ' + response.message;
      return;
    }

    var data = response.data;
    nodes.unitResult.textContent =
      data.value + ' ' + data.from.symbol + '  =  ' + data.resultText + ' ' + data.to.symbol;
    ui.toast('Converted on the back end', 'success');
  }

  /** Binds every control of the conversion tab. */
  function init() {
    nodes.baseConvert.addEventListener('click', convertBase);
    nodes.baseValue.addEventListener('keydown', function onKeyDown(event) {
      if (event.key === 'Enter') {
        convertBase();
      }
    });
    nodes.baseSource.addEventListener('change', convertBase);

    nodes.unitCategory.addEventListener('change', function onCategoryChange(event) {
      fillUnits(event.target.value);
      convertUnit();
    });
    nodes.unitFrom.addEventListener('change', convertUnit);
    nodes.unitTo.addEventListener('change', convertUnit);
    nodes.unitValue.addEventListener('input', ui.debounce(convertUnit, 300));
    nodes.unitConvert.addEventListener('click', convertUnit);
    nodes.unitSwap.addEventListener('click', function onSwap() {
      var from = nodes.unitFrom.value;
      nodes.unitFrom.value = nodes.unitTo.value;
      nodes.unitTo.value = from;
      convertUnit();
    });

    loadUnitCatalog();
  }

  global.CalculatorConverter = {
    init: init,
    convertBase: convertBase,
    convertUnit: convertUnit,
    loadUnitCatalog: loadUnitCatalog,
    /** Selects a category and two units; also used by the demonstration mode. */
    selectUnits: function selectUnits(category, from, to) {
      unitsChosen = true;
      nodes.unitCategory.value = category;
      fillUnits(category, from, to);
    },
    /** True once the unit catalog has been loaded from the back end. */
    isCatalogLoaded: function isCatalogLoaded() {
      return unitCatalog.length > 0;
    },
  };
})(window);
