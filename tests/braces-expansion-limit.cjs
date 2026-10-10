'use strict';
// GHSA-vfj7-8cjw-p6xm regression for the locally vendored braces 3.0.3 backport
// (vendor/security-backports/braces-3.0.3.tgz, installed via file: + $braces override).
// Vectors mirror the vetted advisory harness (advisory-semantic.cjs, braces branch).
// All hostile vectors are bounded (fixed depth), so the baseline 3.0.3 they replace
// fails fast with a bounded rejection/RangeError — never an unbounded OOM run.
const assert = require('node:assert/strict');
const braces = require('braces');

const bounded = err => err instanceof SyntaxError && err.code === 'BRACES_MAX_DEPTH';

// 1) Bounded rejection of deeply nested brace groups at a fixed
//    depth ceiling, for every API surface, instead of unbounded recursion.
for (const mode of ['compile', 'expand', 'stringify']) {
  const hostile = '{'.repeat(4000) + 'x' + '}'.repeat(4000);
  assert.throws(() => braces[mode](hostile), bounded, `${mode}: bounded rejection, not engine RangeError`);
  let ast = { type: 'text', value: 'x' };
  for (let i = 0; i < 300; i++) ast = { type: 'root', nodes: [ast] };
  assert.throws(() => braces[mode](ast), bounded, `${mode}: direct AST bypass refused`);
}
assert.throws(() => braces.parse('('.repeat(4000) + 'x' + ')'.repeat(4000)), bounded);

// 2) No user-supplied option can lift the fixed resource boundary.
assert.throws(
  () => braces.compile('{'.repeat(4000) + 'x' + '}'.repeat(4000), { maxDepth: Infinity }),
  bounded
);

// 3) Normal semantics are unchanged (no unrelated behavior regressions).
assert.equal(braces.compile('a/{b,c}/d'), 'a/(b|c)/d');
assert.deepEqual(braces.expand('file{1..3}.txt'), ['file1.txt', 'file2.txt', 'file3.txt']);
assert.equal(braces.stringify(braces.parse('a/{b,c}/d')), 'a/{b,c}/d');
assert.deepEqual(braces.expand('{a,{b,c}}'), ['a', 'b', 'c']);
assert.equal(braces.compile('\\{literal\\}'), '{literal}');
assert.equal(braces.compile('"{literal}"'), '{literal}');
assert.doesNotThrow(() => braces.compile('{'.repeat(100) + 'x' + '}'.repeat(100)));

// 4) Shallow nested multiplicative expansion still works correctly.
assert.deepEqual(braces.expand('a/{b,c}/{x,y}'), ['a/b/x', 'a/b/y', 'a/c/x', 'a/c/y']);

console.log('braces bounded parsing and normal compile/expand/stringify semantics PASS');

