(function (root) {
  "use strict";

  const LIMITS = { states: 30, symbols: 10, dfaStates: 300, textChars: 20000, lines: 400, nameLength: 14, stringLength: 200 };
  const EPS_WORDS = new Set(["e", "ε", "eps", "epsilon", "λ", "lambda"]);
  const EMPTY_WORDS = new Set(["∅", "-", "{}", "phi", "null", "none"]);
  const NAME_RE = /^[\p{L}\p{N}_'.]+$/u;

  const isEps = x => typeof x === "string" && (EPS_WORDS.has(x) || EPS_WORDS.has(x.toLowerCase()));
  const isEmptyWord = x => typeof x === "string" && (EMPTY_WORDS.has(x) || EMPTY_WORDS.has(x.toLowerCase()));

  const splitList = s => s.replace(/[{}()]/g, " ").split(/[,\s]+/).filter(Boolean);

  function rng(seed) {
    if (seed == null) return Math.random;
    let a = (typeof seed === "number" ? seed : hash(String(seed))) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

  function fail(message, code) { const e = new Error(message); e.code = code || "INVALID"; throw e; }

  const fmtSet = a => (a && a.length ? "{" + a.join(",") + "}" : "∅");

  function parse(text, opts) {
    opts = opts || {};
    const maxStates = opts.maxStates || LIMITS.states;
    if (typeof text !== "string") fail("The automaton must be given as text.");
    text = text.replace(/^\uFEFF/, "");
    if (!text.trim()) fail("The input is empty. Write a start state and some transitions, or pick an example.", "EMPTY");
    if (text.length > LIMITS.textChars) fail(`The input is too long (${text.length} characters, limit ${LIMITS.textChars}).`);
    const lines = text.split(/\r?\n/);
    if (lines.length > LIMITS.lines) fail(`Too many lines (${lines.length}, limit ${LIMITS.lines}).`);

    const N = { states: [], start: null, finals: [], d: {}, alpha: [], ord: {}, warn: [], hasEps: false, declaredAlpha: false };
    const alpha = new Set(), declStates = new Set(), declAlpha = new Set();
    let hasStatesLine = false, duplicates = 0, emptyTargets = 0;

    const checkName = (name, lineNo) => {
      if (name.length > LIMITS.nameLength) fail(`Line ${lineNo}: state name “${name}” is longer than ${LIMITS.nameLength} characters.`);
      if (!NAME_RE.test(name)) fail(`Line ${lineNo}: “${name}” is not a valid state name. Use letters, digits, _ or '.`);
      if (isEps(name)) fail(`Line ${lineNo}: “${name}” is reserved for ε and cannot be a state name.`);
    };
    const checkSymbol = (sym, lineNo) => {
      if (sym.length > 6) fail(`Line ${lineNo}: symbol “${sym}” is longer than 6 characters.`);
      if (!NAME_RE.test(sym)) fail(`Line ${lineNo}: “${sym}” is not a valid input symbol.`);
    };

    lines.forEach((raw, i) => {
      const lineNo = i + 1;
      const line = raw.split("#")[0].split("//")[0].trim();
      if (!line) return;
      let m;
      if ((m = line.match(/^(?:states?|Q)\s*[:=]\s*(.*)$/i))) {
        hasStatesLine = true;
        splitList(m[1]).forEach(s => { checkName(s, lineNo); declStates.add(s); });
      } else if ((m = line.match(/^(?:alphabet|sigma|symbols|Σ)\s*[:=]\s*(.*)$/i))) {
        N.declaredAlpha = true;
        splitList(m[1]).forEach(s => {
          if (isEps(s)) fail(`Line ${lineNo}: ε cannot be an input symbol — it means “no input”.`);
          checkSymbol(s, lineNo); declAlpha.add(s); alpha.add(s);
        });
      } else if ((m = line.match(/^(?:start|initial)\s*[:=]\s*(.*)$/i))) {
        const list = splitList(m[1]);
        if (list.length !== 1) fail(`Line ${lineNo}: exactly one start state is allowed (found ${list.length || "none"}).`, "START");
        checkName(list[0], lineNo);
        if (N.start && N.start !== list[0]) fail(`Only one start state is allowed (found “${N.start}” and “${list[0]}”).`, "START");
        N.start = list[0];
      } else if ((m = line.match(/^(?:finals?|accepting|accept|F)\s*[:=]\s*(.*)$/i))) {
        splitList(m[1]).filter(x => !isEmptyWord(x)).forEach(s => { checkName(s, lineNo); N.finals.push(s); });
      } else {
        const l2 = line.replace(/^(?:δ|delta|d)\s*\(/i, "").replace(/\)\s*(?==|->|→)/, "");
        m = l2.match(/^(\S+?)\s*,\s*(\S+?)\s*(?:=|->|→)\s*(.*)$/) || l2.match(/^(\S+?)\s*-+\s*(\S+?)\s*-+>\s*(.*)$/);
        if (!m) fail(`Line ${lineNo}: cannot read “${line}”. Expected something like  q0,a = q1  or  start: q0.`, "SYNTAX");
        const from = m[1], symRaw = m[2];
        checkName(from, lineNo);
        const sym = isEps(symRaw) ? "ε" : symRaw;
        if (sym !== "ε") {
          checkSymbol(sym, lineNo);
          if (N.declaredAlpha && !declAlpha.has(sym)) fail(`Line ${lineNo}: symbol “${sym}” is not in the declared alphabet {${[...declAlpha].join(",")}}.`, "ALPHABET");
          alpha.add(sym);
        } else N.hasEps = true;
        const key = from + "|" + sym;
        N.d[key] = N.d[key] || new Set();
        const targets = splitList(m[3]).filter(x => !isEmptyWord(x));
        if (!targets.length) emptyTargets++;
        for (const t of targets) {
          checkName(t, lineNo);
          if (N.d[key].has(t)) duplicates++;
          N.d[key].add(t);
        }
      }
    });

    if (!N.start) fail("Missing “start:” line — every automaton needs exactly one start state.", "NO_START");
    N.finals = [...new Set(N.finals)];
    const used = new Set([N.start, ...N.finals]);
    for (const k in N.d) { used.add(k.split("|")[0]); N.d[k].forEach(x => used.add(x)); }
    if (hasStatesLine) {
      const undeclared = [...used].filter(x => !declStates.has(x));
      if (undeclared.length) fail("Undeclared state(s): " + undeclared.join(", ") + " — add them to “states:” or delete the “states:” line.", "UNDECLARED");
    }

    N.states = hasStatesLine ? [...declStates] : [...used].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (N.states.length > maxStates) fail(`The automaton has ${N.states.length} states; the limit is ${maxStates} because the DFA can need up to 2^n subsets.`, "TOO_BIG");
    N.alpha = [...alpha].sort();
    if (N.alpha.length > LIMITS.symbols) fail(`The alphabet has ${N.alpha.length} symbols; the limit is ${LIMITS.symbols}.`);
    N.states.forEach((s, i) => (N.ord[s] = i));
    N.hasEps = Object.keys(N.d).some(k => k.endsWith("|ε") && N.d[k].size > 0);

    const seen = new Set([N.start]), stack = [N.start];
    while (stack.length) {
      const s = stack.pop();
      for (const c of [...N.alpha, "ε"]) for (const t of N.d[s + "|" + c] || []) if (!seen.has(t)) { seen.add(t); stack.push(t); }
    }
    N.unreachable = N.states.filter(x => !seen.has(x));
    const unusedSymbols = N.alpha.filter(c => !Object.keys(N.d).some(k => k.endsWith("|" + c) && N.d[k].size));

    if (!N.alpha.length) N.warn.push("No input symbols: the language can only be {ε} or ∅.");
    if (!N.finals.length) N.warn.push("No final state: the language is empty (∅).");
    if (N.finals.includes(N.start)) N.warn.push("The start state is final, so ε (the empty string) is accepted.");
    if (N.unreachable.length) N.warn.push("Unreachable state(s) ignored: " + N.unreachable.join(", ") + ".");
    if (unusedSymbols.length) N.warn.push("Declared symbol(s) never used: " + unusedSymbols.join(", ") + " — they always lead to the dead state.");
    if (duplicates) N.warn.push(duplicates + " duplicate transition target(s) merged.");
    if (emptyTargets) N.warn.push(emptyTargets + " transition(s) to ∅ written explicitly (same as leaving them out).");
    if (findEpsCycle(N)) N.warn.push("ε-cycle detected — ε-closure handles it; the states on the cycle always appear together.");
    return N;
  }

  function findEpsCycle(N) {
    const colour = {};
    const dfs = s => {
      colour[s] = 1;
      for (const t of N.d[s + "|ε"] || []) {
        if (colour[t] === 1) return true;
        if (!colour[t] && dfs(t)) return true;
      }
      colour[s] = 2;
      return false;
    };
    return N.states.some(s => !colour[s] && dfs(s));
  }

  const sortStates = (N, S) => [...S].sort((a, b) => N.ord[a] - N.ord[b]);
  const isAccepting = (N, S) => S.some(s => N.finals.includes(s));

  function closureDetail(N, S) {
    const result = new Set(S), stack = [...S], edges = [];
    while (stack.length) {
      const s = stack.pop();
      for (const t of N.d[s + "|ε"] || []) {
        edges.push([s, "ε", t]);
        if (!result.has(t)) { result.add(t); stack.push(t); }
      }
    }
    const sorted = sortStates(N, result);
    return { set: sorted, added: sorted.filter(x => !S.includes(x)), edges };
  }
  const closure = (N, S) => closureDetail(N, S).set;

  function moveDetail(N, S, c) {
    const out = new Set(), edges = [];
    for (const s of S) for (const t of N.d[s + "|" + c] || []) { out.add(t); edges.push([s, c, t]); }
    return { set: sortStates(N, out), edges };
  }

  function build(N, opts) {
    const maxStates = (opts && opts.maxStates) || LIMITS.dfaStates;
    const init = closureDetail(N, [N.start]);
    const D = [{ set: init.set }], index = { [init.set.join(",")]: 0 }, trans = [];
    const steps = [{ type: "init", closure: init.set, move: [N.start], added: init.added, epsEdges: init.edges, moveEdges: [], to: 0, isNew: true }];
    for (let i = 0; i < D.length; i++) {
      for (const c of N.alpha) {
        const mv = moveDetail(N, D[i].set, c), cl = closureDetail(N, mv.set), k = cl.set.join(",");
        let isNew = false;
        if (!(k in index)) {
          index[k] = D.length; D.push({ set: cl.set }); isNew = true;
          if (D.length > maxStates) fail(`The DFA would need more than ${maxStates} states (exponential blow-up). Use a smaller NFA.`, "DFA_TOO_BIG");
        }
        trans.push({ f: i, c, t: index[k], step: steps.length });
        steps.push({ type: "move", from: i, c, move: mv.set, moveEdges: mv.edges, closure: cl.set, added: cl.added, epsEdges: cl.edges, to: index[k], isNew });
      }
    }
    D.forEach((d, i) => {
      d.fin = isAccepting(N, d.set);
      d.dead = d.set.length === 0;
      d.discovered = steps.findIndex(s => s.to === i && s.isNew);
    });
    const tm = {};
    trans.forEach(t => (tm[t.f + "|" + t.c] = t.t));
    return { D, trans, steps, tm };
  }

  function dfaName(M, i, mode) {
    if (mode === "letters") {
      let n = i, s = "";
      do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
      return s;
    }
    if (mode === "sets") return fmtSet(M.D[i].set);
    return "D" + i;
  }

  function dfaToText(N, M, mode) {
    const nm = i => (mode === "letters" ? dfaName(M, i, "letters") : "D" + i);
    const fin = M.D.map((d, i) => (d.fin ? nm(i) : null)).filter(Boolean);
    const lines = ["# DFA from subset construction", "states: " + M.D.map((_, i) => nm(i)).join(", ")];
    if (N.alpha.length) lines.push("alphabet: " + N.alpha.join(", "));
    lines.push("start: " + nm(0), "final: " + (fin.length ? fin.join(", ") : "∅"));
    M.D.forEach((d, i) => lines.push(`# ${nm(i)} = ${fmtSet(d.set)}`));
    M.trans.forEach(t => lines.push(`${nm(t.f)},${t.c} = ${nm(t.t)}`));
    return lines.join("\n");
  }

  function toText(N) {
    const lines = ["states: " + N.states.join(", ")];
    if (N.alpha.length) lines.push("alphabet: " + N.alpha.join(", "));
    lines.push("start: " + N.start, "final: " + (N.finals.length ? N.finals.join(", ") : "∅"));
    for (const s of N.states) for (const c of [...N.alpha, "ε"]) {
      const t = N.d[s + "|" + c];
      if (t && t.size) lines.push(`${s},${c} = ${sortStates(N, t).join(",")}`);
    }
    return lines.join("\n");
  }

  function dfaProblems(N) {
    const p = [];
    if (N.hasEps) p.push("It still has ε-moves; a DFA cannot have ε-transitions.");
    for (const s of N.states) for (const c of N.alpha) {
      const n = (N.d[s + "|" + c] || new Set()).size;
      if (n > 1) p.push(`${s} on “${c}” has ${n} targets; a DFA needs exactly one.`);
      else if (n === 0) p.push(`${s} on “${c}” has no target; add a dead (trap) state.`);
    }
    return p.slice(0, 8);
  }
  const isDeterministic = N => !N.hasEps && N.states.every(s => N.alpha.every(c => (N.d[s + "|" + c] || new Set()).size <= 1));

  const runNFA = (N, w) => { let S = closure(N, [N.start]); for (const c of w) S = closure(N, moveDetail(N, S, c).set); return isAccepting(N, S); };
  const runDFA = (N, M, w) => { let s = 0; for (const c of w) { const t = M.tm[s + "|" + c]; if (t === undefined) return false; s = t; } return M.D[s].fin; };

  function generate(n, k, eps, seed) {
    const opts = typeof n === "object" && n !== null ? n : { n, k, eps, seed };
    const N0 = Math.min(Math.max(+opts.n || 4, 2), 7), K = Math.min(Math.max(+opts.k || 2, 1), 4);
    const minDfa = opts.minDfa || 3, maxDfa = opts.maxDfa || 14, R = rng(opts.seed);
    const al = "abcd".slice(0, K).split(""), S = [...Array(N0)].map((_, i) => "q" + i), pick = a => a[Math.floor(R() * a.length)];
    let fallback = null;
    for (let tries = 0; tries < 150; tries++) {
      const L = ["states: " + S.join(","), "alphabet: " + al.join(","), "start: q0"];
      const fin = S.filter((s, i) => i > 0 && R() < 0.35);
      if (!fin.length) fin.push(S[N0 - 1]);
      L.push("final: " + fin.join(","));
      for (const s of S) {
        for (const c of al) { const t = new Set(); if (R() < 0.8) t.add(pick(S)); if (R() < 0.3) t.add(pick(S)); if (t.size) L.push(`${s},${c} = ${[...t].join(",")}`); }
        if (opts.eps && R() < 0.4) { const t = pick(S); if (t !== s) L.push(`${s},ε = ${t}`); }
      }
      const src = L.join("\n");
      try {
        const N = parse(src);
        if (N.alpha.length !== K || N.unreachable.length) continue;
        if (opts.eps && !N.hasEps) continue;
        const D = build(N).D.length;
        if (D >= minDfa && D <= maxDfa) return src;
        fallback = fallback || src;
      } catch (e) {  }
    }
    return fallback || "states: q0,q1,q2\nalphabet: a,b\nstart: q0\nfinal: q2\nq0,a = q0,q1\nq0,b = q0\nq1,b = q2";
  }

  function regexToNFA(re) {
    if (typeof re !== "string") fail("The regular expression must be text.");
    const src = re.replace(/\s+/g, "").replace(/eps(ilon)?/gi, "ε").replace(/λ/g, "ε");
    if (!src) fail("The regular expression is empty.", "EMPTY");
    if (src.length > 40) fail(`The regular expression is too long (${src.length} characters, limit 40).`);
    let pos = 0;
    const peek = () => src[pos];
    const isSym = ch => ch !== undefined && /[a-zA-Z0-9ε∅]/.test(ch);
    const where = () => `at position ${pos + 1}`;
    function parseUnion() {
      const parts = [parseConcat()];
      while (peek() === "|" || peek() === "+") {
        pos++;
        if (peek() === undefined || peek() === ")" || peek() === "|" || peek() === "+") fail(`Missing expression after the union operator ${where()}.`, "REGEX");
        parts.push(parseConcat());
      }
      return parts.length === 1 ? parts[0] : { op: "union", parts };
    }
    function parseConcat() {
      const parts = [];
      while (peek() !== undefined && peek() !== ")" && peek() !== "|" && peek() !== "+") parts.push(parseStar());
      if (!parts.length) fail(`Expected a symbol or “(” ${where()}.`, "REGEX");
      return parts.length === 1 ? parts[0] : { op: "concat", parts };
    }
    function parseStar() {
      let node = parseAtom();
      while (peek() === "*" || peek() === "?") { node = { op: peek() === "*" ? "star" : "opt", parts: [node] }; pos++; }
      return node;
    }
    function parseAtom() {
      const ch = peek();
      if (ch === "(") {
        pos++;
        if (peek() === ")") fail(`Empty parentheses ${where()}. Write ε for the empty string.`, "REGEX");
        const n = parseUnion();
        if (peek() !== ")") fail(`Missing “)” ${where()}.`, "REGEX");
        pos++;
        return n;
      }
      if (ch === "*" || ch === "?") fail(`“${ch}” has nothing before it ${where()}.`, "REGEX");
      if (ch === ")") fail(`Unexpected “)” ${where()}.`, "REGEX");
      if (!isSym(ch)) fail(`“${ch}” is not allowed ${where()}. Use letters, digits, | + * ? ( ) and ε.`, "REGEX");
      pos++;
      return { op: "sym", sym: ch };
    }
    const ast = parseUnion();
    if (pos < src.length) fail(`Unexpected “${src[pos]}” ${where()}.`, "REGEX");

    let n = 0;
    const T = [], frags = [];
    const ns = () => "t" + n++;
    const add = (a, c, b) => T.push([a, c, b]);
    function thompson(node) {
      let s, f;
      if (node.op === "sym") {
        s = ns(); f = ns();
        if (node.sym !== "∅") add(s, node.sym, f);
        frags.push({ kind: node.sym === "ε" ? "ε" : node.sym === "∅" ? "∅" : "symbol " + node.sym, start: s, end: f });
      } else if (node.op === "concat") {
        const fs = node.parts.map(thompson);
        for (let i = 0; i < fs.length - 1; i++) add(fs[i][1], "ε", fs[i + 1][0]);
        s = fs[0][0]; f = fs[fs.length - 1][1];
        frags.push({ kind: "concatenation", start: s, end: f });
      } else if (node.op === "union") {
        s = ns();
        const fs = node.parts.map(thompson);
        f = ns();
        fs.forEach(([a, b]) => { add(s, "ε", a); add(b, "ε", f); });
        frags.push({ kind: "union", start: s, end: f });
      } else {
        s = ns();
        const [a, b] = thompson(node.parts[0]);
        f = ns();
        add(s, "ε", a); add(b, "ε", f); add(s, "ε", f);
        if (node.op === "star") add(b, "ε", a);
        frags.push({ kind: node.op === "star" ? "Kleene star" : "optional (?)", start: s, end: f });
      }
      return [s, f];
    }
    const [s0, f0] = thompson(ast);
    if (n > LIMITS.states) fail(`Thompson's construction needs ${n} states here; the limit is ${LIMITS.states}. Shorten the expression.`, "TOO_BIG");
    const grouped = {};
    T.forEach(([a, c, b]) => (grouped[a + "|" + c] = grouped[a + "|" + c] || []).push(b));
    const lines = [`# Thompson ε-NFA for ${re.trim()}`, "states: " + Array.from({ length: n }, (_, i) => "t" + i).join(", "), "start: " + s0, "final: " + f0,
      ...Object.entries(grouped).map(([k, v]) => `${k.split("|")[0]},${k.split("|")[1]} = ${v.join(",")}`)];
    return { text: lines.join("\n"), states: n, fragments: frags, normalized: src };
  }

  // Eliminate ε-moves: ε-NFA -> equivalent NFA with the SAME states and no ε.
  // Standard construction:  δ'(q,a) = ε-closure( move( ε-closure(q), a ) );
  // q is final in the new NFA iff ε-closure(q) contains an original final state.
  function removeEps(N) {
    const elim = buildEpsElimination(N);
    return elim ? elim.NE : N;
  }

  // Detailed step-by-step ε-elimination: generates every minute calculation step
  // including state-by-state ε-closures, final state determination, and δ'(q, a) moves.
  function buildEpsElimination(N) {
    if (!N) return null;
    const closures = {}; // q -> closureDetail
    const finalNotes = {}; // q -> { isFinal, reachingFinals }
    const steps = [];
    const NE_d = {};
    const NE_finals = [];
    const trans = [];

    // Step 0: Overview step
    const allEpsEdges = [];
    for (const s of N.states) {
      for (const t of N.d[s + "|ε"] || []) allEpsEdges.push([s, "ε", t]);
    }
    steps.push({
      type: "overview",
      desc: N.hasEps
        ? `This is an ε-NFA with ${N.states.length} states and ${allEpsEdges.length} ε-transition(s). To eliminate ε-moves, we compute δ'(q,a) = ε-closure(move(ε-closure(q), a)). A state q is accepting in the new NFA iff its ε-closure contains an original final state.`
        : `This automaton has no ε-moves. Its ε-elimination is identical to the original automaton.`,
      hotEdges: allEpsEdges,
      closure: [],
      move: [],
      added: [],
      epsEdges: allEpsEdges,
      moveEdges: []
    });

    // Stage 1.A & 1.B: For each state, compute its ε-closure and accepting status
    for (const q of N.states) {
      const cl = closureDetail(N, [q]);
      closures[q] = cl;
      const reachingFinals = cl.set.filter(s => N.finals.includes(s));
      const isFin = reachingFinals.length > 0;
      if (isFin) NE_finals.push(q);
      finalNotes[q] = { isFinal: isFin, reachingFinals };

      steps.push({
        type: "closure",
        state: q,
        closure: cl.set,
        added: cl.added,
        epsEdges: cl.edges,
        move: [q],
        moveEdges: [],
        isFinal: isFin,
        reachingFinals,
        desc: `Compute ε-closure(${q}) = {${cl.set.join(", ")}}. ${cl.added.length ? `Following ε-moves reaches ${cl.added.join(", ")} via ${cl.edges.map(e => e[0] + "–ε→" + e[2]).join(", ")}.` : `No outgoing ε-moves leave ${q}.`} ${isFin ? `Since original final state ${reachingFinals.join(", ")} is in this closure, ${q} is an ACCEPTING state in the new NFA.` : `No original final state is reached on ε, so ${q} is non-accepting in the new NFA.`}`
      });
    }

    // Stage 1.C: For each state q and input symbol a, compute δ'(q, a)
    for (const q of N.states) {
      const clQ = closures[q].set;
      for (const a of N.alpha) {
        const mv = moveDetail(N, clQ, a);
        const clMove = closureDetail(N, mv.set);
        const targets = clMove.set;

        if (targets.length) {
          NE_d[q + "|" + a] = new Set(targets);
          targets.forEach(t => trans.push({ from: q, sym: a, to: t, step: steps.length }));
        }

        steps.push({
          type: "trans",
          state: q,
          sym: a,
          clQ,
          move: mv.set,
          moveEdges: mv.edges,
          closure: targets,
          added: clMove.added,
          epsEdges: clMove.edges,
          targets,
          transCount: targets.length,
          desc: `Compute δ'(${q}, ${a}) = ε-closure(move(ε-closure(${q}), ${a})):
1. ε-closure(${q}) = {${clQ.join(", ")}}
2. move({${clQ.join(", ")}}, ${a}) = {${mv.set.join(", ") || "∅"}} ${mv.edges.length ? `via ${mv.edges.map(e => e[0] + "–" + a + "→" + e[2]).join(", ")}` : ""}
3. ε-closure({${mv.set.join(", ") || "∅"}}) = {${targets.join(", ") || "∅"}}
Result: in the ε-free NFA, add transition δ'(${q}, ${a}) = {${targets.join(", ") || "∅"}}`
        });
      }
    }

    const NE = {
      states: N.states.slice(),
      start: N.start,
      finals: [...new Set(NE_finals)],
      d: NE_d,
      alpha: N.alpha.slice(),
      ord: N.ord,
      warn: [],
      hasEps: false,
      declaredAlpha: N.declaredAlpha,
      unreachable: []
    };

    return { closures, finalNotes, steps, trans, NE };
  }

  const API = {
    LIMITS, fmtSet, rng, parse, build, isDeterministic, dfaProblems, dfaName, dfaToText, toText,
    closure, closureDetail, moveDetail, runNFA, runDFA, generate, regexToNFA, removeEps, buildEpsElimination
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Automata = API;
})(typeof window !== "undefined" ? window : globalThis);
