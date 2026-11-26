(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const split = s => [...new Set(String(s).split(/[,\s]+/).filter(Boolean))];

  const NFA_EXAMPLES = [
    { name: "Ends with ab", src: "# Strings over {a,b} ending in ab\nstates: q0, q1, q2\nstart: q0\nfinal: q2\nq0,a = q0,q1\nq0,b = q0\nq1,b = q2" },
    { name: "ε-NFA for a*b*c*", src: "# ε-moves let the machine skip a block\nstart: q0\nfinal: q2\nq0,a = q0\nq0,ε = q1\nq1,b = q1\nq1,ε = q2\nq2,c = q2" },
    { name: "Contains aa or bb", src: "start: s\nfinal: f\ns,a = s,x\ns,b = s,y\nx,a = f\ny,b = f\nf,a = f\nf,b = f" },
    { name: "Third symbol from the end is a", src: "# Exponential blow-up: the DFA needs 2^3 = 8 states\nstart: q0\nfinal: q3\nq0,a = q0,q1\nq0,b = q0\nq1,a = q2\nq1,b = q2\nq2,a = q3\nq2,b = q3" },
    { name: "Binary: ends in 01 or 10", src: "alphabet: 0,1\nstart: p\nfinal: r,u\np,0 = p,q\np,1 = p,t\nq,1 = r\nt,0 = u" },
    { name: "Dragon book (a|b)*abb ε-NFA", src: "# Thompson-style ε-NFA (Aho, Lam, Sethi, Ullman Fig. 3.34)\nstart: 0\nfinal: 10\n0,ε = 1,7\n1,ε = 2,4\n2,a = 3\n4,b = 5\n3,ε = 6\n5,ε = 6\n6,ε = 1,7\n7,a = 8\n8,b = 9\n9,b = 10" },
    { name: "⚠️ Edge Case: ε-cycle (q0 ⇄ q1)", src: "# Edge Case: ε-cycle (termination guaranteed in O(|Q|))\nstart: q0\nfinal: q2\nq0,ε = q1\nq1,ε = q0\nq1,a = q2\nq2,b = q0" },
    { name: "⚠️ Edge Case: Empty Language ∅ (No Finals)", src: "# Edge Case: Empty language L(M) = ∅ (no final states)\nstart: q0\nfinal: ∅\nq0,a = q0,q1\nq0,b = q0\nq1,b = q1" },
    { name: "⚠️ Edge Case: Start State Final (Accepts ε)", src: "# Edge Case: Start state is accepting (ε ∈ L)\nstart: q0\nfinal: q0,q2\nq0,a = q1\nq1,b = q2" },
    { name: "⚠️ Edge Case: Unreachable States", src: "# Edge Case: State q3 is disconnected and pruned during subset construction\nstates: q0, q1, q2, q3\nstart: q0\nfinal: q2\nq0,a = q1\nq1,b = q2\nq3,a = q3\nq3,b = q2" },
    { name: "⚠️ Edge Case: Missing Transitions (Dead State ∅)", src: "# Edge Case: Non-total transitions generate explicit sink state ∅\nstart: q0\nfinal: q1\nq0,a = q1" },
    { name: "⚠️ Edge Case: Unused Alphabet Symbol (c ∉ δ)", src: "# Edge Case: Symbol 'c' declared in alphabet but unused in transitions\nalphabet: a, b, c\nstart: q0\nfinal: q1\nq0,a = q0,q1\nq1,b = q1" },
    { name: "⚠️ Edge Case: Single-State Automaton", src: "# Edge Case: Boundary 1-state machine (|Q| = 1)\nstart: q0\nfinal: q0\nq0,a = q0" },
    { name: "⚠️ Edge Case: All States Accepting (F = Q)", src: "# Edge Case: Every state is final\nstart: q0\nfinal: q0, q1\nq0,a = q1\nq1,b = q0" }
  ];
  const DFA_EXAMPLES = [
    { name: "Textbook: 6 states → 3", src: "# Minimises to {A,B} {C,D,E} {F}\nstates: A,B,C,D,E,F\nalphabet: 0,1\nstart: A\nfinal: C,D,E\nA,0 = B\nA,1 = C\nB,0 = A\nB,1 = D\nC,0 = E\nC,1 = F\nD,0 = E\nD,1 = F\nE,0 = E\nE,1 = F\nF,0 = F\nF,1 = F" },
    { name: "Dragon book (a|b)*abb: 5 → 4", src: "start: A\nfinal: E\nA,a = B\nA,b = C\nB,a = B\nB,b = D\nC,a = B\nC,b = C\nD,a = B\nD,b = E\nE,a = B\nE,b = C" },
    { name: "Even a's with duplicates", src: "start: p\nfinal: p,r\np,a = q\np,b = r\nq,a = r\nq,b = s\nr,a = s\nr,b = p\ns,a = p\ns,b = q" },
    { name: "Incomplete DFA (needs a trap)", src: "# Missing transitions go to an added trap state\nstart: s0\nfinal: s2\ns0,a = s1\ns1,b = s2\ns2,a = s1" },
    { name: "Unreachable state x", src: "states: A,B,x\nstart: A\nfinal: B\nA,0 = B\nA,1 = A\nB,0 = B\nB,1 = A\nx,0 = x\nx,1 = B" },
    { name: "Already minimal", src: "start: E\nfinal: E\nE,a = O\nE,b = E\nO,a = E\nO,b = O" }
  ];

  class AutomatonInput {
    constructor(host, opts) {
      this.host = host;
      this.opts = Object.assign({ kind: "nfa", examples: null, storageKey: null, regex: true, random: true, runLabel: "Run", onRun: () => {}, onChange: null, compact: false, rows: 11 }, opts || {});
      this.examples = this.opts.examples || (this.opts.kind === "dfa" ? DFA_EXAMPLES : NFA_EXAMPLES);
      this.mode = "text";
      host.classList.add("editor");
      host.innerHTML = `
        <div class="row" style="margin-bottom:10px">
          <select class="ex" aria-label="Load an example" style="flex:1;min-width:150px">
            <option value="">Load an example…</option>
            <option value="__q">✎ Describe a language in words…</option>
            ${this.examples.map((e, i) => `<option value="${i}">${esc(e.name)}</option>`).join("")}
          </select>
          ${this.opts.random ? `<button class="btn sm" data-a="random" title="Generate a random ${this.opts.kind === "dfa" ? "DFA" : "NFA"}">Random</button>` : ""}
        </div>
        <div class="seg tabs" role="tablist">
          <button type="button" role="tab" data-mode="text" aria-selected="true">Text</button>
          <button type="button" role="tab" data-mode="table" aria-selected="false">Table</button>
          <button type="button" role="tab" data-mode="question" aria-selected="false">From a question</button>
          <button type="button" role="tab" data-mode="draw" aria-selected="false">Draw</button>
        </div>
        <div data-pane="text">
          <textarea class="code" spellcheck="false" autocapitalize="off" autocomplete="off" rows="${this.opts.rows}" aria-label="Automaton definition"></textarea>
          <details class="tiny muted" style="margin-top:6px"><summary>Format</summary>
            <div style="margin-top:6px;line-height:1.7"><code>start: q0</code> exactly one start state<br><code>final: q2, q3</code> any number (or ∅)<br><code>q0,a = q0,q1</code> transition to a set; also <code>δ(q0,a) = {q1}</code> or <code>q0 -a-&gt; q1</code><br><code>q0,ε = q1</code> ε-move (write <code>ε</code>, <code>e</code> or <code>eps</code>)<br><code>states:</code> / <code>alphabet:</code> optional; when given, everything must be declared<br><code>#</code> or <code>//</code> start a comment · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs</div>
          </details>
        </div>
        <div data-pane="table" hidden><div class="grid-editor"></div></div>
        <div data-pane="question" hidden>
          <label class="field">Describe the language in words or enter a regular expression
            <textarea class="qtext" rows="4" spellcheck="true" placeholder="e.g. the regular expression (a|b)*abb — builds an ε-NFA and simulates in real time!"></textarea>
          </label>
          <div class="q-live small" style="margin-top:6px;min-height:24px"></div>
          <div class="row" style="margin-top:8px">
            <button class="btn primary" data-a="fromq-sim" title="Build automaton and run simulation immediately in real time">⚡ Simulate in Real-Time</button>
            <button class="btn" data-a="fromq" title="Build NFA definition">Build the NFA</button>
            <button class="btn sm quiet" data-a="qexample">Try random example</button>
          </div>
          <div class="q-chips" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">
            <span class="tiny muted" style="width:100%;font-weight:600">Quick examples (click to simulate):</span>
            <button type="button" class="btn sm quiet chip" data-q="the regular expression (a|b)*abb">Regex (a|b)*abb (ε-NFA)</button>
            <button type="button" class="btn sm quiet chip" data-q="the regular expression a*b*c*">Regex a*b*c* (ε-NFA)</button>
            <button type="button" class="btn sm quiet chip" data-q="strings over {a,b} ending with abb">Ends with abb</button>
            <button type="button" class="btn sm quiet chip" data-q="strings over {a,b} with an even number of a">Even a's</button>
            <button type="button" class="btn sm quiet chip" data-q="strings over {0,1} containing the substring 101">Contains 101</button>
            <button type="button" class="btn sm quiet chip" data-q="strings over {a,b} of length divisible by 3">Length div by 3</button>
          </div>
          <details class="hint" style="margin:10px 0 0"><summary>What can I type?</summary>A regular language in words — <em>ending with</em> / <em>starting with</em> / <em>containing</em> a pattern, <em>even/odd number of</em> a symbol, <em>length divisible by k</em>, <em>at least / at most / exactly n</em>, <em>not containing</em>…, <em>binary divisible by k</em> — or a regular expression such as <code>(a|b)*abb</code> or <code>a*b*c*</code>. It builds an automaton and immediately simulates ε-elimination and subset construction in real time.</details>
          <div class="q-out small" style="margin-top:8px"></div>
        </div>
        <div data-pane="draw" hidden><div class="canvas-editor"></div></div>
        <div class="status-line" aria-live="polite"></div>
        <div class="row" style="margin-top:10px">
          <button class="btn primary" data-a="run">${esc(this.opts.runLabel)}</button>
          <button class="btn quiet sm" data-a="copy">Copy text</button>
          <button class="btn quiet sm" data-a="clear">Clear</button>
        </div>`;
      this.ta = host.querySelector("textarea");
      this.status = host.querySelector(".status-line");
      host.querySelector(".ex").addEventListener("change", e => {
        if (e.target.value === "__q") { this.setMode("question"); const q = host.querySelector(".qtext"); if (q) q.focus(); }
        else { const ex = this.examples[+e.target.value]; if (ex) this.setText(ex.src, true); }
        e.target.value = "";
      });
      this.qIndex = 0;
      this.qText = host.querySelector(".qtext");
      this.qLive = host.querySelector(".q-live");
      const checkQLive = Studio.debounce(() => {
        const txt = (this.qText.value || "").trim();
        if (txt.length < 2) {
          if (this.qLive) this.qLive.innerHTML = '<span class="muted tiny">Type a language description or regex above...</span>';
          return;
        }
        try {
          const res = window.Extract ? Extract.automatonFromQuestion(txt) : null;
          if (res && res.src) {
            const tempN = Automata.parse(res.src);
            const epsBadge = tempN.hasEps ? '<span class="chip" style="background:var(--eps-soft);border-color:var(--eps);color:var(--eps);font-size:11px">ε-NFA</span>' : '<span class="chip" style="font-size:11px">NFA</span>';
            this.qLive.innerHTML = `<span style="color:var(--go);font-weight:600">✓ Detected:</span> ${esc(res.how)} ${epsBadge} <span class="muted tiny">(${tempN.states.length} states) — ready!</span>`;
          } else if (res && res.error) {
            this.qLive.innerHTML = `<span style="color:var(--stop);font-weight:600">Notice:</span> ${esc(res.error)}`;
          } else {
            this.qLive.innerHTML = '<span class="muted tiny">Parsing wording... (try "ends with abb", "even number of a", or regex "(a|b)*abb")</span>';
          }
        } catch (e) {
          this.qLive.innerHTML = '<span class="muted tiny">Keep typing...</span>';
        }
      }, 200);

      this.qText.addEventListener("input", checkQLive);
      this.qText.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          this.fromQuestion(true);
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this.fromQuestion(true);
        }
      });
      host.addEventListener("click", e => this.onClick(e));
      this.ta.addEventListener("input", Studio.debounce(() => this.validate(), 250));
      this.ta.addEventListener("keydown", e => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); this.run(); }
      });
      const saved = this.opts.storageKey ? Studio.store.get(this.opts.storageKey, null) : null;
      this.ta.value = saved || this.examples[0].src;
      this.validate();
      if (this.qText && !this.qText.value) this.qText.value = "(a|b)*abb";
      checkQLive();
    }

    onClick(e) {
      const chip = e.target.closest(".chip");
      if (chip && chip.dataset.q) {
        if (this.qText) this.qText.value = chip.dataset.q;
        this.fromQuestion(true);
        return;
      }
      const b = e.target.closest("button"); if (!b || !this.host.contains(b)) return;
      if (b.dataset.mode) return this.setMode(b.dataset.mode);
      const a = b.dataset.a;
      if (a === "run") this.run();
      else if (a === "clear") { this.ta.value = ""; this.validate(); this.setMode("text"); this.ta.focus(); }
      else if (a === "copy") { navigator.clipboard && navigator.clipboard.writeText(this.ta.value).then(() => Studio.toast("Automaton text copied."), () => Studio.toast("Copy failed — select the text and copy it manually.", "err")); }
      else if (a === "random") this.random();
      else if (a === "fromq") this.fromQuestion(false);
      else if (a === "fromq-sim") this.fromQuestion(true);
      else if (a === "qexample") {
        const ex = AutomatonInput.QUESTION_EXAMPLES[this.qIndex++ % AutomatonInput.QUESTION_EXAMPLES.length];
        this.host.querySelector(".qtext").value = ex;
        this.fromQuestion(true);
      }
    }

    fromQuestion(autoSimulate) {
      const ta = this.host.querySelector(".qtext"), out = this.host.querySelector(".q-out");
      let text = (ta.value || "").trim();
      if (text.length < 2) {
        text = "(a|b)*abb";
        ta.value = text;
      }
      let r = null;
      try { r = window.Extract ? Extract.automatonFromQuestion(text) : null; } catch (e) { r = { error: e.message }; }
      if (r && r.error) { out.innerHTML = `<div class="msg warn">${esc(r.error)}</div>`; return; }
      if (!r || !r.src) {
        out.innerHTML = '<div class="msg err">That wording was not recognised. Try phrasings like “strings over {a,b} ending with abb”, “even number of a”, “length divisible by 3”, “not containing bb”, “binary divisible by 4”, or a regular expression like (a|b)*abb.</div>';
        return;
      }
      this.setText(r.src, true);
      out.innerHTML = `<div class="msg ok">${esc(r.how || "Built automaton from question.")} ${autoSimulate ? "<b>Simulating in real time...</b>" : ""}</div>`;
      if (autoSimulate && typeof window !== "undefined" && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent("automata:simulate", { detail: { src: r.src, how: r.how } }));
      }
    }

    setMode(m) {
      if (m === "table") {
        const N = this.parse();
        if (!N) { Studio.toast("Fix the text first — the table needs a readable automaton.", "err"); return; }
        this.renderTable(N);
      }
      if (m === "draw") {
        if (typeof CanvasEditor === "undefined") { Studio.toast("Drawing tool is still loading — try again.", "err"); return; }
        const host = this.host.querySelector(".canvas-editor");
        if (!this.canvas) this.canvas = new CanvasEditor(host, { onChange: text => { this.ta.value = text; this.validate(); } });
        this.canvas.load(this.ta.value);
      }
      this.mode = m;
      this.host.querySelectorAll("[role=tab]").forEach(t => t.setAttribute("aria-selected", String(t.dataset.mode === m)));
      this.host.querySelectorAll("[data-pane]").forEach(p => (p.hidden = p.dataset.pane !== m));
    }

    getText() { return this.ta.value; }
    setText(src, run) {
      this.ta.value = src;
      this.validate();
      if (this.mode === "table") { const N = this.parse(); if (N) this.renderTable(N); }
      if (run) this.run();
    }

    parse() { try { return Automata.parse(this.ta.value); } catch (e) { return null; } }

    validate() {
      let N = null, msg = "";
      try {
        N = Automata.parse(this.ta.value);
        const kind = this.opts.kind;
        const facts = `${N.states.length} state${N.states.length === 1 ? "" : "s"}, alphabet {${N.alpha.join(",")}}${N.hasEps ? ", with ε-moves" : ""}`;
        let note = "";
        if (kind === "dfa" && !Automata.isDeterministic(N)) note = `<div class="msg warn" style="margin-top:6px">This is not deterministic. ${esc(Automata.dfaProblems(N).filter(p => !/no target/.test(p))[0] || "")} Use “Convert to DFA first” below the input.</div>`;
        msg = `<div class="msg ok">Ready: ${esc(facts)}.</div>` + note + (N.warn.length ? `<div class="msg warn" style="margin-top:6px"><ul>${N.warn.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>` : "");
      } catch (e) {
        msg = `<div class="msg err">${esc(e.message)}</div>`;
      }
      this.status.innerHTML = msg;
      this.lastValid = N;
      if (this.opts.onChange) this.opts.onChange(N);
      return N;
    }

    run() {
      const N = this.validate();
      if (!N) { this.ta.focus(); Studio.toast("The automaton has an error — see the message under the editor.", "err"); return; }
      if (this.opts.storageKey) Studio.store.set(this.opts.storageKey, this.ta.value);
      Studio.lastAutomaton.set(this.ta.value, location.pathname);
      this.opts.onRun(this.ta.value, N);
    }

    random() {
      const eps = Math.random() < 0.5;
      let src = Automata.generate({ n: 3 + Math.floor(Math.random() * 3), k: 2, eps: this.opts.kind === "dfa" ? false : eps, minDfa: 3, maxDfa: 8 });
      if (this.opts.kind === "dfa") { const N = Automata.parse(src), M = Automata.build(N); src = Automata.dfaToText(N, M, "letters"); }
      this.setText("# Random " + (this.opts.kind === "dfa" ? "DFA" : "NFA") + "\n" + src, true);
    }

    renderTable(N) {
      const pane = this.host.querySelector(".grid-editor");
      const isDfa = this.opts.kind === "dfa";
      const cols = isDfa ? N.alpha : [...N.alpha, "ε"];
      pane.innerHTML = `
        <label class="field">States<input class="t-states code" value="${esc(N.states.join(", "))}"></label>
        <label class="field">Alphabet<input class="t-alpha code" value="${esc(N.alpha.join(", "))}"></label>
        <label class="field">Start state<select class="t-start">${N.states.map(s => `<option${s === N.start ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
        <div class="field"><span style="font-size:13px;font-weight:600">Final states</span><div class="finals">${N.states.map(s => `<label class="check"><input type="checkbox" value="${esc(s)}"${N.finals.includes(s) ? " checked" : ""}>${esc(s)}</label>`).join("")}</div></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>δ</th>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
          ${N.states.map(s => `<tr><th>${s === N.start ? "→" : ""}${N.finals.includes(s) ? "*" : ""}${esc(s)}</th>${cols.map(c => `<td><input data-k="${esc(s)}|${esc(c)}" value="${esc([...(N.d[s + "|" + c] || [])].join(","))}" placeholder="∅" aria-label="δ(${esc(s)}, ${esc(c)})"></td>`).join("")}</tr>`).join("")}
        </tbody></table></div>
        <p class="hint" style="margin:0">Targets separated by commas; leave empty for ∅. Change the state or alphabet lists to add rows or columns.</p>`;
      const sync = () => this.fromTable();
      pane.querySelectorAll(".t-start, .finals input, td input").forEach(i => i.addEventListener("input", sync));
      pane.querySelectorAll(".t-states, .t-alpha").forEach(i => i.addEventListener("change", () => { sync(); const M = this.parse(); if (M) this.renderTable(M); else this.renderTableDraft(); }));
    }
    renderTableDraft() { /* the text keeps the error; the status line explains it */ }

    fromTable() {
      const pane = this.host.querySelector(".grid-editor");
      const states = split(pane.querySelector(".t-states").value), alpha = split(pane.querySelector(".t-alpha").value);
      const start = pane.querySelector(".t-start").value || states[0] || "";
      const finals = [...pane.querySelectorAll(".finals input:checked")].map(i => i.value).filter(s => states.includes(s));
      const lines = ["states: " + states.join(", ")];
      if (alpha.length) lines.push("alphabet: " + alpha.join(", "));
      lines.push("start: " + (states.includes(start) ? start : states[0] || ""), "final: " + (finals.length ? finals.join(", ") : "∅"));
      pane.querySelectorAll("td input").forEach(inp => {
        const [s, c] = inp.dataset.k.split("|"), v = split(inp.value);
        if (v.length && states.includes(s) && (c === "ε" || alpha.includes(c))) lines.push(`${s},${c} = ${v.join(",")}`);
      });
      this.ta.value = lines.join("\n");
      this.validate();
    }
  }


  AutomatonInput.NFA_EXAMPLES = NFA_EXAMPLES;
  AutomatonInput.DFA_EXAMPLES = DFA_EXAMPLES;
  AutomatonInput.QUESTION_EXAMPLES = [
    "the regular expression (a|b)*abb",
    "strings over {a,b} ending with abb",
    "strings over {0,1} containing the substring 101",
    "strings over {a,b} with an even number of a",
    "strings over {a,b} of length divisible by 3",
    "strings over {a,b} not containing bb"
  ];
  window.AutomatonInput = AutomatonInput;
})();
