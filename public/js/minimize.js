/* DFA minimisation page. */
(function () {
  "use strict";
  const { $, esc } = Studio, A = Automata;
  const PALETTE = ["#9db7f5", "#8fd3b6", "#f5c97a", "#e8a3c4", "#b6a4ef", "#9fd7e6", "#f2a98f", "#c9d77f", "#d0b38a", "#a3b0c4"];
  let N = null, R = null, steps = [], cur = 0, src = "";

  const origView = new GraphView($("#origCanvas"), { title: "Your DFA", emptyText: "Your DFA appears here." });
  const minView = new GraphView($("#minCanvas"), { title: "Minimal DFA", emptyText: "The minimal DFA appears at the last step." });
  const player = new StepPlayer($("#transport"), { onStep: show, storageKey: "speed.min", label: i => (steps[i] ? steps[i].label : "") });
  const input = new AutomatonInput($("#input"), { kind: "dfa", storageKey: "min.src", runLabel: "Minimise", onRun: build, regex: false });

  const colour = k => `color-mix(in srgb, ${PALETTE[k % PALETTE.length]} 55%, var(--sheet))`;

  function build(text, parsed) {
    $("#notDfa").hidden = true;
    try { R = A.minimizeSteps(parsed); }
    catch (e) {
      R = null;
      if (e.code === "NOT_DFA") {
        $("#notDfa").hidden = false;
        $("#notDfa").innerHTML = `<div class="msg warn">${esc(e.message)}</div><button class="btn" id="convert" style="margin-top:8px">Convert to a DFA first</button>`;
        $("#convert").onclick = () => { const M = A.build(parsed); input.setText(A.dfaToText(parsed, M, "letters"), true); Studio.toast(`Converted with subset construction: ${M.D.length} DFA states.`); };
      } else Studio.toast(e.message, "err");
      origView.setGraph(GraphView.fromNFA(parsed)); minView.clear();
      return;
    }
    N = parsed; src = text;
    // the original diagram includes the trap and its added edges from the start, so nothing moves later
    const g = GraphView.fromNFA(N);
    if (R.trap) {
      g.nodes.push({ id: R.trap, label: R.trap, dead: true, title: "added trap state" });
      R.addedTrans.forEach(([s, c, t]) => g.edges.push({ from: s, to: t, sym: c }));
      N.alpha.forEach(c => g.edges.push({ from: R.trap, to: R.trap, sym: c }));
    }
    origView.setGraph(g);
    minView.setGraph({ nodes: R.minimal.states.map(m => ({ id: m.id, label: m.id, sub: "{" + m.members.join(",") + "}", final: m.final, start: m.start, dead: m.trap, title: `${m.id} = {${m.members.join(",")}}` })), edges: R.minimal.states.flatMap((m, k) => N.alpha.map(c => ({ from: m.id, to: "M" + R.minimal.tm[k + "|" + c], sym: c }))) });
    // step list
    steps = [{ type: "input", label: "your DFA" }];
    steps.push({ type: "reach", label: R.removed.length ? "remove unreachable" : "all reachable" });
    steps.push({ type: "complete", label: R.trap ? "add trap state" : "already complete" });
    const base = R.steps.find(s => s.type === "base");
    steps.push({ type: "base", label: "round 0: final vs non-final", marks: base.marks });
    R.steps.filter(s => s.type === "round").forEach(r => r.marks.forEach((m, k) => steps.push({ type: "mark", round: r.round, mark: m, first: k === 0, label: `round ${r.round}: mark (${m.pair.join(",")})` })));
    steps.push({ type: "merge", label: "merge equivalent states" });
    steps.push({ type: "done", label: "minimal DFA" });
    // index of the step at which each pair gets marked
    R.markedAt = {};
    steps.forEach((s, i) => {
      if (s.type === "base") s.marks.forEach(m => (R.markedAt[R.pairKey(m.pair[0], m.pair[1])] = i));
      if (s.type === "mark") R.markedAt[R.pairKey(s.mark.pair[0], s.mark.pair[1])] = i;
    });
    partitions();
    results();
    player.load(steps.length, steps.map((s, i) => (s.type === "mark" && s.first ? i : s.type === "merge" ? i : -1)).filter(i => i > 0), 0);
  }

  function show(i) {
    if (!R) return;
    cur = i;
    const s = steps[i];
    const vis = new Set(N.states.concat(i >= 2 && R.trap ? [R.trap] : []));
    const visE = new Set();
    for (const k in N.d) { const [f, c] = k.split("|"); N.d[k].forEach(t => visE.add(`${f}|${t}|${c}`)); }
    if (i >= 2 && R.trap) { R.addedTrans.forEach(([a, c, t]) => visE.add(`${a}|${t}|${c}`)); N.alpha.forEach(c => visE.add(`${R.trap}|${R.trap}|${c}`)); }
    const classes = {}, colors = {}, hot = new Set();
    if (i >= 1) R.removed.forEach(r => (classes[r] = "removed"));
    if (s.type === "complete" && R.trap) { classes[R.trap] = "fresh"; R.addedTrans.forEach(([a, c, t]) => hot.add(`${a}|${t}|${c}`)); }
    if (s.type === "base") R.finals.forEach(f => (classes[f] = "in-s"));
    if (s.type === "mark") {
      const [a, b] = s.mark.pair, [x, y] = s.mark.succ;
      classes[a] = "moved"; classes[b] = "moved"; classes[x] = (classes[x] ? classes[x] + " " : "") + "closure"; classes[y] = (classes[y] ? classes[y] + " " : "") + "closure";
      hot.add(`${a}|${x}|${s.mark.sym}`); hot.add(`${b}|${y}|${s.mark.sym}`);
    }
    if (s.type === "merge" || s.type === "done") R.classes.forEach((c, k) => c.forEach(q => (colors[q] = colour(k))));
    origView.setView({ visibleNodes: vis, visibleEdges: visE, classes, colors, hotEdges: hot, pulse: s.type === "complete" && R.trap ? R.trap : null });
    const minColors = {};
    R.minimal.states.forEach(m => (minColors[m.id] = colour(R.classes.findIndex(c => c.includes(m.members[0])))));
    minView.setView({ visibleNodes: s.type === "done" || s.type === "merge" ? null : new Set(), colors: minColors });
    narrate(i);
    pairTable(i);
  }

  function narrate(i) {
    const s = steps[i];
    let t = "", extra = "";
    if (s.type === "input") t = `The DFA has ${N.states.length} states over {${N.alpha.join(",")}}, starting at ${N.start} with final states ${N.finals.length ? "{" + N.finals.join(",") + "}" : "∅"}.`;
    if (s.type === "reach") t = R.removed.length ? `States ${R.removed.join(", ")} cannot be reached from ${N.start}, so no string ever visits them. They are removed (shown faded).` : `Every state can be reached from ${N.start}, so nothing is removed.`;
    if (s.type === "complete") t = R.trap ? `${R.addedTrans.length} transition${R.addedTrans.length > 1 ? "s are" : " is"} missing (${R.addedTrans.slice(0, 4).map(x => `δ(${x[0]},${x[1]})`).join(", ")}${R.addedTrans.length > 4 ? ", …" : ""}). They now go to a new non-final trap state “${R.trap}”, which loops to itself on every symbol. Table filling needs a complete DFA.` : "Every state has a transition on every symbol, so no trap state is needed.";
    if (s.type === "base") t = `Round 0: the empty string separates a final state from a non-final one, so every such pair is marked. ${s.marks.length} pair${s.marks.length === 1 ? " is" : "s are"} marked. Final states are outlined in blue.`;
    if (s.type === "mark") {
      const m = s.mark;
      t = `Round ${m.round}: (${m.pair[0]}, ${m.pair[1]}) is marked. On “${m.sym}”, ${m.pair[0]} goes to ${m.succ[0]} and ${m.pair[1]} goes to ${m.succ[1]}, and (${m.succ[0]}, ${m.succ[1]}) was already marked. So a string that separates ${m.succ[0]} from ${m.succ[1]}, with “${m.sym}” in front, separates ${m.pair[0]} from ${m.pair[1]}.`;
      extra = `<div class="formula"><div><span class="k">pair</span><span class="mv">(${esc(m.pair.join(", "))})</span></div><div><span class="k">δ(·, ${esc(m.sym)})</span><span>${esc(m.pair[0])}→${esc(m.succ[0])}, ${esc(m.pair[1])}→${esc(m.succ[1])}</span></div><div><span class="k">already marked</span><span class="add">(${esc(m.succ.join(", "))})</span></div></div>`;
    }
    if (s.type === "merge") {
      const groups = R.classes.filter(c => c.length > 1);
      t = groups.length ? `No more pairs can be marked. The unmarked pairs are equivalent, giving the classes ${R.classes.map(c => "{" + c.join(",") + "}").join(" ")}. States with the same colour merge.` : "No more pairs can be marked, and every pair is marked: no two states are equivalent, so the DFA is already minimal.";
    }
    if (s.type === "done") t = `The minimal DFA has ${R.minimal.states.length} state${R.minimal.states.length > 1 ? "s" : ""} (from ${N.states.length}). Each new state M is one class; its transitions come from any member, which is safe because members agree on every symbol.`;
    $("#narrative").innerHTML = `<div class="stepno">Step ${i + 1} of ${steps.length} · ${esc(s.label)}</div><p style="margin:6px 0 0">${esc(t)}</p>${extra}`;
  }

  function pairTable(i) {
    const S = R.states, s = steps[i];
    if (S.length < 2) { $("#pairs").innerHTML = '<p class="small muted">A single state has no pairs to compare.</p>'; return; }
    const ended = s.type === "merge" || s.type === "done";
    let h = '<table class="pairs"><tbody>';
    for (let r = 1; r < S.length; r++) {
      h += `<tr><th>${esc(S[r])}</th>`;
      for (let c = 0; c < S.length - 1; c++) {
        if (c >= r) { h += '<td class="blank"></td>'; continue; }
        const k = R.pairKey(S[r], S[c]), at = R.markedAt[k], m = R.mark[k];
        const marked = at != null && at <= i && i >= 3;
        const now = (s.type === "mark" && R.pairKey(s.mark.pair[0], s.mark.pair[1]) === k) || (s.type === "base" && at === i);
        const reason = marked ? `(${S[c]}, ${S[r]}): ${m.reason}` : ended ? `(${S[c]}, ${S[r]}) are equivalent` : `(${S[c]}, ${S[r]}) not marked yet`;
        h += `<td class="cell${marked ? " x" : ended ? " eq" : ""}${now ? " now" : ""}" title="${esc(reason)}">${marked ? "×" + m.round : ended ? "=" : ""}</td>`;
      }
      h += "</tr>";
    }
    h += `<tr><td class="blank"></td>${S.slice(0, -1).map(x => `<th>${esc(x)}</th>`).join("")}</tr></tbody></table>`;
    $("#pairs").innerHTML = h;
  }

  function partitions() {
    $("#partitions").innerHTML = `<table class="data"><thead><tr><th>Round</th><th>Blocks</th><th>Count</th></tr></thead><tbody>${R.partitions.map((p, k) => `<tr><td>P${k}</td><td class="set">${esc(p.map(b => "{" + b.join(",") + "}").join("  "))}</td><td>${p.length}</td></tr>`).join("")}</tbody></table>`;
  }

  function results() {
    const m = R.minimal;
    $("#stats").innerHTML = [[N.states.length, "states in your DFA"], [R.removed.length, "unreachable removed"], [R.trap ? "yes" : "no", "trap state added"], [m.states.length, "states after minimising"], [R.marks.length, "pairs marked"], [R.partitions.length - 1, "refinement rounds"]]
      .map(s => `<div class="stat"><b>${esc(s[0])}</b><span>${esc(s[1])}</span></div>`).join("");
    $("#minTable").innerHTML = `<table class="data"><thead><tr><th>State</th><th>Merged from</th>${N.alpha.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${m.states.map((s, k) => `<tr><td>${s.start ? "→ " : ""}${s.final ? "* " : ""}<b>${s.id}</b></td><td class="set">{${esc(s.members.join(","))}}</td>${N.alpha.map(c => `<td>M${m.tm[k + "|" + c]}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const eq = A.equivalent(N, A.parse(m.text));
    $("#verify").innerHTML = eq.ok ? '<div class="msg ok">✓ Verified: the minimal DFA accepts exactly the same language as your DFA (checked by exploring every pair of states).</div>' : `<div class="msg err">✗ The languages differ on “${esc(eq.counter.join("") || "ε")}” — please report this.</div>`;
  }

  $("#copyMin").addEventListener("click", () => R && navigator.clipboard.writeText(R.minimal.text).then(() => Studio.toast("Minimal DFA copied."), () => Studio.toast("Copy failed.", "err")));
  $("#runMin").addEventListener("click", () => R && Studio.handoff("run.html", { src: R.minimal.text }));
  $("#practise").addEventListener("click", () => Studio.handoff("practice.html", { practise: { type: "classes" } }));
  $("#toggleInput").addEventListener("click", e => {
    const ws = $("#ws"), hide = !ws.classList.contains("collapsed");
    ws.classList.toggle("collapsed", hide);
    e.target.textContent = hide ? "Show input" : "Hide input";
    setTimeout(() => { origView.fit(); minView.fit(); }, 40);
  });
  const narrow = window.matchMedia("(max-width: 1100px)");
  const lay = () => ($("#canvases").style.gridTemplateColumns = narrow.matches ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)");
  narrow.addEventListener("change", lay); lay();

  Studio.context = () => ({ page: "DFA minimisation simulator", automaton: input.getText(), step: R && steps[cur] ? `Step ${cur + 1} of ${steps.length}: ${$("#narrative").textContent.replace(/^Step[^·]*·\s*/, "")}` : "" });
  Studio.chatChips = ["Why was this pair marked?", "Explain table filling", "Make a minimisation question"];

  const h = Studio.takeHandoff("minimize.html");
  if (h && h.src) input.setText(h.src, true); else input.run();
})();
