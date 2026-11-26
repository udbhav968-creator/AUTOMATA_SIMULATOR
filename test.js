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

// ---------- Tier 6: detailed step-by-step ε-elimination simulation (buildEpsElimination) ----------
let p6 = 0, f6 = 0;
const ok6 = (cond, name, extra) => { if (cond) p6++; else { f6++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };
for (const c of ENFA) {
  let N, elim;
  try {
    N = A.parse(c.src);
    elim = A.buildEpsElimination(N);
  } catch (e) {
    ok6(false, c.name, "threw: " + e.message);
    continue;
  }
  const hasOverview = elim.steps.some(s => s.type === "overview");
  const hasClosures = N.states.every(q => elim.steps.some(s => s.type === "closure" && s.state === q));
  const hasTransitions = N.states.every(q => N.alpha.every(a => elim.steps.some(s => s.type === "trans" && s.state === q && s.sym === a)));
  const noEps = !elim.NE.hasEps && !Object.keys(elim.NE.d).some(k => k.endsWith("|\u03b5"));
  const correctFinals = N.states.every(q => {
    const cl = A.closure(N, [q]);
    const reachesFin = cl.some(s => N.finals.includes(s));
    return elim.finalNotes[q].isFinal === reachesFin;
  });

  ok6(hasOverview && hasClosures && hasTransitions && noEps && correctFinals,
    `buildEpsElimination: ${c.name} produces complete minute step log (${elim.steps.length} steps)`);
}
const tier6 = f6 === 0;
console.log(`Tier 6 \u2014 minute step-by-step ε-elimination: ${p6}/${p6 + f6} pass${tier6 ? " \u2713" : " \u2717"}`);

// ---------- Tier 7: Edge cases, case-insensitivity, and structural invariants ----------
let p7 = 0, f7 = 0;
const ok7 = (cond, name, extra) => { if (cond) p7++; else { f7++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };
{
  // (a) uppercase E as epsilon
  const nE = A.parse("start: q0\nfinal: q1\nq0,E = q1\nq1,a = q1");
  ok7(nE.hasEps && !nE.alpha.includes("E"), "parses uppercase 'E' as ε-transition");

  // (b) uppercase EPS and LAMBDA as epsilon
  const nEps = A.parse("start: q0\nfinal: q1\nq0,EPS = q1\nq1,LAMBDA = q2\nfinal: q2");
  ok7(nEps.hasEps && !nEps.alpha.includes("EPS") && !nEps.alpha.includes("LAMBDA"), "parses uppercase 'EPS' and 'LAMBDA' as ε-transitions");

  // (c) case-insensitive empty words Phi, NULL, none
  const nEmpty = A.parse("start: q0\nfinal: q1\nq0,a = Phi\nq0,b = NULL\nq0,c = q1");
  ok7((nEmpty.d["q0|a"] || new Set()).size === 0 && (nEmpty.d["q0|b"] || new Set()).size === 0, "parses Phi and NULL as empty set ∅");

  // (d) single accepting state accepting empty string
  const nSingle = A.parse("start: q0\nfinal: q0\nq0,a = q0");
  const mSingle = A.build(nSingle);
  ok7(A.runNFA(nSingle, []) && A.runDFA(nSingle, mSingle, []), "single accepting state accepts ε");

  // (e) total DFA transitions invariant: exactly |D| * |alpha| transitions
  const totalExpected = mSingle.D.length * nSingle.alpha.length;
  let countTrans = 0;
  for (let i = 0; i < mSingle.D.length; i++) for (const c of nSingle.alpha) if (mSingle.tm[i + "|" + c] !== undefined) countTrans++;
  ok7(countTrans === totalExpected, "totality invariant: every DFA state has a transition for every alphabet symbol");

  // (f) dead state absorption: once in dead state, all transitions loop to dead state
  const nNeedsDead = A.parse("start: q0\nfinal: q1\nq0,a = q1\nq0,b = q0"); // q1 has no transitions
  const mNeedsDead = A.build(nNeedsDead);
  const deadIdx = mNeedsDead.D.findIndex(d => d.dead);
  let deadLoops = deadIdx !== -1;
  if (deadIdx !== -1) {
    for (const c of nNeedsDead.alpha) {
      if (mNeedsDead.tm[deadIdx + "|" + c] !== deadIdx) deadLoops = false;
    }
  }
  ok7(deadLoops, "dead/trap state exists and all transitions loop back to it");
}
const tier7 = f7 === 0;
console.log(`Tier 7 \u2014 edge cases, case-insensitivity & invariants: ${p7}/${p7 + f7} pass${tier7 ? " \u2713" : " \u2717"}`);

// ---------- Tier 8: Thompson's regex-to-NFA equivalence suite ----------
let p8 = 0, f8 = 0;
const ok8 = (cond, name, extra) => { if (cond) p8++; else { f8++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };
const REGEX_CASES = [
  { re: "(a|b)*abb", acc: ["abb", "aabb", "babb", "ababb"], rej: ["", "ab", "ba", "bb"] },
  { re: "a*b*c*", acc: ["", "a", "b", "c", "abc", "aaabbbccc"], rej: ["ba", "ca", "cb"] },
  { re: "(0|1)*01", acc: ["01", "001", "101", "1101"], rej: ["", "0", "1", "10", "00"] },
  { re: "a+b", acc: ["a", "b"], rej: ["", "ab", "ba", "aa"] },
  { re: "a?b", acc: ["b", "ab"], rej: ["", "a", "aab", "ba"] },
  { re: "a|b|c", acc: ["a", "b", "c"], rej: ["", "ab", "bc", "d"] }
];
for (const rc of REGEX_CASES) {
  let r, N, M;
  try {
    r = A.regexToNFA(rc.re);
    N = A.parse(r.text);
    M = A.build(N);
  } catch (e) {
    ok8(false, rc.re, "threw: " + e.message);
    continue;
  }
  let good = true;
  for (const w of rc.acc) {
    const s = [...w];
    if (!(A.runNFA(N, s) && A.runDFA(N, M, s))) { good = false; ok8(false, rc.re, "should accept: " + (w || "ε")); break; }
  }
  if (good) for (const w of rc.rej) {
    const s = [...w];
    if (A.runNFA(N, s) || A.runDFA(N, M, s)) { good = false; ok8(false, rc.re, "should reject: " + (w || "ε")); break; }
  }
  if (good) ok8(true, `Thompson ε-NFA for "${rc.re}" language-verified`);
}
const tier8 = f8 === 0;
console.log(`Tier 8 \u2014 Thompson regex-to-NFA equivalence: ${p8}/${p8 + f8} pass${tier8 ? " \u2713" : " \u2717"}`);

// ---------- Tier 9: Expanded "From a Question" natural language suite ----------
let p9 = 0, f9 = 0;
const ok9 = (cond, name, extra) => { if (cond) p9++; else { f9++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };
const EXTRA_QUESTIONS = [
  { q: "ends with abb", acc: ["abb", "aabb"], rej: ["", "ab"] },
  { q: "starts with a", acc: ["a", "ab"], rej: ["", "b"] },
  { q: "contains 101", acc: ["101", "0101"], rej: ["", "100"] },
  { q: "strings over {a,b} with an odd number of b", acc: ["b", "ab", "ba", "bbb"], rej: ["", "bb", "a", "abb"] },
  { q: "binary strings divisible by 3", acc: ["0", "11", "110", "1001"], rej: ["1", "10", "100", "111"] },
  { q: "strings over {a,b} of length at least 2", acc: ["aa", "ab", "ba", "aaa"], rej: ["", "a", "b"] },
  { q: "strings over {a,b} with exactly 2 a's", acc: ["aa", "baa", "aba", "aab"], rej: ["", "a", "aaa", "aaaa"] }
];
for (const eq of EXTRA_QUESTIONS) {
  let r, N, M;
  try {
    r = Ex.automatonFromQuestion(eq.q);
    if (!r || !r.src) { ok9(false, eq.q, "not recognised"); continue; }
    N = A.parse(r.src);
    M = A.build(N);
  } catch (e) {
    ok9(false, eq.q, "threw: " + e.message);
    continue;
  }
  let good = true;
  for (const w of eq.acc) {
    if (!A.runDFA(N, M, [...w])) { good = false; ok9(false, eq.q, "should accept: " + (w || "ε")); break; }
  }
  if (good) for (const w of eq.rej) {
    if (A.runDFA(N, M, [...w])) { good = false; ok9(false, eq.q, "should reject: " + (w || "ε")); break; }
  }
  if (good) ok9(true, `Question parser: "${eq.q}"`);
}
const tier9 = f9 === 0;
console.log(`Tier 9 \u2014 natural language question parser expansion: ${p9}/${p9 + f9} pass${tier9 ? " \u2713" : " \u2717"}`);

// ---------- Tier 10: Live HTTP Server and REST API Integration ----------
let p10 = 0, f10 = 0;
const ok10 = (cond, name, extra) => { if (cond) p10++; else { f10++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };

async function runTier10() {
  const { server } = require("./server");
  const testPort = 3099;
  await new Promise(resolve => server.listen(testPort, resolve));

  try {
    // 1. GET /api/health
    const health = await fetch(`http://localhost:${testPort}/api/health`).then(r => r.json());
    ok10(health.ok === true && health.limits && health.limits.states > 0, "GET /api/health returns valid status and limits");

    // 2. POST /api/convert (standard NFA)
    const convNfa = await fetch(`http://localhost:${testPort}/api/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ src: "start: q0\nfinal: q1\nq0,a = q0,q1\nq0,b = q0" })
    }).then(r => r.json());
    ok10(convNfa.states && convNfa.states.length > 0 && convNfa.transitions && convNfa.transitions.length > 0 && convNfa.hasEps === false,
      "POST /api/convert handles standard NFA");

    // 3. POST /api/convert (ε-NFA with elimination)
    const convEnfa = await fetch(`http://localhost:${testPort}/api/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ src: "start: q0\nfinal: q2\nq0,a = q0\nq0,ε = q1\nq1,b = q2" })
    }).then(r => r.json());
    ok10(convEnfa.hasEps === true && convEnfa.elimination && convEnfa.elimination.states.length > 0 && convEnfa.elimination.text,
      "POST /api/convert handles ε-NFA with elimination summary");

    // 4. POST /api/convert with malformed input (error handling)
    const resBad = await fetch(`http://localhost:${testPort}/api/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ src: "invalid syntax without start" })
    });
    ok10(resBad.status === 400, "POST /api/convert rejects invalid automaton with 400");

    // 5. Static files: GET /subset.html, /automata.js, /extract.js
    const resSubset = await fetch(`http://localhost:${testPort}/subset.html`);
    const resAuto = await fetch(`http://localhost:${testPort}/automata.js`);
    const resExt = await fetch(`http://localhost:${testPort}/extract.js`);
    ok10(resSubset.status === 200 && resAuto.status === 200 && resExt.status === 200, "Serves static HTML and universal JS modules");

    // 6. POST /api/trace (interactive string tracer)
    const traceRes = await fetch(`http://localhost:${testPort}/api/trace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ src: "start: q0\nfinal: q1\nq0,a = q1", word: "a" })
    }).then(r => r.json());
    ok10(traceRes && traceRes.dfaAccepted === true && traceRes.nfaAccepted === true, "POST /api/trace executes string tracer");

    // 7. 404 handler: GET /not-existent
    const res404 = await fetch(`http://localhost:${testPort}/non-existent-page.html`);
    ok10(res404.status === 404, "Returns 404 for non-existent routes");
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  const tier10 = f10 === 0;
  console.log(`Tier 10 \u2014 live HTTP server and REST API integration: ${p10}/${p10 + f10} pass${tier10 ? " \u2713" : " \u2717"}`);

  // ---------- Tier 11: DFA Minimization (Hopcroft's Partition Refinement) ----------
  let p11 = 0, f11 = 0;
  const ok11 = (cond, name, extra) => { if (cond) p11++; else { f11++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };

  // 1. Reducible DFA test: 5 states -> 3 minimal states
  const N_red = A.parse("start: q0\nfinal: q3,q4\nq0,a = q1\nq0,b = q2\nq1,a = q3\nq1,b = q4\nq2,a = q3\nq2,b = q4\nq3,a = q3\nq3,b = q3\nq4,a = q4\nq4,b = q4\n");
  const M_red = A.build(N_red);
  const min_red = A.minimizeDFA(N_red, M_red);
  ok11(min_red.originalStateCount === 5 && min_red.minStateCount === 3 && min_red.wasReduced === true, "Hopcroft partition merges equivalent states (5 -> 3 states)");

  // 2. Already minimal DFA
  const N_min = A.parse("start: q0\nfinal: q2\nq0,a = q1\nq0,b = q0\nq1,a = q1\nq1,b = q2\nq2,a = q2\nq2,b = q2\n");
  const M_min = A.build(N_min);
  const min_res2 = A.minimizeDFA(N_min, M_min);
  ok11(min_res2.originalStateCount === min_res2.minStateCount && min_res2.wasReduced === false, "Already minimal DFA is preserved without reduction");

  // 3. Strict language equivalence between DFA and Minimal DFA
  let equivAll = true;
  const testWords = ["", "a", "b", "aa", "ab", "ba", "bb", "aaa", "aab", "aba", "abb", "baa", "bab", "bba", "bbb", "aabb", "bbaa"];
  for (const w of testWords) {
    const dfaAccept = A.runDFA(N_red, M_red, w.split(""));
    let cur = min_red.minDFA.start;
    let dead = false;
    for (const c of w.split("")) {
      const nxt = min_red.minDFA.tm[cur + "|" + c];
      if (nxt === undefined) { dead = true; break; }
      cur = nxt;
    }
    const minAccept = !dead && min_red.minDFA.finals.includes(cur);
    if (dfaAccept !== minAccept) { equivAll = false; break; }
  }
  ok11(equivAll, "Original DFA and Minimal DFA are strictly language-equivalent on all test words");

  // 4. Step-by-step partition log validation
  ok11(min_red.steps.length >= 2 && min_red.steps[0].type === "init" && min_red.steps[min_red.steps.length - 1].type === "final",
    "Minimization logs partition steps and fixed point");

  const tier11 = f11 === 0;
  console.log(`Tier 11 \u2014 DFA minimization (Hopcroft partition refinement): ${p11}/${p11 + f11} pass${tier11 ? " \u2713" : " \u2717"}`);

  // ---------- Tier 12: Interactive String Tracer & Path Tracer ----------
  let p12 = 0, f12 = 0;
  const ok12 = (cond, name, extra) => { if (cond) p12++; else { f12++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };

  // 1. Accepting string
  const tr1 = A.traceString(N_min, M_min, "ab");
  ok12(tr1.dfaAccepted === true && tr1.nfaAccepted === true && tr1.equivalent === true, "Traces accepting string correctly on both NFA and DFA");

  // 2. Rejecting string
  const tr2 = A.traceString(N_min, M_min, "a");
  ok12(tr2.dfaAccepted === false && tr2.nfaAccepted === false && tr2.equivalent === true, "Traces rejecting string correctly on both NFA and DFA");

  // 3. Empty string ε
  const tr3 = A.traceString(N_min, M_min, "ε");
  ok12(tr3.chars.length === 0 && tr3.equivalent === true, "Handles empty string ε properly");

  // 4. Dead state path detection
  const tr4 = A.traceString(N_min, M_min, "c");
  ok12(tr4.dfaAccepted === false && tr4.dfaPath.some(p => p.isDead), "Detects dead/trap state transitions in path");

  const tier12 = f12 === 0;
  console.log(`Tier 12 \u2014 interactive string simulator & path tracer: ${p12}/${p12 + f12} pass${tier12 ? " \u2713" : " \u2717"}`);

  // ---------- Tier 13: Academic Export Formats (LaTeX TikZ, Graphviz DOT, JFLAP .jff) ----------
  let p13 = 0, f13 = 0;
  const ok13 = (cond, name, extra) => { if (cond) p13++; else { f13++; console.log("  \u2717 " + name + (extra ? "  (" + extra + ")" : "")); } };

  const tikz = A.dfaToTikz(N_min, M_min);
  ok13(tikz.includes("\\begin{tikzpicture}") && tikz.includes("\\node[state") && tikz.includes("\\end{tikzpicture}"), "Generates valid LaTeX TikZ automaton");

  const dot = A.dfaToDot(N_min, M_min);
  ok13(dot.includes("digraph DFA") && dot.includes("rankdir=LR") && dot.includes("doublecircle"), "Generates valid Graphviz DOT automaton");

  const jff = A.dfaToJFF(N_min, M_min);
  ok13(jff.includes("<structure>") && jff.includes("<type>fa</type>") && jff.includes("<state id=") && jff.includes("<transition>"), "Generates valid JFLAP 7.0 .jff XML format");

  const tier13 = f13 === 0;
  console.log(`Tier 13 \u2014 academic exports (LaTeX TikZ, Graphviz DOT, JFLAP XML): ${p13}/${p13 + f13} pass${tier13 ? " \u2713" : " \u2717"}`);

  const allPass = tier1 && tier2 && tier3 && tier4 && tier5 && tier6 && tier7 && tier8 && tier9 && tier10 && tier11 && tier12 && tier13;
  console.log(allPass
    ? "\nALL CHECKS PASSED \u2014 13/13 test tiers passed: conversion, question builder, canvas editor, ε-elimination, minute step simulation, edge cases, invariants, live HTTP API, DFA minimization, string tracer, and academic exports verified."
    : "\nSOME CHECKS FAILED.");
  if (!allPass) process.exit(1);
}

runTier10();
