'use strict';
// Local security backport: fixed total AST nesting budget, not caller configurable.
const MAX_DEPTH = 128;
const refuse = () => { const e = new SyntaxError('Brace AST exceeds maximum depth (128)'); e.code = 'BRACES_MAX_DEPTH'; throw e; };
const check = ast => {
  const stack = [[ast, 0]];
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (depth > MAX_DEPTH) refuse();
    if (node && Array.isArray(node.nodes)) for (const child of node.nodes) stack.push([child, depth + 1]);
  }
};
module.exports = { MAX_DEPTH, refuse, check };
