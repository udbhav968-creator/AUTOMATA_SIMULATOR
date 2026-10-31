/*
 * QView — draws one question of any type and collects the student's answer in the shape QGen.grade() expects.
 *   const ctl = QView.render(question, host, { mode: "practice" | "exam" | "review", response, onChange });
 *   ctl.collect()            → response object
 *   ctl.feedback(result)     → shows the grade
 */
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const A = window.Automata, Q = window.QGen;

  function metaRow(q) {
    const t = Q.TYPES[q.type] || {};
    return `<div class="qmeta">
      <span class="tag" data-bloom="${esc(q.bloom)}">${esc(q.bloom)}</span>
      <span class="tag" title="${esc(Q.OUTCOMES[q.lo] || "")}">${esc(q.lo)}</span>
      <span class="tag">${esc(t.label || q.type)}</span>
      <span class="tag">${esc(q.difficulty)}</span>
      <span class="tag">${esc(q.marks)} mark${q.marks == 1 ? "" : "s"}</span>
      ${q.source === "bank" ? '<span class="tag">From the question bank</span>' : q.source === "ai" ? '<span class="tag">Written by Gemini</span>' : ""}
    </div>`;
  }

  function graphBox(src, title, height) {
    const id = "g" + Math.random().toString(36).slice(2, 9);
    return { html: `<div><div id="${id}" style="height:${height || 280}px"></div><details style="margin-top:6px"><summary class="tiny muted">Show as text</summary><pre class="mono tiny" style="margin:6px 0 0;padding:8px;background:var(--sheet-2);border-radius:8px;overflow:auto">${esc(src)}</pre></details></div>`, mount: () => { try { new GraphView(document.getElementById(id), { title, interactive: true }).setGraph(GraphView.fromNFA(A.parse(src))); } catch (e) { document.getElementById(id).innerHTML = `<div class="msg err">${esc(e.message)}</div>`; } } };
  }

  function render(q, host, opts) {
    opts = Object.assign({ mode: "practice", response: null, onChange: null }, opts || {});
    const r = opts.response || {};
    const locked = opts.mode === "review";
    const mounts = [];
    let N = null; try { if (q.src) N = A.parse(q.src); } catch (e) { /* shown by the graph box */ }
    let body = "";

    if (q.type === "evaluate") {
      const g1 = graphBox(q.src, "NFA"), g2 = graphBox(q.data.candidate, "Student's DFA");
      mounts.push(g1.mount, g2.mount);
      body += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px">${g1.html}${g2.html}</div>`;
    } else if (q.src) {
      const g = graphBox(q.src, q.type === "classes" ? "DFA" : "Automaton");
      mounts.push(g.mount);
      body += g.html;
    }

    let ans = "";
    switch (q.type) {
      case "mcq": case "tf": {
        const opts2 = q.type === "mcq" ? q.data.options : ["True", "False"];
        const chosen = q.type === "mcq" ? r.index : r.value === true ? 0 : r.value === false ? 1 : null;
        ans = `<div class="options" role="radiogroup">${opts2.map((o, i) => `<label class="option${chosen === i ? " chosen" : ""}"><input type="radio" name="opt-${esc(q.id)}" value="${i}"${chosen === i ? " checked" : ""}${locked ? " disabled" : ""}><span>${esc(o)}</span></label>`).join("")}</div>`;
        break;
      }
      case "closure": case "move": {
        ans = `<label class="field">Your set<input class="code" data-r="text" value="${esc(r.text || "")}" placeholder="{q0, q1}  or  ∅" autocomplete="off" spellcheck="false"${locked ? " disabled" : ""}></label>
          ${N && !locked ? `<div class="row" style="margin-top:6px"><span class="tiny muted">Tap states to add or remove:</span>${N.states.map(s => `<button type="button" class="btn sm" data-toggle="${esc(s)}">${esc(s)}</button>`).join("")}<button type="button" class="btn sm quiet" data-empty>∅</button></div>` : ""}`;
        break;
      }
      case "accept": {
        const v = r.values || [];
        ans = `<div class="table-wrap"><table class="data"><thead><tr><th>String</th><th>Your decision</th></tr></thead><tbody>${q.data.strings.map((w, i) => `<tr><td class="mono">${esc(w || "ε")}</td><td><div class="seg" data-acc="${i}">${["Accept", "Reject"].map((t, k) => `<button type="button" data-v="${k === 0}" aria-pressed="${v[i] === (k === 0)}"${locked ? " disabled" : ""}>${t}</button>`).join("")}</div></td></tr>`).join("")}</tbody></table></div>`;
        break;
      }
      case "table": {
        const sol = Q.solve(q), cells = r.cells || [];
        ans = `<div class="table-wrap"><table class="data"><thead><tr><th>DFA state (subset)</th>${sol.alpha.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${sol.rows.map((row, i) => `<tr><td class="set">${i === 0 ? "→ " : ""}${esc(A.fmtSet(row))}</td>${sol.alpha.map((c, j) => `<td><input class="code" data-cell="${i},${j}" value="${esc((cells[i] || [])[j] || "")}" placeholder="{…} or ∅" style="min-width:110px" autocomplete="off"${locked ? " disabled" : ""}></td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="hint" style="margin:6px 0 0">Rows list every reachable subset in the order subset construction finds them.</p>`;
        break;
      }
      case "count":
        ans = `<label class="field" style="max-width:220px">Number of states<input type="number" min="0" max="999" data-r="value" value="${esc(r.value || "")}"${locked ? " disabled" : ""}></label>`;
        break;
      case "classes":
        ans = `<label class="field">Equivalence classes<input class="code" data-r="text" value="${esc(r.text || "")}" placeholder="{A,B} {C} {D,E}" autocomplete="off" spellcheck="false"${locked ? " disabled" : ""}></label><p class="hint" style="margin:6px 0 0">List every state exactly once. A state that merges with nothing is its own class.</p>`;
        break;
      case "evaluate":
        ans = `<div class="stack"><div class="seg" data-verdict>${["The DFA is correct", "The DFA is wrong"].map((t, k) => `<button type="button" data-v="${k === 0}" aria-pressed="${r.verdict === (k === 0)}"${locked ? " disabled" : ""}>${t}</button>`).join("")}</div>
          <label class="field">If it is wrong: a string on which the two machines disagree<input class="code" data-r="counter" value="${esc(r.counter || "")}" placeholder="e.g. abb   (write ε for the empty string)" autocomplete="off"${locked ? " disabled" : ""}></label></div>`;
        break;
      case "construct": case "design": {
        const tmpl = q.type === "construct" ? "start: \nfinal: \n" : "start: \nfinal: \n";
        ans = `<label class="field">Your ${q.data && q.data.requireDFA ? "DFA" : "automaton"}<textarea class="code" rows="9" data-r="text" spellcheck="false" placeholder="${esc(tmpl)}A,a = B"${locked ? " disabled" : ""}>${esc(r.text || "")}</textarea></label><div class="tiny" data-live style="margin-top:6px"></div>`;
        break;
      }
      case "short":
        ans = `<label class="field">Your answer<textarea rows="5" data-r="answer"${locked ? " disabled" : ""}>${esc(r.answer || "")}</textarea></label>
          <div data-model hidden class="msg info" style="margin-top:8px"><b>Model answer.</b> ${esc(q.data.model)}<div class="row" style="margin-top:8px"><span class="small">Mark yourself:</span>${[["0", "Missed it"], ["0.5", "Partly"], ["1", "Fully"]].map(([v, t]) => `<button type="button" class="btn sm" data-self="${v}" aria-pressed="${String(r.self) === v}">${t}</button>`).join("")}</div></div>
          ${opts.mode === "exam" ? '<p class="hint">Written answers are self-marked after the exam.</p>' : ""}`;
        break;
    }

    host.innerHTML = `<div class="qcard">${metaRow(q)}<div class="qprompt">${esc(q.prompt)}</div>${body}<div data-answer>${ans}</div><div data-fb></div></div>`;
    mounts.forEach(m => m());
    const state = { self: r.self };

    const changed = () => { if (opts.onChange) opts.onChange(collect()); };
    host.querySelectorAll("input[type=radio]").forEach(i => i.addEventListener("change", () => { host.querySelectorAll(".option").forEach(o => o.classList.toggle("chosen", o.querySelector("input").checked)); changed(); }));
    host.querySelectorAll("[data-r], [data-cell]").forEach(i => i.addEventListener("input", changed));
    host.querySelectorAll("[data-acc] button, [data-verdict] button").forEach(b => b.addEventListener("click", () => { b.parentElement.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); changed(); }));
    host.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", () => {
      const inp = host.querySelector("[data-r=text]"), cur = Q.parseSet(N, inp.value);
      let set = cur.set ? cur.set.slice() : [];
      set = set.includes(b.dataset.toggle) ? set.filter(x => x !== b.dataset.toggle) : [...set, b.dataset.toggle].sort((a, c) => N.ord[a] - N.ord[c]);
      inp.value = set.length ? "{" + set.join(",") + "}" : "∅";
      changed();
    }));
    const empty = host.querySelector("[data-empty]");
    if (empty) empty.addEventListener("click", () => { host.querySelector("[data-r=text]").value = "∅"; changed(); });
    host.querySelectorAll("[data-self]").forEach(b => b.addEventListener("click", () => { state.self = +b.dataset.self; host.querySelectorAll("[data-self]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); changed(); }));
    const live = host.querySelector("[data-live]");
    if (live) {
      const ta = host.querySelector("[data-r=text]");
      const check = () => {
        if (!ta.value.trim()) { live.innerHTML = '<span class="muted">Use the same text format as the simulators. Include a dead state if your DFA needs one.</span>'; return; }
        try { const S = A.parse(ta.value), p = A.dfaProblems(S); live.innerHTML = p.length && q.data.requireDFA ? `<span class="muted">Readable (${S.states.length} states). Not a complete DFA yet: ${esc(p[0])}</span>` : `<span class="ok">Readable: ${S.states.length} states.</span>`; }
        catch (e) { live.innerHTML = `<span class="bad">${esc(e.message)}</span>`; }
      };
      ta.addEventListener("input", Studio.debounce(check, 300)); check();
    }

    function collect() {
      const v = sel => host.querySelector(sel);
      switch (q.type) {
        case "mcq": { const c = host.querySelector("input[type=radio]:checked"); return { index: c ? +c.value : null }; }
        case "tf": { const c = host.querySelector("input[type=radio]:checked"); return { value: c ? c.value === "0" : null }; }
        case "closure": case "move": case "classes": return { text: v("[data-r=text]").value };
        case "accept": return { values: q.data.strings.map((_, i) => { const p = host.querySelector(`[data-acc="${i}"] [aria-pressed=true]`); return p ? p.dataset.v === "true" : null; }) };
        case "table": { const cells = []; host.querySelectorAll("[data-cell]").forEach(i => { const [a, b] = i.dataset.cell.split(",").map(Number); (cells[a] = cells[a] || [])[b] = i.value; }); return { cells }; }
        case "count": return { value: v("[data-r=value]").value };
        case "evaluate": { const p = host.querySelector("[data-verdict] [aria-pressed=true]"); return { verdict: p ? p.dataset.v === "true" : null, counter: v("[data-r=counter]").value }; }
        case "construct": case "design": return { text: v("[data-r=text]").value };
        case "short": return { answer: v("[data-r=answer]").value, self: state.self };
      }
      return {};
    }

    function feedback(res, opts2) {
      const box = host.querySelector("[data-fb]");
      if (q.type === "short" && res.manual && state.self == null) {
        host.querySelector("[data-model]").hidden = false;
        box.innerHTML = '<div class="feedback part"><b>Compare with the model answer, then mark yourself.</b></div>';
        return;
      }
      if (q.type === "short") host.querySelector("[data-model]").hidden = false;
      const cls = res.score >= 0.999 ? "good" : res.score > 0 ? "part" : "bad";
      const head = res.score >= 0.999 ? "Correct" : res.score > 0 ? `Partly right (${Math.round(res.score * 100)}%)` : "Not yet";
      let sol = "";
      if (opts2 && opts2.solution) { const e = Q.explain(q); if (e) sol = `<div style="margin-top:8px"><b style="display:inline">Solution:</b> <span class="mono" style="white-space:pre-wrap">${esc(e)}</span></div>`; }
      if (q.type === "mcq" || q.type === "tf") host.querySelectorAll(".option").forEach((o, i) => { const right = Q.solve(q); const ok = q.type === "mcq" ? i === right.index : (i === 0) === right.value; o.classList.toggle("right", ok); o.classList.toggle("wrong", !ok && o.querySelector("input").checked); });
      box.innerHTML = `<div class="feedback ${cls}"><b>${head}</b>${esc(res.feedback)}${sol}</div>`;
    }
    function showModel() { const m = host.querySelector("[data-model]"); if (m) m.hidden = false; }

    return { collect, feedback, showModel };
  }

  /** Short text of a response, for result reviews. */
  function summary(q, r) {
    r = r || {};
    switch (q.type) {
      case "mcq": return r.index == null ? "—" : q.data.options[r.index];
      case "tf": return r.value == null ? "—" : r.value ? "True" : "False";
      case "accept": return (r.values || []).map((v, i) => `${q.data.strings[i] || "ε"}: ${v == null ? "—" : v ? "accept" : "reject"}`).join(", ");
      case "table": return (r.cells || []).flat().filter(Boolean).length + " cells filled";
      case "evaluate": return r.verdict == null ? "—" : (r.verdict ? "correct" : "wrong") + (r.counter ? `, “${r.counter}”` : "");
      case "count": return r.value || "—";
      case "short": return (r.answer || "—").slice(0, 120);
      default: return (r.text || "—").slice(0, 160);
    }
  }

  window.QView = { render, summary };
})();
