(function (root) {
// Core automata engine (zero dependencies). Used by the server; mirrors the in-browser simulator.
const EPS = new Set(["e", "ε", "eps", "epsilon", "λ"]);
function parse(t) {
  const o = { states: [], start: null, finals: [], d: {}, alpha: [], ord: {}, warn: [] }, A = new Set(), decl = new Set(); let hasStates = false, dup = 0;
  const L = s => s.replace(/[{}()]/g, " ").split(/[,\s]+/).filter(Boolean);
  for (const raw of String(t).split("\n")) {
    const l = raw.split("#")[0].split("//")[0].trim(); if (!l) continue; let m;
    if ((m = l.match(/^states?\s*:\s*(.*)$/i))) { hasStates = true; L(m[1]).forEach(x => decl.add(x)); }
    else if ((m = l.match(/^(?:alphabet|sigma|Σ)\s*:\s*(.*)$/i))) L(m[1]).forEach(x => { if (EPS.has(x)) throw new Error("ε cannot be an input symbol."); A.add(x); });
    else if ((m = l.match(/^(?:start|initial)\s*:\s*(\S+)/i))) { if (o.start && o.start !== m[1]) throw new Error(`Only one start state is allowed (found “${o.start}” and “${m[1]}”).`); o.start = m[1]; }
    else if ((m = l.match(/^(?:finals?|accepting)\s*:\s*(.*)$/i))) o.finals.push(...L(m[1]));
    else {
      const l2 = l.replace(/^(?:δ|delta|d)\s*\(/i, "").replace(/\)\s*(?==|->|→)/, "");
      m = l2.match(/^(\S+?)\s*,\s*(\S+?)\s*(?:=|->|→)\s*(.*)$/) || l2.match(/^(\S+?)\s*-+\s*(\S+?)\s*-+>\s*(.*)$/);
      if (!m) throw new Error("Cannot parse line: " + l);
      const c = EPS.has(m[2]) ? "ε" : m[2]; if (c !== "ε") A.add(c);
      const k = m[1] + "|" + c; o.d[k] = o.d[k] || new Set();
      for (const x of L(m[3]).filter(x => x !== "∅" && x !== "-")) { if (o.d[k].has(x)) dup++; o.d[k].add(x); }
    }
  }
  if (!o.start) throw new Error("Missing 'start:' line — every automaton needs exactly one start state.");
  o.finals = [...new Set(o.finals)];
  const used = new Set([o.start, ...o.finals]); for (const k in o.d) { used.add(k.split("|")[0]); o.d[k].forEach(x => used.add(x)); }
  if (hasStates) { const bad = [...used].filter(x => !decl.has(x)); if (bad.length) throw new Error("Undeclared state(s): " + bad.join(", ") + " — add them to 'states:' or delete the 'states:' line."); }
  o.states = [...new Set([...decl, ...used])];
  if (o.states.length > 16) throw new Error(`NFA has ${o.states.length} states; the limit is 16 because the DFA can have up to 2^n subsets.`);
  o.alpha = [...A].sort(); o.states.forEach((s, i) => o.ord[s] = i);
  const seen = new Set([o.start]), st = [o.start]; while (st.length) { const s = st.pop(); for (const k in o.d) if (k.split("|")[0] === s) o.d[k].forEach(x => { if (!seen.has(x)) { seen.add(x); st.push(x); } }); }
  const un = o.states.filter(x => !seen.has(x));
  if (!o.alpha.length) o.warn.push("No input symbols: the language is {ε} or ∅.");
  if (!o.finals.length) o.warn.push("No final state: the language is empty (∅).");
  if (o.finals.includes(o.start)) o.warn.push("The start state is final, so ε is accepted.");
  if (un.length) o.warn.push("Unreachable NFA state(s) ignored: " + un.join(", ") + ".");
  if (dup) o.warn.push(dup + " duplicate transition target(s) merged.");
  return o;
}
const key = (N, S) => [...S].sort((a, b) => N.ord[a] - N.ord[b]);
const clo = (N, S) => { const r = new Set(S), st = [...S]; while (st.length) { const s = st.pop(); for (const t of N.d[s + "|ε"] || []) if (!r.has(t)) { r.add(t); st.push(t); } } return r; };
const mv = (N, S, c) => { const r = new Set(); for (const s of S) for (const t of N.d[s + "|" + c] || []) r.add(t); return r; };
const acc = (N, S) => S.some(s => N.finals.includes(s));
function build(N) {
  const s0 = key(N, clo(N, [N.start])), D = [{ set: s0 }], idx = { [s0.join(",")]: 0 }, trans = [], steps = [{ type: "init", closure: s0, to: 0, isNew: true }];
  for (let i = 0; i < D.length; i++) for (const c of N.alpha) {
    const m = key(N, mv(N, D[i].set, c)), t = key(N, clo(N, m)), k = t.join(","); let nw = false;
    if (!(k in idx)) { idx[k] = D.length; D.push({ set: t }); nw = true; if (D.length > 300) throw new Error("DFA exceeds 300 states."); }
    trans.push({ f: i, c, t: idx[k] }); steps.push({ type: "move", from: i, c, move: m, closure: t, to: idx[k], isNew: nw });
  }
  D.forEach(d => d.fin = acc(N, d.set)); const tm = {}; trans.forEach(t => tm[t.f + "|" + t.c] = t.t);
  return { D, trans, steps, tm };
}
function minimize(N, M) {
  let p = M.D.map(d => d.fin ? 1 : 0), n = new Set(p).size;
  for (;;) { const mp = {}, q = M.D.map((d, i) => { const s = p[i] + "|" + N.alpha.map(c => p[M.tm[i + "|" + c]]).join(","); return mp[s] = mp[s] ?? Object.keys(mp).length; }), nn = Object.keys(mp).length; p = q; if (nn === n) break; n = nn; }
  return n;
}
// Language equivalence of two automata via simultaneous subset BFS (gives the SHORTEST counter-example).
function equivalent(A, B) {
  const alpha = [...new Set([...A.alpha, ...B.alpha])].sort(), k = (a, b) => a.join(",") + "|" + b.join(",");
  const q = [{ a: key(A, clo(A, [A.start])), b: key(B, clo(B, [B.start])), w: [] }], seen = new Set([k(q[0].a, q[0].b)]);
  for (let i = 0; i < q.length; i++) {
    const { a, b, w } = q[i]; if (acc(A, a) !== acc(B, b)) return { ok: false, counter: w, nfaAccepts: acc(A, a) };
    for (const c of alpha) { const na = key(A, clo(A, mv(A, a, c))), nb = key(B, clo(B, mv(B, b, c))), kk = k(na, nb); if (!seen.has(kk)) { seen.add(kk); q.push({ a: na, b: nb, w: [...w, c] }); } }
  }
  return { ok: true };
}
function dfaProblems(N) {
  const p = [];
  if (Object.keys(N.d).some(k => k.endsWith("|ε") && N.d[k].size)) p.push("Your machine still has ε-moves.");
  for (const s of N.states) for (const c of N.alpha) { const n = (N.d[s + "|" + c] || new Set()).size; if (n !== 1) p.push(`${s} on '${c}' has ${n} targets (a DFA needs exactly 1 — add a dead state if needed).`); }
  return p.slice(0, 6);
}
function generate(n = 4, k = 2, eps = false) {
  n = Math.min(Math.max(+n || 4, 2), 7); k = Math.min(Math.max(+k || 2, 1), 4);
  const al = "abcd".slice(0, k).split(""), S = [...Array(n)].map((_, i) => "q" + i), r = a => a[Math.floor(Math.random() * a.length)];
  for (let tries = 0; tries < 50; tries++) {
    const L = ["states: " + S.join(","), "start: q0"], fin = S.filter((s, i) => i > 0 && Math.random() < .4); if (!fin.length) fin.push(S[n - 1]);
    L.push("final: " + fin.join(", "));
    for (const s of S) { for (const c of al) { const t = new Set(); if (Math.random() < .85) t.add(r(S)); if (Math.random() < .35) t.add(r(S)); if (t.size) L.push(`${s},${c} = ${[...t].join(",")}`); } if (eps && Math.random() < .35) L.push(`${s},ε = ${r(S)}`); }
    const src = L.join("\n"); try { if (parse(src).alpha.length === k) return src; } catch {}
  }
  return "start: q0\nfinal: q1\nq0,a = q0,q1\nq0,b = q0\nq1,b = q1";
}

const runNFA = (N, w) => { let S = key(N, clo(N, [N.start])); for (const c of w) S = key(N, clo(N, mv(N, S, c))); return acc(N, S); };
const runDFA = (N, M, w) => { let s = 0; for (const c of w) { const t = M.tm[s + "|" + c]; if (t === undefined) return false; s = t; } return M.D[s].fin; };
function properties(N) {
  const M = build(N), live = new Set(); M.D.forEach((d, i) => { if (d.fin) live.add(i); });
  for (let ch = true; ch;) { ch = false; for (const t of M.trans) if (!live.has(t.f) && live.has(t.t)) { live.add(t.f); ch = true; } }
  const col = {}; let cyc = false;
  const dfs = s => { col[s] = 1; for (const c of N.alpha) { const t = M.tm[s + "|" + c]; if (!live.has(t)) continue; if (col[t] === 1) cyc = true; else if (!col[t]) dfs(t); } col[s] = 2; };
  if (live.has(0)) dfs(0);
  const words = [], q = [{ s: 0, w: [] }], sep = N.alpha.every(a => a.length === 1) ? "" : " ";
  for (let i = 0; i < q.length && words.length < 10 && q.length < 5000; i++) { const { s, w } = q[i]; if (M.D[s].fin) words.push(w.join(sep) || "ε"); if (w.length < 8 && live.has(s)) for (const c of N.alpha) q.push({ s: M.tm[s + "|" + c], w: [...w, c] }); }
  return { empty: !live.has(0), universal: M.D.every(d => d.fin), finite: !cyc, words, dfaStates: M.D.length, minimal: minimize(N, M) };
}
const API = { parse, build, minimize, equivalent, dfaProblems, generate, runNFA, runDFA, properties };
if (typeof module !== "undefined") module.exports = API; else root.Automata = API;
})(typeof window !== "undefined" ? window : globalThis);

