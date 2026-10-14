'use strict';

/**
 * Unit tests for the calculator facade: the numbers produced by the whole
 * pipeline (tokenizer -> parser -> evaluator -> formatter).
 *
 * Every row of the "core flow" table in the assignment blog is covered here, so
 * the blog table and the test suite cannot disagree.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SQLITE_PATH = process.env.SQLITE_PATH || 'data/test-calculator.db';

const { calculate, describeKind } = require('../src/expression/Calculator');

/**
 * @param {string} expression
 * @param {object} [options]
 * @returns {number}
 */
function value(expression, options) {
  return calculate(expression, options).value;
}

/** @param {string} expression @param {object} [options] @returns {string} */
function code(expression, options) {
  try {
    calculate(expression, options);
    return 'NO_ERROR';
  } catch (error) {
    return error.code;
  }
}

test('calculator: the four basic operations', () => {
  assert.equal(value('12+8'), 20);
  assert.equal(value('20-7'), 13);
  assert.equal(value('6*7'), 42);
  assert.equal(value('84/12'), 7);
  assert.equal(value('12×8'), 96);
  assert.equal(value('12÷8'), 1.5);
});

test('calculator: decimals', () => {
  assert.equal(value('12.5/2'), 6.25);
  assert.equal(value('0.1+0.2'), 0.3); // rounded to 12 significant digits
  assert.equal(value('.5+.25'), 0.75);
  assert.equal(value('1.5*1.5'), 2.25);
});

test('calculator: compound expressions follow mathematical rules', () => {
  assert.equal(value('1+2*3'), 7);
  assert.equal(value('(1+2)*3'), 9);
  assert.equal(value('10/2+7'), 12);
  assert.equal(value('8-3*2'), 2);
  assert.equal(value('100/(4*5)'), 5);
  assert.equal(value('((2+3)*(7-4))/5'), 3);
});

test('calculator: unary plus and minus', () => {
  assert.equal(value('-5'), -5);
  assert.equal(value('-5+8'), 3);
  assert.equal(value('3*-2'), -6);
  assert.equal(value('+7'), 7);
  assert.equal(value('--5'), 5);
  assert.equal(value('-3*-4'), 12);
});

test('calculator: power and modulo', () => {
  assert.equal(value('2**10'), 1024);
  assert.equal(value('2^8'), 256);
  assert.equal(value('2**3**2'), 512);
  assert.equal(value('17%5'), 2);
  // A power is applied before a leading sign, so -2**2 is -(2**2).
  assert.equal(value('-2**2'), -4);
  assert.equal(value('(-2)**2'), 4);
});

test('calculator: scientific functions and constants', () => {
  const options = { scientific: true };
  assert.equal(value('sqrt(144)', options), 12);
  assert.equal(value('abs(-7.5)', options), 7.5);
  assert.equal(value('pow(2,10)', options), 1024);
  assert.equal(value('round(2.6)', options), 3);
  assert.equal(value('max(3,7)', options), 7);
  assert.equal(value('hypot(3,4)', options), 5);
  assert.ok(Math.abs(value('sin(0)', options)) < 1e-12);
  assert.ok(Math.abs(value('cos(0)', options) - 1) < 1e-12);
  assert.ok(Math.abs(value('ln(e)', options) - 1) < 1e-12);
  assert.ok(Math.abs(value('pi', options) - Math.PI) < 1e-12);
});

test('calculator: the previous result is reachable through "ans"', () => {
  assert.equal(value('ans*2', { scientific: true, ans: 21 }), 42);
});

test('calculator: division by zero is refused', () => {
  assert.equal(code('10/0'), 'EVALUATOR_DIVISION_BY_ZERO');
  assert.equal(code('10/(3-3)'), 'EVALUATOR_DIVISION_BY_ZERO');
  assert.equal(code('0/0'), 'EVALUATOR_DIVISION_BY_ZERO');
  assert.equal(code('5%0'), 'EVALUATOR_DIVISION_BY_ZERO');
  assert.equal(code('0**-1'), 'EVALUATOR_DIVISION_BY_ZERO');
});

test('calculator: domain errors are refused', () => {
  const scientific = { scientific: true };
  assert.equal(code('sqrt(-4)', scientific), 'EVALUATOR_DOMAIN_ERROR');
  assert.equal(code('ln(0)', scientific), 'EVALUATOR_DOMAIN_ERROR');
  assert.equal(code('log(-1)', scientific), 'EVALUATOR_DOMAIN_ERROR');
  assert.equal(code('asin(2)', scientific), 'EVALUATOR_DOMAIN_ERROR');
  assert.equal(code('(-8)**0.5', scientific), 'EVALUATOR_DOMAIN_ERROR');
});

test('calculator: invalid expressions are refused with a classified code', () => {
  assert.equal(code('1+*2'), 'PARSER_MISSING_OPERAND');
  assert.equal(code('(1+2'), 'PARSER_UNMATCHED_PARENTHESIS');
  assert.equal(code('1++'), 'PARSER_TRAILING_OPERATOR');
  assert.equal(code('abc'), 'TOKENIZER_UNKNOWN_IDENTIFIER');
  assert.equal(code('1+2;'), 'TOKENIZER_INVALID_CHARACTER');
  assert.equal(code(''), 'VALIDATION_EMPTY_EXPRESSION');
});

test('calculator: overflow is reported instead of returning Infinity', () => {
  assert.equal(code('9**9**9'), 'EVALUATOR_OVERFLOW');
  assert.equal(code('1e'), 'TOKENIZER_INVALID_NUMBER');
});

test('calculator: the operation family is derived from the used operators', () => {
  const addition = calculate('12+8');
  assert.deepEqual(addition.usedOperations, ['addition']);
  assert.equal(describeKind(addition.usedOperations, addition.usedFunctions), 'addition');

  const compound = calculate('1+2*3');
  assert.equal(describeKind(compound.usedOperations, compound.usedFunctions), 'compound');

  const scientific = calculate('sqrt(9)', { scientific: true });
  assert.equal(describeKind(scientific.usedOperations, scientific.usedFunctions), 'scientific');

  const plain = calculate('-5');
  assert.equal(describeKind(plain.usedOperations, plain.usedFunctions), 'subtraction');
});

test('calculator: results are rounded to 12 significant digits', () => {
  assert.equal(calculate('2/3').resultText, '0.666666666667');
  assert.equal(calculate('1/3').resultText, '0.333333333333');
  assert.equal(calculate('0.1+0.2').resultText, '0.3');
});

test('calculator: the normalised expression is echoed back', () => {
  assert.equal(calculate(' 12 × 8 ').normalizedExpression, '12*8');
  assert.equal(calculate('2²').normalizedExpression, '2**2');
});
