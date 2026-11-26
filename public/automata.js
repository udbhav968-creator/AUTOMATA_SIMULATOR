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

    // Structured edge case flags
    N.hasEpsCycle = Boolean(findEpsCycle(N));
    N.unreachableStates = N.unreachable || [];
    N.unusedSymbols = unusedSymbols || [];
    N.isEmptyLanguage = !N.finals.length || !N.finals.some(f => seen.has(f));
    N.isSingleState = N.states.length === 1;
    N.allAccepting = N.states.length > 0 && N.states.every(s => N.finals.includes(s));
    N.allRejecting = N.finals.length === 0;

    const startClosure = closure(N, [N.start]);
    N.acceptsEpsilon = startClosure.some(s => N.finals.includes(s));

    if (!N.alpha.length) N.warn.push("No input symbols: the language can only be {ε} or ∅.");
    if (!N.finals.length) N.warn.push("No final state: the language is empty (∅).");
    if (N.finals.includes(N.start)) N.warn.push("The start state is final, so ε (the empty string) is accepted.");
    if (N.unreachable.length) N.warn.push("Unreachable state(s) ignored: " + N.unreachable.join(", ") + ".");
    if (unusedSymbols.length) N.warn.push("Declared symbol(s) never used: " + unusedSymbols.join(", ") + " — they always lead to the dead state.");
    if (duplicates) N.warn.push(duplicates + " duplicate transition target(s) merged.");
    if (emptyTargets) N.warn.push(emptyTargets + " transition(s) to ∅ written explicitly (same as leaving them out).");
    if (N.hasEpsCycle) N.warn.push("ε-cycle detected — ε-closure handles it; the states on the cycle always appear together.");
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
    let cycleDetected = false;
    while (stack.length) {
      const s = stack.pop();
      for (const t of N.d[s + "|ε"] || []) {
        edges.push([s, "ε", t]);
        if (!result.has(t)) {
          result.add(t);
          stack.push(t);
        } else {
          cycleDetected = true;
        }
      }
    }
    const sorted = sortStates(N, result);
    return { set: sorted, added: sorted.filter(x => !S.includes(x)), edges, cycleDetected };
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
    const steps = [{ type: "init", closure: init.set, move: [N.start], added: init.added, epsEdges: init.edges, moveEdges: [], to: 0, isNew: true, cycleDetected: init.cycleDetected }];
    for (let i = 0; i < D.length; i++) {
      for (const c of N.alpha) {
        const mv = moveDetail(N, D[i].set, c), cl = closureDetail(N, mv.set), k = cl.set.join(",");
        let isNew = false;
        if (!(k in index)) {
          index[k] = D.length; D.push({ set: cl.set }); isNew = true;
          if (D.length > maxStates) fail(`The DFA would need more than ${maxStates} states (exponential blow-up). Use a smaller NFA.`, "DFA_TOO_BIG");
        }
        const isDeadTransition = cl.set.length === 0;
        trans.push({ f: i, c, t: index[k], step: steps.length });
        steps.push({
          type: "move", from: i, c, move: mv.set, moveEdges: mv.edges, closure: cl.set, added: cl.added,
          epsEdges: cl.edges, to: index[k], isNew, cycleDetected: cl.cycleDetected, isDeadTransition
        });
      }
    }
    D.forEach((d, i) => {
      d.fin = isAccepting(N, d.set);
      d.dead = d.set.length === 0;
      d.discovered = steps.findIndex(s => s.to === i && s.isNew);
    });
    const tm = {};
    trans.forEach(t => (tm[t.f + "|" + t.c] = t.t));
    return {
      D, trans, steps, tm,
      hasDeadState: D.some(d => d.dead),
      deadStateIndex: D.findIndex(d => d.dead)
    };
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

  // Stage 3: Hopcroft Partition Refinement DFA Minimization
  function minimizeDFA(N, M) {
    if (!M || !M.D || !M.D.length) return null;
    const alpha = N.alpha.slice();

    // 1. Reachable states from start state 0
    const reachable = new Set([0]);
    const queue = [0];
    while (queue.length) {
      const u = queue.shift();
      for (const c of alpha) {
        const v = M.tm[u + "|" + c];
        if (v !== undefined && !reachable.has(v)) {
          reachable.add(v);
          queue.push(v);
        }
      }
    }
    const states = [...reachable].sort((a, b) => a - b);

    // 2. Initial partition: Accepting vs Non-Accepting
    const F = states.filter(s => M.D[s].fin);
    const nonF = states.filter(s => !M.D[s].fin);

    let P = [];
    if (F.length) P.push(F);
    if (nonF.length) P.push(nonF);

    const steps = [];
    steps.push({
      step: 0,
      type: "init",
      partition: P.map(b => b.slice()),
      desc: `Initial partition P₀ = { ${P.map(b => "{" + b.map(s => "D" + s).join(",") + "}").join(", ")} } (Accepting vs Non-accepting states).`
    });

    // 3. Iterative refinement
    let changed = true;
    let iter = 0;
    while (changed && iter < 100) {
      iter++;
      changed = false;
      const newP = [];

      for (const block of P) {
        if (block.length <= 1) {
          newP.push(block);
          continue;
        }

        let splitFound = false;
        for (const c of alpha) {
          const groups = new Map();
          for (const s of block) {
            const tgt = M.tm[s + "|" + c];
            let tgtBlockIdx = -1;
            if (tgt !== undefined && reachable.has(tgt)) {
              tgtBlockIdx = P.findIndex(b => b.includes(tgt));
            }
            if (!groups.has(tgtBlockIdx)) groups.set(tgtBlockIdx, []);
            groups.get(tgtBlockIdx).push(s);
          }

          if (groups.size > 1) {
            const subBlocks = [...groups.values()].sort((a, b) => a[0] - b[0]);
            newP.push(...subBlocks);
            changed = true;
            splitFound = true;

            steps.push({
              step: steps.length,
              type: "split",
              symbol: c,
              originalBlock: block.slice(),
              subBlocks: subBlocks.map(b => b.slice()),
              partition: [...newP, ...P.slice(P.indexOf(block) + 1)].map(b => b.slice()),
              desc: `Split block {${block.map(s => "D" + s).join(",")}} on symbol '${c}' because states transition into different partition blocks: ${subBlocks.map(sb => "{" + sb.map(s => "D" + s).join(",") + "}").join(" and ")}.`
            });
            break;
          }
        }

        if (!splitFound) {
          newP.push(block);
        }
      }

      P = newP;
    }

    // Sort partition blocks so start state 0's block is first
    P.sort((a, b) => {
      if (a.includes(0)) return -1;
      if (b.includes(0)) return 1;
      return a[0] - b[0];
    });

    steps.push({
      step: steps.length,
      type: "final",
      partition: P.map(b => b.slice()),
      desc: `Fixed point reached in ${iter} iteration(s). Minimal partition has ${P.length} state(s): ${P.map((b, i) => `M${i} = {${b.map(s => "D" + s).join(",")}}`).join(", ")}.`
    });

    // 4. Construct Minimal DFA
    const blockOf = {};
    P.forEach((block, idx) => {
      block.forEach(s => { blockOf[s] = idx; });
    });

    const minD = P.map((block, i) => {
      const isFin = block.some(s => M.D[s].fin);
      const isDead = block.every(s => M.D[s].dead);
      const origSubsets = block.map(s => M.D[s].set).flat();
      const uniqueOrig = [...new Set(origSubsets)].sort((a, b) => (N.ord[a] || 0) - (N.ord[b] || 0));
      return {
        id: "M" + i,
        label: "M" + i,
        name: "M" + i,
        block: block.slice(),
        set: uniqueOrig,
        fin: isFin,
        dead: isDead,
        start: i === 0
      };
    });

    const minTrans = [];
    const minTm = {};
    P.forEach((block, i) => {
      const rep = block[0];
      for (const c of alpha) {
        const tgt = M.tm[rep + "|" + c];
        if (tgt !== undefined && blockOf[tgt] !== undefined) {
          const toIdx = blockOf[tgt];
          minTrans.push({ f: i, c, t: toIdx, from: "M" + i, to: "M" + toIdx });
          minTm[i + "|" + c] = toIdx;
        }
      }
    });

    const originalStateCount = states.length;
    const minStateCount = minD.length;
    const wasReduced = minStateCount < originalStateCount;
    const reductionPercent = originalStateCount > 0 ? Math.round((1 - minStateCount / originalStateCount) * 100) : 0;

    return {
      blocks: P,
      steps,
      minDFA: {
        D: minD,
        trans: minTrans,
        tm: minTm,
        start: 0,
        alpha: alpha.slice(),
        finals: minD.map((d, idx) => d.fin ? idx : -1).filter(idx => idx !== -1)
      },
      originalStateCount,
      minStateCount,
      wasReduced,
      reductionPercent
    };
  }

  // Interactive String Simulation & Path Tracer
  function traceString(N, M, w) {
    if (!N || !M) return null;
    const raw = typeof w === "string" ? w.trim() : "";
    const chars = (raw === "ε" || raw === "λ" || raw === "") ? [] : raw.split("");
    const unknownChars = chars.filter(c => !N.alpha.includes(c));
    const hasUnknown = unknownChars.length > 0;

    // DFA execution
    let curDfa = 0;
    const dfaPath = [{ state: 0, char: null, isFinal: M.D[0] ? M.D[0].fin : false, isDead: M.D[0] ? M.D[0].dead : false, isUnknown: false }];
    let dfaDead = false;

    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      const isUnk = !N.alpha.includes(c);
      if (dfaDead || isUnk) {
        dfaDead = true;
        dfaPath.push({ state: null, char: c, isFinal: false, isDead: true, isUnknown: isUnk });
        continue;
      }
      const nxt = M.tm[curDfa + "|" + c];
      if (nxt === undefined) {
        dfaDead = true;
        dfaPath.push({ state: null, char: c, isFinal: false, isDead: true, isUnknown: false });
      } else {
        curDfa = nxt;
        const d = M.D[curDfa];
        dfaPath.push({ state: curDfa, char: c, isFinal: d ? d.fin : false, isDead: d ? d.dead : false, isUnknown: false });
      }
    }
    const dfaAccepted = !dfaDead && M.D[curDfa] && M.D[curDfa].fin;

    // NFA execution
    const initClosure = closureDetail(N, [N.start]);
    let curNfaSet = initClosure.set;
    const nfaPath = [{
      set: curNfaSet,
      char: null,
      isFinal: isAccepting(N, curNfaSet),
      addedEps: initClosure.added,
      isUnknown: false
    }];

    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      const isUnk = !N.alpha.includes(c);
      if (isUnk) {
        curNfaSet = [];
        nfaPath.push({
          char: c,
          moveSet: [],
          set: [],
          isFinal: false,
          addedEps: [],
          isUnknown: true
        });
        continue;
      }
      const mv = moveDetail(N, curNfaSet, c);
      const cl = closureDetail(N, mv.set);
      curNfaSet = cl.set;
      nfaPath.push({
        char: c,
        moveSet: mv.set,
        set: curNfaSet,
        isFinal: isAccepting(N, curNfaSet),
        addedEps: cl.added,
        isUnknown: false
      });
    }
    const nfaAccepted = isAccepting(N, curNfaSet);

    return {
      word: raw,
      chars,
      unknownChars: [...new Set(unknownChars)],
      hasUnknown,
      isEmptyInput: chars.length === 0,
      isEmptyLanguage: Boolean(N.isEmptyLanguage),
      dfaPath,
      dfaAccepted,
      nfaPath,
      nfaAccepted,
      equivalent: dfaAccepted === nfaAccepted
    };
  }

  // Edge Cases & Invariants Theoretical Analyzer
  function analyzeEdgeCases(N, M, min_res) {
    const cases = [];
    if (!N) return cases;

    // 1. Epsilon cycles
    if (N.hasEpsCycle) {
      cases.push({
        id: "eps_cycle",
        type: "warning",
        icon: "🔁",
        title: "ε-Cycle Detected",
        summary: "The automaton contains a directed cycle of ε-transitions (e.g. q0 ⇄ q1).",
        detail: "States on an ε-cycle are mutually reachable without consuming input. The simulator tracks visited sets to guarantee termination in O(|Q|) without infinite loops.",
        handled: true
      });
    }

    // 2. Empty language
    if (N.isEmptyLanguage) {
      cases.push({
        id: "empty_lang",
        type: "error",
        icon: "∅",
        title: "Empty Language L(M) = ∅",
        summary: N.finals.length === 0 ? "No final states are declared." : "No final state is reachable from the start state.",
        detail: "The automaton accepts no strings whatsoever. All words tested in the string tracer are rejected.",
        handled: true
      });
    }

    // 3. Accepts empty string
    if (N.acceptsEpsilon) {
      cases.push({
        id: "accepts_eps",
        type: "success",
        icon: "✓",
        title: "Accepts Empty String ε",
        summary: "The start state (or its ε-closure) contains an accepting state.",
        detail: "The language contains the empty word ε ∈ L(M). The DFA start state D0 is marked as an accepting state.",
        handled: true
      });
    }

    // 4. Unreachable states
    if (N.unreachableStates && N.unreachableStates.length > 0) {
      cases.push({
        id: "unreachable",
        type: "warning",
        icon: "🚫",
        title: `Unreachable State(s): ${N.unreachableStates.join(", ")}`,
        summary: `State(s) cannot be reached along any directed path from start state ${N.start}.`,
        detail: "Subset construction automatically prunes unreachable states because it explores only the reachable power set from ε-closure(start).",
        handled: true
      });
    }

    // 5. Dead / trap state generated
    if (M && M.hasDeadState) {
      cases.push({
        id: "dead_state",
        type: "info",
        icon: "💀",
        title: "Explicit Dead/Trap State ∅ Generated",
        summary: "Some states have missing transitions on valid alphabet symbols.",
        detail: "To satisfy the DFA totality axiom (every state must have exactly 1 transition per alphabet symbol), subset ∅ is rendered as an explicit sink state with complete self-loops.",
        handled: true
      });
    }

    // 6. Unused alphabet symbols
    if (N.unusedSymbols && N.unusedSymbols.length > 0) {
      cases.push({
        id: "unused_symbols",
        type: "warning",
        icon: "🔡",
        title: `Unused Symbol(s): ${N.unusedSymbols.join(", ")}`,
        summary: `Symbol(s) declared in Σ but never appear in any transition definition.`,
        detail: "Transitions on these unused symbols always lead directly to the dead state ∅.",
        handled: true
      });
    }

    // 7. Single state automaton
    if (N.isSingleState) {
      cases.push({
        id: "single_state",
        type: "info",
        icon: "🔹",
        title: "Single-State Automaton (|Q| = 1)",
        summary: `Boundary scenario: machine consists only of start state ${N.start}.`,
        detail: "Verified for self-loop stability and base-case subset construction.",
        handled: true
      });
    }

    // 8. All states accepting / all rejecting
    if (N.allAccepting) {
      cases.push({
        id: "all_accepting",
        type: "info",
        icon: "🌟",
        title: "All States Accepting (F = Q)",
        summary: "Every defined state is in F.",
        detail: "All reachable non-empty subsets are accepting.",
        handled: true
      });
    }

    // 9. Minimization edge case
    if (min_res) {
      if (min_res.wasReduced) {
        cases.push({
          id: "min_reduced",
          type: "success",
          icon: "✂️",
          title: `Minimization Merged ${min_res.originalStateCount - min_res.minStateCount} State(s)`,
          summary: `Hopcroft partition refinement reduced DFA by ${min_res.reductionPercent}%.`,
          detail: `Equivalent state blocks: ${min_res.minDFA.D.map((d, i) => `M${i} = {${d.block.map(s => "D" + s).join(", ")}}`).join("; ")}.`,
          handled: true
        });
      } else {
        cases.push({
          id: "already_minimal",
          type: "info",
          icon: "✨",
          title: "DFA is Canonical Minimal",
          summary: `All ${min_res.originalStateCount} states are pairwise distinguishable.`,
          detail: "No two states share identical future language acceptance signatures; 0 states merged.",
          handled: true
        });
      }
    }

    return cases;
  }

  // Academic Exporters: LaTeX (TikZ), Graphviz DOT, JFLAP (.jff)
  function dfaToTikz(N, M, mode) {
    if (!M || !M.D) return "% No DFA available";
    const nameFn = i => (mode === "letters" ? dfaName(M, i, "letters") : "D" + i);
    const n = M.D.length;
    const r = Math.max(3, Math.min(6, n * 0.9));

    let s = `% LaTeX TikZ Automaton — Generated by Automata Studio\n`;
    s += `\\documentclass[border=10pt]{standalone}\n`;
    s += `\\usepackage{tikz}\n`;
    s += `\\usetikzlibrary{automata, positioning, arrows.meta}\n\n`;
    s += `\\begin{document}\n`;
    s += `\\begin{tikzpicture}[shorten >=1pt, node distance=2.8cm, on grid, auto, >=Stealth, thick]\n`;

    // Circular layout calculation for nodes
    M.D.forEach((d, i) => {
      const angle = (90 - (360 / n) * i) * (Math.PI / 180);
      const x = (r * Math.cos(angle)).toFixed(2);
      const y = (r * Math.sin(angle)).toFixed(2);
      const opts = ["state"];
      if (i === 0) opts.push("initial");
      if (d.fin) opts.push("accepting");
      s += `  \\node[${opts.join(", ")}] (${nameFn(i)}) at (${x}, ${y}) {$${nameFn(i)}$};\n`;
    });

    s += `\n  % Transitions\n`;
    const edgeMap = new Map();
    M.trans.forEach(t => {
      const k = `${t.f}->${t.t}`;
      if (!edgeMap.has(k)) edgeMap.set(k, []);
      edgeMap.get(k).push(t.c);
    });

    edgeMap.forEach((syms, key) => {
      const [from, to] = key.split("->").map(Number);
      const u = nameFn(from), v = nameFn(to);
      const label = syms.join(", ");
      if (from === to) {
        s += `  \\path[->] (${u}) edge [loop above] node {$${label}$} (${u});\n`;
      } else {
        const reverseKey = `${to}->${from}`;
        const bend = edgeMap.has(reverseKey) ? " [bend left=15]" : "";
        s += `  \\path[->] (${u}) edge${bend} node {$${label}$} (${v});\n`;
      }
    });

    s += `\\end{tikzpicture}\n`;
    s += `\\end{document}\n`;
    return s;
  }

  function dfaToDot(N, M, mode) {
    if (!M || !M.D) return "// No DFA available";
    const nameFn = i => (mode === "letters" ? dfaName(M, i, "letters") : "D" + i);
    let s = `// Graphviz DOT Automaton — Generated by Automata Studio\n`;
    s += `digraph DFA {\n`;
    s += `  rankdir=LR;\n`;
    s += `  node [fontname="Helvetica", fontsize=12];\n`;
    s += `  edge [fontname="Helvetica", fontsize=11];\n\n`;
    s += `  __start [shape=point, width=0.1, label=""];\n`;
    s += `  __start -> ${nameFn(0)};\n\n`;

    M.D.forEach((d, i) => {
      const shape = d.fin ? "doublecircle" : "circle";
      const fill = d.dead ? ', style=dashed, color="#94a3b8"' : "";
      s += `  ${nameFn(i)} [shape=${shape}${fill}, label="${nameFn(i)}${d.set.length ? `\\n{${d.set.join(",")}}` : ""}"] ;\n`;
    });

    s += `\n`;
    const edgeMap = new Map();
    M.trans.forEach(t => {
      const k = `${t.f}->${t.t}`;
      if (!edgeMap.has(k)) edgeMap.set(k, []);
      edgeMap.get(k).push(t.c);
    });

    edgeMap.forEach((syms, key) => {
      const [from, to] = key.split("->").map(Number);
      s += `  ${nameFn(from)} -> ${nameFn(to)} [label=" ${syms.join(", ")} "];\n`;
    });

    s += `}\n`;
    return s;
  }

  function dfaToJFF(N, M, mode) {
    if (!M || !M.D) return "";
    const nameFn = i => (mode === "letters" ? dfaName(M, i, "letters") : "D" + i);
    const n = M.D.length;
    const r = Math.max(120, n * 35);
    const cx = 300, cy = 250;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<!-- JFLAP 7.0 Automaton Export — Generated by Automata Studio -->\n`;
    xml += `<structure>\n`;
    xml += `  <type>fa</type>\n`;
    xml += `  <automaton>\n`;
    xml += `    <!-- The list of states. -->\n`;

    M.D.forEach((d, i) => {
      const angle = (90 - (360 / n) * i) * (Math.PI / 180);
      const x = Math.round(cx + r * Math.cos(angle));
      const y = Math.round(cy - r * Math.sin(angle));
      xml += `    <state id="${i}" name="${nameFn(i)}">\n`;
      xml += `      <x>${x}</x>\n`;
      xml += `      <y>${y}</y>\n`;
      if (i === 0) xml += `      <initial/>\n`;
      if (d.fin) xml += `      <final/>\n`;
      xml += `    </state>\n`;
    });

    xml += `    <!-- The list of transitions. -->\n`;
    M.trans.forEach(t => {
      xml += `    <transition>\n`;
      xml += `      <from>${t.f}</from>\n`;
      xml += `      <to>${t.t}</to>\n`;
      xml += `      <read>${t.c}</read>\n`;
      xml += `    </transition>\n`;
    });

    xml += `  </automaton>\n`;
    xml += `</structure>\n`;
    return xml;
  }

  const API = {
    LIMITS, fmtSet, rng, parse, build, isDeterministic, dfaProblems, dfaName, dfaToText, toText,
    closure, closureDetail, moveDetail, runNFA, runDFA, generate, regexToNFA, removeEps, buildEpsElimination,
    minimizeDFA, traceString, dfaToTikz, dfaToDot, dfaToJFF, analyzeEdgeCases
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Automata = API;
})(typeof window !== "undefined" ? window : globalThis);
