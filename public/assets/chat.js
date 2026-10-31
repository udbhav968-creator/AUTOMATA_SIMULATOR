/*
 * TutorChat — the AI tutor.
 * Online: messages go to /api/chat (Gemini, key kept on the server).
 * Fallbacks, in order: Gemini error/quota/timeout → server says {offline:true} → built-in tutor answers;
 *                      server unreachable (static hosting, server stopped) → built-in tutor answers.
 * Any automaton the tutor writes (```nfa block) is re-checked here with the engine and gets buttons to
 * open it in a simulator, practise it, or save it to the question bank.
 * Pages can provide context through Studio.context = () => ({ page, automaton, step, question, questionObj, answer, exam }).
 */
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAX_LEN = 2000, KEEP = 30;

  /* ------------------------------------------------------------ safe markdown-lite */
  function render(md, blocks) {
    const parts = String(md).split(/```([a-zA-Z]*)[ \t]*\n?([\s\S]*?)```/g);
    let html = "";
    for (let i = 0; i < parts.length; i++) {
      if (i % 3 === 0) html += inline(parts[i]);
      else if (i % 3 === 1) {
        const lang = parts[i].toLowerCase(), code = parts[i + 1].replace(/\n$/, "");
        i++;
        if (["nfa", "dfa", "automaton", "enfa"].includes(lang) || (!lang && /start\s*:/i.test(code))) { blocks.push(code.trim()); html += card(code.trim(), blocks.length - 1); }
        else html += `<pre><code>${esc(code)}</code></pre>`;
      }
    }
    return html;
  }
  function inline(t) {
    const lines = esc(t).split(/\n/);
    let out = "", list = null;
    const fmt = s => s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    for (const raw of lines) {
      const l = raw.trimEnd(), m = l.match(/^\s*(?:[-•*]|(\d+)[.)])\s+(.*)$/);
      if (m) {
        const type = m[1] ? "ol" : "ul";
        if (list !== type) { if (list) out += `</${list}>`; out += `<${type}>`; list = type; }
        out += `<li>${fmt(m[2])}</li>`; continue;
      }
      if (list) { out += `</${list}>`; list = null; }
      if (l.trim()) out += `<p>${fmt(l)}</p>`;
    }
    if (list) out += `</${list}>`;
    return out;
  }
  function card(src, id) {
    let ok = true, info = "", det = false;
    try { const N = Automata.parse(src); Automata.build(N); det = Automata.isDeterministic(N) && !Automata.dfaProblems(N).length; info = `${N.states.length} states · {${N.alpha.join(",")}}`; }
    catch (e) { ok = false; info = e.message; }
    return `<div class="auto-card"><pre><code>${esc(src)}</code></pre>${ok
      ? `<div class="bar"><span class="tiny muted">${esc(info)}</span><span class="spacer"></span>
           <button class="btn sm" data-open="subset.html" data-b="${id}">Convert</button>
           <button class="btn sm" data-open="run.html" data-b="${id}">Run</button>
           ${det ? `<button class="btn sm" data-open="minimize.html" data-b="${id}">Minimise</button>` : ""}
           <button class="btn sm" data-practise="${id}">Practise</button>
           <button class="btn sm" data-bank="${id}">Save to bank</button></div>`
      : `<div class="bad">This automaton could not be read: ${esc(info)}</div>`}</div>`;
  }

  /* ------------------------------------------------------------ built-in tutor */
  const DEFS = [
    [/ε-?closure|epsilon.?closure|e-closure/, "**ε-closure(q)** is q together with every state reachable from q using only ε-moves. Compute it with a stack: start from {q}, follow ε-arrows, add new states, repeat until nothing changes. It always contains q itself."],
    [/subset construction|powerset/, "**Subset construction** turns an NFA into a DFA. Each DFA state is a set of NFA states. Start with ε-closure(q0). For every new set S and symbol a, compute T = ε-closure(move(S, a)); if T is new, add it. A set is final when it contains a final NFA state. At most 2ⁿ sets exist, but usually far fewer are reachable."],
    [/dead state|trap state|empty set state|∅ state/, "The **dead state ∅** appears when no NFA state can follow a symbol. Once there, the DFA stays there on every symbol and never accepts, so it is never final."],
    [/minimi[sz]/, "**DFA minimisation**: remove unreachable states, add a trap if transitions are missing, then mark pairs of states that some string can tell apart. Start with (final, non-final) pairs; mark (p, q) if some symbol leads them to an already-marked pair; repeat. Unmarked pairs are equivalent and merge."],
    [/myhill|nerode/, "The **Myhill–Nerode theorem**: a language is regular iff it has finitely many equivalence classes of the relation “x ≡ y when no suffix z separates xz and yz”. The number of classes is the size of the minimal DFA, which is unique up to renaming."],
    [/thompson/, "**Thompson's construction** builds an ε-NFA from a regular expression: a symbol gets two states and one arrow; concatenation links the end of one part to the start of the next with ε; union adds a new start and end with ε-arrows to both parts; star adds a new start and end plus ε-arrows to repeat or skip."],
    [/\bnfa\b|non.?determin/, "An **NFA** (Q, Σ, δ, q0, F) may have several next states (δ: Q × (Σ ∪ {ε}) → 2^Q). It accepts if *some* path ends in a final state. NFAs recognise exactly the regular languages, like DFAs."],
    [/\bdfa\b|determin/, "A **DFA** (Q, Σ, δ, q0, F) has exactly one next state for each state and symbol (δ: Q × Σ → Q) and no ε-moves. It accepts a string if the single path ends in a final state."],
    [/move\(|move function|what is move/, "**move(S, a)** is the set of states reachable from any state of S by exactly one a-arrow (no ε). In subset construction you always take ε-closure(move(S, a)) next."],
    [/equivalen/, "Two automata are **equivalent** if they accept exactly the same strings. The simulator checks it by exploring pairs of subsets; when they differ it reports the shortest string accepted by only one of them."],
    [/regular (language|expression)/, "A **regular language** is one accepted by some finite automaton; equivalently, described by a regular expression. Regular languages are closed under union, concatenation, star, complement and intersection."],
    [/pumping/, "The **pumping lemma** (for regular languages): if L is regular there is p such that every w in L with |w| ≥ p splits as xyz with |xy| ≤ p, |y| ≥ 1, and xyⁱz ∈ L for all i ≥ 0. It is used to prove a language is *not* regular."]
  ];

  function offline(text, ctx) {
    const t = text.toLowerCase(), A = window.Automata, Q = window.QGen;
    const blockMatch = text.match(/```[a-z]*\s*\n([\s\S]*?)```/);
    const src = blockMatch ? blockMatch[1] : (ctx.automaton || "");
    let N = null; try { if (src.trim()) N = A.parse(src); } catch (e) { /* ignore */ }
    const level = /hard/.test(t) ? "Hard" : /easy/.test(t) ? "Easy" : "Medium";

    if (/^(hi|hello|hey|namaste)\b/.test(t)) return "Hello! I can make practice questions, give hints, explain the current step, compute ε-closures, run strings and convert or minimise the automaton you have loaded.";

    if (/hint|stuck|clue/.test(t) && ctx.questionObj && Q) return "**Hint:** " + Q.hint(ctx.questionObj);

    if (/(question|quiz|practi[cs]e|test me|exercise|problem)/.test(t) && Q) {
      const LEVEL_TYPES = { remember: "mcq", understand: "tf", apply: "closure", analy: "count", evaluate: "evaluate", create: "construct" };
      const levels = Object.keys(LEVEL_TYPES).filter(k => t.includes(k));
      const pickType = () => /table.?filling|minim|equivalent state|merge/.test(t) ? "classes" : /closure/.test(t) ? "closure" : /move/.test(t) ? "move" : /table/.test(t) ? "table"
        : /design|language/.test(t) ? "design" : /accept|reject|string/.test(t) ? "accept" : /judge|evaluate|check a dfa/.test(t) ? "evaluate"
        : /count|how many/.test(t) ? "count" : /mcq|multiple|concept|definition/.test(t) ? "mcq" : "construct";
      const types = levels.length > 1 ? levels.slice(0, 3).map(l => LEVEL_TYPES[l]) : [levels.length === 1 && !/closure|move|table|design|accept|count|minim/.test(t) ? LEVEL_TYPES[levels[0]] : pickType()];
      const eps = /ε|eps|epsilon/.test(t) ? true : undefined;
      const parts = types.map((type, k) => {
        const q = Q.makeQuestion(type, { difficulty: level, eps });
        let out = `${types.length > 1 ? `**Question ${k + 1}. ` : "**"}${q.bloom} level — ${q.verb}** (${q.difficulty}, ${q.marks} mark${q.marks > 1 ? "s" : ""})\n\n${q.prompt}`;
        if (q.data && q.data.options) out += "\n" + q.data.options.map((o, i) => `${i + 1}. ${o}`).join("\n");
        if (q.data && q.data.strings) out += "\nStrings: " + q.data.strings.map(s => "`" + (s || "ε") + "`").join(", ");
        if (q.data && q.data.candidate) out += "\nNFA:\n```nfa\n" + q.src + "\n```\nStudent's DFA:\n```nfa\n" + q.data.candidate + "\n```";
        else if (q.src) out += "\n```nfa\n" + q.src + "\n```";
        return out;
      });
      return parts.join("\n\n") + "\n\nUse **Practise** on an automaton, or open Practice & exam to have answers graded. Ask me for a hint any time.";
    }

    if (/string (it|that) (rejects|accepts)|example (of a )?string|give me a string/.test(t) && N) {
      const want = /reject/.test(t) ? false : true, sep = N.alpha.every(a => a.length === 1) ? "" : " ";
      const q = [[]];
      for (let k = 0; k < q.length && k < 3000; k++) {
        const w = q[k];
        if (A.runNFA(N, w) === want) { const r = A.traceNFA(N, w); return `“${w.join(sep) || "ε"}” is ${want ? "accepted" : "rejected"} (the shortest such string). ${r.reason}`; }
        if (w.length < 8) N.alpha.forEach(c => q.push([...w, c]));
      }
      return `I found no ${want ? "accepted" : "rejected"} string up to length 8 — the language may be ${want ? "empty" : "everything (Σ*)"}.`;
    }

    if (/(this|current) step|explain (the )?step|why (is|did|does)/.test(t) && ctx.step) return "**What is happening:** " + ctx.step + "\n\nIn every step the simulator takes one set S and one symbol a, computes move(S, a), then adds everything reachable by ε-moves. If the resulting set is new it becomes a new DFA state; otherwise only an arrow is added.";

    if (/closure/.test(t) && N) {
      const after = text.slice(t.indexOf("closure"));
      const st = N.states.find(s => new RegExp("(^|[^A-Za-z0-9_'.])" + s.replace(/[.']/g, "\\$&") + "($|[^A-Za-z0-9_'.])").test(after));
      if (st) {
        const d = A.closureDetail(N, [st]);
        return `ε-closure(${st}) = **${A.fmtSet(d.set)}**` + (d.edges.length ? `\nε-arrows followed: ${d.edges.map(e => e[0] + " → " + e[2]).join(", ")}.` : `\nNo ε-arrows leave ${st}, so the closure is just {${st}}.`);
      }
      const lines = N.states.slice(0, 10).map(s => `- ε-closure(${s}) = ${A.fmtSet(A.closure(N, [s]))}`).join("\n");
      return DEFS[0][1] + `\n\nIn the loaded automaton${N.hasEps ? "" : " (it has no ε-moves, so every closure is just the state itself)"}:\n` + lines;
    }

    let m;
    m = text.match(/(?:accept|run|trace|test)\w*\s+(?:the\s+)?(?:string\s+)?["“'`]?([^"”'`\s?]+|ε)/i);
    if (m && N && !/question/.test(t)) {
      const w = A.tokenize(N, m[1] === "ε" ? "" : m[1]), r = A.traceNFA(N, w);
      return `Running **${m[1]}**:\n` + r.steps.slice(0, 14).map(s => s.i < 0 ? `- start: ε-closure(${N.start}) = ${A.fmtSet(s.after)}` : `- read ${s.sym}: move = ${A.fmtSet(s.afterMove)}, closure = ${A.fmtSet(s.after)}`).join("\n") + `\n\n**Result:** ${r.reason}`;
    }

    if (/minim/.test(t) && N) {
      let D = N, via = "";
      if (!A.isDeterministic(N)) { const M = A.build(N); D = A.parse(A.dfaToText(N, M)); via = `It is not a DFA, so I converted it first (${M.D.length} states). `; }
      const r = A.minimizeSteps(D);
      return via + `The minimal DFA has **${r.minimal.states.length} states**. Equivalence classes: ${r.classes.map(c => "{" + c.join(",") + "}").join(" ")}.` + (r.removed.length ? ` Unreachable states removed: ${r.removed.join(", ")}.` : "") + "\nOpen Minimise DFA to watch the table-filling steps.";
    }

    if (/convert|subset|to (a )?dfa|dfa for this/.test(t) && N) {
      const M = A.build(N);
      return `Subset construction gives **${M.D.length} DFA states** (minimal: ${A.minimize(N, M)}).\n` + M.D.slice(0, 12).map((d, i) => `- D${i} = ${A.fmtSet(d.set)}${i === 0 ? " (start)" : ""}${d.fin ? " (final)" : ""}: ` + N.alpha.map(c => `${c}→D${M.tm[i + "|" + c]}`).join(", ")).join("\n") + (M.D.length > 12 ? "\n- …" : "") + "\nOpen the NFA → DFA simulator to watch each step.";
    }

    for (const [re, ans] of DEFS) if (re.test(t)) return ans;

    if (/check my answer|is (this|my answer) (right|correct)/.test(t)) return "Press **Check answer** under the question: the simulator grades it exactly (it compares languages, not just text) and shows a counter-example string when something is wrong.";

    return "I'm the built-in tutor, so I answer from the simulator's own engine. Try:\n- “Make a hard ε-NFA question”\n- “ε-closure of q1”\n- “Does it accept abba?”\n- “Convert this to a DFA” or “Minimise it”\n- “What is a dead state?”";
  }

  /* ------------------------------------------------------------ widget */
  class TutorChat {
    constructor(host, opts) {
      this.opts = Object.assign({ inline: false }, opts || {});
      this.history = Studio.session.get("chat.history", []);
      this.blocks = [];
      this.busy = false;
      const box = document.createElement("section");
      box.className = "chatbox" + (this.opts.inline ? " inline" : "");
      box.setAttribute("aria-label", "AI tutor");
      box.innerHTML = `
        <div class="chat-head"><div><b>Tutor</b><div class="status tiny" data-ai><i></i><span>Checking…</span></div></div><span class="spacer"></span>
          <button class="btn sm quiet" data-a="clear" title="Start a new conversation">New chat</button>
          ${this.opts.inline ? "" : '<button class="btn sm icon" data-a="close" aria-label="Close tutor">✕</button>'}</div>
        <div class="chat-log" aria-live="polite"></div>
        <div class="chat-quick"></div>
        <div class="chat-input"><textarea rows="1" maxlength="${MAX_LEN}" placeholder="Ask about automata, or “make me a question”" aria-label="Message the tutor"></textarea><button class="btn primary" data-a="send">Send</button></div>`;
      this.box = box;
      this.log = box.querySelector(".chat-log");
      this.input = box.querySelector("textarea");
      if (this.opts.inline) host.append(box);
      else {
        box.hidden = true;
        this.fab = document.createElement("button");
        this.fab.className = "fab noprint";
        this.fab.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/></svg>Ask the tutor';
        this.fab.addEventListener("click", () => this.open());
        document.body.append(this.fab, box);
      }
      box.addEventListener("click", e => this.onClick(e));
      this.input.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.send(this.input.value); }
        if (e.key === "Escape" && !this.opts.inline) this.close();
      });
      this.input.addEventListener("input", () => { this.input.style.height = "auto"; this.input.style.height = Math.min(140, this.input.scrollHeight) + "px"; });
      this.renderQuick();
      this.redraw();
      Studio.health().then(() => {});
    }

    ctx() { try { return (Studio.context && Studio.context()) || {}; } catch (e) { return {}; } }

    renderQuick() {
      const chips = (Studio.chatChips || []).concat(["Make me a question", "Give me a hint", "Explain this step", "What is ε-closure?", "Minimise the loaded automaton"]);
      this.box.querySelector(".chat-quick").innerHTML = [...new Set(chips)].slice(0, 7).map(c => `<button type="button" data-q="${esc(c)}">${esc(c)}</button>`).join("");
    }

    open(prefill) { if (this.fab) { this.box.hidden = false; this.fab.hidden = true; } this.renderQuick(); if (prefill) this.input.value = prefill; this.input.focus(); this.log.scrollTop = 1e9; }
    close() { if (!this.fab) return; this.box.hidden = true; this.fab.hidden = false; this.fab.focus(); }

    onClick(e) {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.a === "send") return this.send(this.input.value);
      if (b.dataset.a === "close") return this.close();
      if (b.dataset.a === "clear") { this.history = []; this.save(); this.redraw(); return; }
      if (b.dataset.q) return this.send(b.dataset.q);
      const src = this.blocks[+(b.dataset.b ?? b.dataset.practise ?? b.dataset.bank)];
      if (src == null) return;
      if (b.dataset.open) Studio.handoff(b.dataset.open, { src });
      else if (b.dataset.practise != null) Studio.handoff("practice.html", { question: { id: "chat" + Date.now().toString(36), type: "construct", bloom: "Create", verb: "Construct", lo: "LO2", difficulty: "Medium", marks: 5, source: "ai", prompt: "Convert this NFA (from the tutor) into an equivalent DFA.", src, data: { requireDFA: true } } });
      else if (b.dataset.bank != null) Studio.handoff("bank.html", { draft: { type: "construct", text: "Convert the given NFA into an equivalent DFA using subset construction.", src, origin: "ai" } });
    }

    save() { Studio.session.set("chat.history", this.history.slice(-KEEP)); }

    redraw() {
      this.blocks = [];
      if (!this.history.length) {
        this.log.innerHTML = `<div class="bubble bot"><p>Hi! I'm your automata tutor. I can explain any step, give hints without spoiling the answer, check your reasoning and write new practice questions.</p><p class="tiny muted">I can see the automaton and step you are working on.</p></div>`;
        return;
      }
      this.log.innerHTML = this.history.map(m => this.bubble(m)).join("");
      this.log.scrollTop = 1e9;
    }
    bubble(m) {
      if (m.role === "user") return `<div class="bubble me">${esc(m.content).replace(/\n/g, "<br>")}</div>`;
      return `<div class="bubble bot">${render(m.content, this.blocks)}${m.note ? `<div class="note">${esc(m.note)}</div>` : ""}</div>`;
    }

    async send(text) {
      text = String(text || "").trim();
      if (!text || this.busy) return;
      if (text.length > MAX_LEN) { Studio.toast(`Messages are limited to ${MAX_LEN} characters.`, "err"); return; }
      this.busy = true;
      this.input.value = ""; this.input.style.height = "auto";
      const sendBtn = this.box.querySelector("[data-a=send]"); sendBtn.disabled = true;
      this.history.push({ role: "user", content: text });
      this.redraw();
      const typing = document.createElement("div");
      typing.className = "bubble bot typing"; typing.textContent = "Thinking…";
      this.log.append(typing); this.log.scrollTop = 1e9;
      const ctx = this.ctx();
      let reply, note = "";
      if (ctx.exam) { reply = "A timed exam is running, so the tutor is paused. It will be back after you submit."; }
      else {
        try {
          const res = await Studio.api("/api/chat", { body: { messages: this.history.filter(m => !m.local).map(m => ({ role: m.role, content: m.content })), context: { page: ctx.page, automaton: ctx.automaton, step: ctx.step, question: ctx.question, answer: ctx.answer } }, timeout: 50000 });
          if (res.offline) { reply = offline(text, ctx); note = (res.reason === "no-key" ? "Gemini is not configured on the server" : "Gemini unavailable: " + (res.message || res.reason)) + " — answered by the built-in tutor."; }
          else { reply = res.reply; note = res.model ? `Gemini · ${res.model}${res.truncated ? " · answer was cut short" : ""}` : ""; }
        } catch (e) {
          reply = offline(text, ctx);
          note = (e.offline ? "Server offline" : e.message) + " — answered by the built-in tutor.";
        }
      }
      typing.remove();
      this.history.push({ role: "assistant", content: reply, note });
      this.save();
      this.redraw();
      this.busy = false; sendBtn.disabled = false;
      this.input.focus();
    }
  }

  TutorChat.offline = offline;
  window.TutorChat = TutorChat;
  /** Mount the floating tutor on every page except the full tutor page. */
  function boot() {
    if (document.body.dataset.noFab != null) return;
    window.Tutor = new TutorChat(null, { inline: false });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
