/*
 * Question generation and grading for Automata Studio.
 * Every question is plain data (safe to save, share and send to the AI); grade() re-derives the answer
 * from the automaton with the engine, so an answer key can never be stale or mistyped.
 *
 * Each question carries a Bloom's taxonomy level, an action verb and a learning outcome (LO).
 */
(function (root) {
  "use strict";
  const A = typeof module !== "undefined" && module.exports ? require("./automata") : root.Automata;

  const BLOOM = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"];
  const OUTCOMES = {
    LO1: "Define finite automata (DFA, NFA, ε-NFA) and their formal components.",
    LO2: "Compute ε-closures and apply subset construction to convert an NFA into a DFA.",
    LO3: "Simulate an automaton on input strings and decide acceptance.",
    LO4: "Analyse and minimise a DFA using state distinguishability.",
    LO5: "Evaluate the correctness of an automaton using language equivalence and counter-examples.",
    LO6: "Design a finite automaton for a regular language described in words."
  };
  /** Question types: label, Bloom level, action verb, learning outcome, whether the engine can grade it. */
  const TYPES = {
    mcq:       { label: "Multiple choice", bloom: "Remember", verb: "Identify", lo: "LO1" },
    tf:        { label: "True or false", bloom: "Understand", verb: "Explain", lo: "LO1" },
    closure:   { label: "ε-closure", bloom: "Apply", verb: "Compute", lo: "LO2" },
    move:      { label: "Move and closure", bloom: "Apply", verb: "Calculate", lo: "LO2" },
    accept:    { label: "Accept or reject", bloom: "Apply", verb: "Trace", lo: "LO3" },
    table:     { label: "Subset table", bloom: "Apply", verb: "Construct", lo: "LO2" },
    count:     { label: "Count states", bloom: "Analyze", verb: "Determine", lo: "LO2" },
    classes:   { label: "Equivalent states", bloom: "Analyze", verb: "Distinguish", lo: "LO4" },
    evaluate:  { label: "Judge a DFA", bloom: "Evaluate", verb: "Justify", lo: "LO5" },
    construct: { label: "Convert NFA to DFA", bloom: "Create", verb: "Construct", lo: "LO2" },
    design:    { label: "Design an automaton", bloom: "Create", verb: "Design", lo: "LO6" },
    short:     { label: "Written answer", bloom: "Understand", verb: "Describe", lo: "LO1", manual: true }
  };
  const DIFF = { Easy: { n: 3, k: 2, eps: false, minDfa: 3, maxDfa: 5 }, Medium: { n: 4, k: 2, eps: true, minDfa: 3, maxDfa: 7 }, Hard: { n: 5, k: 2, eps: true, minDfa: 5, maxDfa: 10 } };

  /* -------------------------------------------------------------- concept bank (Remember / Understand) */
  const CONCEPTS = [
    { q: "An NFA with n states is converted by subset construction. What is the largest number of DFA states it can need?", o: ["n", "2n", "n²", "2ⁿ"], a: 3, e: "Each DFA state is a subset of the n NFA states, and there are 2ⁿ subsets.", b: "Remember" },
    { q: "What does ε-closure(q) contain?", o: ["Only the states reachable from q on ε-moves, excluding q", "q and every state reachable from q using ε-moves only", "Every state reachable from q on any input", "The final states reachable from q"], a: 1, e: "The closure always includes q itself plus everything reachable through zero or more ε-moves.", b: "Remember" },
    { q: "In a DFA the transition function δ has the type", o: ["Q × Σ → Q", "Q × Σ → 2^Q", "Q × (Σ ∪ {ε}) → 2^Q", "Q → Σ"], a: 0, e: "A DFA has exactly one next state for each state and symbol. 2^Q is the NFA's type.", b: "Remember" },
    { q: "What is the start state of the DFA built from an ε-NFA with start state q0?", o: ["{q0}", "ε-closure(q0)", "The set of all final states", "move(q0, ε)"], a: 1, e: "Before reading any input the NFA can already be in every state of ε-closure(q0).", b: "Remember" },
    { q: "Which tuple element is not part of a DFA's formal definition?", o: ["Q, the set of states", "Σ, the input alphabet", "Γ, the stack alphabet", "F, the final states"], a: 2, e: "A stack alphabet belongs to a pushdown automaton.", b: "Remember" },
    { q: "What do ε-moves let an NFA do?", o: ["Read two symbols at once", "Change state without reading any input", "Reject the string immediately", "Go back one symbol"], a: 1, e: "An ε-transition consumes no input.", b: "Remember" },
    { q: "Thompson's construction for r* adds how many new states to the machine for r?", o: ["0", "1", "2", "4"], a: 2, e: "It adds a new start and a new final state, plus four ε-edges.", b: "Remember" },
    { q: "Which statement is true?", o: ["NFAs recognise more languages than DFAs", "DFAs recognise more languages than NFAs", "NFAs and DFAs recognise exactly the regular languages", "Only ε-NFAs recognise regular languages"], a: 2, e: "Subset construction turns any NFA into an equivalent DFA, so both define the regular languages.", b: "Understand" },
    { q: "When is a DFA state produced by subset construction accepting?", o: ["When it contains every NFA final state", "When it contains at least one NFA final state", "When it is the last state discovered", "When it has a self-loop"], a: 1, e: "The DFA accepts if any of the NFA's possible current states is final.", b: "Understand" },
    { q: "What does the empty-set state ∅ represent in subset construction?", o: ["The start state", "An accepting state", "A dead state: no NFA state is active, so every continuation is rejected", "A state reached on ε"], a: 2, e: "Once no NFA state is active, nothing can bring one back.", b: "Understand" },
    { q: "Why does subset construction usually create far fewer than 2ⁿ states?", o: ["It merges equivalent states as it goes", "It only creates subsets that are reachable from the start subset", "It ignores ε-moves", "It stops at n states"], a: 1, e: "States are only added when some transition actually reaches that subset.", b: "Understand" },
    { q: "When are two DFA states p and q distinguishable?", o: ["When they have different names", "When some string leads one of them to a final state and the other to a non-final state", "When they have different numbers of outgoing edges", "When one of them is unreachable"], a: 1, e: "That string tells them apart, so they cannot be merged.", b: "Understand" },
    { q: "In the table-filling algorithm, which pairs are marked first?", o: ["Pairs with a common successor", "Pairs where one state is final and the other is not", "Pairs of unreachable states", "Pairs that include the start state"], a: 1, e: "The empty string already distinguishes a final state from a non-final one.", b: "Understand" },
    { q: "The minimal DFA of a regular language is", o: ["unique up to renaming of its states", "different for each NFA you start from", "always smaller than the NFA", "always 2ⁿ states"], a: 0, e: "The Myhill–Nerode theorem guarantees a unique minimal DFA up to isomorphism.", b: "Understand" },
    { q: "Which language family shows that the 2ⁿ bound of subset construction can be reached?", o: ["Strings of even length", "Strings whose n-th symbol from the end is a", "Strings that start with a", "The empty language"], a: 1, e: "The DFA must remember the last n symbols, which needs 2ⁿ states.", b: "Understand" },
    { q: "What happens to the language when you remove an unreachable state from a DFA?", o: ["It shrinks", "It grows", "It does not change", "It becomes empty"], a: 2, e: "No input string can ever visit an unreachable state.", b: "Understand" },
    { q: "A DFA has no final states. Its language is", o: ["{ε}", "Σ*", "∅", "Σ"], a: 2, e: "Acceptance needs to end in a final state, and there is none.", b: "Understand" },
    { q: "Which string is in the language of (a|b)*abb?", o: ["abba", "babb", "ab", "bbb"], a: 1, e: "The expression means any string that ends with abb.", b: "Understand" }
  ];
  const TF = [
    { s: "Every DFA is also an NFA.", a: true, e: "A DFA is an NFA where each transition set has exactly one state and there are no ε-moves." },
    { s: "ε-closure(q) can be empty.", a: false, e: "It always contains q itself." },
    { s: "Subset construction can produce a DFA with fewer states than the NFA.", a: true, e: "For example, an NFA with unreachable states, or one whose reachable subsets coincide." },
    { s: "A DFA may have two transitions on the same symbol from one state.", a: false, e: "Determinism means exactly one next state per state and symbol." },
    { s: "Adding an ε-transition from a final state back to the start state of an NFA for L gives an NFA for L⁺.", a: true, e: "After reaching a final state the machine can restart, so one or more strings of L are accepted." },
    { s: "Two states that are both final are always equivalent.", a: false, e: "They may still be distinguished by a longer string." },
    { s: "The dead state is accepting.", a: false, e: "It contains no NFA state, so it contains no final state." }
  ];

  /* -------------------------------------------------------------- languages for design questions (Create) */
  const LANGS = [
    { d: "strings over {a, b} that end with ab", lvl: "Easy", ref: "start: A\nfinal: C\nA,a=B\nA,b=A\nB,a=B\nB,b=C\nC,a=B\nC,b=A" },
    { d: "strings over {a, b} that contain aa as a substring", lvl: "Easy", ref: "start: A\nfinal: C\nA,a=B\nA,b=A\nB,a=C\nB,b=A\nC,a=C\nC,b=C" },
    { d: "strings over {a, b} with an even number of a's", lvl: "Easy", ref: "start: E\nfinal: E\nE,a=O\nE,b=E\nO,a=E\nO,b=O" },
    { d: "strings over {a, b} whose length is divisible by 3", lvl: "Easy", ref: "start: L0\nfinal: L0\nL0,a=L1\nL0,b=L1\nL1,a=L2\nL1,b=L2\nL2,a=L0\nL2,b=L0" },
    { d: "strings over {a, b} that start with a and end with b", lvl: "Medium", ref: "start: S\nfinal: Y\nS,a=X\nS,b=D\nX,a=X\nX,b=Y\nY,a=X\nY,b=Y\nD,a=D\nD,b=D" },
    { d: "strings over {a, b} with no two consecutive b's", lvl: "Medium", ref: "start: A\nfinal: A,B\nA,a=A\nA,b=B\nB,a=A\nB,b=D\nD,a=D\nD,b=D" },
    { d: "strings over {a, b} that do not contain ab as a substring", lvl: "Medium", ref: "start: A\nfinal: A,B\nA,a=B\nA,b=A\nB,a=B\nB,b=D\nD,a=D\nD,b=D" },
    { d: "strings over {a, b} in which every a is immediately followed by b", lvl: "Medium", ref: "start: A\nfinal: A\nA,a=B\nA,b=A\nB,b=A\nB,a=D\nD,a=D\nD,b=D" },
    { d: "strings over {a, b} with exactly two a's", lvl: "Medium", ref: "start: Z\nfinal: T\nZ,a=O\nZ,b=Z\nO,a=T\nO,b=O\nT,a=D\nT,b=T\nD,a=D\nD,b=D" },
    { d: "strings over {a, b} in which the number of a's leaves remainder 1 when divided by 3", lvl: "Hard", ref: "start: R0\nfinal: R1\nR0,a=R1\nR0,b=R0\nR1,a=R2\nR1,b=R1\nR2,a=R0\nR2,b=R2" },
    { d: "binary strings (most significant bit first) whose value is divisible by 3; the empty string counts as 0", lvl: "Hard", ref: "start: R0\nfinal: R0\nR0,0=R0\nR0,1=R1\nR1,0=R2\nR1,1=R0\nR2,0=R1\nR2,1=R2" },
    { d: "strings over {a, b} whose second symbol from the end is a", lvl: "Hard", ref: "start: p\nfinal: r\np,a=p,q\np,b=p\nq,a=r\nq,b=r" }
  ];

  /* -------------------------------------------------------------- utilities */
  const fmt = A.fmtSet;
  const sameSet = (x, y) => x.length === y.length && x.every(v => y.includes(v));
  const pickFrom = (R, arr) => arr[Math.floor(R() * arr.length)];
  const shuffle = (R, arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  let counter = 0;
  const uid = p => (p || "q") + Date.now().toString(36) + (counter++).toString(36);
  const meta = type => ({ bloom: TYPES[type].bloom, verb: TYPES[type].verb, lo: TYPES[type].lo });

  /** Parse a set typed by a student: "{q0, q1}", "q0 q1", "∅", "{}", "phi", "empty". Returns {set} or {error}. */
  function parseSet(N, text) {
    const t = String(text == null ? "" : text).trim();
    if (!t) return { error: "No answer given." };
    if (/^(∅|\{\s*\}|phi|empty|null|none|-)$/i.test(t)) return { set: [] };
    const items = [...new Set(t.replace(/[{}()\[\]]/g, " ").split(/[,\s]+/).filter(Boolean))];
    const bad = items.filter(x => !N.states.includes(x));
    if (bad.length) return { error: `${bad.join(", ")} ${bad.length > 1 ? "are not states" : "is not a state"} of this automaton.` };
    return { set: items.sort((a, b) => N.ord[a] - N.ord[b]) };
  }

  /** Pick a few interesting strings for accept/reject questions. */
  function sampleStrings(N, R, count) {
    const all = [], q = [[]];
    for (let i = 0; i < q.length && q.length < 400; i++) { all.push(q[i]); if (q[i].length < 5) N.alpha.forEach(c => q.push([...q[i], c])); }
    const acc = shuffle(R, all.filter(w => w.length >= 2 && A.runNFA(N, w))), rej = shuffle(R, all.filter(w => w.length >= 2 && !A.runNFA(N, w)));
    const out = [];
    for (let i = 0; out.length < count && (i < acc.length || i < rej.length); i++) { if (acc[i]) out.push(acc[i]); if (out.length < count && rej[i]) out.push(rej[i]); }
    const sep = N.alpha.every(a => a.length === 1) ? "" : " ";
    return shuffle(R, out).slice(0, count).map(w => w.join(sep));
  }

  /* -------------------------------------------------------------- generators */

  function makeQuestion(type, opts) {
    opts = opts || {};
    const R = A.rng(opts.seed), level = DIFF[opts.difficulty] ? opts.difficulty : "Medium", P = DIFF[level];
    const base = { id: uid("g"), type, difficulty: level, marks: opts.marks || ({ Easy: 2, Medium: 3, Hard: 5 }[level]), source: "generated", ...meta(type) };
    const nfa = () => A.generate({ n: P.n, k: P.k, eps: opts.eps != null ? opts.eps : P.eps, seed: Math.floor(R() * 1e9), minDfa: P.minDfa, maxDfa: P.maxDfa });

    if (type === "mcq") {
      const pool = CONCEPTS.filter(c => !opts.bloom || c.b === opts.bloom), c = pickFrom(R, pool.length ? pool : CONCEPTS);
      return { ...base, bloom: c.b, verb: c.b === "Remember" ? "Identify" : "Explain", prompt: c.q, data: { options: c.o }, key: { index: c.a }, explanation: c.e, marks: 1 };
    }
    if (type === "tf") {
      if (R() < 0.5) {
        const t = pickFrom(R, TF);
        return { ...base, prompt: t.s, key: { value: t.a }, explanation: t.e, marks: 1 };
      }
      const src = nfa(), N = A.parse(src), M = A.build(N), lie = R() < 0.5, n = M.D.length + (lie ? (R() < 0.5 ? 1 : -1) : 0);
      return { ...base, prompt: `For the NFA shown, subset construction (keeping only reachable subsets, including ∅ if it appears) produces exactly ${n} DFA states.`, src, key: { value: !lie }, marks: 1 };
    }
    if (type === "closure") {
      const src = A.generate({ n: Math.max(P.n, 4), k: 2, eps: true, seed: Math.floor(R() * 1e9), minDfa: 2, maxDfa: 12 }), N = A.parse(src);
      const withEps = N.states.filter(s => (N.d[s + "|ε"] || new Set()).size);
      const state = pickFrom(R, withEps.length ? withEps : N.states);
      return { ...base, prompt: `Compute ε-closure(${state}) for the ε-NFA shown.`, src, data: { state } };
    }
    if (type === "move") {
      const src = nfa(), N = A.parse(src), M = A.build(N), cands = M.D.filter(d => d.set.length);
      const S = pickFrom(R, cands).set, c = pickFrom(R, N.alpha);
      return { ...base, prompt: `Compute ε-closure(move(${fmt(S)}, ${c})) for the NFA shown.`, src, data: { set: S, sym: c } };
    }
    if (type === "accept") {
      const src = nfa(), N = A.parse(src);
      return { ...base, prompt: "Decide whether the NFA shown accepts or rejects each string.", src, data: { strings: sampleStrings(N, R, 4) } };
    }
    if (type === "table") {
      const src = A.generate({ n: P.n, k: 2, eps: opts.eps != null ? opts.eps : P.eps, seed: Math.floor(R() * 1e9), minDfa: 3, maxDfa: Math.min(P.maxDfa, 6) });
      return { ...base, prompt: "Complete the subset-construction table: for each DFA state (a subset of NFA states) and symbol, write the subset reached after the move and the ε-closure.", src };
    }
    if (type === "count") {
      const what = R() < 0.55 ? "dfa" : "minimal";
      const src = nfa();
      return { ...base, prompt: what === "dfa" ? "How many states does the DFA from subset construction have? Count only reachable subsets, and count the dead state ∅ if it appears." : "How many states does the minimal DFA for this NFA's language have? Count the dead state if the minimal DFA needs one.", src, data: { what } };
    }
    if (type === "classes") {
      const pool = LANGS.filter(l => l.lvl !== "Hard" && A.isDeterministic(A.parse(l.ref)));
      let src = null;
      for (let t = 0; t < 12; t++) {
        src = redundantDFA(pickFrom(R, pool).ref, R);
        const D = A.parse(src);
        if (A.minimizeSteps(D).classes.length < D.states.length) break;
      }
      return { ...base, prompt: "Group the states of this DFA into classes of equivalent (indistinguishable) states. Write each class in braces, for example {A,B} {C}.", src };
    }
    if (type === "evaluate") {
      const src = nfa(), N = A.parse(src), M = A.build(N), good = R() < 0.4;
      let cand = A.parse(A.dfaToText(N, M, "letters"));
      let candText = A.toText(cand);
      if (!good) candText = mutate(cand, R);
      return { ...base, prompt: "A student converted the NFA on the left into the DFA on the right. Is the DFA correct? If not, give a string on which the two machines disagree.", src, data: { candidate: candText } };
    }
    if (type === "construct") {
      const src = nfa();
      return { ...base, prompt: "Convert this NFA into an equivalent DFA. Write the DFA in the text format, including a dead state if you need one.", src, data: { requireDFA: true } };
    }
    if (type === "design") {
      const pool = LANGS.filter(l => l.lvl === level), lang = pickFrom(R, pool.length ? pool : LANGS);
      const requireDFA = level !== "Hard";
      return { ...base, prompt: `Design a ${requireDFA ? "DFA" : "DFA or NFA"} that accepts exactly the ${lang.d}.`, data: { requireDFA, reference: lang.ref, language: lang.d } };
    }
    if (type === "short") {
      return { ...base, prompt: "Explain, in your own words, why subset construction always produces a DFA that accepts the same language as the NFA.", data: { model: "After reading any string w, the DFA is in the state that equals the set of NFA states reachable on w (proof by induction on |w|, using ε-closure after every move). The DFA accepts w exactly when that set contains a final NFA state, which is exactly when the NFA has an accepting path for w." } };
    }
    throw new Error("Unknown question type: " + type);
  }

  /** Add duplicate states to a DFA so the "equivalent states" question has something to merge. */
  function redundantDFA(refText, R) {
    const N = A.parse(refText), orig = {}, copyOf = {};
    N.states.forEach(s => (orig[s] = s));
    shuffle(R, N.states).slice(0, Math.min(2, N.states.length)).forEach(s => { const c = s + "'"; copyOf[s] = c; orig[c] = s; });
    const all = Object.keys(orig);
    const delta = {};
    for (const s of all) for (const c of N.alpha) {
      const t = [...N.d[orig[s] + "|" + c]][0];
      delta[s + "|" + c] = copyOf[t] && R() < 0.5 ? copyOf[t] : t;
    }
    // make sure every copy is entered by at least one edge from a reachable state
    Object.entries(copyOf).forEach(([s, c]) => {
      if (Object.values(delta).includes(c)) return;
      const k = Object.keys(delta).find(k => delta[k] === s && !k.startsWith(c + "|"));
      if (k) delta[k] = c;
    });
    // keep only reachable states, so every listed state takes part in the question
    const seen = new Set([N.start]), queue = [N.start];
    while (queue.length) { const s = queue.shift(); for (const c of N.alpha) { const t = delta[s + "|" + c]; if (!seen.has(t)) { seen.add(t); queue.push(t); } } }
    const keep = all.filter(s => seen.has(s));
    const lines = ["start: " + N.start, "final: " + (keep.filter(s => N.finals.includes(orig[s])).join(",") || "∅")];
    keep.forEach(s => N.alpha.forEach(c => lines.push(`${s},${c} = ${delta[s + "|" + c]}`)));
    return lines.join("\n");
  }

  /** Make a wrong DFA by changing one transition or flipping one final state. */
  function mutate(N, R) {
    for (let t = 0; t < 30; t++) {
      const M = A.parse(A.toText(N));
      if (R() < 0.6 && N.states.length > 1 && N.alpha.length) {
        const s = pickFrom(R, N.states), c = pickFrom(R, N.alpha), cur = [...(M.d[s + "|" + c] || [])][0];
        const other = pickFrom(R, N.states.filter(x => x !== cur));
        M.d[s + "|" + c] = new Set([other]);
      } else {
        const s = pickFrom(R, N.states);
        M.finals = M.finals.includes(s) ? M.finals.filter(x => x !== s) : [...M.finals, s];
      }
      if (!A.equivalent(N, M).ok) return A.toText(M);
    }
    return A.toText(N).replace(/final: .*/, "final: ∅");
  }

  /* -------------------------------------------------------------- solving (used for grading and for showing solutions) */

  function solve(q) {
    const N = q.src ? A.parse(q.src) : null;
    switch (q.type) {
      case "mcq": return { index: q.key.index, text: q.data.options[q.key.index] };
      case "tf": {
        if (q.key && typeof q.key.value === "boolean") return { value: q.key.value };
        return { value: false };
      }
      case "closure": { const d = A.closureDetail(N, [q.data.state]); return { set: d.set, edges: d.edges }; }
      case "move": { const m = A.moveDetail(N, q.data.set, q.data.sym), c = A.closureDetail(N, m.set); return { set: c.set, move: m.set }; }
      case "accept": return { results: q.data.strings.map(w => A.runNFA(N, A.tokenize(N, w))) };
      case "table": {
        const M = A.build(N);
        return { rows: M.D.map(d => d.set), cells: M.D.map((d, i) => N.alpha.map(c => M.D[M.tm[i + "|" + c]].set)), alpha: N.alpha, M };
      }
      case "count": { const M = A.build(N); return { value: q.data.what === "dfa" ? M.D.length : A.minimize(N, M), dfa: M.D.length, dead: M.D.some(d => d.dead) }; }
      case "classes": { const r = A.minimizeSteps(N); return { classes: r.classes.filter(c => !(r.trap && c.length === 1 && c[0] === r.trap)) }; }
      case "evaluate": { const C = A.parse(q.data.candidate), eq = A.equivalent(N, C); return { correct: eq.ok, counter: eq.ok ? null : eq.counter }; }
      case "construct": { const M = A.build(N); return { text: A.dfaToText(N, M, "letters") }; }
      case "design": return { text: q.data.reference };
      case "short": return { text: (q.data && q.data.model) || "" };
      default: return {};
    }
  }

  /**
   * Grade a response. Returns { score: 0..1, correct, feedback, manual? }.
   * Responses:  mcq {index}  tf {value}  closure/move {text}  accept {values:[bool]}  table {cells:[[text]]}
   *             count {value}  classes {text}  evaluate {verdict:boolean, counter:text}  construct/design {text}  short {self:0|0.5|1}
   */
  function grade(q, r) {
    r = r || {};
    try {
      const sol = solve(q), N = q.src ? A.parse(q.src) : null;
      const res = (score, feedback) => ({ score: Math.max(0, Math.min(1, score)), correct: score >= 0.999, feedback });
      switch (q.type) {
        case "mcq":
          if (r.index == null) return res(0, "No option chosen.");
          return res(r.index === sol.index ? 1 : 0, r.index === sol.index ? "Correct." : `The answer is “${sol.text}”.`);
        case "tf":
          if (typeof r.value !== "boolean") return res(0, "No answer chosen.");
          return res(r.value === sol.value ? 1 : 0, r.value === sol.value ? "Correct." : `The statement is ${sol.value ? "true" : "false"}.`);
        case "closure": case "move": {
          const p = parseSet(N, r.text);
          if (p.error) return res(0, p.error);
          if (sameSet(p.set, sol.set)) return res(1, `Correct: ${fmt(sol.set)}.`);
          if (q.type === "move" && sameSet(p.set, sol.move) && !sameSet(sol.move, sol.set)) return res(0.5, `That is move(S, ${q.data.sym}) = ${fmt(sol.move)}, but you still need its ε-closure: ${fmt(sol.set)}.`);
          if (q.type === "closure" && !p.set.includes(q.data.state)) return res(0, `ε-closure(${q.data.state}) always contains ${q.data.state} itself. The answer is ${fmt(sol.set)}.`);
          const missing = sol.set.filter(x => !p.set.includes(x)), extra = p.set.filter(x => !sol.set.includes(x));
          return res(0, `Not quite. ${missing.length ? "Missing: " + missing.join(", ") + ". " : ""}${extra.length ? "Should not include: " + extra.join(", ") + ". " : ""}The answer is ${fmt(sol.set)}.`);
        }
        case "accept": {
          const v = r.values || [];
          let ok = 0; const wrong = [];
          sol.results.forEach((x, i) => { if (v[i] === x) ok++; else wrong.push(`“${q.data.strings[i] || "ε"}” is ${x ? "accepted" : "rejected"}`); });
          return res(ok / sol.results.length, wrong.length ? `${ok} of ${sol.results.length} right. ${wrong.join("; ")}.` : "All correct.");
        }
        case "table": {
          const cells = r.cells || [];
          let ok = 0, total = 0; const wrong = [];
          sol.cells.forEach((row, i) => row.forEach((target, j) => {
            total++;
            const p = parseSet(N, (cells[i] || [])[j]);
            if (!p.error && sameSet(p.set, target)) ok++;
            else if (wrong.length < 3) wrong.push(`δ(${fmt(sol.rows[i])}, ${sol.alpha[j]}) = ${fmt(target)}`);
          }));
          return res(ok / total, ok === total ? "Every cell is correct." : `${ok} of ${total} cells right. For example: ${wrong.join("; ")}.`);
        }
        case "count": {
          const v = parseInt(r.value, 10);
          if (isNaN(v)) return res(0, "Enter a number.");
          if (v === sol.value) return res(1, `Correct: ${sol.value} states.`);
          let tip = "";
          if (q.data.what === "dfa" && sol.dead && v === sol.value - 1) tip = " Did you forget the dead state ∅?";
          if (q.data.what === "dfa" && v === Math.pow(2, N.states.length)) tip = " 2ⁿ is only the upper bound; count the reachable subsets.";
          if (q.data.what === "minimal" && v === sol.dfa) tip = " That is the size before minimisation.";
          return res(0, `The answer is ${sol.value}.${tip}`);
        }
        case "classes": {
          const text = String(r.text || "").trim();
          if (!text) return res(0, "No answer given.");
          const groups = (text.match(/\{[^}]*\}/g) || text.split(/\n|;/)).map(g => g.replace(/[{}]/g, " ").split(/[,\s]+/).filter(Boolean)).filter(g => g.length);
          const states = sol.classes.flat(), bad = groups.flat().filter(s => !states.includes(s));
          if (bad.length) return res(0, `${bad.join(", ")} ${bad.length > 1 ? "are not states" : "is not a state"} of this DFA.`);
          const where = {}; groups.forEach((g, i) => g.forEach(s => (where[s] = i)));
          const solWhere = {}; sol.classes.forEach((g, i) => g.forEach(s => (solWhere[s] = i)));
          let agree = 0, total = 0;
          for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) {
            total++;
            const a = states[i], b = states[j];
            const mine = where[a] !== undefined && where[a] === where[b], truth = solWhere[a] === solWhere[b];
            if (mine === truth) agree++;
          }
          const exact = agree === total && states.every(s => where[s] !== undefined);
          return res(exact ? 1 : agree / total * 0.8, exact ? "Correct partition." : `${agree} of ${total} state pairs classified correctly. The classes are ${sol.classes.map(c => "{" + c.join(",") + "}").join(" ")}.`);
        }
        case "evaluate": {
          if (typeof r.verdict !== "boolean") return res(0, "Choose whether the DFA is correct.");
          if (sol.correct) return res(r.verdict ? 1 : 0, r.verdict ? "Right: the DFA accepts exactly the NFA's language." : "The DFA is actually correct: it accepts exactly the same strings as the NFA.");
          if (r.verdict) return res(0, `The DFA is wrong. For example “${sol.counter.join("") || "ε"}” is treated differently by the two machines.`);
          const C = A.parse(q.data.candidate), w = A.tokenize(N, r.counter || "");
          if (!String(r.counter || "").trim() && r.counter !== "ε") return res(0.5, `Right verdict. Add a string on which they disagree, for example “${sol.counter.join("") || "ε"}”.`);
          const bad = w.filter(c => !N.alpha.includes(c));
          if (bad.length) return res(0.5, `Right verdict, but “${bad[0]}” is not in the alphabet.`);
          const differs = A.runNFA(N, w) !== A.runNFA(C, w);
          return res(differs ? 1 : 0.5, differs ? "Correct verdict and a valid counter-example." : `Right verdict, but both machines treat “${r.counter}” the same way. Try “${sol.counter.join("") || "ε"}”.`);
        }
        case "construct": case "design": {
          const text = String(r.text || "");
          let S;
          try { S = A.parse(text); } catch (e) { return res(0, "Your automaton could not be read: " + e.message); }
          const Ref = q.type === "design" ? A.parse(q.data.reference) : N, eq = A.equivalent(Ref, S), problems = A.dfaProblems(S), needDFA = q.data && q.data.requireDFA;
          if (!eq.ok) {
            const w = eq.counter.join(Ref.alpha.every(a => a.length === 1) ? "" : " ") || "ε";
            return res(0, `Not equivalent: “${w}” is ${eq.firstAccepts ? "in the language but your machine rejects it" : "not in the language but your machine accepts it"}.`);
          }
          if (needDFA && problems.length) return res(0.5, "Same language, but it is not a valid DFA yet: " + problems[0]);
          return res(1, `Correct: your machine accepts exactly the right language${needDFA ? " and is a valid DFA" : ""} (${S.states.length} states).`);
        }
        case "short":
          if (r.self == null) return { score: 0, correct: false, manual: true, feedback: "Compare with the model answer and mark yourself." };
          return { score: +r.self, correct: +r.self === 1, manual: true, feedback: "Self-marked against the model answer." };
        default: return res(0, "This question type cannot be graded.");
      }
    } catch (e) {
      return { score: 0, correct: false, feedback: "This question could not be graded: " + e.message, error: true };
    }
  }

  function hint(q) {
    switch (q.type) {
      case "closure": return `Start with {${q.data.state}}. Follow every ε-arrow from the states you have, and repeat until nothing new appears.`;
      case "move": return `First collect every state reachable from ${fmt(q.data.set)} by one “${q.data.sym}” arrow. Then take the ε-closure of that set.`;
      case "accept": return "Track the set of active states symbol by symbol, taking the ε-closure after each move. Accept if the final set contains a final state.";
      case "table": return "Row 1 is ε-closure of the start state. Each cell is ε-closure(move(row, symbol)).";
      case "count": return q.data.what === "dfa" ? "Run subset construction and count each new subset, including ∅." : "Build the DFA, then merge states that no string can distinguish.";
      case "classes": return "Mark final/non-final pairs first. Then mark a pair if some symbol sends it to an already-marked pair. Unmarked pairs are equivalent.";
      case "evaluate": return "Test short strings on both machines, or build the DFA yourself and compare.";
      case "construct": return "Begin with ε-closure(start). For each new subset and symbol, compute ε-closure(move). Every subset containing a final NFA state is final.";
      case "design": return "Decide what each state must remember about the input read so far. One state per situation.";
      default: return "Re-read the definition involved, then try a small example.";
    }
  }

  /** Human-readable full solution. */
  function explain(q) {
    try {
      const s = solve(q);
      switch (q.type) {
        case "mcq": return q.explanation ? `${s.text}. ${q.explanation}` : s.text;
        case "tf": return (s.value ? "True. " : "False. ") + (q.explanation || "");
        case "closure": return `ε-closure(${q.data.state}) = ${fmt(s.set)}` + (s.edges.length ? ` via ${s.edges.map(e => e[0] + "→" + e[2]).join(", ")}.` : " (no ε-moves leave it).");
        case "move": return `move(${fmt(q.data.set)}, ${q.data.sym}) = ${fmt(s.move)}; ε-closure of that = ${fmt(s.set)}.`;
        case "accept": return q.data.strings.map((w, i) => `“${w || "ε"}”: ${s.results[i] ? "accepted" : "rejected"}`).join("; ") + ".";
        case "table": return s.rows.map((r, i) => `${fmt(r)}: ` + s.alpha.map((c, j) => `${c}→${fmt(s.cells[i][j])}`).join(", ")).join("\n");
        case "count": return `${s.value} states.`;
        case "classes": return s.classes.map(c => "{" + c.join(",") + "}").join(" ");
        case "evaluate": return s.correct ? "The DFA is correct." : `The DFA is incorrect; shortest disagreement: “${s.counter.join("") || "ε"}”.`;
        default: return s.text || "";
      }
    } catch (e) { return ""; }
  }

  /* -------------------------------------------------------------- exams */

  /** Build an exam that walks up Bloom's levels. opts: { count, difficulty, blooms, seed, bank } */
  function makeExam(opts) {
    opts = opts || {};
    const R = A.rng(opts.seed == null ? Date.now() : opts.seed);
    const count = Math.min(Math.max(+opts.count || 8, 1), 25);
    const blooms = opts.blooms && opts.blooms.length ? opts.blooms : BLOOM;
    const genTypes = Object.keys(TYPES).filter(t => t !== "short" && blooms.includes(TYPES[t].bloom));
    const bank = (opts.bank || []).map(fromBank).filter(q => q && blooms.includes(q.bloom) && (!opts.difficulty || opts.difficulty === "Mixed" || q.difficulty === opts.difficulty));
    const out = [];
    const bankShare = Math.min(bank.length, Math.round(count * (opts.bankShare != null ? opts.bankShare : 0.4)));
    shuffle(R, bank).slice(0, bankShare).forEach(q => out.push(q));
    let i = 0;
    while (out.length < count && genTypes.length) {
      const type = genTypes[i % genTypes.length];
      const diff = opts.difficulty && opts.difficulty !== "Mixed" ? opts.difficulty : ["Easy", "Medium", "Hard"][Math.floor(R() * 3)];
      try { out.push(makeQuestion(type, { difficulty: diff, seed: Math.floor(R() * 1e9) })); } catch (e) { /* skip */ }
      i++;
      if (i > count * 4) break;
    }
    return out.sort((a, b) => BLOOM.indexOf(a.bloom) - BLOOM.indexOf(b.bloom));
  }

  /* -------------------------------------------------------------- question bank (manual questions) */

  const BANK_TYPES = ["construct", "design", "accept", "closure", "count", "mcq", "tf", "short"];

  /** Validate a teacher-written question. Returns a list of problems (empty when valid). */
  function validateBank(rec) {
    const e = [];
    if (!rec || typeof rec !== "object") return ["The question is empty."];
    if (!BANK_TYPES.includes(rec.type)) e.push("Choose a question type.");
    const text = String(rec.text || "").trim();
    if (text.length < 5) e.push("Write the question text (at least 5 characters).");
    if (text.length > 1200) e.push("The question text is too long (1200 characters maximum).");
    if (rec.bloom && !BLOOM.includes(rec.bloom)) e.push("Unknown Bloom level.");
    const needsSrc = ["construct", "accept", "closure", "count"].includes(rec.type);
    let N = null;
    if (needsSrc) {
      try { N = A.parse(String(rec.src || "")); A.build(N); } catch (err) { e.push("Automaton: " + err.message); }
    }
    if (rec.type === "design") {
      try { A.parse(String(rec.reference || "")); } catch (err) { e.push("Reference automaton: " + err.message); }
    }
    if (rec.type === "accept" && N) {
      const strings = (rec.strings || []).map(String).filter(s => s.length || s === "");
      if (!strings.length) e.push("Add at least one test string.");
      if (strings.length > 10) e.push("Use at most 10 test strings.");
      strings.forEach(w => { const bad = A.tokenize(N, w).filter(c => !N.alpha.includes(c)); if (bad.length) e.push(`String “${w}” uses “${bad[0]}”, which is not in the alphabet.`); });
    }
    if (rec.type === "closure" && N && !N.states.includes(rec.state)) e.push("Choose a state of the automaton for the ε-closure.");
    if (rec.type === "count" && !["dfa", "minimal"].includes(rec.what)) e.push("Choose what to count.");
    if (rec.type === "mcq") {
      const o = (rec.options || []).map(x => String(x).trim()).filter(Boolean);
      if (o.length < 2) e.push("Give at least two options.");
      if (o.length > 6) e.push("Use at most six options.");
      if (new Set(o).size !== o.length) e.push("Options must be different.");
      if (!(rec.answer >= 0 && rec.answer < o.length)) e.push("Mark the correct option.");
    }
    if (rec.type === "tf" && typeof rec.answer !== "boolean") e.push("Choose whether the statement is true or false.");
    if (rec.type === "short" && String(rec.model || "").trim().length < 5) e.push("Write a model answer.");
    return e;
  }

  /** Normalise a bank record (also used by the server before saving). */
  function cleanBank(rec) {
    const t = rec.type, type = TYPES[t] || TYPES.short;
    const out = {
      id: String(rec.id || uid("b")).slice(0, 40), type: t, text: String(rec.text || "").trim().slice(0, 1200),
      bloom: BLOOM.includes(rec.bloom) ? rec.bloom : type.bloom, difficulty: ["Easy", "Medium", "Hard"].includes(rec.difficulty) ? rec.difficulty : "Medium",
      marks: Math.min(Math.max(+rec.marks || 5, 1), 20), lo: OUTCOMES[rec.lo] ? rec.lo : type.lo, author: String(rec.author || "").slice(0, 60), origin: rec.origin === "ai" ? "ai" : "manual",
      at: rec.at || new Date().toISOString()
    };
    if (["construct", "accept", "closure", "count"].includes(t)) out.src = String(rec.src || "").slice(0, 6000);
    if (t === "design") { out.reference = String(rec.reference || "").slice(0, 6000); out.requireDFA = !!rec.requireDFA; }
    if (t === "accept") out.strings = (rec.strings || []).map(s => String(s).slice(0, 60)).slice(0, 10);
    if (t === "closure") out.state = String(rec.state || "");
    if (t === "count") out.what = rec.what === "minimal" ? "minimal" : "dfa";
    if (t === "mcq") { out.options = (rec.options || []).map(x => String(x).trim()).filter(Boolean).slice(0, 6); out.answer = +rec.answer; out.explanation = String(rec.explanation || "").slice(0, 600); }
    if (t === "tf") { out.answer = !!rec.answer; out.explanation = String(rec.explanation || "").slice(0, 600); }
    if (t === "short") out.model = String(rec.model || "").slice(0, 2000);
    return out;
  }

  /** Turn a bank record into a gradable question. */
  function fromBank(rec) {
    if (validateBank(rec).length) return null;
    const t = rec.type, base = { id: rec.id, type: t, prompt: rec.text, difficulty: rec.difficulty || "Medium", marks: rec.marks || 5, bloom: rec.bloom || TYPES[t].bloom, verb: TYPES[t].verb, lo: rec.lo || TYPES[t].lo, source: rec.origin === "ai" ? "ai" : "bank" };
    switch (t) {
      case "construct": return { ...base, src: rec.src, data: { requireDFA: true } };
      case "design": return { ...base, data: { requireDFA: !!rec.requireDFA, reference: rec.reference, language: rec.text } };
      case "accept": return { ...base, src: rec.src, data: { strings: rec.strings } };
      case "closure": return { ...base, src: rec.src, data: { state: rec.state } };
      case "count": return { ...base, src: rec.src, data: { what: rec.what } };
      case "mcq": return { ...base, data: { options: rec.options }, key: { index: rec.answer }, explanation: rec.explanation };
      case "tf": return { ...base, key: { value: rec.answer }, explanation: rec.explanation };
      case "short": return { ...base, data: { model: rec.model } };
    }
    return null;
  }

  const API = { BLOOM, OUTCOMES, TYPES, DIFF, CONCEPTS, LANGS, BANK_TYPES, parseSet, makeQuestion, makeExam, solve, grade, hint, explain, validateBank, cleanBank, fromBank };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.QGen = API;
})(typeof window !== "undefined" ? window : globalThis);
