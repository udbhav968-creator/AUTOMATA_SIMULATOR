const A = require("./lib/automata"), assert = require("assert");
const nfa = A.parse("start: q0\nfinal: q2\nq0,a = q0,q1\nq0,b = q0\nq1,b = q2");
const M = A.build(nfa); assert.strictEqual(M.D.length, 3); assert.strictEqual(A.minimize(nfa, M), 3);
const good = A.parse("start: A\nfinal: C\nA,a = B\nA,b = A\nB,a = B\nB,b = C\nC,a = B\nC,b = A");
assert(A.equivalent(nfa, good).ok && !A.dfaProblems(good).length);
const bad = A.parse("start: A\nfinal: C\nA,a = B\nA,b = A\nB,a = B\nB,b = C\nC,a = B\nC,b = C");
assert.deepStrictEqual(A.equivalent(nfa, bad).counter, ["a", "b", "b"].slice(0, 3));
for (let i = 0; i < 200; i++) A.build(A.parse(A.generate(5, 3, true)));
console.log("All tests passed ✓");
