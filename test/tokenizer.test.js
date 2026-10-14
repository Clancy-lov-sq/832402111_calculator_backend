'use strict';

/**
 * Unit tests for the tokenizer.
 *
 * Run with: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SQLITE_PATH = process.env.SQLITE_PATH || 'data/test-tokenizer.db';

const { tokenize } = require('../src/expression/Tokenizer');
const { TokenType, normalizeExpression } = require('../src/expression/Token');

/** @param {string} expression @returns {string[]} token texts */
function texts(expression, options) {
  return tokenize(expression, options).map((token) => token.text);
}

test('tokenizer: splits a simple expression into numbers and operators', () => {
  assert.deepEqual(texts('12+8'), ['12', '+', '8', '']);
});

test('tokenizer: recognises decimals, including ".5" and "5."', () => {
  assert.deepEqual(texts('0.5'), ['0.5', '']);
  assert.deepEqual(texts('.5'), ['.5', '']);
  assert.deepEqual(texts('5.'), ['5.', '']);
  assert.deepEqual(texts('12.5/2'), ['12.5', '/', '2', '']);
});

test('tokenizer: rejects a number with two decimal points', () => {
  assert.throws(() => tokenize('1.2.3'), (error) => error.code === 'TOKENIZER_INVALID_NUMBER');
});

test('tokenizer: normalises calculator symbols to API operators', () => {
  assert.deepEqual(texts('12×8'), ['12', '*', '8', '']);
  assert.deepEqual(texts('12÷8'), ['12', '/', '8', '']);
  assert.deepEqual(texts('12−8'), ['12', '-', '8', '']);
  assert.deepEqual(texts('12 ✕ 8'), ['12', '*', '8', '']);
});

test('tokenizer: strips every kind of whitespace', () => {
  assert.deepEqual(texts('  1 +\t2\n* 3 '), ['1', '+', '2', '*', '3', '']);
});

test('tokenizer: rewrites ^ and superscripts to the power operator', () => {
  assert.deepEqual(texts('2^3'), ['2', '**', '3', '']);
  assert.deepEqual(texts('2²'), ['2', '**', '2', '']);
  assert.deepEqual(texts('2³'), ['2', '**', '3', '']);
});

test('tokenizer: rejects characters that are not part of the grammar', () => {
  assert.throws(() => tokenize('1+2;'), (error) => error.code === 'TOKENIZER_INVALID_CHARACTER');
  assert.throws(() => tokenize('alert(1)'), (error) => error.code === 'TOKENIZER_UNKNOWN_IDENTIFIER');
  assert.throws(() => tokenize('1 + $2'), (error) => error.code === 'TOKENIZER_INVALID_CHARACTER');
});

test('tokenizer: rejects JavaScript that could be mistaken for a formula', () => {
  // The whole point of the tokenizer: these are not "almost valid", they are
  // simply refused, and nothing is ever executed.
  ['process.exit()', 'require("fs")', 'constructor', '__proto__', 'globalThis'].forEach((input) => {
    assert.throws(() => tokenize(input), (error) => /TOKENIZER_|PARSER_|VALIDATION_/.test(error.code));
  });
});

test('tokenizer: numbers must be literals, never expressions', () => {
  assert.throws(() => tokenize('1e5'), (error) => error.code === 'TOKENIZER_INVALID_NUMBER');
  assert.throws(() => tokenize('0x10'), (error) => error.code === 'TOKENIZER_UNKNOWN_IDENTIFIER');
  assert.throws(() => tokenize('Infinity'), (error) => error.code === 'TOKENIZER_UNKNOWN_IDENTIFIER');
});

test('tokenizer: rejects an empty expression', () => {
  assert.throws(() => tokenize(''), (error) => error.code === 'VALIDATION_EMPTY_EXPRESSION');
  assert.throws(() => tokenize('   '), (error) => error.code === 'VALIDATION_EMPTY_EXPRESSION');
});

test('tokenizer: rejects an expression that is too long', () => {
  assert.throws(
    () => tokenize('1+'.repeat(200) + '1'),
    (error) => ['VALIDATION_EXPRESSION_TOO_LONG', 'TOKENIZER_TOO_MANY_TOKENS'].includes(error.code),
  );
});

test('tokenizer: scientific names are only tokens in scientific mode', () => {
  assert.throws(() => tokenize('sqrt(9)'), (error) => error.code === 'VALIDATION_INVALID_PARAMETER');
  assert.deepEqual(texts('sqrt(9)', { allowScientific: true }), ['sqrt', '(', '9', ')', '']);
  assert.deepEqual(texts('pi', { allowScientific: true }), ['pi', '']);
});

test('tokenizer: every token carries its position for error messages', () => {
  const tokens = tokenize('12+8');
  assert.equal(tokens[0].position, 0);
  assert.equal(tokens[1].position, 2);
  assert.equal(tokens[2].position, 3);
  assert.equal(tokens[3].type, TokenType.EOF);
});

test('normalisation is exposed for reuse by the service layer', () => {
  assert.equal(normalizeExpression(' 12 × 8 '), '12*8');
  assert.equal(normalizeExpression('2²'), '2**2');
});
