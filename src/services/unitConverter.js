'use strict';

/**
 * Unit conversion.
 *
 * Every unit is expressed as a factor (and, for temperatures, an offset) that
 * turns the value into the *base unit of its category*. Converting therefore
 * always takes two steps:
 *
 *   value -> base unit of the source category -> target unit
 *
 * which keeps the table small and guarantees that every pair inside a category
 * works without a specific rule per pair.
 *
 * Documented extended feature; independent from the expression engine.
 */

const { AppError, ErrorCode } = require('../utils/errors');

/** Categories and the exact SI unit every value is normalised to. */
const CATEGORIES = Object.freeze({
  length: { name: 'Length', baseUnit: 'm' },
  mass: { name: 'Mass', baseUnit: 'kg' },
  temperature: { name: 'Temperature', baseUnit: '°C' },
  area: { name: 'Area', baseUnit: 'm²' },
  volume: { name: 'Volume', baseUnit: 'L' },
  time: { name: 'Time', baseUnit: 's' },
  speed: { name: 'Speed', baseUnit: 'm/s' },
  data: { name: 'Digital storage', baseUnit: 'B' },
});

/**
 * Unit table.
 *
 * Unit identifiers are the display symbols in lower case (`mm`, `km/h`, `mib`,
 * `°c`), so the identifier the API accepts is always recognisable for a user.
 * `factor` is the multiplier that converts the unit into the base unit of its
 * category. `offset` is only used by temperatures:
 * valueInBase = value * factor + offset.
 */
const UNITS = Object.freeze({
  length: {
    mm: { name: 'Millimetre', symbol: 'mm', factor: 0.001 },
    cm: { name: 'Centimetre', symbol: 'cm', factor: 0.01 },
    m: { name: 'Metre', symbol: 'm', factor: 1 },
    km: { name: 'Kilometre', symbol: 'km', factor: 1000 },
    in: { name: 'Inch', symbol: 'in', factor: 0.0254 },
    ft: { name: 'Foot', symbol: 'ft', factor: 0.3048 },
    yd: { name: 'Yard', symbol: 'yd', factor: 0.9144 },
    mi: { name: 'Mile', symbol: 'mi', factor: 1609.344 },
    nmi: { name: 'Nautical mile', symbol: 'nmi', factor: 1852 },
  },
  mass: {
    mg: { name: 'Milligram', symbol: 'mg', factor: 1e-6 },
    g: { name: 'Gram', symbol: 'g', factor: 0.001 },
    kg: { name: 'Kilogram', symbol: 'kg', factor: 1 },
    t: { name: 'Tonne', symbol: 't', factor: 1000 },
    oz: { name: 'Ounce', symbol: 'oz', factor: 0.028349523125 },
    lb: { name: 'Pound', symbol: 'lb', factor: 0.45359237 },
    '斤': { name: 'Jin (500 g)', symbol: '斤', factor: 0.5 },
  },
  temperature: {
    '°c': { name: 'Celsius', symbol: '°C', factor: 1, offset: 0 },
    '°f': { name: 'Fahrenheit', symbol: '°F', factor: 5 / 9, offset: -32 * (5 / 9) },
    k: { name: 'Kelvin', symbol: 'K', factor: 1, offset: -273.15 },
  },
  area: {
    cm2: { name: 'Square centimetre', symbol: 'cm²', factor: 0.0001 },
    m2: { name: 'Square metre', symbol: 'm²', factor: 1 },
    km2: { name: 'Square kilometre', symbol: 'km²', factor: 1e6 },
    ha: { name: 'Hectare', symbol: 'ha', factor: 10000 },
    acre: { name: 'Acre', symbol: 'acre', factor: 4046.8564224 },
    ft2: { name: 'Square foot', symbol: 'ft²', factor: 0.09290304 },
    '亩': { name: 'Mu (666.67 m²)', symbol: '亩', factor: 2000 / 3 },
  },
  volume: {
    ml: { name: 'Millilitre', symbol: 'mL', factor: 0.001 },
    l: { name: 'Litre', symbol: 'L', factor: 1 },
    m3: { name: 'Cubic metre', symbol: 'm³', factor: 1000 },
    gal: { name: 'US gallon', symbol: 'gal', factor: 3.785411784 },
    qt: { name: 'US quart', symbol: 'qt', factor: 0.946352946 },
    cup: { name: 'US cup', symbol: 'cup', factor: 0.2365882365 },
  },
  time: {
    ms: { name: 'Millisecond', symbol: 'ms', factor: 0.001 },
    s: { name: 'Second', symbol: 's', factor: 1 },
    min: { name: 'Minute', symbol: 'min', factor: 60 },
    h: { name: 'Hour', symbol: 'h', factor: 3600 },
    d: { name: 'Day', symbol: 'd', factor: 86400 },
    wk: { name: 'Week', symbol: 'wk', factor: 604800 },
  },
  speed: {
    'm/s': { name: 'Metre per second', symbol: 'm/s', factor: 1 },
    'km/h': { name: 'Kilometre per hour', symbol: 'km/h', factor: 1 / 3.6 },
    mph: { name: 'Mile per hour', symbol: 'mph', factor: 0.44704 },
    kn: { name: 'Knot', symbol: 'kn', factor: 0.5144444444444445 },
  },
  data: {
    b: { name: 'Byte', symbol: 'B', factor: 1 },
    kb: { name: 'Kilobyte (1000 B)', symbol: 'kB', factor: 1000 },
    kib: { name: 'Kibibyte (1024 B)', symbol: 'KiB', factor: 1024 },
    mb: { name: 'Megabyte (1000² B)', symbol: 'MB', factor: 1e6 },
    mib: { name: 'Mebibyte (1024² B)', symbol: 'MiB', factor: 1048576 },
    gb: { name: 'Gigabyte (1000³ B)', symbol: 'GB', factor: 1e9 },
    gib: { name: 'Gibibyte (1024³ B)', symbol: 'GiB', factor: 1073741824 },
    tb: { name: 'Terabyte (1000⁴ B)', symbol: 'TB', factor: 1e12 },
    tib: { name: 'Tebibyte (1024⁴ B)', symbol: 'TiB', factor: 1099511627776 },
  },
});

/**
 * Finds the category a unit identifier belongs to.
 * @param {string} unit
 * @returns {string|undefined}
 */
function findCategory(unit) {
  return Object.keys(UNITS).find((category) => UNITS[category][unit] !== undefined);
}

/**
 * @param {string} category
 * @param {string} unit
 * @returns {object} the unit definition
 * @throws {AppError} VALIDATION_INVALID_PARAMETER when the unit is unknown
 */
function getUnit(category, unit) {
  const units = UNITS[category];
  if (units === undefined) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_PARAMETER, {
      detail: `Unknown unit category "${category}"`,
    });
  }
  const definition = units[unit];
  if (definition === undefined) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_PARAMETER, {
      detail: `The unit "${unit}" does not belong to the category "${category}"`,
    });
  }
  return definition;
}

/**
 * Converts a value between two units of the same category.
 *
 * @param {number} value
 * @param {string} fromUnit
 * @param {string} toUnit
 * @param {object} [options]
 * @param {number} [options.precision] significant digits kept in `result`
 * @returns {{value: number, from: object, to: object, category: string, result: number, resultText: string}}
 */
function convert(value, fromUnit, toUnit, options = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_FIELD_TYPE, {
      detail: 'The field "value" must be a finite number',
    });
  }

  const sourceCategory = findCategory(fromUnit);
  const targetCategory = findCategory(toUnit);

  if (sourceCategory === undefined && targetCategory === undefined) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_PARAMETER, {
      detail: `Unknown unit "${fromUnit}" or "${toUnit}"`,
    });
  }
  if (sourceCategory !== targetCategory) {
    throw new AppError(ErrorCode.VALIDATION_INVALID_PARAMETER, {
      detail: `"${fromUnit}" and "${toUnit}" belong to different categories (${sourceCategory} and ${targetCategory})`,
    });
  }

  const source = getUnit(sourceCategory, fromUnit);
  const target = getUnit(targetCategory, toUnit);

  // Step 1: source unit -> base unit of the category
  const baseValue = value * source.factor + (source.offset || 0);
  // Step 2: base unit -> target unit
  const result = (baseValue - (target.offset || 0)) / target.factor;

  const precision = Number.isInteger(options.precision) ? options.precision : 12;
  const rounded = Number(result.toPrecision(precision));

  return {
    value,
    category: sourceCategory,
    from: { unit: fromUnit, name: source.name, symbol: source.symbol },
    to: { unit: toUnit, name: target.name, symbol: target.symbol },
    result: Object.is(rounded, -0) ? 0 : rounded,
    resultText: String(Object.is(rounded, -0) ? 0 : rounded),
  };
}

/**
 * Describes every category and unit, used by `GET /api/units`.
 * @returns {Array<object>}
 */
function describeUnits() {
  return Object.entries(CATEGORIES).map(([key, meta]) => ({
    category: key,
    name: meta.name,
    baseUnit: meta.baseUnit,
    units: Object.entries(UNITS[key]).map(([unit, definition]) => ({
      unit,
      name: definition.name,
      symbol: definition.symbol,
    })),
  }));
}

module.exports = { CATEGORIES, UNITS, convert, describeUnits, getUnit, findCategory };
