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
const earlierFailed = !!(fail || fuzzBad || gBad.length);

// Question extractor: a sample tutorial sheet in mixed formats (tables, δ-notation, ∈ for ε, MCQ, design-in-words)
const X = require("./lib/extract"), fs = require("fs");
const drafts = X.extract(fs.readFileSync(__dirname + "/data/sample-question-paper.txt", "utf8"));
const ready = drafts.filter(d => d.ready);
const lang = (t, acc, rej) => { const d = drafts.find(x => x.rec.text.includes(t)); if (!d || !d.rec.reference) return false; const N = A.parse(d.rec.reference); return acc.every(w => A.runNFA(N, [...w])) && rej.every(w => !A.runNFA(N, [...w])); };
const xOk = drafts.length === 12 && ready.length === 10
  && lang("abb", ["abb", "babb"], ["ab", ""]) && lang("divisible by 3", ["", "11", "110"], ["1", "10"])
  && lang("101", ["1010", "0101"], ["101", "1100"]) && lang("do not", ["", "abab"], ["aa", "baab"])
  && ready.every(d => Q.grade(Q.fromBank(d.rec), {}).score === 0);
console.log(`Extractor: ${drafts.length} questions found, ${ready.length} ready to grade${xOk ? " ✓" : " ✗"}`);
process.exit(earlierFailed || !xOk ? 1 : 0);
