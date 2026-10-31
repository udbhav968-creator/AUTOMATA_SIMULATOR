/*
 * Question extractor for Automata Studio.
 * Turns pasted text (or text read from a PDF) into question-bank drafts, without any AI:
 *   - splits the text into numbered questions,
 *   - finds automata written as text lines, δ(q,a) = {…} lines, or textbook transition tables,
 *   - picks a question type from the wording (convert, ε-closure, accept, count, minimise, design, MCQ, true/false),
 *   - for "design a DFA that accepts …" questions, builds the reference automaton for common languages
 *     (ends with / starts with / contains, even-odd counts, length mod k, exactly / at least / at most n,
 *      binary divisible by k, and "and" / "not" combinations) so the question can be auto-graded.
 * Every draft is checked with QGen.validateBank; drafts with problems are returned for review, never dropped.
 */
(function (root) {
  "use strict";
  const node = typeof module !== "undefined" && module.exports;
  const A = node ? require("./automata") : root.Automata;
  const Q = node ? require("./qgen") : root.QGen;

  const EPS = /^(ε|e|eps|epsilon|λ|∈|lambda|Є|ϵ)$/i;
  const EMPTY = /^(∅|φ|ϕ|Φ|Ø|-|—|–|\{\s*\}|phi|null|none)$/i;

  /* ------------------------------------------------------------------ text clean-up */
  function normalise(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\u2192\u27F6\u21D2]/g, "→")           // arrows
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2208/g, "ε")                          // ∈ is often printed for ε in Indian textbooks
      .replace(/\u03F5|\u0190|\u025B/g, "ε")
      .replace(/[ \t\u00A0]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /* ------------------------------------------------------------------ splitting */
  const Q_START = /^\s*(?:(?:Q|Question|Ques)\s*\.?\s*\d{1,3}[a-z]?\s*[.):\-]|(?:Q|Question)\s*\d{1,3}\s+(?=[A-Z(])|\d{1,2}\s*[.)](?=\s))\s*(?=\S)/;

  function split(text) {
    const lines = normalise(text).split("\n");
    const blocks = [];
    let cur = null;
    for (const line of lines) {
      if (Q_START.test(line)) { if (cur) blocks.push(cur); cur = [line.replace(Q_START, "")]; }
      else if (cur) cur.push(line);
      else if (line.trim()) cur = [line];
    }
    if (cur) blocks.push(cur);
    // text before the first numbered question is a title / instructions, not a question
    if (blocks.length > 1 && !Q_START.test(lines.find(l => l.trim()) || "")) blocks.shift();
    return blocks.map(b => b.join("\n").trim()).filter(b => b.length > 3).slice(0, 60);
  }

  /* ------------------------------------------------------------------ automata inside a question */
  const DIRECTIVE = /^\s*(states?|q|alphabet|sigma|σ|symbols|start|initial|finals?|accepting|accept|f)\s*[:=]/i;
  const TRANSITION = /^\s*(?:δ|delta|d)?\s*\(?\s*[\w'.]+\s*,\s*[\w'.ε∈]+\s*\)?\s*(?:=|->|→)\s*\S/i;
  const ARROW = /^\s*[\w'.]+\s*-+\s*[\w'.ε]+\s*-+>\s*\S/;

  function fromLines(block) {
    block = block.replace(/[ \t]*[,;:]?[ \t]*(?=(?:δ|delta)\s*\()/g, "\n").replace(/(\})\s*[,;]\s*(?=(?:start|initial|final|accept)\w*\b)/gi, "$1\n");
    const all = block.split("\n"), used = [];
    all.forEach((l, i) => { if (DIRECTIVE.test(l) || TRANSITION.test(l) || ARROW.test(l)) used.push(i); });
    const lines = used.map(i => all[i].trim())
      .map(l => l.replace(/^(?:Q)\s*[:=]/i, "states:").replace(/^(?:F)\s*[:=]/i, "final:").replace(/^σ\s*[:=]/i, "alphabet:"));
    if (!lines.some(l => TRANSITION.test(l) || ARROW.test(l))) return null;
    return { src: completeStartFinal(lines.join("\n"), block), used };
  }

  /** Add start/final lines from the prose when the automaton text lacks them. */
  function completeStartFinal(src, prose) {
    let out = src;
    if (!/^\s*(start|initial)\s*[:=]/im.test(out)) {
      const m = prose.match(/(?:start(?:ing)?|initial)(?:\s+state)?\s*(?:is|=|:)?\s*\{?\s*(q[\w'.]*|[A-Z][\w'.]*|\d+)\b/) || prose.match(/q\s*0\s*=\s*([\w'.]+)/i);
      const first = (out.match(/^\s*(?:δ\s*\()?\s*([\w'.]+)\s*,/m) || [])[1];
      out = "start: " + (m ? m[1] : first || "q0") + "\n" + out;
    }
    if (!/^\s*(finals?|accepting|accept)\s*[:=]/im.test(out)) {
      const m = prose.match(/F\s*=\s*\{([^}]*)\}/) || prose.match(/(?:final|accepting)(?:\s+states?)?\s*(?:is|are|=|:)?\s*\{?\s*((?:q[\w'.]*|[A-Z][\w'.]*|\d+)(?:\s*(?:,|and)\s*(?:q[\w'.]*|[A-Z][\w'.]*|\d+))*)/);
      if (m) out = "final: " + m[1].replace(/\band\b/g, ",") + "\n" + out;
    }
    return out;
  }

  /** Read a textbook transition table: a header row of symbols, then rows "→*q0  {q0,q1}  q2  ∅". */
  function fromTable(block) {
    const lines = block.split("\n");
    const cellRe = /\{[^}]*\}|[\w'.∅φϕΦØ—–-]+/g;
    for (let h = 0; h < lines.length; h++) {
      const head = lines[h].replace(/δ|delta|states?|state\/input|input|present|next|\|/gi, " ").trim();
      if (!head) continue;
      const syms = head.split(/\s+/).filter(Boolean);
      if (syms.length < 1 || syms.length > 6 || !syms.every(s => s.length <= 3 && /^[\w'ε∈]+$/.test(s))) continue;
      if (syms.some(s => /^q\d/i.test(s))) continue; // a row, not a header
      const symbols = syms.map(s => (EPS.test(s) ? "ε" : s));
      const rows = [], used = [h];
      for (let r = h + 1; r < lines.length && rows.length < 30; r++) {
        let line = lines[r].replace(/\|/g, " ").trim();
        if (!line) { if (rows.length) break; continue; }
        const mark = line.match(/^((?:→|->|>|\*|#)\s*)+/);
        const markers = mark ? mark[0] : "";
        line = line.slice(markers.length).trim();
        const cells = line.match(cellRe) || [];
        if (cells.length !== symbols.length + 1) { if (rows.length >= 2) break; else continue; }
        const name = cells[0].replace(/[{}]/g, "");
        if (!/^[\w'.]+$/.test(name) || EMPTY.test(name)) break;
        rows.push({ name, start: /→|->|>/.test(markers), final: /\*|#/.test(markers) || /\*/.test(cells[0]), cells: cells.slice(1) });
        used.push(r);
      }
      if (rows.length < 2) continue;
      const out = [];
      const start = (rows.find(r => r.start) || rows[0]).name;
      out.push("states: " + rows.map(r => r.name).join(", "), "start: " + start);
      const fin = rows.filter(r => r.final).map(r => r.name);
      if (fin.length) out.push("final: " + fin.join(", "));
      for (const r of rows) r.cells.forEach((c, i) => {
        const targets = c.replace(/[{}]/g, " ").split(/[,\s]+/).filter(t => t && !EMPTY.test(t));
        if (targets.length) out.push(`${r.name},${symbols[i]} = ${targets.join(",")}`);
      });
      let src = out.join("\n");
      if (!fin.length) src = completeStartFinal(src.replace(/^start:.*\n/m, ""), block).replace(/^start:.*$/m, "start: " + start);
      return { src, used };
    }
    return null;
  }

  function findAutomaton(block) {
    for (const f of [fromLines, fromTable]) {
      const got = f(block);
      if (!got) continue;
      const prose = block.split("\n").filter((_, i) => !got.used.includes(i)).join("\n").trim();
      try { const N = A.parse(got.src); A.build(N); return { src: A.toText(N), N, prose }; } catch (e) { return { src: got.src, error: e.message, prose }; }
    }
    return null;
  }

  /* ------------------------------------------------------------------ languages described in words */
  function alphabetOf(text) {
    const m = text.match(/(?:over|alphabet|Σ|sigma)\s*(?:=|is)?\s*\{\s*([a-z0-9](?:\s*,\s*[a-z0-9]){1,3})\s*\}/i) || text.match(/\{\s*([a-z0-9](?:\s*,\s*[a-z0-9]){1,3})\s*\}/i);
    if (m) return m[1].split(/\s*,\s*/);
    if (/binary|\b0s?\b.*\b1s?\b|\{0,1\}/i.test(text)) return ["0", "1"];
    return ["a", "b"];
  }
  const word = s => String(s || "").replace(/['"`]/g, "");

  /** Small automaton builders. Each returns automaton text over alphabet al. */
  const B = {
    suffix(al, s) { const n = s.length, L = ["start: p0", "final: p" + n]; al.forEach(c => L.push(`p0,${c} = p0`)); [...s].forEach((c, i) => L.push(`p${i},${c} = p${i + 1}`)); return L.join("\n"); },
    prefix(al, s) { const n = s.length, L = ["start: p0", "final: p" + n]; [...s].forEach((c, i) => L.push(`p${i},${c} = p${i + 1}`)); al.forEach(c => L.push(`p${n},${c} = p${n}`)); return L.join("\n"); },
    infix(al, s) { const n = s.length, L = ["start: p0", "final: p" + n]; al.forEach(c => { L.push(`p0,${c} = p0`); L.push(`p${n},${c} = p${n}`); }); [...s].forEach((c, i) => L.push(`p${i},${c} = p${i + 1}`)); return L.join("\n"); },
    countMod(al, x, k, r) { const L = ["start: c0", "final: c" + r]; for (let i = 0; i < k; i++) al.forEach(c => L.push(`c${i},${c} = c${c === x ? (i + 1) % k : i}`)); return L.join("\n"); },
    lenMod(al, k, r) { const L = ["start: l0", "final: l" + r]; for (let i = 0; i < k; i++) al.forEach(c => L.push(`l${i},${c} = l${(i + 1) % k}`)); return L.join("\n"); },
    countCmp(al, x, n, cmp) { // exactly / at least / at most n occurrences of x
      const top = n + 1, L = ["start: n0"];
      const fin = []; for (let i = 0; i <= top; i++) if ((cmp === "eq" && i === n) || (cmp === "ge" && i >= n) || (cmp === "le" && i <= n)) fin.push("n" + i);
      L.push("final: " + (fin.join(",") || "∅"));
      for (let i = 0; i <= top; i++) al.forEach(c => L.push(`n${i},${c} = n${c === x ? Math.min(i + 1, top) : i}`));
      return L.join("\n");
    },
    lenCmp(al, n, cmp) {
      const top = n + 1, L = ["start: m0"], fin = [];
      for (let i = 0; i <= top; i++) if ((cmp === "eq" && i === n) || (cmp === "ge" && i >= n) || (cmp === "le" && i <= n)) fin.push("m" + i);
      L.push("final: " + (fin.join(",") || "∅"));
      for (let i = 0; i <= top; i++) al.forEach(c => L.push(`m${i},${c} = m${Math.min(i + 1, top)}`));
      return L.join("\n");
    },
    divisible(k) { const L = ["start: r0", "final: r0"]; for (let i = 0; i < k; i++) for (const b of [0, 1]) L.push(`r${i},${b} = r${(2 * i + b) % k}`); return L.join("\n"); }
  };
  const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const num = s => (s in NUM ? NUM[s] : parseInt(s, 10));

  /** Determinise with an explicit alphabet (so unused symbols still get transitions). */
  function dfaOf(src, al) {
    const N = A.parse("alphabet: " + al.join(",") + "\n" + src.replace(/^alphabet:.*$/m, ""));
    return { N, M: A.build(N) };
  }
  function complement(src, al) {
    const { N, M } = dfaOf(src, al);
    const L = ["start: s0", "final: " + (M.D.map((d, i) => (d.fin ? null : "s" + i)).filter(Boolean).join(",") || "∅")];
    M.trans.forEach(t => L.push(`s${t.f},${t.c} = s${t.t}`));
    return L.join("\n");
  }
  function product(a, b, al, op) {
    const X = dfaOf(a, al), Y = dfaOf(b, al), key = (i, j) => `P${i}_${j}`, seen = new Map(), q = [[0, 0]], L = [];
    seen.set("0,0", true);
    const fin = [];
    while (q.length) {
      const [i, j] = q.shift();
      const acc = op === "and" ? X.M.D[i].fin && Y.M.D[j].fin : X.M.D[i].fin || Y.M.D[j].fin;
      if (acc) fin.push(key(i, j));
      for (const c of al) {
        const ni = X.M.tm[i + "|" + c], nj = Y.M.tm[j + "|" + c];
        L.push(`${key(i, j)},${c} = ${key(ni, nj)}`);
        if (!seen.has(ni + "," + nj)) { seen.set(ni + "," + nj, true); q.push([ni, nj]); }
      }
    }
    // readable names: s0, s1, … in discovery order
    const names = {}; let k = 0;
    const nm = x => (names[x] = names[x] || "s" + k++);
    nm("P0_0");
    const lines = L.map(l => l.replace(/P\d+_\d+/g, nm));
    return ["start: s0", "final: " + (fin.map(nm).join(",") || "∅"), ...lines].join("\n");
  }

  /** One condition such as "ends with ab" or "even number of a's". Returns {src, label} or null. */
  function condition(t, al) {
    const sym = `[${al.map(c => c.replace(/[-\]\\^]/g, "\\$&")).join("")}]`;
    const str = `["'\`]?(${sym}+)["'\`]?`;
    let m, neg = false;
    let s = t.trim();
    if (/^(?:that\s+)?(?:do(?:es)?\s+not|don't|doesn't|not)\s+/i.test(s) || /\b(?:without)\b/i.test(s)) { neg = true; s = s.replace(/^(?:that\s+)?(?:do(?:es)?\s+not|don't|doesn't|not)\s+/i, "").replace(/\bwithout\b/i, "containing"); }
    let r = null;
    if ((m = s.match(new RegExp(`\\b(?:end|ends|ending)\\s+(?:with|in)\\s+${str}`, "i")))) r = { src: B.suffix(al, word(m[1])), label: "strings ending with " + m[1] };
    else if ((m = s.match(new RegExp(`\\b(?:start|starts|starting|begin|begins|beginning)\\s+with\\s+${str}`, "i")))) r = { src: B.prefix(al, word(m[1])), label: "strings starting with " + m[1] };
    else if ((m = s.match(new RegExp(`\\b(?:contain|contains|containing|having|has|with)\\s+(?:the\\s+)?(?:sub-?string\\s+)?${str}(?:\\s+as\\s+(?:a\\s+)?sub-?string)?`, "i"))) && !/number|length|exactly|at least|at most/i.test(s)) r = { src: B.infix(al, word(m[1])), label: "strings containing " + m[1] };
    else if ((m = s.match(new RegExp(`\\b(even|odd)\\s+(?:number|no\\.?)\\s+of\\s+${str}`, "i")))) r = { src: B.countMod(al, m[2][0], 2, m[1].toLowerCase() === "even" ? 0 : 1), label: `an ${m[1].toLowerCase()} number of ${m[2][0]}'s` };
    else if ((m = s.match(new RegExp(`(?:number|no\\.?)\\s+of\\s+${str}'?s?\\s+(?:is\\s+)?(?:divisible by|a multiple of)\\s+(\\d)`, "i")))) r = { src: B.countMod(al, m[1][0], +m[2], 0), label: `number of ${m[1][0]}'s divisible by ${m[2]}` };
    else if ((m = s.match(new RegExp(`(?:number|no\\.?)\\s+of\\s+${str}'?s?\\s+(?:is\\s+)?(?:≡|congruent to|leaves remainder|mod\\s*(\\d)\\s*=)\\s*(\\d)`, "i")))) r = null;
    else if ((m = s.match(/\b(even|odd)\s+length\b|\blength\s+(?:is\s+)?(even|odd)\b/i))) { const p = (m[1] || m[2]).toLowerCase(); r = { src: B.lenMod(al, 2, p === "even" ? 0 : 1), label: p + " length" }; }
    else if ((m = s.match(/length\s+(?:is\s+)?(?:divisible by|a multiple of)\s+(\d)/i))) r = { src: B.lenMod(al, +m[1], 0), label: "length divisible by " + m[1] };
    else if ((m = s.match(new RegExp(`\\b(exactly|at least|atleast|at most|atmost)\\s+(\\d|zero|one|two|three|four|five|six)\\s+${str}'?s?\\b`, "i")))) { const k = m[1].toLowerCase().replace(/\s/g, ""), n = num(m[2].toLowerCase()); if (n <= 6) r = { src: B.countCmp(al, m[3][0], n, k === "exactly" ? "eq" : k === "atleast" ? "ge" : "le"), label: `${m[1].toLowerCase()} ${n} ${m[3][0]}'s` }; }
    else if ((m = s.match(/length\s+(?:is\s+)?(exactly|at least|atleast|at most|atmost)\s+(\d)/i))) { const k = m[1].toLowerCase().replace(/\s/g, ""), n = +m[2]; if (n <= 8) r = { src: B.lenCmp(al, n, k === "exactly" ? "eq" : k === "atleast" ? "ge" : "le"), label: `length ${m[1]} ${n}` }; }
    else if ((m = s.match(/divisible by\s+(\d{1,2})/i)) && al.join("") === "01") { const k = +m[1]; if (k >= 2 && k <= 12) r = { src: B.divisible(k), label: "binary numbers divisible by " + k }; }
    if (!r) return null;
    return neg ? { src: complement(r.src, al), label: "NOT (" + r.label + ")" } : r;
  }

  /** Reference automaton for a "design a DFA that accepts …" question, or null. */
  function recogniseLanguage(text) {
    const al = alphabetOf(text);
    const lower = text.replace(/\s+/g, " ");
    const m = lower.match(/(?:accept(?:s|ing)?|recogni[sz]e[sd]?|for|of)\s+(?:the\s+)?(?:set of\s+|language of\s+)?(?:all\s+)?(?:strings?|words?|binary (?:strings|numbers)|numbers)?\s*(?:over\s*(?:the alphabet\s*)?\{[^}]*\}\s*|over \w+\s*)?(?:which|that|in which|where|such that|having|with)?\s*(.+)$/i);
    const tryDesc = desc => {
      const parts = desc.replace(/[.;?]\s*$/, "").split(/\s+(and|or|but)\s+/i);
      let cur = null;
      for (let i = 0; i < parts.length; i += 2) {
        const c = condition(parts[i], al);
        if (!c) return null;
        if (!cur) cur = c;
        else { const op = /or/i.test(parts[i - 1]) ? "or" : "and"; cur = { src: product(cur.src, c.src, al, op), label: `${cur.label} ${op} ${c.label}` }; }
      }
      return cur;
    };
    const cur = (m && tryDesc(m[1])) || tryDesc(lower);
    if (!cur) return null;
    const N = A.parse("alphabet: " + al.join(",") + "\n" + cur.src);
    return { src: A.toText(N), label: cur.label, alphabet: al };
  }

  /* ------------------------------------------------------------------ other details */
  function marksOf(text) {
    const m = text.match(/[\[(]\s*(\d{1,2})\s*(?:marks?|m)?\s*[\])]|(\d{1,2})\s*marks?\b/i);
    return m ? Math.min(20, Math.max(1, +(m[1] || m[2]))) : null;
  }
  function optionsOf(text) {
    const lines = text.split("\n"), opts = [];
    let stemEnd = lines.length;
    lines.forEach((l, i) => {
      const m = l.match(/^\s*(?:\(?([a-dA-D])[).]|([a-dA-D])\s*[:\-])\s+(.+)$/);
      if (m) { if (!opts.length) stemEnd = i; opts.push({ key: (m[1] || m[2]).toLowerCase(), text: m[3].trim() }); }
    });
    // inline options: "(a) x (b) y (c) z (d) w"
    if (opts.length < 2) {
      const inline = text.match(/\(a\)\s*(.+?)\s*\(b\)\s*(.+?)\s*(?:\(c\)\s*(.+?)\s*)?(?:\(d\)\s*(.+?))?(?:\n|$|answer|ans)/i);
      if (inline) return { stem: text.slice(0, text.search(/\(a\)/i)).trim(), options: inline.slice(1).filter(Boolean).map(s => s.trim()) };
      return null;
    }
    return { stem: lines.slice(0, stemEnd).join(" ").trim(), options: opts.map(o => o.text) };
  }
  function answerKey(text) {
    const m = text.match(/\b(?:answer|ans|correct(?: answer)?)\s*[:.\-=]?\s*\(?([a-dA-D]|true|false|t|f)\b\)?/i);
    return m ? m[1].toLowerCase() : null;
  }
  function stringsOf(text, N) {
    const al = N ? N.alpha : ["a", "b", "0", "1"];
    const ok = w => w === "ε" || (w.length <= 40 && [...w].every(c => al.includes(c)));
    const out = [];
    const quoted = text.match(/["'`]([^"'`\n]{1,40})["'`]/g) || [];
    quoted.forEach(q => { const w = q.slice(1, -1).trim(); if (ok(w)) out.push(w); });
    const m = text.match(/(?:strings?|inputs?|words?|w\s*=)\s*[:=]?\s*([^\n]+)/i);
    if (m) m[1].split(/[\s,;]+|\band\b/).map(s => s.replace(/[(){}\[\].?]/g, "")).filter(Boolean).forEach(w => { if (ok(w) && w.length >= 1) out.push(w); });
    return [...new Set(out.map(w => (w === "ε" ? "" : w)))].slice(0, 10);
  }
  const VERB_LEVEL = [
    [/^(define|list|state|name|identify|recall|what is|write down)\b/i, "Remember"],
    [/^(explain|describe|discuss|differentiate|distinguish between|compare|classify|summari[sz]e|why)\b/i, "Understand"],
    [/^(convert|compute|find|apply|trace|simulate|calculate|obtain|show)\b/i, "Apply"],
    [/^(analy[sz]e|determine|examine|minimi[sz]e|check whether)\b/i, "Analyze"],
    [/^(justify|prove|evaluate|verify|critique|argue)\b/i, "Evaluate"],
    [/^(design|construct|draw|develop|build|create|formulate)\b/i, "Create"]
  ];
  const bloomOf = text => { for (const [re, lvl] of VERB_LEVEL) if (re.test(text.trim())) return lvl; return null; };

  /* ------------------------------------------------------------------ one block → draft */
  function draftFrom(block, index) {
    const text = block.replace(/\s+\n/g, "\n").trim();
    const oneLine = text.split("\n")[0].trim();
    const lower = text.toLowerCase();
    const marks = marksOf(text);
    const notes = [];
    let rec = null;
    const auto = findAutomaton(text);
    const opt = optionsOf(text);

    if (opt && opt.options.length >= 2) {
      const key = answerKey(text);
      rec = { type: "mcq", text: opt.stem || oneLine, options: opt.options.slice(0, 6), answer: key && /^[a-d]$/.test(key) ? "abcd".indexOf(key) : -1 };
      if (rec.answer < 0) notes.push("Mark the correct option.");
    } else if (/true or false|true\/false|\bt\/f\b|state (?:whether )?true/i.test(text)) {
      const key = answerKey(text);
      rec = { type: "tf", text: text.replace(/\b(?:answer|ans)\s*[:.\-=]?\s*\w+.*$/im, "").replace(/^\s*(?:state\s+(?:whether\s+)?)?(?:true or false|true\/false|t\/f)\s*[:.\-]?\s*/i, "").replace(/\(?\s*(?:true or false|true\/false|t\/f)\s*\)?\s*[.:?]?/ig, "").trim(), answer: key ? key[0] === "t" : true };
      if (!key) notes.push("Check whether the statement is true or false.");
    } else if (auto && auto.N) {
      const N = auto.N;
      const strings = stringsOf(text, N);
      const closure = text.match(/closure\s*(?:of)?\s*\(?\s*\{?\s*([\w'.]+)/i);
      if (/minimi[sz]|equivalent states|indistinguishable|myhill|table.?filling/i.test(text) && A.isDeterministic(N)) rec = { type: "classes", src: auto.src };
      else if (/closure/i.test(text) && closure && N.states.includes(closure[1])) rec = { type: "closure", src: auto.src, state: closure[1] };
      else if (/(how many|number of)\s+(?:\w+\s+){0,3}states/i.test(text)) rec = { type: "count", src: auto.src, what: /minimal|minimum|minimi/i.test(text) ? "minimal" : "dfa" };
      else if (strings.length && /accept|reject|trace|simulat|process|run|check whether|test/i.test(text)) rec = { type: "accept", src: auto.src, strings };
      else rec = { type: "construct", src: auto.src };
      if (rec.type === "construct" && /minimi/i.test(lower) && !A.isDeterministic(N)) notes.push("The question mentions minimisation but the automaton is an NFA; saved as a conversion question.");
      rec.text = auto.prose.replace(/\n{2,}/g, "\n").trim() || oneLine;
      if (rec.text.length > 600) rec.text = rec.text.slice(0, 600) + "…";
    } else if (auto && auto.error) {
      rec = { type: "construct", text: auto.prose || oneLine, src: auto.src };
      notes.push("An automaton was found but could not be read: " + auto.error);
    } else if (/\b(design|construct|draw|build|give|obtain|write)\b[^.]*\b(dfa|nfa|automat\w*|machine|fa)\b/i.test(text) || /\bdfa\b.*\baccept/i.test(text)) {
      const lang = recogniseLanguage(text);
      rec = { type: "design", text: oneLine.length > 20 ? text.split("\n").slice(0, 3).join(" ") : text, requireDFA: /\bdfa\b/i.test(text) && !/\bnfa\b/i.test(text) };
      if (lang) { rec.reference = lang.src; notes.push(`Reference automaton built from the wording (“${lang.label}”). Check it before saving.`); }
      else if (/palindrom|a\s*\^?\s*n\s*b\s*\^?\s*n|aⁿbⁿ|0\^n\s*1\^n|equal number of|same number of|\bww\b|w\s*w\s*\^?\s*r|prime/i.test(text)) notes.push("This language is not regular, so no DFA or NFA can accept it. Reword the question (for example, bound the length) or keep it as a written answer.");
      else notes.push("Write a reference automaton so answers can be graded (the wording was not recognised).");
    } else {
      rec = { type: "short", text: text.length > 1200 ? text.slice(0, 1200) : text, model: "" };
      notes.push("Add a model answer (written answers are self-marked).");
    }
    const level = bloomOf(rec.text || oneLine);
    if (level && ["short", "mcq", "tf"].includes(rec.type)) rec.bloom = level;
    rec.marks = marks || { mcq: 1, tf: 1, closure: 2, count: 2, accept: 3, classes: 4, construct: 5, design: 5, short: 3 }[rec.type];
    rec.difficulty = rec.type === "design" || rec.type === "construct" ? "Medium" : "Easy";
    rec.origin = "manual";
    const clean = Q.cleanBank(rec);
    const problems = Q.validateBank(clean);
    return { index, original: block, rec: clean, problems, notes: [...new Set(notes)], ready: !problems.length };
  }

  function extract(text) {
    const blocks = split(text);
    return blocks.map((b, i) => draftFrom(b, i + 1));
  }

  const NON_REGULAR = /palindrom|a\s*\^?\s*n\s*b\s*\^?\s*n|aⁿbⁿ|0\s*\^\s*n\s*1\s*\^\s*n|equal number of|same number of|\bww\b|w\s*w\s*\^?\s*r|\bprime\b|balanced paren/i;

  /** Find a regular expression written in the text, e.g. "(a|b)*abb" or "regular expression ab*+b". */
  function findRegex(text) {
    const t = normalise(text);
    const tagged = t.match(/(?:regular expression|regex|r\.?e\.?|expression)\s*(?:is|=|:)?\s*([()a-z0-9|+*?εΛλ∅ ]{2,40}?)(?=[\s.,;]*(?:$|\n|\bover\b|\binto\b|\bto\b|\busing\b|\band\b))/i);
    const cands = [];
    if (tagged) cands.push(tagged[1].trim());
    (t.match(/[()a-z0-9|+*?ε]*[*|()+][()a-z0-9|+*?ε]*/gi) || []).filter(x => /[a-z0-9]/i.test(x) && /[*|()]/.test(x) && x.length >= 2).forEach(x => cands.push(x));
    for (const c of cands) { try { const r = A.regexToNFA(c); return { src: r.text, regex: r.normalized }; } catch (e) { /* try next */ } }
    return null;
  }

  /**
   * Build an automaton from a question typed in words, for the simulators.
   * Returns { src, how } or null. Order: an automaton written in the question → a regular expression → a described language.
   */
  function automatonFromQuestion(text) {
    const auto = findAutomaton(normalise(text));
    if (auto && auto.N) return { src: auto.src, how: "Read the automaton written in your question." };
    const re = findRegex(text);
    if (re) return { src: re.src, how: `Built an ε-NFA for the regular expression ${re.regex} (Thompson's construction).` };
    const lang = recogniseLanguage(normalise(text));
    if (lang) return { src: lang.src, how: `Built an automaton over {${lang.alphabet.join(",")}} for: ${lang.label}.` };
    if (NON_REGULAR.test(text)) return { error: "That language is not regular (it needs unbounded counting or memory), so no DFA or NFA can accept it. Try a bounded version, for example palindromes of length at most 4." };
    return null;
  }

  const API = { normalise, split, findAutomaton, findRegex, recogniseLanguage, automatonFromQuestion, extract, draftFrom };
  if (node) module.exports = API; else root.Extract = API;
})(typeof window !== "undefined" ? window : globalThis);
