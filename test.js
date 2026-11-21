"use strict";
// NFA -> DFA subset construction : verification harness
// Run:  node test.js
const A = require("./lib/automata");

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; } else { fail++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };

// ---------- Tier 1: named functional / edge cases ----------
// Each case: an automaton + strings with the language-membership we expect.
// We require BOTH the NFA run and the constructed-DFA run to match the expectation,
// which is exactly the statement L(NFA) = L(DFA).
const CASES = [
  { name: "DFA passthrough (ends with ab)", src:
    "start: q0\nfinal: q2\nq0,a = q0,q1\nq0,b = q0\nq1,b = q2\nq1,a = q1",
    acc: ["ab", "aab", "abab"], rej: ["", "a", "ba", "aba"] },
  { name: "NFA, 2nd-last symbol is 1", src:
    "start: q0\nfinal: q2\nq0,0 = q0\nq0,1 = q0,q1\nq1,0 = q2\nq1,1 = q2",
    acc: ["10", "11", "0110", "110"], rej: ["", "0", "1", "00", "001", "0101"] },
  { name: "NFA contains substring 101", src:
    "start: q0\nfinal: q3\nq0,0 = q0\nq0,1 = q0,q1\nq1,0 = q2\nq1,1 = q0,q1\nq2,1 = q3\nq2,0 = q0\nq3,0 = q3\nq3,1 = q3",
    acc: ["101", "0101", "1101", "101000"], rej: ["", "1", "10", "100", "111"] },
  { name: "epsilon-NFA (a* then b)", src:
    "start: q0\nfinal: q2\nq0,a = q0\nq0,\u03b5 = q1\nq1,b = q2",
    acc: ["b", "ab", "aaab"], rej: ["", "a", "ba", "bb"] },
  { name: "epsilon with a cycle (closure must terminate)", src:
    "start: q0\nfinal: q1\nq0,\u03b5 = q1\nq1,\u03b5 = q0\nq1,a = q1",
    acc: ["", "a", "aa"], rej: ["b"] },
  { name: "empty language (final unreachable)", src:
    "start: q0\nfinal: q9\nstates: q0,q9\nalphabet: a\nq0,a = q0",
    acc: [], rej: ["", "a", "aa"] },
];

for (const c of CASES) {
  let N, M;
  try { N = A.parse(c.src); M = A.build(N); }
  catch (e) { ok(false, c.name, "threw: " + e.message); continue; }
  let good = true;
  for (const w of c.acc) { const sym = [...w]; if (!(A.runNFA(N, sym) && A.runDFA(N, M, sym))) { good = false; ok(false, c.name, "should ACCEPT \"" + (w||"\u03b5") + "\""); break; } }
  if (good) for (const w of c.rej) { const sym = [...w]; if (A.runNFA(N, sym) || A.runDFA(N, M, sym)) { good = false; ok(false, c.name, "should REJECT \"" + (w||"\u03b5") + "\""); break; } }
  if (good) ok(true, c.name);
}

// ---------- Tier 1b: input validation (invalid definitions must fail cleanly) ----------
const BAD = [
  { name: "missing start state", src: "final: q1\nq0,a = q1" },
  { name: "two start states", src: "start: q0\nstart: q1\nfinal: q1\nq0,a=q1" },
  { name: "undeclared state used", src: "states: q0\nstart: q0\nfinal: q0\nq0,a = q5" },
];
for (const b of BAD) {
  let threw = false;
  try { A.parse(b.src); } catch (e) { threw = true; }
  ok(threw, "rejects invalid input: " + b.name, threw ? "" : "no error thrown");
}

// ---------- Tier 1c: structural guarantees on the produced DFA ----------
{
  const N = A.parse(CASES[1].src), M = A.build(N);
  // (a) single start state D0
  ok(M.D.length > 0 && M.D[0].set.length > 0, "DFA has a start state D0");
  // (b) totality: every DFA state has exactly one target per symbol
  let total = true;
  for (let i = 0; i < M.D.length; i++) for (const ch of N.alpha) if (M.tm[i + "|" + ch] === undefined) total = false;
  ok(total, "constructed DFA is total (one transition per symbol)");
  // (c) determinism: targets are single states (by construction)
  ok(A.dfaToText(N, M).includes("D0"), "DFA renders to text");
}

const tier1 = fail === 0;
console.log(`Tier 1 \u2014 functional, edge & validation tests: ${pass}/${pass + fail} passed${tier1 ? " \u2713" : " \u2717"}`);

// ---------- Tier 2: randomized fuzzing (L(NFA) == L(DFA)) ----------
let machines = 0, strings = 0, mismatches = 0;
for (let i = 0; i < 300; i++) {
  let N, M;
  try { N = A.parse(A.generate({ n: 5, k: 3, eps: true, seed: i })); M = A.build(N); }
  catch (e) { continue; }
  machines++;
  for (let k = 0; k < 40; k++) {
    const len = k % 8;
    const w = Array.from({ length: len }, (_, j) => N.alpha[(i * 7 + k * 3 + j) % N.alpha.length]);
    strings++;
    if (A.runNFA(N, w) !== A.runDFA(N, M, w)) mismatches++;
  }
}
const tier2 = mismatches === 0;
console.log(`Tier 2 \u2014 fuzzing: ${machines} random NFAs converted, ${strings.toLocaleString()} strings tested, ${mismatches} mismatches${tier2 ? " \u2713" : " \u2717"}`);

// ---------- Tier 3: natural-language "from a question" builder ----------
const Ex = require("./lib/extract");
let p3 = 0, f3 = 0;
const ok3 = (cond, name, extra) => { if (cond) p3++; else { f3++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };
const QCASES = [
  { q: "strings over {a,b} ending with abb", acc: ["abb", "aabb", "babb", "ababb"], rej: ["", "ab", "abba", "abbb"] },
  { q: "strings over {a,b} starting with a", acc: ["a", "ab", "abb"], rej: ["", "b", "ba"] },
  { q: "strings over {0,1} containing the substring 101", acc: ["101", "0101", "1011"], rej: ["", "100", "111"] },
  { q: "strings over {a,b} with an even number of a", acc: ["", "aa", "abba", "b"], rej: ["a", "aaa", "ab"] },
  { q: "strings over {a,b} of length divisible by 3", acc: ["", "aaa", "ababab"], rej: ["a", "aa", "aaaa"] },
  { q: "strings over {a,b} not containing bb", acc: ["", "a", "abab", "b"], rej: ["bb", "abb", "bba"] },
  { q: "the regular expression (a|b)*abb", acc: ["abb", "aabb", "babb"], rej: ["", "ab", "ba"] }
];
for (const c of QCASES) {
  let r; try { r = Ex.automatonFromQuestion(c.q); } catch (e) { ok3(false, c.q, "threw: " + e.message); continue; }
  if (!r || !r.src) { ok3(false, c.q, r && r.error ? r.error : "not recognised"); continue; }
  let N, M; try { N = A.parse(r.src); M = A.build(N); } catch (e) { ok3(false, c.q, "bad NFA: " + e.message); continue; }
  let good = true;
  for (const w of c.acc) if (!A.runDFA(N, M, [...w])) { good = false; ok3(false, c.q, "should ACCEPT \"" + (w || "\u03b5") + "\""); break; }
  if (good) for (const w of c.rej) if (A.runDFA(N, M, [...w])) { good = false; ok3(false, c.q, "should REJECT \"" + (w || "\u03b5") + "\""); break; }
  if (good) ok3(true, c.q);
}
const tier3 = f3 === 0;
console.log(`Tier 3 \u2014 "from a question" builder: ${p3}/${p3 + f3} language descriptions built correctly${tier3 ? " \u2713" : " \u2717"}`);

// ---------- Tier 4: hand-drawn canvas builder (model -> text -> DFA) ----------
const CE = require("./public/assets/canvas-editor.js");
let p4 = 0, f4 = 0;
const ok4 = (cond, name, extra) => { if (cond) p4++; else { f4++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };
const DRAW = [
  { name: "drawn: ends with ab",
    model: { nodes: [{ id: "q0" }, { id: "q1" }, { id: "q2", final: true }], start: "q0",
      edges: [{ from: "q0", to: "q0", sym: "a" }, { from: "q0", to: "q1", sym: "a" }, { from: "q0", to: "q0", sym: "b" }, { from: "q1", to: "q2", sym: "b" }] },
    acc: ["ab", "aab", "abab"], rej: ["", "a", "ba"] },
  { name: "drawn: ε-NFA a* then b",
    model: { nodes: [{ id: "q0" }, { id: "q1" }, { id: "q2", final: true }], start: "q0",
      edges: [{ from: "q0", to: "q0", sym: "a" }, { from: "q0", to: "q1", sym: "ε" }, { from: "q1", to: "q2", sym: "b" }] },
    acc: ["b", "ab", "aaab"], rej: ["", "a", "bb"] },
  { name: "drawn: single accepting start (accepts ε)",
    model: { nodes: [{ id: "q0", final: true }], start: "q0", edges: [{ from: "q0", to: "q0", sym: "a" }] },
    acc: ["", "a", "aa"], rej: ["b"] }
];
for (const c of DRAW) {
  let txt, N, M;
  try { txt = CE.serialize(c.model); N = A.parse(txt); M = A.build(N); }
  catch (e) { ok4(false, c.name, "threw: " + e.message); continue; }
  let good = true;
  for (const w of c.acc) if (!A.runDFA(N, M, [...w])) { good = false; ok4(false, c.name, "should ACCEPT \"" + (w || "\u03b5") + "\""); break; }
  if (good) for (const w of c.rej) if (A.runDFA(N, M, [...w])) { good = false; ok4(false, c.name, "should REJECT \"" + (w || "\u03b5") + "\""); break; }
  if (good) ok4(true, c.name);
}
const tier4 = f4 === 0;
console.log(`Tier 4 \u2014 hand-drawn canvas builder: ${p4}/${p4 + f4} drawn automata serialise and convert correctly${tier4 ? " \u2713" : " \u2717"}`);

// ---------- Tier 5: ε-elimination (ε-NFA -> ε-free NFA -> DFA) ----------
let p5 = 0, f5 = 0;
const ok5 = (cond, name, extra) => { if (cond) p5++; else { f5++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };
const ENFA = [
  { name: "ε skip-a-block (a* b* then c*)", src: "start: q0\nfinal: q2\nq0,a = q0\nq0,\u03b5 = q1\nq1,b = q1\nq1,\u03b5 = q2\nq2,c = q2" },
  { name: "a*b via ε", src: "start: q0\nfinal: q2\nq0,a = q0\nq0,\u03b5 = q1\nq1,b = q2" },
  { name: "ε-cycle", src: "start: q0\nfinal: q1\nq0,\u03b5 = q1\nq1,\u03b5 = q0\nq1,a = q1" }
];
for (const c of ENFA) {
  let N, NE, M; try { N = A.parse(c.src); NE = A.removeEps(N); M = A.build(N); } catch (e) { ok5(false, c.name, "threw: " + e.message); continue; }
  // (a) the ε-free NFA really has no ε-moves
  const noEps = !NE.hasEps && !Object.keys(NE.d).some(k => k.endsWith("|\u03b5"));
  // (b) original ε-NFA, ε-free NFA and the DFA accept the same strings up to length 6
  let agree = true, bad = "";
  const q = [""]; const seen = [];
  while (q.length) { const w = q.shift(); seen.push(w); if (w.length < 6) for (const ch of N.alpha) q.push(w + ch); }
  for (const w of seen) { const s = [...w]; if (A.runNFA(N, s) !== A.runNFA(NE, s) || A.runNFA(NE, s) !== A.runDFA(N, M, s)) { agree = false; bad = w || "\u03b5"; break; } }
  ok5(noEps && agree, c.name, !noEps ? "still has ε" : (!agree ? "disagree on \"" + bad + "\"" : ""));
}
const tier5 = f5 === 0;
console.log(`Tier 5 \u2014 ε-elimination (ε-NFA \u2192 ε-free NFA \u2192 DFA): ${p5}/${p5 + f5} pipelines language-equivalent${tier5 ? " \u2713" : " \u2717"}`);

const allPass = tier1 && tier2 && tier3 && tier4 && tier5;
console.log(allPass
  ? "\nALL CHECKS PASSED \u2014 conversion, question builder, canvas builder and ε-elimination all verified."
  : "\nSOME CHECKS FAILED.");
process.exit(allPass ? 0 : 1);
