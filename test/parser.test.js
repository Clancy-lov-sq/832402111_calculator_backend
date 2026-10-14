'use strict';

/**
 * Unit tests for the parser.
 *
 * The parser is tested through the postfix program it emits, which makes the
 * operator order visible without executing anything.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SQLITE_PATH = process.env.SQLITE_PATH || 'data/test-parser.db';

const { tokenize } = require('../src/expression/Tokenizer');
const { parse } = require('../src/expression/Parser');

/**
 * @param {string} expression
 * @param {object} [options]
 * @returns {string} a compact text form of the postfix program, e.g. "1 2 +"
 */
function postfix(expression, options) {
  return parse(tokenize(expression, options), options)
    .map((instruction) => {
      if (instruction.type === 'NUMBER') {
        return String(instruction.value);
      }
      if (instruction.type === 'CONSTANT') {
        return instruction.name;
      }
      if (instruction.type === 'CALL') {
        return `${instruction.name}/${instruction.argCount}`;
      }
      return instruction.operator;
    })
    .join(' ');
}

test('parser: multiplication is emitted before addition (precedence)', () => {
  assert.equal(postfix('1+2*3'), '1 2 3 * +');
  assert.equal(postfix('10/2+7'), '10 2 / 7 +');
  assert.equal(postfix('8-3*2'), '8 3 2 * -');
});

test('parser: parentheses change the order of operations', () => {
  assert.equal(postfix('(1+2)*3'), '1 2 + 3 *');
  assert.equal(postfix('2*(3+(4-1))'), '2 3 4 1 - + *');
});

test('parser: unary signs are recognised where an operand is expected', () => {
  assert.equal(postfix('-5'), '5 -');
  assert.equal(postfix('-5+8'), '5 - 8 +');
  assert.equal(postfix('3*-2'), '3 2 - *');
  assert.equal(postfix('+7'), '7 +');
  assert.equal(postfix('--5'), '5 - -');
  assert.equal(postfix('(-3)*-2'), '3 - 2 - *');
});

test('parser: a minus after a value stays a binary subtraction', () => {
  assert.equal(postfix('8-3'), '8 3 -');
  assert.equal(postfix('8-3-2'), '8 3 - 2 -');
});

test('parser: power is right associative', () => {
  assert.equal(postfix('2**3**2'), '2 3 2 ** **');
});

test('parser: a power is applied before a leading unary sign', () => {
  // -2**2 is -(2**2) = -4: the same rule as spreadsheets and scientific
  // calculators that have a separate negation key.
  assert.equal(postfix('-2**2'), '2 2 ** -');
  assert.equal(postfix('(-2)**2'), '2 - 2 **');
});

test('parser: implicit multiplication is supported for parentheses and constants', () => {
  assert.equal(postfix('2(3+4)'), '2 3 4 + *');
  assert.equal(postfix('(1+2)(3+4)'), '1 2 + 3 4 + *');
  assert.equal(postfix('2pi', { allowScientific: true }), '2 pi *');
});

test('parser: scientific functions carry their arity', () => {
  assert.equal(postfix('sqrt(9)', { allowScientific: true }), '9 sqrt/1');
  assert.equal(postfix('pow(2,10)', { allowScientific: true }), '2 10 pow/2');
});

test('parser: rejects an incomplete expression', () => {
  assert.throws(() => parse(tokenize('1+')), (error) => error.code === 'PARSER_TRAILING_OPERATOR');
  assert.throws(() => parse(tokenize('*2')), (error) => error.code === 'PARSER_MISSING_OPERAND');
  assert.throws(() => parse(tokenize('1+*2')), (error) => error.code === 'PARSER_MISSING_OPERAND');
  assert.throws(() => parse(tokenize('()')), (error) => error.code === 'PARSER_MISSING_OPERAND');
});

test('parser: rejects unmatched parentheses', () => {
  assert.throws(() => parse(tokenize('(1+2')), (error) => error.code === 'PARSER_UNMATCHED_PARENTHESIS');
  assert.throws(() => parse(tokenize('1+2)')), (error) => error.code === 'PARSER_UNMATCHED_PARENTHESIS');
});

test('parser: rejects two operands without an operator', () => {
  // Whitespace is removed during normalisation, so "2 3" is simply the number
  // 23; the real cases are a parenthesised value followed by another value.
  assert.equal(postfix('2 3'), '23');
  assert.throws(() => parse(tokenize('(1+2) 3')), (error) => error.code === 'PARSER_MISSING_OPERATOR');
  assert.throws(
    () => parse(tokenize('sqrt(4) 2', { allowScientific: true }), { allowScientific: true }),
    (error) => error.code === 'PARSER_SYNTAX_ERROR',
  );
});

test('parser: rejects a wrong number of function arguments', () => {
  assert.throws(
    () => parse(tokenize('sin(1,2)', { allowScientific: true }), { allowScientific: true }),
    (error) => error.code === 'PARSER_INVALID_FUNCTION_CALL',
  );
  assert.throws(
    () => parse(tokenize('pow(2)', { allowScientific: true }), { allowScientific: true }),
    (error) => error.code === 'PARSER_INVALID_FUNCTION_CALL',
  );
});

test('parser: rejects deeply nested expressions (resource limit)', () => {
  const expression = `${'('.repeat(40)}1${')'.repeat(40)}`;
  assert.throws(
    () => parse(tokenize(expression)),
    (error) => error.code === 'PARSER_NESTING_TOO_DEEP',
  );
});
