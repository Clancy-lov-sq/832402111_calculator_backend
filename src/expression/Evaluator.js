'use strict';

/**
 * Expression evaluator: executes a postfix program with one stack.
 *
 * Because the parser already produced the correct order of operations, the
 * evaluator itself contains no precedence logic at all. It only has to:
 *   1. push literals and constants,
 *   2. apply operators to the top of the stack,
 *   3. call whitelisted functions,
 *   4. check the arithmetic result for the cases the assignment calls out
 *      (division by zero, domain errors, overflow).
 *
 * Complexity is O(n) in time and O(n) in space for n instructions.
 */

const { AppError, ErrorCode } = require('../utils/errors');
const { InstructionType } = require('./Parser');
const { familyOfOperator } = require('./Token');
const { getConstant, getFunction } = require('./Functions');

/** Largest magnitude accepted before a result counts as an overflow. */
const MAX_MAGNITUDE = Number.MAX_VALUE;

class Evaluator {
  /**
   * @param {object} [context]
   * @param {number} [context.ans] value of the previous result, used by `ans`
   */
  constructor(context = {}) {
    /** @type {number[]} operand stack */
    this.stack = [];
    this.context = context;
    /** Operation families that were actually used by this expression. */
    this.usedOperations = new Set();
    /** Scientific function names that were actually called. */
    this.usedFunctions = new Set();
  }

  /**
   * Runs a postfix program.
   *
   * @param {Array<object>} instructions
   * @returns {number} the single remaining value
   */
  run(instructions) {
    for (const instruction of instructions) {
      this.execute(instruction);
    }

    if (this.stack.length !== 1) {
      // A well-formed program always leaves exactly one value. Reaching this
      // line means the parser emitted an inconsistent program: a defect, not a
      // user error, so it is reported as an internal error by the API layer.
      throw new AppError(ErrorCode.INTERNAL_ERROR, {
        detail: 'The expression program did not produce exactly one result',
      });
    }

    return this.ensureFinite(this.stack[0]);
  }

  /**
   * Executes a single instruction.
   * @param {object} instruction
   */
  execute(instruction) {
    switch (instruction.type) {
      case InstructionType.NUMBER:
        this.stack.push(instruction.value);
        return;

      case InstructionType.CONSTANT:
        this.pushConstant(instruction.name);
        return;

      case InstructionType.UNARY:
        this.applyUnary(instruction.operator);
        return;

      case InstructionType.BINARY:
        this.applyBinary(instruction.operator);
        return;

      case InstructionType.CALL:
        this.applyFunction(instruction.name, instruction.argCount);
        return;

      default:
        throw new AppError(ErrorCode.INTERNAL_ERROR, {
          detail: `Unknown instruction type "${instruction.type}"`,
        });
    }
  }

  /**
   * Pushes a named constant. `ans` is resolved from the request context so a
   * user can continue from the previous result.
   * @param {string} name
   */
  pushConstant(name) {
    if (name === 'ans') {
      const ans = this.context.ans;
      if (typeof ans !== 'number' || !Number.isFinite(ans)) {
        throw new AppError(ErrorCode.VALIDATION_INVALID_PARAMETER, {
          detail: 'No previous result is available for "ans"',
        });
      }
      this.stack.push(ans);
      return;
    }

    const value = getConstant(name);
    if (value === undefined) {
      throw new AppError(ErrorCode.TOKENIZER_UNKNOWN_IDENTIFIER, {
        detail: `"${name}" is not a supported constant`,
      });
    }
    this.stack.push(value);
  }

  /**
   * Applies a unary sign to the top of the stack.
   * @param {string} operator '+' or '-'
   */
  applyUnary(operator) {
    const operand = this.pop('a unary operator');
    if (operator === '+') {
      this.stack.push(operand);
      return;
    }
    if (operator === '-') {
      this.usedOperations.add(familyOfOperator('-'));
      this.stack.push(-operand);
      return;
    }
    throw new AppError(ErrorCode.INTERNAL_ERROR, {
      detail: `Unknown unary operator "${operator}"`,
    });
  }

  /**
   * Applies a binary operator.
   *
   * The right operand is popped first: subtraction and division depend on the
   * operand order.
   *
   * @param {string} operator
   */
  applyBinary(operator) {
    const right = this.pop(`the operator "${operator}"`);
    const left = this.pop(`the operator "${operator}"`);

    switch (operator) {
      case '+':
        this.stack.push(left + right);
        break;
      case '-':
        this.stack.push(left - right);
        break;
      case '*':
        this.stack.push(left * right);
        break;
      case '/':
        if (right === 0) {
          throw new AppError(ErrorCode.EVALUATOR_DIVISION_BY_ZERO, {
            detail: `The expression "${left} / ${right}" divides by zero`,
          });
        }
        this.stack.push(left / right);
        break;
      case '%':
        if (right === 0) {
          throw new AppError(ErrorCode.EVALUATOR_DIVISION_BY_ZERO, {
            detail: 'The modulo operation cannot use a zero divisor',
          });
        }
        this.stack.push(left % right);
        break;
      case '**':
        this.stack.push(this.power(left, right));
        break;
      default:
        throw new AppError(ErrorCode.INTERNAL_ERROR, {
          detail: `Unknown binary operator "${operator}"`,
        });
    }

    this.usedOperations.add(familyOfOperator(operator));
  }

  /**
   * Computes `base ** exponent` with the domain rules of real arithmetic.
   * @param {number} base
   * @param {number} exponent
   * @returns {number}
   */
  power(base, exponent) {
    if (base < 0 && !Number.isInteger(exponent)) {
      throw new AppError(ErrorCode.EVALUATOR_DOMAIN_ERROR, {
        detail: `A negative base (${base}) requires an integer exponent, otherwise the result is not a real number`,
      });
    }
    if (base === 0 && exponent < 0) {
      throw new AppError(ErrorCode.EVALUATOR_DIVISION_BY_ZERO, {
        detail: 'Zero cannot be raised to a negative power',
      });
    }
    return base ** exponent;
  }

  /**
   * Calls a whitelisted scientific function.
   * @param {string} name
   * @param {number} argCount
   */
  applyFunction(name, argCount) {
    const definition = getFunction(name);
    if (definition === undefined) {
      throw new AppError(ErrorCode.TOKENIZER_UNKNOWN_IDENTIFIER, {
        detail: `"${name}" is not a supported function`,
      });
    }

    const args = [];
    for (let index = 0; index < argCount; index += 1) {
      args.unshift(this.pop(`the function "${name}"`));
    }

    const value = definition.fn(...args);
    this.usedFunctions.add(name);
    this.stack.push(value);
  }

  /**
   * Pops one operand and rejects an empty stack.
   * @param {string} consumer description used in the error message
   * @returns {number}
   */
  pop(consumer) {
    const value = this.stack.pop();
    if (value === undefined) {
      throw new AppError(ErrorCode.PARSER_MISSING_OPERAND, {
        detail: `An operand is missing for ${consumer}`,
      });
    }
    return this.ensureFinite(value);
  }

  /**
   * Rejects NaN and infinities.
   *
   * NaN means the operation is undefined (0/0, tan(pi/2), ...); an infinity
   * means the result left the range of a double. Both are reported as errors
   * instead of being written to the history table as a meaningless value.
   *
   * @param {number} value
   * @returns {number}
   */
  ensureFinite(value) {
    if (Number.isNaN(value)) {
      throw new AppError(ErrorCode.EVALUATOR_NOT_A_NUMBER, {
        detail: 'The operation has no numeric result',
      });
    }
    if (!Number.isFinite(value) || Math.abs(value) > MAX_MAGNITUDE) {
      throw new AppError(ErrorCode.EVALUATOR_OVERFLOW, {
        detail: 'The result is too large or too small to be represented',
      });
    }
    return value;
  }
}

/**
 * Convenience wrapper: postfix program -> number.
 *
 * @param {Array<object>} instructions
 * @param {object} [context]
 * @returns {{value: number, usedOperations: Set<string>, usedFunctions: Set<string>}}
 */
function evaluate(instructions, context = {}) {
  const evaluator = new Evaluator(context);
  const value = evaluator.run(instructions);
  return {
    value,
    usedOperations: evaluator.usedOperations,
    usedFunctions: evaluator.usedFunctions,
  };
}

module.exports = { Evaluator, evaluate };
