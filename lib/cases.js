/*
 * Edge-case test suite shared by tests.html, report.html and `node test.js`.
 * Each case: [name, category, kind, input, expectations]
 *   kind "nfa":   input = automaton text;   expect { n: DFA states, acc: [...], rej: [...], warn: /re/, err: /re/ }
 *   kind "regex": input = regular expression; expect { acc, rej, minimal, err }
 *   kind "min":   input = DFA text;           expect { minimal, removed, trap, err }
 */
(function (root) {
  "use strict";
  const ring = n => "start: q0\n" + Array.from({ length: n }, (_, i) => `q${i},a = q${(i + 1) % n}`).join("\n");
  const nthFromEnd = n => "start: q0\nfinal: q" + n + "\nq0,a = q0,q1\nq0,b = q0\n" + Array.from({ length: n - 1 }, (_, i) => `q${i + 1},a = q${i + 2}\nq${i + 1},b = q${i + 2}`).join("\n");
  const CASES = [
    // normal behaviour
    ["Classic NFA: strings ending in ab", "Normal", "nfa", "start: q0\nfinal: q2\nq0,a = q0,q1\nq0,b = q0\nq1,b = q2", { n: 3, acc: ["ab", "aab", "bab"], rej: ["", "a", "ba", "abb"] }],
    ["ε-NFA for a*b*c*", "Normal", "nfa", "start: q0\nfinal: q2\nq0,a = q0\nq0,e = q1\nq1,b = q1\nq1,e = q2\nq2,c = q2", { n: 4, acc: ["", "aabbcc", "c", "bc"], rej: ["ba", "cb", "abca"] }],
    ["Dragon book (a|b)*abb ε-NFA gives 5 DFA states", "Normal", "nfa", "start: 0\nfinal: 10\n0,ε = 1,7\n1,ε = 2,4\n2,a = 3\n4,b = 5\n3,ε = 6\n5,ε = 6\n6,ε = 1,7\n7,a = 8\n8,b = 9\n9,b = 10", { n: 5, acc: ["abb", "aabb", "babb"], rej: ["", "ab", "abba"] }],
    ["Textbook minimisation: 6 states → 3", "Normal", "min", "start: A\nfinal: C,D,E\nA,0=B\nA,1=C\nB,0=A\nB,1=D\nC,0=E\nC,1=F\nD,0=E\nD,1=F\nE,0=E\nE,1=F\nF,0=F\nF,1=F", { minimal: 3 }],
    ["Regex (a|b)*abb → minimal DFA of 4 states", "Normal", "regex", "(a|b)*abb", { minimal: 4, acc: ["abb", "babb"], rej: ["ab", ""] }],
    ["Regex with + as union: (a+b)*", "Normal", "regex", "(a+b)*", { minimal: 1, acc: ["", "abba"], rej: [] }],
    ["Regex with optional: ab?c", "Normal", "regex", "ab?c", { acc: ["ac", "abc"], rej: ["abbc", "a", ""] }],
    // ε-moves and special structure
    ["ε-cycle (q0 ⇄ q1)", "ε-moves", "nfa", "start: q0\nfinal: q2\nq0,e = q1\nq1,e = q0\nq1,a = q2", { n: 3, acc: ["a"], rej: ["", "aa"], warn: /ε-cycle/ }],
    ["ε-self-loop", "ε-moves", "nfa", "start: q0\nfinal: q1\nq0,ε = q0\nq0,a = q1", { n: 3, acc: ["a"], rej: ["", "aa"] }],
    ["Only ε-moves, no symbols", "ε-moves", "nfa", "start: q0\nfinal: q1\nq0,e = q1", { n: 1, acc: [""], warn: /No input symbols/ }],
    // edge cases
    ["Start state is final (accepts ε)", "Edge", "nfa", "start: q0\nfinal: q0\nq0,a = q1\nq1,a = q0", { n: 2, acc: ["", "aa"], rej: ["a", "aaa"], warn: /ε .*accepted/ }],
    ["No final state (empty language)", "Edge", "nfa", "start: q0\nq0,a = q0", { n: 1, rej: ["", "a"], warn: /empty/ }],
    ["Unreachable NFA state", "Edge", "nfa", "states: q0,q1,q9\nstart: q0\nfinal: q1\nq0,a = q1\nq9,a = q9", { n: 3, acc: ["a"], rej: ["", "aa"], warn: /Unreachable/ }],
    ["Duplicate transition targets merged", "Edge", "nfa", "start: q0\nfinal: q1\nq0,a = q1,q1\nq0,a = q1", { n: 3, acc: ["a"], warn: /duplicate/ }],
    ["Dead state ∅ is created", "Edge", "nfa", "start: q0\nfinal: q1\nq0,a = q1", { n: 3, acc: ["a"], rej: ["", "aa"] }],
    ["Declared but unused symbol", "Edge", "nfa", "alphabet: a,b,c\nstart: q0\nfinal: q0\nq0,a = q0", { n: 2, acc: ["", "aa"], rej: ["b", "c"], warn: /never used/ }],
    ["Upper-case E is a state, not ε", "Edge", "nfa", "start: E\nfinal: O\nE,a = O\nO,a = E", { n: 2, acc: ["a", "aaa"], rej: ["", "aa"] }],
    ["Incomplete DFA gets a trap state", "Edge", "min", "start: s0\nfinal: s2\ns0,a = s1\ns1,b = s2\ns2,a = s1", { trap: true, minimal: 4 }],
    ["Unreachable DFA state is removed", "Edge", "min", "states: A,B,x\nstart: A\nfinal: B\nA,0 = B\nA,1 = A\nB,0 = B\nB,1 = A\nx,0 = x\nx,1 = B", { removed: 1, minimal: 2 }],
    ["DFA with no final state minimises to 1 state", "Edge", "min", "start: A\nA,a = B\nB,a = A", { minimal: 1 }],
    // input flexibility
    ["Multi-character symbols", "Flexible input", "nfa", "start: s\nfinal: t\ns,ab = t", { n: 3, acc: ["ab"], rej: ["", "ab ab"] }],
    ["Alternative syntaxes δ(p,a)={q} and p -b-> q", "Flexible input", "nfa", "start: p\nfinal: q\nδ(p,a) = {q}\np -b-> q", { n: 3, acc: ["a", "b"], rej: ["ab", ""] }],
    ["Comments, blank lines, Windows line endings", "Flexible input", "nfa", "# note\r\n\r\nstart: q0 // x\r\nfinal: q0\r\nq0,a = q0", { n: 1, acc: ["", "aa"], rej: ["b"] }],
    // stress
    ["Exponential: 4th symbol from the end is a (16 states)", "Stress", "nfa", nthFromEnd(4), { n: 16, acc: ["abbb", "aaaa"], rej: ["bbbb", "bbab"] }],
    // constraints that must be rejected with a clear message
    ["Empty input", "Constraint", "nfa", "   ", { err: /empty/ }],
    ["Missing start state", "Constraint", "nfa", "final: q0\nq0,a = q0", { err: /Missing/ }],
    ["Two start states on one line", "Constraint", "nfa", "start: q0, q1\nq0,a = q1", { err: /exactly one start/ }],
    ["Two different start lines", "Constraint", "nfa", "start: q0\nstart: q1\nq0,a = q1", { err: /Only one start/ }],
    ["Undeclared state", "Constraint", "nfa", "states: q0\nstart: q0\nq0,a = q9", { err: /Undeclared/ }],
    ["Symbol outside the declared alphabet", "Constraint", "nfa", "alphabet: a\nstart: q0\nq0,b = q0", { err: /not in the declared alphabet/ }],
    ["Unreadable line", "Constraint", "nfa", "start: q0\nhello world", { err: /cannot read/ }],
    ["Invalid state name", "Constraint", "nfa", "start: q0\nq0,a = <x>", { err: /not a valid state name/ }],
    ["ε declared as an input symbol", "Constraint", "nfa", "alphabet: a,eps\nstart: q0", { err: /ε cannot/ }],
    ["31 states exceed the limit of 30", "Constraint", "nfa", ring(31), { err: /limit is 30/ }],
    ["DFA blow-up beyond 300 states is stopped", "Constraint", "nfa", nthFromEnd(9), { err: /more than 300/ }],
    ["Regex: missing bracket", "Constraint", "regex", "(ab", { err: /Missing “\)”/ }],
    ["Regex: star with nothing before it", "Constraint", "regex", "*a", { err: /nothing before/ }],
    ["Regex: empty alternative", "Constraint", "regex", "a|", { err: /Missing expression/ }],
    ["Regex: too many states for Thompson", "Constraint", "regex", "(abcdefgh)*(abcdefgh)", { err: /limit is 30/ }],
    ["Minimising an NFA is refused", "Constraint", "min", "start: q0\nfinal: q1\nq0,a = q0,q1", { err: /needs a DFA/ }]
  ];

  const tok = (A, N, w) => A.tokenize(N, w);

  function runCase(A, c) {
    const [name, cat, kind, input, x] = c, out = { name, cat, kind, exp: [], act: [], pass: true };
    const chk = (label, e, a, ok) => { out.exp.push(label + ": " + e); out.act.push(label + ": " + a); if (!ok) out.pass = false; };
    let N, M;
    try {
      if (kind === "regex") N = A.parse(A.regexToNFA(input).text);
      else N = A.parse(input);
      if (kind === "min") {
        const r = A.minimizeSteps(N);
        if (x.err) { chk("error", String(x.err), "no error", false); return out; }
        if (x.minimal != null) chk("minimal states", x.minimal, r.minimal.states.length, r.minimal.states.length === x.minimal);
        if (x.removed != null) chk("unreachable removed", x.removed, r.removed.length, r.removed.length === x.removed);
        if (x.trap != null) chk("trap added", x.trap, !!r.trap, !!r.trap === x.trap);
        const eq = A.equivalent(N, A.parse(r.minimal.text));
        chk("minimal ≡ original", "same language", eq.ok ? "same language" : "differs", eq.ok);
        return out;
      }
      M = A.build(N);
    } catch (e) {
      if (x.err) chk("error", String(x.err), e.message, x.err.test(e.message));
      else chk("no error", "runs", e.message, false);
      return out;
    }
    if (x.err) { chk("error", String(x.err), "no error", false); return out; }
    if (x.n != null) chk("DFA states", x.n, M.D.length, M.D.length === x.n);
    if (x.minimal != null) { const m = A.minimize(N, M); chk("minimal DFA states", x.minimal, m, m === x.minimal); }
    if (x.warn) chk("warning", String(x.warn), N.warn.join(" | ") || "none", N.warn.some(w => x.warn.test(w)));
    for (const w of x.acc || []) { const a = A.runNFA(N, tok(A, N, w)), b = A.runDFA(N, M, tok(A, N, w)); chk(`“${w || "ε"}”`, "accept", `NFA ${a ? "accepts" : "rejects"}, DFA ${b ? "accepts" : "rejects"}`, a && b); }
    for (const w of x.rej || []) { const a = A.runNFA(N, tok(A, N, w)), b = A.runDFA(N, M, tok(A, N, w)); chk(`“${w || "ε"}”`, "reject", `NFA ${a ? "accepts" : "rejects"}, DFA ${b ? "accepts" : "rejects"}`, !a && !b); }
    let bad = 0, cnt = 0; const q = [[]];
    for (let i = 0; i < q.length && cnt < 3000; i++) { const w = q[i]; cnt++; if (A.runNFA(N, w) !== A.runDFA(N, M, w)) bad++; if (w.length < 6) N.alpha.forEach(c => q.push([...w, c])); }
    chk(`NFA ≡ DFA on ${cnt} strings`, "0 mismatches", bad + " mismatches", bad === 0);
    return out;
  }

  /** Grading self-check: every generated question must accept its own solution. */
  function gradingCheck(A, Q, seeds) {
    const rows = [];
    for (const t of Object.keys(Q.TYPES)) for (const d of ["Easy", "Medium", "Hard"]) {
      let ok = 0, n = 0;
      for (let s = 1; s <= (seeds || 3); s++) {
        const q = Q.makeQuestion(t, { difficulty: d, seed: s * 7919 }), sol = Q.solve(q);
        let r = {};
        if (t === "mcq") r = { index: sol.index }; else if (t === "tf") r = { value: sol.value };
        else if (t === "closure" || t === "move") r = { text: A.fmtSet(sol.set) };
        else if (t === "accept") r = { values: sol.results };
        else if (t === "table") r = { cells: sol.cells.map(row => row.map(A.fmtSet)) };
        else if (t === "count") r = { value: String(sol.value) };
        else if (t === "classes") r = { text: sol.classes.map(c => "{" + c.join(",") + "}").join(" ") };
        else if (t === "evaluate") r = { verdict: sol.correct, counter: sol.counter ? sol.counter.join("") || "ε" : "" };
        else if (t === "short") r = { self: 1 };
        else r = { text: sol.text };
        n++; if (Q.grade(q, r).correct) ok++;
      }
      rows.push({ type: t, label: Q.TYPES[t].label, bloom: Q.TYPES[t].bloom, difficulty: d, ok, n });
    }
    return rows;
  }

  const API = { CASES, runCase, gradingCheck };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else Object.assign(root, API);
})(typeof window !== "undefined" ? window : globalThis);
