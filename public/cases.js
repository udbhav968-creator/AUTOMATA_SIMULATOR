// Shared edge-case suite: used by tests.html, report.html and `node test.js`.
(function (root) {
const big = "start: q0\n" + Array.from({ length: 17 }, (_, i) => `q${i},a = q${(i + 1) % 17}`).join("\n");
const CASES = [
["Classic: ends with ab", "Normal", "start: q0\nfinal: q2\nq0,a = q0,q1\nq0,b = q0\nq1,b = q2", { n: 3, acc: ["ab", "aab", "bab"], rej: ["", "a", "ba", "abb"] }],
["ε-NFA a*b*c*", "ε-moves", "start: q0\nfinal: q2\nq0,a = q0\nq0,e = q1\nq1,b = q1\nq1,e = q2\nq2,c = q2", { n: 4, acc: ["", "aabbcc", "c", "bc"], rej: ["ba", "cb", "abca"] }],
["ε-cycle (q0 ⇄ q1)", "ε-moves", "start: q0\nfinal: q2\nq0,e = q1\nq1,e = q0\nq1,a = q2", { n: 3, acc: ["a"], rej: ["", "aa"] }],
["Start state is final", "Edge", "start: q0\nfinal: q0\nq0,a = q1\nq1,a = q0", { n: 2, acc: ["", "aa"], rej: ["a", "aaa"], warn: /ε is accepted/ }],
["No final state", "Edge", "start: q0\nq0,a = q0", { n: 1, rej: ["", "a"], warn: /empty/ }],
["Only ε-moves, no symbols", "Edge", "start: q0\nfinal: q1\nq0,e = q1", { n: 1, acc: [""], warn: /No input symbols/ }],
["Unreachable NFA states", "Edge", "states: q0,q1,q9\nstart: q0\nfinal: q1\nq0,a = q1\nq9,a = q9", { n: 3, acc: ["a"], rej: ["", "aa"], warn: /Unreachable/ }],
["Duplicate transitions", "Edge", "start: q0\nfinal: q1\nq0,a = q1,q1\nq0,a = q1", { n: 3, acc: ["a"], warn: /duplicate/ }],
["Dead (trap) state ∅", "Edge", "start: q0\nfinal: q1\nq0,a = q1", { n: 3, acc: ["a"], rej: ["", "aa"] }],
["Declared unused symbol c", "Edge", "alphabet: a,b,c\nstart: q0\nfinal: q0\nq0,a = q0", { n: 2, acc: ["", "aa"], rej: ["b", "c"] }],
["Multi-character symbols", "Flexible", "start: s\nfinal: t\ns,ab = t", { n: 3, acc: ["ab"], rej: ["", "ab ab"] }],
["Alternative syntaxes δ(p,a)={q}, p -b-> q", "Flexible", "start: p\nfinal: q\nδ(p,a) = {q}\np -b-> q", { n: 3, acc: ["a", "b"], rej: ["ab", ""] }],
["Comments and blank lines", "Flexible", "# note\n\nstart: q0 // x\nfinal: q0\nq0,a = q0", { n: 1, acc: ["", "aa"], rej: ["b"] }],
["Exponential: 4th symbol from end is a", "Stress", "start: q0\nfinal: q4\nq0,a = q0,q1\nq0,b = q0\nq1,a = q2\nq1,b = q2\nq2,a = q3\nq2,b = q3\nq3,a = q4\nq3,b = q4", { n: 16, acc: ["abbb", "aaaa"], rej: ["bbbb", "bbab"] }],
["ERROR: missing start", "Constraint", "final: q0\nq0,a = q0", { err: /Missing/ }],
["ERROR: undeclared state", "Constraint", "states: q0\nstart: q0\nq0,a = q9", { err: /Undeclared/ }],
["ERROR: two start states", "Constraint", "start: q0\nstart: q1\nq0,a = q1", { err: /Only one start/ }],
["ERROR: unreadable line", "Constraint", "start: q0\nhello world", { err: /Cannot parse/ }],
["ERROR: 17 states exceeds limit", "Constraint", big, { err: /limit/ }],
["ERROR: ε as input symbol", "Constraint", "alphabet: a,e\nstart: q0", { err: /ε cannot/ }]];
const tok = (N, w) => N.alpha.every(a => a.length === 1) ? [...w] : w.split(" ").filter(Boolean);
function run(A, c) {
  const [name, cat, src, x] = c, out = { name, cat, exp: [], act: [], pass: true };
  const chk = (l, e, a, ok) => { out.exp.push(l + ": " + e); out.act.push(l + ": " + a); if (!ok) out.pass = false; };
  let N; try { N = A.parse(src); } catch (e) { if (x.err) chk("error", String(x.err), e.message, x.err.test(e.message)); else chk("parse", "no error", e.message, false); return out; }
  if (x.err) { chk("error", String(x.err), "no error", false); return out; }
  const M = A.build(N);
  if (x.n != null) chk("DFA states", x.n, M.D.length, M.D.length === x.n);
  if (x.warn) chk("warning", String(x.warn), N.warn.join(" | ") || "none", N.warn.some(w => x.warn.test(w)));
  for (const w of x.acc || []) { const a = A.runNFA(N, tok(N, w)), b = A.runDFA(N, M, tok(N, w)); chk(`“${w || "ε"}”`, "accept", `NFA ${a ? "✓" : "✗"} / DFA ${b ? "✓" : "✗"}`, a && b); }
  for (const w of x.rej || []) { const a = A.runNFA(N, tok(N, w)), b = A.runDFA(N, M, tok(N, w)); chk(`“${w || "ε"}”`, "reject", `NFA ${a ? "✓" : "✗"} / DFA ${b ? "✓" : "✗"}`.replace(/✓/g, "accepts").replace(/✗/g, "rejects"), !a && !b); }
  let bad = 0, cnt = 0; const q = [[]]; for (let i = 0; i < q.length && cnt < 3000; i++) { const w = q[i]; cnt++; if (A.runNFA(N, w) !== A.runDFA(N, M, w)) bad++; if (w.length < 5) N.alpha.forEach(c => q.push([...w, c])); }
  chk(`NFA ≡ DFA on ${cnt} strings`, "0 mismatches", bad + " mismatches", bad === 0); return out;
}
root.CASES = CASES; root.runCase = run; if (typeof module !== "undefined") module.exports = { CASES, runCase: run };
})(typeof window !== "undefined" ? window : globalThis);
