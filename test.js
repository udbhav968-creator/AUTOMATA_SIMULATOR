// Engine and grader tests:  node test.js
const A = require("./lib/automata"), Q = require("./lib/qgen"), { CASES, runCase, gradingCheck } = require("./lib/cases");
let fail = 0;
for (const c of CASES) {
  const r = runCase(A, c);
  if (!r.pass) { fail++; console.log("✗", r.name, "\n  expected:", r.exp.join(" | "), "\n  actual:  ", r.act.join(" | ")); }
}
console.log(`${CASES.length - fail}/${CASES.length} edge-case tests passed${fail ? " ✗" : " ✓"}`);

// random fuzzing: every random NFA must convert, and its DFA must agree with it
let fuzzBad = 0;
for (let i = 0; i < 300; i++) {
  const N = A.parse(A.generate({ n: 5, k: 3, eps: true, seed: i })), M = A.build(N);
  for (let k = 0; k < 40; k++) { const w = Array.from({ length: k % 7 }, (_, j) => N.alpha[(i * 7 + k * 3 + j) % N.alpha.length]); if (A.runNFA(N, w) !== A.runDFA(N, M, w)) fuzzBad++; }
  const D = A.parse(A.dfaToText(N, M)), R = A.minimizeSteps(D);
  if (!A.equivalent(D, A.parse(R.minimal.text)).ok) fuzzBad++;
}
console.log(`300 random NFAs converted and minimised: ${fuzzBad ? fuzzBad + " problems ✗" : "all consistent ✓"}`);

const g = gradingCheck(A, Q, 10), gBad = g.filter(r => r.ok !== r.n);
console.log(`Grader self-check: ${g.reduce((a, r) => a + r.ok, 0)}/${g.reduce((a, r) => a + r.n, 0)} generated questions accept their own solution${gBad.length ? " ✗" : " ✓"}`);
gBad.forEach(r => console.log("  ✗", r.label, r.difficulty, `${r.ok}/${r.n}`));
process.exit(fail || fuzzBad || gBad.length ? 1 : 0);
