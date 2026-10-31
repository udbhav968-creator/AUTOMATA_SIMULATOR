/*
 * Automata engine for Automata Studio (CSET302).
 * Zero dependencies. The same file runs in Node (server, tests) and in the browser (window.Automata).
 *
 *   parse()            text → NFA object, with strict validation and friendly warnings
 *   build()            subset construction (ε-NFA / NFA → DFA) with a full step log
 *   minimizeSteps()    DFA minimisation: unreachable removal, completion, table filling, partitions
 *   traceNFA()         string run of an NFA (active sets, edges used) for animation
 *   computationTree()  NFA computation tree (capped)
 *   regexToNFA()       Thompson's construction from a regular expression
 *   equivalent()       language equivalence with the shortest counter-example
 *   generate()         random NFA question generator (seedable)
 *   properties()       empty / universal / finite / shortest strings
 */
(function (root) {
  "use strict";

  const LIMITS = { states: 30, symbols: 10, dfaStates: 300, textChars: 20000, lines: 400, nameLength: 14, stringLength: 200 };
  const EPS_WORDS = new Set(["e", "ε", "eps", "epsilon", "λ", "lambda"]);
  const EMPTY_WORDS = new Set(["∅", "-", "{}", "phi", "null"]);
  const NAME_RE = /^[\p{L}\p{N}_'.]+$/u;
  /** "e" (lower-case only), ε, λ, eps, epsilon, lambda all mean the empty string. Upper-case E stays a normal name. */
  const isEps = x => EPS_WORDS.has(x) || ["eps", "epsilon", "lambda"].includes(x.toLowerCase());

  /* ------------------------------------------------------------------ helpers */

  /** Split a list like "q0, q1 {q2}" into tokens. */
  const splitList = s => s.replace(/[{}()]/g, " ").split(/[,\s]+/).filter(Boolean);

  /** Seeded random generator (mulberry32) so an exam can be regenerated identically. */
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

  /** Format a list of states as {a,b} or ∅. */
  const fmtSet = a => (a && a.length ? "{" + a.join(",") + "}" : "∅");

  /* ------------------------------------------------------------------ parsing */

  /**
   * Parse automaton text.
   *   states: q0,q1      alphabet: a,b      start: q0      final: q1,q2
   *   q0,a = q0,q1       δ(q0,a) = {q1}     q0 -a-> q1     q0,ε = q1   (ε may be written e / eps)
   *   # or // start a comment
   */
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
        splitList(m[1]).filter(x => !EMPTY_WORDS.has(x)).forEach(s => { checkName(s, lineNo); N.finals.push(s); });
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
        const targets = splitList(m[3]).filter(x => !EMPTY_WORDS.has(x));
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
    // Declared order wins; otherwise natural order (q2 before q10, A before B) so subsets read like the textbook.
    N.states = hasStatesLine ? [...declStates] : [...used].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (N.states.length > maxStates) fail(`The automaton has ${N.states.length} states; the limit is ${maxStates} because the DFA can need up to 2^n subsets.`, "TOO_BIG");
    N.alpha = [...alpha].sort();
    if (N.alpha.length > LIMITS.symbols) fail(`The alphabet has ${N.alpha.length} symbols; the limit is ${LIMITS.symbols}.`);
    N.states.forEach((s, i) => (N.ord[s] = i));
    N.hasEps = Object.keys(N.d).some(k => k.endsWith("|ε") && N.d[k].size > 0);

    // Reachability over all moves including ε
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

  /* ------------------------------------------------------------------ core set operations */

  const sortStates = (N, S) => [...S].sort((a, b) => N.ord[a] - N.ord[b]);
  const isAccepting = (N, S) => S.some(s => N.finals.includes(s));

  /** ε-closure with the ε-edges followed (used for explanations and animation). */
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

  /** move(S, c) with the edges used. */
  function moveDetail(N, S, c) {
    const out = new Set(), edges = [];
    for (const s of S) for (const t of N.d[s + "|" + c] || []) { out.add(t); edges.push([s, c, t]); }
    return { set: sortStates(N, out), edges };
  }

  /* ------------------------------------------------------------------ subset construction */

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

  /** Count of states in the minimal DFA (Moore refinement). */
  function minimize(N, M) {
    let part = M.D.map(d => (d.fin ? 1 : 0)), n = new Set(part).size;
    for (;;) {
      const map = {};
      const next = M.D.map((d, i) => {
        const sig = part[i] + "|" + N.alpha.map(c => part[M.tm[i + "|" + c]]).join(",");
        return (map[sig] = map[sig] ?? Object.keys(map).length);
      });
      const nn = Object.keys(map).length;
      part = next;
      if (nn === n) break;
      n = nn;
    }
    return n;
  }

  /** Name DFA states: "D" → D0,D1…   "letters" → A,B,C…   "sets" → {q0,q1} */
  function dfaName(M, i, mode) {
    if (mode === "letters") {
      let n = i, s = "";
      do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
      return s;
    }
    if (mode === "sets") return fmtSet(M.D[i].set);
    return "D" + i;
  }

  /** Serialise the subset-construction DFA to automaton text so other pages can use it. */
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

  /** Serialise a parsed automaton back to clean text. */
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

  /* ------------------------------------------------------------------ DFA checks and minimisation */

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

  /**
   * Minimise a DFA and record every step.
   * Missing transitions are allowed: they go to an added trap state.
   * Throws code NOT_DFA when the input is non-deterministic.
   */
  function minimizeSteps(N) {
    if (!isDeterministic(N)) {
      const probs = dfaProblems(N).filter(p => !/no target/.test(p));
      fail("Minimisation needs a DFA. " + (probs[0] || "") + " Convert it with subset construction first.", "NOT_DFA");
    }
    const steps = [];
    // 1. remove unreachable states
    const seen = new Set([N.start]), q = [N.start];
    while (q.length) { const s = q.shift(); for (const c of N.alpha) for (const t of N.d[s + "|" + c] || []) if (!seen.has(t)) { seen.add(t); q.push(t); } }
    const removed = N.states.filter(s => !seen.has(s));
    const states = N.states.filter(s => seen.has(s));
    steps.push({ type: "reach", removed });
    // 2. complete the DFA with a trap state when transitions are missing
    const delta = {}, addedTrans = [];
    let trap = null;
    for (const s of [...states]) for (const c of N.alpha) {
      const t = [...(N.d[s + "|" + c] || [])][0];
      if (t !== undefined) delta[s + "|" + c] = t;
      else {
        if (!trap) { trap = "trap"; while (N.states.includes(trap)) trap += "'"; }
        delta[s + "|" + c] = trap;
        addedTrans.push([s, c, trap]);
      }
    }
    if (trap) { states.push(trap); for (const c of N.alpha) delta[trap + "|" + c] = trap; }
    steps.push({ type: "complete", trap, added: addedTrans });
    const finals = new Set(N.finals.filter(f => states.includes(f)));
    // 3. table filling (Myhill–Nerode)
    const pairs = [], mark = {};
    const pk = (a, b) => (states.indexOf(a) < states.indexOf(b) ? a + "|" + b : b + "|" + a);
    for (let i = 0; i < states.length; i++) for (let j = 0; j < i; j++) pairs.push([states[j], states[i]]);
    const marks = [], base = [];
    for (const [a, b] of pairs) if (finals.has(a) !== finals.has(b)) {
      const f = finals.has(a) ? a : b, nf = finals.has(a) ? b : a;
      const m = { pair: [a, b], round: 0, reason: `${f} is final and ${nf} is not` };
      mark[pk(a, b)] = m; marks.push(m); base.push(m);
    }
    steps.push({ type: "base", marks: base });
    let round = 0, changed = true;
    while (changed) {
      changed = false; round++;
      const newMarks = [];
      for (const [a, b] of pairs) {
        if (mark[pk(a, b)]) continue;
        for (const c of N.alpha) {
          const x = delta[a + "|" + c], y = delta[b + "|" + c];
          if (x !== y && mark[pk(x, y)] && mark[pk(x, y)].round < round) {
            newMarks.push({ pair: [a, b], round, sym: c, succ: [x, y], reason: `on “${c}”: ${a}→${x} and ${b}→${y}, and (${x}, ${y}) is already marked` });
            break;
          }
        }
      }
      newMarks.forEach(m => { mark[pk(m.pair[0], m.pair[1])] = m; marks.push(m); });
      if (newMarks.length) { changed = true; steps.push({ type: "round", round, marks: newMarks }); }
    }
    // 4. equivalence classes = unmarked pairs
    const parent = {}; states.forEach(s => (parent[s] = s));
    const find = s => (parent[s] === s ? s : (parent[s] = find(parent[s])));
    for (const [a, b] of pairs) if (!mark[pk(a, b)]) parent[find(a)] = find(b);
    const groups = {};
    states.forEach(s => (groups[find(s)] = groups[find(s)] || []).push(s));
    const classes = Object.values(groups).sort((x, y) => states.indexOf(x[0]) - states.indexOf(y[0]));
    const classOf = {}; classes.forEach((g, i) => g.forEach(s => (classOf[s] = i)));
    const startClass = classOf[N.start];
    const order = [startClass, ...classes.map((_, i) => i).filter(i => i !== startClass)];
    const renum = {}; order.forEach((ci, k) => (renum[ci] = k));
    const minStates = order.map((ci, k) => ({ id: "M" + k, members: classes[ci], final: classes[ci].some(s => finals.has(s)), start: k === 0, trap: classes[ci].every(s => s === trap) }));
    const minTm = {};
    order.forEach((ci, k) => N.alpha.forEach(c => (minTm[k + "|" + c] = renum[classOf[delta[classes[ci][0] + "|" + c]]])));
    steps.push({ type: "merge", classes: minStates.map(m => m.members) });
    // 5. Moore partition rounds (alternative view of the same result)
    const partitions = [];
    let block = {}; states.forEach(s => (block[s] = finals.has(s) ? 1 : 0));
    const groupBy = b => { const g = {}; states.forEach(s => (g[b[s]] = g[b[s]] || []).push(s)); return Object.values(g); };
    partitions.push(groupBy(block));
    for (;;) {
      const map = {}, nb = {};
      states.forEach(s => {
        const sig = block[s] + "|" + N.alpha.map(c => block[delta[s + "|" + c]]).join(",");
        nb[s] = map[sig] = map[sig] ?? Object.keys(map).length;
      });
      const before = new Set(Object.values(block)).size, after = Object.keys(map).length;
      block = nb;
      if (after === before) break;
      partitions.push(groupBy(block));
    }
    const text = ["# Minimal DFA", "states: " + minStates.map(m => m.id).join(", "), ...(N.alpha.length ? ["alphabet: " + N.alpha.join(", ")] : []), "start: M0",
      "final: " + (minStates.filter(m => m.final).map(m => m.id).join(", ") || "∅"),
      ...minStates.map(m => `# ${m.id} = {${m.members.join(",")}}`),
      ...minStates.flatMap((m, k) => N.alpha.map(c => `${m.id},${c} = M${minTm[k + "|" + c]}`))].join("\n");
    return { states, alpha: N.alpha, delta, finals: [...finals], start: N.start, removed, trap, addedTrans, pairs, mark, pairKey: pk, marks, steps, classes, partitions, minimal: { states: minStates, tm: minTm, text } };
  }

  /* ------------------------------------------------------------------ running strings */

  /** Split a string into symbols: per character when every symbol is one character, otherwise by spaces/commas. */
  function tokenize(N, w) {
    w = String(w == null ? "" : w).trim();
    if (w === "ε" || w === "") return [];
    if (N.alpha.length && N.alpha.every(a => a.length === 1) && !/[\s,]/.test(w)) return [...w];
    return w.split(/[\s,]+/).filter(Boolean);
  }

  const runNFA = (N, w) => { let S = closure(N, [N.start]); for (const c of w) S = closure(N, moveDetail(N, S, c).set); return isAccepting(N, S); };
  const runDFA = (N, M, w) => { let s = 0; for (const c of w) { const t = M.tm[s + "|" + c]; if (t === undefined) return false; s = t; } return M.D[s].fin; };

  /** Step-by-step NFA run for animation and explanation. */
  function traceNFA(N, w) {
    if (w.length > LIMITS.stringLength) fail(`The string is too long (${w.length} symbols, limit ${LIMITS.stringLength}).`);
    const init = closureDetail(N, [N.start]);
    const steps = [{ i: -1, sym: null, before: [], moveEdges: [], afterMove: [N.start], epsEdges: init.edges, after: init.set, added: init.added }];
    let S = init.set, stop = null;
    for (let i = 0; i < w.length; i++) {
      const c = w[i];
      if (!N.alpha.includes(c)) {
        stop = { at: i, reason: `“${c}” is not in the alphabet {${N.alpha.join(",")}}` };
        steps.push({ i, sym: c, before: S, moveEdges: [], afterMove: [], epsEdges: [], after: [], added: [], invalid: true });
        S = [];
        break;
      }
      const mv = moveDetail(N, S, c), cl = closureDetail(N, mv.set);
      steps.push({ i, sym: c, before: S, moveEdges: mv.edges, afterMove: mv.set, epsEdges: cl.edges, after: cl.set, added: cl.added });
      S = cl.set;
      if (!S.length) { stop = { at: i, reason: `no state can continue after reading “${c}” (symbol ${i + 1})` }; break; }
    }
    const accepted = !stop && isAccepting(N, S);
    let reason;
    if (stop) reason = "Rejected: " + stop.reason + ".";
    else if (accepted) reason = `Accepted: the last set ${fmtSet(S)} contains the final state ${S.filter(s => N.finals.includes(s)).join(", ")}.`;
    else reason = `Rejected: the last set ${fmtSet(S)} contains no final state.`;
    return { steps, accepted, reason, stop, final: S };
  }

  /** NFA computation tree (every path), capped. depth = symbols consumed so far. */
  function computationTree(N, w, cap) {
    cap = cap || 160;
    const nodes = [{ id: 0, state: N.start, depth: 0, via: null, parent: -1 }];
    let truncated = false;
    const queue = [{ id: 0, epsSeen: new Set([N.start]) }];
    while (queue.length) {
      const { id, epsSeen } = queue.shift(), nd = nodes[id];
      const kids = [];
      for (const t of N.d[nd.state + "|ε"] || []) if (!epsSeen.has(t)) kids.push({ state: t, depth: nd.depth, via: "ε", eps: new Set([...epsSeen, t]) });
      if (nd.depth < w.length) for (const t of N.d[nd.state + "|" + w[nd.depth]] || []) kids.push({ state: t, depth: nd.depth + 1, via: w[nd.depth], eps: new Set([t]) });
      nd.children = [];
      for (const k of kids) {
        if (nodes.length >= cap) { truncated = true; break; }
        const kid = { id: nodes.length, state: k.state, depth: k.depth, via: k.via, parent: id };
        nodes.push(kid); nd.children.push(kid.id); queue.push({ id: kid.id, epsSeen: k.eps });
      }
    }
    nodes.forEach(n => {
      if (n.children && n.children.length) n.status = "inner";
      else if (n.depth === w.length && N.finals.includes(n.state)) n.status = "accept";
      else if (n.depth === w.length) n.status = "reject";
      else n.status = truncated && !n.children ? "cut" : "stuck";
    });
    return { nodes, truncated };
  }

  /* ------------------------------------------------------------------ equivalence and properties */

  function equivalent(A, B) {
    const alpha = [...new Set([...A.alpha, ...B.alpha])].sort();
    const k = (a, b) => a.join(",") + "|" + b.join(",");
    const start = { a: closure(A, [A.start]), b: closure(B, [B.start]), w: [] };
    const q = [start], seen = new Set([k(start.a, start.b)]);
    for (let i = 0; i < q.length; i++) {
      const { a, b, w } = q[i];
      if (isAccepting(A, a) !== isAccepting(B, b)) return { ok: false, counter: w, nfaAccepts: isAccepting(A, a), firstAccepts: isAccepting(A, a) };
      if (q.length > 200000) fail("The equivalence check is too large.");
      for (const c of alpha) {
        const na = closure(A, moveDetail(A, a, c).set), nb = closure(B, moveDetail(B, b, c).set), kk = k(na, nb);
        if (!seen.has(kk)) { seen.add(kk); q.push({ a: na, b: nb, w: [...w, c] }); }
      }
    }
    return { ok: true };
  }

  function properties(N) {
    const M = build(N), live = new Set();
    M.D.forEach((d, i) => { if (d.fin) live.add(i); });
    for (let ch = true; ch;) { ch = false; for (const t of M.trans) if (!live.has(t.f) && live.has(t.t)) { live.add(t.f); ch = true; } }
    const col = {}; let cyc = false;
    const dfs = s => { col[s] = 1; for (const c of N.alpha) { const t = M.tm[s + "|" + c]; if (!live.has(t)) continue; if (col[t] === 1) cyc = true; else if (!col[t]) dfs(t); } col[s] = 2; };
    if (live.has(0)) dfs(0);
    const words = [], q = [{ s: 0, w: [] }], sep = N.alpha.every(a => a.length === 1) ? "" : " ";
    for (let i = 0; i < q.length && words.length < 10 && q.length < 6000; i++) {
      const { s, w } = q[i];
      if (M.D[s].fin) words.push(w.join(sep) || "ε");
      if (w.length < 8 && live.has(s)) for (const c of N.alpha) q.push({ s: M.tm[s + "|" + c], w: [...w, c] });
    }
    return { empty: !live.has(0), universal: M.D.every(d => d.fin), finite: !cyc, words, dfaStates: M.D.length, minimal: minimize(N, M) };
  }

  /* ------------------------------------------------------------------ regular expression → ε-NFA (Thompson) */

  /**
   * Syntax: symbols a–z, A–Z, 0–9; union | or +; postfix * and ?; parentheses; ε (also λ or "eps").
   * + means union (textbook notation). Write aa* for "one or more a".
   */
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
    // Thompson's construction
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

  /* ------------------------------------------------------------------ random generator */

  /**
   * Random NFA. Call generate(n, k, eps, seed) or generate({ n, k, eps, seed, minDfa, maxDfa }).
   * Retries until every state is reachable and the DFA size lies in [minDfa, maxDfa].
   */
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
      } catch (e) { /* try again */ }
    }
    return fallback || "states: q0,q1,q2\nalphabet: a,b\nstart: q0\nfinal: q2\nq0,a = q0,q1\nq0,b = q0\nq1,b = q2";
  }

  const API = {
    LIMITS, fmtSet, rng, parse, build, minimize, minimizeSteps, isDeterministic, dfaProblems, dfaName, dfaToText, toText,
    closure, closureDetail, moveDetail, tokenize, runNFA, runDFA, traceNFA, computationTree, equivalent, properties, regexToNFA, generate
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Automata = API;
})(typeof window !== "undefined" ? window : globalThis);
