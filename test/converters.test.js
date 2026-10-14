'use strict';

/**
 * Unit tests for the extended conversion features.
 *
 * These functions are independent from the expression engine, so they are tested
 * separately: a failure here can never be caused by the tokenizer or parser.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SQLITE_PATH = process.env.SQLITE_PATH || 'data/test-converters.db';

const baseConverter = require('../src/services/baseConverter');
const unitConverter = require('../src/services/unitConverter');

test('base: decimal to binary, octal and hexadecimal', () => {
  assert.equal(baseConverter.fromDecimal(255, 2).result, '11111111');
  assert.equal(baseConverter.fromDecimal(255, 8).result, '377');
  assert.equal(baseConverter.fromDecimal(255, 16).result, 'ff');
  assert.equal(baseConverter.fromDecimal(255, 36).result, '73');
});

test('base: zero and negative values', () => {
  assert.equal(baseConverter.fromDecimal(0, 2).result, '0');
  assert.equal(baseConverter.fromDecimal(-42, 16).result, '-2a');
});

test('base: fractional values', () => {
  assert.equal(baseConverter.fromDecimal(10.5, 2).result, '1010.1');
  assert.equal(baseConverter.fromDecimal(0.625, 2).result, '0.101');
});

test('base: large integers keep every digit thanks to BigInt', () => {
  // 2^60 is far beyond Number.MAX_SAFE_INTEGER; the string must still be exact.
  assert.equal(baseConverter.fromDecimal(2 ** 60, 2).result, '1'.padEnd(61, '0'));
  assert.equal(baseConverter.fromDecimal(9007199254740991, 16).result, '1fffffffffffff');
});

test('base: text in another base to decimal', () => {
  assert.equal(baseConverter.toDecimal('ff', 16).value, 255);
  assert.equal(baseConverter.toDecimal('FF', 16).value, 255);
  assert.equal(baseConverter.toDecimal('1010.1', 2).value, 10.5);
  assert.equal(baseConverter.toDecimal('777', 8).value, 511);
});

test('base: an invalid digit for the base is refused', () => {
  assert.throws(() => baseConverter.toDecimal('12', 2), (error) => error.code === 'TOKENIZER_INVALID_NUMBER');
  assert.throws(() => baseConverter.toDecimal('zz', 16), (error) => error.code === 'TOKENIZER_INVALID_NUMBER');
  assert.throws(() => baseConverter.toDecimal('1.2.3', 10), (error) => error.code === 'TOKENIZER_INVALID_NUMBER');
});

test('base: an unsupported base is refused', () => {
  assert.throws(() => baseConverter.fromDecimal(10, 7), (error) => error.code === 'VALIDATION_INVALID_BASE');
  assert.throws(() => baseConverter.toDecimal('10', 7), (error) => error.code === 'VALIDATION_INVALID_BASE');
});

test('unit: length conversions use the SI base unit', () => {
  assert.equal(unitConverter.convert(1, 'km', 'm').result, 1000);
  assert.equal(unitConverter.convert(1, 'in', 'cm').resultText, '2.54');
  assert.equal(unitConverter.convert(1, 'mi', 'km').resultText, '1.609344');
  assert.equal(unitConverter.convert(1, 'm', 'ft').resultText, '3.28083989501');
});

test('unit: temperature uses the affine rule', () => {
  assert.equal(unitConverter.convert(0, '°c', '°f').result, 32);
  assert.equal(unitConverter.convert(100, '°c', '°f').result, 212);
  assert.equal(unitConverter.convert(0, '°c', 'k').result, 273.15);
  assert.equal(unitConverter.convert(-40, '°c', '°f').result, -40);
  assert.equal(unitConverter.convert(98.6, '°f', '°c').resultText, '37');
});

test('unit: mass, volume, data and speed', () => {
  assert.equal(unitConverter.convert(1, 'kg', 'lb').resultText, '2.20462262185');
  assert.equal(unitConverter.convert(2, 'l', 'ml').result, 2000);
  assert.equal(unitConverter.convert(1, 'gib', 'mib').result, 1024);
  assert.equal(unitConverter.convert(1, 'gb', 'mb').result, 1000);
  assert.equal(unitConverter.convert(100, 'km/h', 'm/s').resultText, '27.7777777778');
});

test('unit: units of different categories cannot be mixed', () => {
  assert.throws(
    () => unitConverter.convert(1, 'kg', 'm'),
    (error) => error.code === 'VALIDATION_INVALID_PARAMETER',
  );
  assert.throws(
    () => unitConverter.convert(1, 'stone', 'kg'),
    (error) => error.code === 'VALIDATION_INVALID_PARAMETER',
  );
});

test('unit: describeUnits exposes every category for the front end', () => {
  const categories = unitConverter.describeUnits();
  assert.ok(categories.length >= 8);
  categories.forEach((category) => {
    assert.equal(typeof category.name, 'string');
    assert.ok(category.units.length > 0);
  });
});
