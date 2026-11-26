(function () {
  "use strict";
  const { $, $$, esc } = Studio, A = Automata, fmt = A.fmtSet;
  let N = null, elim = null, NE = null, M_dfa = null, M_stage2 = null;
  let activeStage = "nfa-to-dfa"; // "enfa-to-nfa" | "nfa-to-dfa" | "direct-dfa"
  let src = "", cur = 0, nameMode = Studio.store.get("subset.names", "D");
  let isPlayingPipeline = false;

  const nfaView = new GraphView($("#nfaCanvas"), { title: "NFA", emptyText: "Your automaton appears here." });
  const dfaView = new GraphView($("#dfaCanvas"), { title: "DFA being built", emptyText: "States appear here as constructed." });

  const player = new StepPlayer($("#transport"), {
    onStep: show,
    label: i => {
      if (activeStage === "enfa-to-nfa" && elim && elim.steps[i]) {
        const s = elim.steps[i];
        if (s.type === "closure") return `ε-closure(${s.state})`;
        if (s.type === "trans") return `δ'(${s.state}, ${s.sym})`;
        return "";
      }
      const M = currentM();
      return (M && M.steps[i] && M.steps[i].isNew && i ? "new state discovered" : "");
    },
    storageKey: "speed.subset"
  });

  const input = new AutomatonInput($("#input"), { kind: "nfa", storageKey: "subset.src", runLabel: "Convert", onRun: build });
  $("#names").value = nameMode;

  function currentM() {
    return activeStage === "direct-dfa" ? M_dfa : M_stage2;
  }

  const name = (i, M) => A.dfaName(M || currentM(), i, nameMode === "sets" ? "sets" : nameMode);
  const plainName = (i, M) => (nameMode === "letters" ? A.dfaName(M || currentM(), i, "letters") : "D" + i);

  function dfaGraph(M) {
    if (!M) return { nodes: [], edges: [] };
    return {
      nodes: M.D.map((d, i) => ({
        id: "D" + i,
        label: nameMode === "sets" ? fmt(d.set) : name(i, M),
        sub: nameMode === "sets" ? "" : fmt(d.set),
        final: d.fin,
        start: i === 0,
        dead: d.dead,
        title: `${plainName(i, M)} = ${fmt(d.set)}${d.fin ? " (final)" : ""}${d.dead ? " (dead state)" : ""}`
      })),
      edges: M.trans.map(t => ({ from: "D" + t.f, to: "D" + t.t, sym: t.c }))
    };
  }

  function neTargetGraph() {
    if (!elim || !elim.NE) return { nodes: [], edges: [] };
    const targetNE = elim.NE;
    return {
      nodes: targetNE.states.map(s => {
        const isFin = elim.finalNotes[s] ? elim.finalNotes[s].isFinal : targetNE.finals.includes(s);
        return {
          id: s,
          label: s,
          final: isFin,
          start: s === targetNE.start,
          title: `${s}${isFin ? " (accepting: reaches original final state)" : " (non-accepting)"}`
        };
      }),
      edges: elim.trans.map(t => ({ from: t.from, to: t.to, sym: t.sym }))
    };
  }

  function setTitles(left, right) {
    const t1 = $("#nfaCanvas").querySelector(".title");
    const t2 = $("#dfaCanvas").querySelector(".title");
    if (t1) t1.textContent = left;
    if (t2) t2.textContent = right;
  }

  function updateStageButtons() {
    const hasEps = N && N.hasEps;
    const stageEnfaBtn = $("#stageEnfaBtn");
    const stageNfaDfaBtn = $("#stageNfaDfaBtn");
    const stageDirectBtn = $("#stageDirectBtn");
    const playPipelineBtn = $("#playPipelineBtn");

    if (hasEps) {
      if (stageEnfaBtn) { stageEnfaBtn.style.display = ""; stageEnfaBtn.setAttribute("aria-pressed", String(activeStage === "enfa-to-nfa")); }
      if (stageNfaDfaBtn) { stageNfaDfaBtn.textContent = "2. NFA → DFA (subset construction)"; stageNfaDfaBtn.setAttribute("aria-pressed", String(activeStage === "nfa-to-dfa")); }
      if (stageDirectBtn) { stageDirectBtn.style.display = ""; stageDirectBtn.setAttribute("aria-pressed", String(activeStage === "direct-dfa")); }
      if (playPipelineBtn) playPipelineBtn.style.display = "";
    } else {
      if (stageEnfaBtn) stageEnfaBtn.style.display = "none";
      if (stageNfaDfaBtn) { stageNfaDfaBtn.textContent = "Subset Construction (NFA → DFA)"; stageNfaDfaBtn.setAttribute("aria-pressed", "true"); }
      if (stageDirectBtn) stageDirectBtn.style.display = "none";
      if (playPipelineBtn) playPipelineBtn.style.display = "none";
      if (activeStage === "enfa-to-nfa" || activeStage === "direct-dfa") activeStage = "nfa-to-dfa";
    }

    const dfaNamesWrap = $("#namesWrap");
    if (dfaNamesWrap) dfaNamesWrap.style.display = activeStage === "enfa-to-nfa" ? "none" : "";
  }

  function selectStage(newStage, autoPlay = false) {
    if (!N) return;
    if (newStage === "enfa-to-nfa" && !N.hasEps) newStage = "nfa-to-dfa";
    activeStage = newStage;
    updateStageButtons();

    if (activeStage === "enfa-to-nfa") {
      setTitles("Source ε-NFA (with ε-moves)", "Equivalent ε-Free NFA (building)");
      nfaView.setGraph(GraphView.fromNFA(N));
      dfaView.setGraph(neTargetGraph());
      player.load(elim.steps.length, [], 0);
      $("#tableTitle").textContent = "Stage 1: ε-Elimination Table";
      $("#tableSubtitle").textContent = "Formula: δ'(q,a) = ε-closure(move(ε-closure(q), a)) · The highlighted cell shows the calculation in the current step.";
      show(0);
    } else if (activeStage === "nfa-to-dfa") {
      const sourceMachine = NE || N;
      const M = M_stage2 || M_dfa;
      setTitles(N.hasEps ? "ε-Free NFA (from Stage 1)" : "Source NFA", "DFA (subset construction)");
      nfaView.setGraph(GraphView.fromNFA(sourceMachine));
      dfaView.setGraph(dfaGraph(M));
      const marks = M.steps.map((s, i) => (s.isNew ? i : -1)).filter(i => i > 0);
      player.load(M.steps.length, marks, 0);
      $("#tableTitle").textContent = "Stage 2: Subset Construction Table";
      $("#tableSubtitle").textContent = "Rows appear as subsets are discovered; the highlighted cell is the one computed in the current step.";
      show(0);
    } else if (activeStage === "direct-dfa") {
      setTitles("Source ε-NFA", "DFA (direct subset construction)");
      nfaView.setGraph(GraphView.fromNFA(N));
      dfaView.setGraph(dfaGraph(M_dfa));
      const marks = M_dfa.steps.map((s, i) => (s.isNew ? i : -1)).filter(i => i > 0);
      player.load(M_dfa.steps.length, marks, 0);
      $("#tableTitle").textContent = "Direct ε-NFA → DFA Subset Construction Table";
      $("#tableSubtitle").textContent = "Direct powerset construction with ε-closures taken at each subset move.";
      show(0);
    }

    if (autoPlay) {
      player.play();
    }
  }

  function build(text, parsed) {
    try {
      N = parsed;
      src = text;
      elim = N.hasEps ? A.buildEpsElimination(N) : null;
      NE = elim ? elim.NE : N;
      M_dfa = A.build(N);
      M_stage2 = elim ? A.build(NE) : M_dfa;
    } catch (e) {
      M_dfa = null; M_stage2 = null; elim = null; NE = null; N = null;
      nfaView.setGraph(GraphView.fromNFA(parsed));
      dfaView.clear();
      $("#narrative").innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
      $("#workTable").innerHTML = ""; $("#stats").innerHTML = ""; $("#verify").innerHTML = "";
      const es = $("#enfaStep"); if (es) es.innerHTML = "";
      return;
    }

    // Default stage: if has ε-moves, start on Stage 1 (enfa-to-nfa) so user sees the minute conversion!
    if (N.hasEps) {
      selectStage("enfa-to-nfa");
    } else {
      selectStage("nfa-to-dfa");
    }
    results();
  }

  // ---------------- Stage 1: ε-NFA → NFA View Handler ----------------
  function viewsForStage1(i, phase) {
    if (!elim) return;
    const s = elim.steps[i];
    if (s.type === "overview") {
      const hot = new Set(s.hotEdges.map(e => e.join("|")));
      nfaView.setView({ classes: {}, hotEdges: hot, dimOthers: false, dimEdges: false });
      dfaView.setView({ visibleNodes: new Set(elim.NE.states), visibleEdges: new Set(), classes: {}, hotEdges: new Set() });
      return;
    }

    if (s.type === "closure") {
      const nfaClasses = { [s.state]: "in-s" };
      s.added.forEach(q => (nfaClasses[q] = "closure"));
      const hot = new Set(s.epsEdges.map(e => e.join("|")));
      nfaView.setView({ classes: nfaClasses, hotEdges: hot, dimOthers: true, dimEdges: true });

      // Target NFA nodes
      const visNodes = new Set(elim.NE.states.slice(0, elim.NE.states.indexOf(s.state) + 1));
      const targetClasses = {};
      targetClasses[s.state] = s.isFinal ? "current fresh" : "current";
      dfaView.setView({ visibleNodes: visNodes, visibleEdges: new Set(), classes: targetClasses, hotEdges: new Set(), pulse: s.state });
      return;
    }

    if (s.type === "trans") {
      const nfaClasses = {};
      s.clQ.forEach(q => (nfaClasses[q] = "in-s"));
      const hot = new Set();
      if (phase >= 1) {
        s.move.forEach(q => (nfaClasses[q] = (nfaClasses[q] ? nfaClasses[q] + " " : "") + "moved"));
        s.moveEdges.forEach(e => hot.add(e.join("|")));
      }
      if (phase === 0) s.moveEdges.forEach(e => hot.add(e.join("|")));
      if (phase >= 2) {
        s.added.forEach(q => (nfaClasses[q] = "closure"));
        s.epsEdges.forEach(e => hot.add(e.join("|")));
      }
      nfaView.setView({ classes: nfaClasses, hotEdges: hot, dimOthers: true, dimEdges: true });

      // Target NFA edges up to step i
      const visE = new Set();
      elim.trans.forEach(t => {
        if (t.step < i || (t.step === i && phase >= 2)) visE.add(`${t.from}|${t.to}|${t.sym}`);
      });
      const dHot = new Set();
      if (phase >= 2) {
        s.targets.forEach(t => dHot.add(`${s.state}|${t}|${s.sym}`));
      }
      const targetClasses = { [s.state]: "current" };
      dfaView.setView({
        visibleNodes: new Set(elim.NE.states),
        visibleEdges: visE,
        classes: targetClasses,
        hotEdges: dHot,
        pulse: phase >= 2 && s.targets.length ? s.state : null
      });
    }
  }

  // ---------------- Stage 2 & Direct: Subset Construction View Handler ----------------
  function viewsForSubset(i, phase) {
    const M = currentM();
    if (!M) return;
    const sourceMachine = activeStage === "direct-dfa" ? N : (NE || N);
    const s = M.steps[i];
    const S = s.type === "init" ? [sourceMachine.start] : M.D[s.from].set;
    const nfaClasses = {};
    S.forEach(q => (nfaClasses[q] = "in-s"));
    const hot = new Set();
    if (phase >= 1) {
      s.move.forEach(q => (nfaClasses[q] = (nfaClasses[q] ? nfaClasses[q] + " " : "") + "moved"));
      s.moveEdges.forEach(e => hot.add(e.join("|")));
    }
    if (phase === 0 && s.type === "move") s.moveEdges.forEach(e => hot.add(e.join("|")));
    if (phase >= 2) {
      s.added.forEach(q => (nfaClasses[q] = "closure"));
      s.epsEdges.forEach(e => hot.add(e.join("|")));
    }
    nfaView.setView({ classes: nfaClasses, hotEdges: hot, dimOthers: true, dimEdges: true });

    const visN = new Set(), visE = new Set();
    M.D.forEach((d, k) => { if (d.discovered <= (phase >= 2 ? i : i - (s.isNew ? 1 : 0)) || k === 0) visN.add("D" + k); });
    M.trans.forEach(t => { if (t.step < i || (t.step === i && phase >= 2)) visE.add(`D${t.f}|D${t.t}|${t.c}`); });
    const classes = {};
    if (s.type === "move") classes["D" + s.from] = "current";
    if (phase >= 2) classes["D" + s.to] = (classes["D" + s.to] ? classes["D" + s.to] + " " : "") + (s.isNew ? "fresh" : "current");
    const dHot = new Set(phase >= 2 && s.type === "move" ? [`D${s.from}|D${s.to}|${s.c}`] : []);
    dfaView.setView({ visibleNodes: visN, visibleEdges: visE, classes, hotEdges: dHot, pulse: phase >= 2 && s.isNew ? "D" + s.to : null });
  }

  async function show(i, info) {
    cur = i;
    if (activeStage === "enfa-to-nfa") {
      await showStage1(i, info);
    } else {
      await showSubset(i, info);
    }
  }

  async function showStage1(i, info) {
    if (!elim) return;
    const s = elim.steps[i];
    narrateStage1(i);
    tableStage1(i);

    if (info && info.animate && info.ms > 0) {
      const ms = info.ms;
      viewsForStage1(i, 0);
      if (s.moveEdges && s.moveEdges.length) await nfaView.animate(s.moveEdges, ms * 0.38);
      if (cur !== i) return;
      viewsForStage1(i, 1);
      if (s.epsEdges && s.epsEdges.length) await nfaView.animate(s.epsEdges, ms * 0.32);
      if (cur !== i) return;
    }
    viewsForStage1(i, 2);

    // Auto-advance if playing full pipeline and reached end of Stage 1
    if (isPlayingPipeline && i === elim.steps.length - 1) {
      setTimeout(() => {
        if (isPlayingPipeline && activeStage === "enfa-to-nfa") {
          selectStage("nfa-to-dfa", true);
        }
      }, Math.max(600, player.stepMs()));
    }
  }

  async function showSubset(i, info) {
    const M = currentM();
    if (!M) return;
    const s = M.steps[i];
    narrateSubset(i);
    tableSubset(i);

    if (info && info.animate && info.ms > 0) {
      const ms = info.ms;
      viewsForSubset(i, 0);
      if (s.moveEdges && s.moveEdges.length) await nfaView.animate(s.moveEdges, ms * 0.38);
      if (cur !== i) return;
      viewsForSubset(i, 1);
      if (s.epsEdges && s.epsEdges.length) await nfaView.animate(s.epsEdges, ms * 0.28);
      if (cur !== i) return;
    }
    viewsForSubset(i, 2);

    if (isPlayingPipeline && i === M.steps.length - 1) {
      isPlayingPipeline = false;
    }
  }

  // ---------------- Stage 1 Narratives & Tables ----------------
  function narrateStage1(i) {
    const s = elim.steps[i];
    const total = elim.steps.length;
    let f = "", body = "";

    if (s.type === "overview") {
      body = `<p style="margin:6px 0 0">${esc(s.desc)}</p>`;
      f = `<div><span class="k">ε-NFA states</span><span>${esc(N.states.join(", "))}</span></div>
           <div><span class="k">Alphabet</span><span>{${esc(N.alpha.join(", "))}}</span></div>
           <div><span class="k">Formula</span><span><b>δ'(q,a) = ε-closure(move(ε-closure(q), a))</b></span></div>`;
    } else if (s.type === "closure") {
      body = `<p style="margin:6px 0 0">Computing ε-closure of state <b>${esc(s.state)}</b>. ${s.added.length ? `Following ε-transitions reaches ${esc(s.added.join(", "))}.` : `No ε-moves leave this state.`} ${s.isFinal ? `<b>Accepting:</b> Original final state {${esc(s.reachingFinals.join(", "))}} is reachable on ε.` : `Non-accepting: no original final state reachable on ε.`}</p>`;
      f = `<div><span class="k">State q</span><span>${esc(s.state)}</span></div>
           <div><span class="k">ε-closure(${esc(s.state)})</span><span><b>${esc(fmt(s.closure))}</b>${s.added.length ? ` <span class="add">+${esc(s.added.join(","))}</span>` : ""}</span></div>
           <div><span class="k">Original Finals in Closure?</span><span>${s.isFinal ? `<b style="color:var(--go)">Yes (${esc(s.reachingFinals.join(","))}) → Accepting ◎</b>` : '<span class="muted">No → Non-accepting</span>'}</span></div>`;
    } else if (s.type === "trans") {
      body = `<p style="margin:6px 0 0">Computing transition for state <b>${esc(s.state)}</b> on symbol <b>“${esc(s.sym)}”</b> using formula:<br><code>δ'(${esc(s.state)}, ${esc(s.sym)}) = ε-closure(move(ε-closure(${esc(s.state)}), ${esc(s.sym)}))</code>.<br>
      1. ε-closure(${esc(s.state)}) = ${esc(fmt(s.clQ))}<br>
      2. move on “${esc(s.sym)}” reaches ${esc(fmt(s.move))}<br>
      3. ε-closure of that move set yields ${esc(fmt(s.targets))}.</p>`;
      f = `<div><span class="k">ε-closure(${esc(s.state)})</span><span>${esc(fmt(s.clQ))}</span></div>
           <div><span class="k">move(..., ${esc(s.sym)})</span><span class="mv">${esc(fmt(s.move))}</span></div>
           <div><span class="k">ε-closure of move</span><span><b>${esc(fmt(s.targets))}</b></span></div>
           <div><span class="k">New Transition</span><span><b>${esc(s.state)} —${esc(s.sym)}→ ${esc(fmt(s.targets))}</b></span></div>`;
    }

    let endBanner = "";
    if (i === total - 1) {
      endBanner = `<div class="row" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--rule)">
        <span style="color:var(--go);font-weight:700">✓ Stage 1 (ε-Elimination) Complete!</span>
        <button class="btn primary sm" id="btnGoToStage2">Proceed to Stage 2: NFA → DFA (subset construction) →</button>
      </div>`;
    }

    $("#narrative").innerHTML = `<div class="stepno">Stage 1: ε-Elimination · Step ${i + 1} of ${total}</div>${body}<div class="formula">${f}</div>${endBanner}`;

    const btnGo = $("#btnGoToStage2");
    if (btnGo) btnGo.addEventListener("click", () => selectStage("nfa-to-dfa", true));
  }

  function tableStage1(i) {
    const s = elim.steps[i];
    let h = `<table class="data"><thead><tr><th>State q</th><th>ε-closure(q)</th><th>Final in NFA?</th>${N.alpha.map(c => `<th>δ'(q, ${esc(c)})</th>`).join("")}</tr></thead><tbody>`;

    N.states.forEach(q => {
      const cl = elim.closures[q] ? elim.closures[q].set : [];
      const isFin = elim.finalNotes[q] && elim.finalNotes[q].isFinal;
      const isCurState = (s.type === "closure" && s.state === q) || (s.type === "trans" && s.state === q);

      h += `<tr${isCurState ? ' class="now"' : ""}>`;
      h += `<td>${q === N.start ? "→ " : ""}${isFin ? "* " : ""}<b>${esc(q)}</b></td>`;
      h += `<td class="set">${cl.length ? esc(fmt(cl)) : '<span class="muted">·</span>'}</td>`;
      h += `<td>${elim.finalNotes[q] ? (isFin ? '<b style="color:var(--go)">Yes ◎</b>' : 'No') : '<span class="muted">·</span>'}</td>`;

      N.alpha.forEach(c => {
        const stepIdx = elim.steps.findIndex(st => st.type === "trans" && st.state === q && st.sym === c);
        const isDone = stepIdx !== -1 && stepIdx <= i;
        const isNow = s.type === "trans" && s.state === q && s.sym === c;
        let cellHtml = '<span class="muted">·</span>';
        if (isDone) {
          const tgts = elim.steps[stepIdx].targets;
          cellHtml = esc(tgts && tgts.length ? fmt(tgts) : "∅");
        }
        h += `<td class="set"${isNow ? ' style="background:var(--marker);color:#18213a;font-weight:700"' : ""}>${cellHtml}</td>`;
      });
      h += `</tr>`;
    });
    h += `</tbody></table>`;
    $("#workTable").innerHTML = h;
    $("#tableNote").textContent = `Step ${i + 1} of ${elim.steps.length} · ${elim.trans.filter(t => t.step <= i).length} transitions constructed`;

    // Step log
    let L = `<table class="data"><thead><tr><th>#</th><th>Step Type</th><th>State</th><th>Symbol</th><th>move</th><th>ε-closure / Result</th></tr></thead><tbody>`;
    elim.steps.slice(0, i + 1).forEach((st, k) => {
      L += `<tr${k === i ? ' class="now"' : ""}><td>${k + 1}</td>`;
      if (st.type === "overview") {
        L += `<td>Overview</td><td colspan="4">All states and ε-transitions identified</td>`;
      } else if (st.type === "closure") {
        L += `<td>ε-closure</td><td><b>${esc(st.state)}</b></td><td>—</td><td>—</td><td class="set">${esc(fmt(st.closure))} ${st.isFinal ? "<b>(Final)</b>" : ""}</td>`;
      } else if (st.type === "trans") {
        L += `<td>Transition</td><td><b>${esc(st.state)}</b></td><td>${esc(st.sym)}</td><td class="set">${esc(fmt(st.move))}</td><td class="set">δ'(${esc(st.state)},${esc(st.sym)}) = ${esc(fmt(st.targets))}</td>`;
      }
      L += `</tr>`;
    });
    $("#log").innerHTML = L + "</tbody></table>";
  }

  // ---------------- Stage 2 & Direct Narratives & Tables ----------------
  function stepTextSubset(i) {
    const M = currentM();
    const sourceMachine = activeStage === "direct-dfa" ? N : (NE || N);
    const s = M.steps[i], to = M.D[s.to];
    const finals = to.set.filter(q => sourceMachine.finals.includes(q));
    const acc = to.fin ? `, and it is accepting because it contains final state${finals.length > 1 ? "s" : ""} ${finals.join(", ")}` : "";
    if (s.type === "init") {
      return `Start with the ε-closure of the NFA start state ${sourceMachine.start}: ${fmt(s.closure)}` + (s.added.length ? ` (${s.added.join(", ")} ${s.added.length > 1 ? "are" : "is"} reached by ε-moves)` : "") + `. This set becomes ${plainName(0, M)}, the DFA start state${acc}.`;
    }
    let t = `Take ${plainName(s.from, M)} = ${fmt(M.D[s.from].set)} and the symbol “${s.c}”. `;
    if (!s.move.length) t += `No state in the set has a “${s.c}”-arrow, so the result is the empty set ∅ — the dead state. Once there, the DFA can never accept.`;
    else {
      t += `One “${s.c}”-arrow from these states reaches ${fmt(s.move)}. `;
      t += s.added.length ? `Following ε-moves adds ${s.added.join(", ")}, giving ${fmt(s.closure)}. ` : `No ε-moves add anything, so the set stays ${fmt(s.closure)}. `;
    }
    if (s.isNew) t += ` This subset is new, so it becomes ${plainName(s.to, M)}${s.move.length ? acc : ""}.`;
    else t += ` This subset is already ${plainName(s.to, M)}, so only the arrow ${plainName(s.from, M)} —${s.c}→ ${plainName(s.to, M)} is added.`;
    if (i === M.steps.length - 1) t += ` That was the last unprocessed pair: the DFA is complete with ${M.D.length} state${M.D.length > 1 ? "s" : ""}.`;
    return t;
  }

  function narrateSubset(i) {
    const M = currentM();
    const sourceMachine = activeStage === "direct-dfa" ? N : (NE || N);
    const s = M.steps[i];
    const edges = list => list.map(e => `${e[0]}–${e[1]}→${e[2]}`).join(", ");
    let f;
    if (s.type === "init") {
      f = `<div><span class="k">start state</span><span>${esc(sourceMachine.start)}</span></div>
           <div><span class="k">ε-closure</span><span>${esc(fmt(s.closure))}</span>${s.added.length ? `<span class="add">+${esc(s.added.join(", "))} via ${esc(edges(s.epsEdges))}</span>` : ""}</div>
           <div><span class="k">DFA start</span><span><b>${esc(plainName(0, M))}</b>${M.D[0].fin ? " · accepting" : ""}</span></div>`;
    } else {
      f = `<div><span class="k">S</span><span>${esc(plainName(s.from, M))} = ${esc(fmt(M.D[s.from].set))}</span></div>
           <div><span class="k">move(S, ${esc(s.c)})</span><span class="mv">${esc(fmt(s.move))}</span>${s.moveEdges.length ? `<span class="muted">via ${esc(edges(s.moveEdges))}</span>` : ""}</div>
           <div><span class="k">ε-closure</span><span>${esc(fmt(s.closure))}</span>${s.added.length ? `<span class="add">+${esc(s.added.join(", "))}</span>` : ""}</div>
           <div><span class="k">δ(${esc(plainName(s.from, M))}, ${esc(s.c)})</span><span><b>${esc(plainName(s.to, M))}</b>${s.isNew ? " · new" : " · existing"}${M.D[s.to].fin ? " · accepting" : ""}${M.D[s.to].dead ? " · dead" : ""}</span></div>`;
    }
    const stagePrefix = activeStage === "direct-dfa" ? "Direct ε-NFA → DFA" : (N.hasEps ? "Stage 2: NFA → DFA" : "Subset Construction");
    $("#narrative").innerHTML = `<div class="stepno">${stagePrefix} · Step ${i + 1} of ${M.steps.length}${s.isNew ? " · new state" : ""}</div><p style="margin:6px 0 0">${esc(stepTextSubset(i))}</p><div class="formula">${f}</div>`;
  }

  function tableSubset(i) {
    const M = currentM();
    const sourceMachine = activeStage === "direct-dfa" ? N : (NE || N);
    const rows = M.D.map((d, k) => k).filter(k => k === 0 || M.D[k].discovered <= i);
    const s = M.steps[i];
    let h = `<table class="data"><thead><tr><th>DFA state</th><th>NFA subset</th>${sourceMachine.alpha.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>`;
    rows.forEach(k => {
      h += `<tr${s.type === "move" && s.from === k ? ' class="now"' : ""}><td>${k === 0 ? "→ " : ""}${M.D[k].fin ? "* " : ""}<b>${esc(plainName(k, M))}</b></td><td class="set">${esc(fmt(M.D[k].set))}</td>`;
      sourceMachine.alpha.forEach(c => {
        const t = M.trans.find(x => x.f === k && x.c === c);
        const done = t && t.step <= i, now = t && t.step === i;
        h += `<td class="set"${now ? ' style="background:var(--marker);color:#18213a;font-weight:700"' : ""}>${done ? esc(plainName(t.t, M)) + (now && s.isNew ? " ★" : "") : '<span class="muted">·</span>'}</td>`;
      });
      h += "</tr>";
    });
    $("#workTable").innerHTML = h + "</tbody></table>";
    $("#tableNote").textContent = `→ start · * accepting · ${rows.length} of ${M.D.length} states found`;
    let L = `<table class="data"><thead><tr><th>#</th><th>From</th><th>Symbol</th><th>move</th><th>ε-closure</th><th>Result</th></tr></thead><tbody>`;
    M.steps.slice(0, i + 1).forEach((t, k) => {
      L += `<tr${k === i ? ' class="now"' : ""}><td>${k + 1}</td>` + (t.type === "init" ? `<td>ε-closure(${esc(sourceMachine.start)})</td><td>—</td><td>—</td>` : `<td>${esc(plainName(t.from, M))} ${esc(fmt(M.D[t.from].set))}</td><td>${esc(t.c)}</td><td class="set">${esc(fmt(t.move))}</td>`) + `<td class="set">${esc(fmt(t.closure))}</td><td>${esc(plainName(t.to, M))}${t.isNew ? " (new)" : ""}</td></tr>`;
    });
    $("#log").innerHTML = L + "</tbody></table>";
  }

  // ---------------- Results & Verification ----------------
  function results() {
    const M = currentM();
    if (!M || !N) return;
    const dead = M.D.some(d => d.dead);
    const stats = [
      [N.states.length, "NFA states"],
      [M.D.length, "DFA states"],
      [M.D.filter(d => d.fin).length, "accepting DFA states"],
      [N.alpha.length, "input symbols"],
      [N.hasEps ? "yes" : "no", "ε-moves"],
      [dead ? "yes" : "no", "dead state ∅"],
      ["2^" + N.states.length + " = " + Math.pow(2, N.states.length), "worst-case bound"]
    ];
    $("#stats").innerHTML = stats.map(s => `<div class="stat"><b>${esc(s[0])}</b><span>${esc(s[1])}</span></div>`).join("");

    if (N.hasEps) {
      const cellCss = "border:1px solid var(--rule);padding:6px 10px;text-align:left";
      const monoCss = "font-family:var(--mono)";
      const clRows = N.states.map(q => {
        const cl = elim ? elim.closures[q].set : A.closure(N, [q]);
        const fin = elim ? elim.finalNotes[q].isFinal : cl.some(s => N.finals.includes(s));
        return `<tr><td style="${cellCss};${monoCss}">${esc(q)}</td><td style="${cellCss};${monoCss}">${esc(A.fmtSet(cl))}</td><td style="${cellCss}">${fin ? '<b style="color:var(--go)">accepting ◎</b> (its ε-closure reaches a final state)' : "non-accepting"}</td></tr>`;
      }).join("");

      $("#enfaStep").innerHTML =
        '<details open class="enfa"><summary><b>How an ε-NFA becomes a DFA (ε-NFA → NFA → DFA)</b></summary>' +
        '<p class="small muted" style="margin:6px 0">Interactive simulation of both stages is available in the <b>Conversion Stage</b> switcher above:</p>' +
        '<div class="row" style="margin:8px 0 12px;gap:8px">' +
        '<button class="btn sm" id="jumpStage1">▶ Simulate Stage 1 (ε-elimination)</button>' +
        '<button class="btn sm" id="jumpStage2">▶ Simulate Stage 2 (subset construction)</button>' +
        '</div>' +
        '<h4 style="margin:12px 0 4px">Stage 1 — ε-closure of each state</h4>' +
        '<p class="small muted" style="margin:0 0 6px">All states reachable using only ε-moves (always includes the state itself).</p>' +
        `<div class="table-wrap"><table style="border-collapse:collapse;font-size:13px;width:100%"><thead><tr><th style="${cellCss}">state q</th><th style="${cellCss}">ε-closure(q)</th><th style="${cellCss}">accepting in new NFA?</th></tr></thead><tbody>${clRows}</tbody></table></div>` +
        '<h4 style="margin:14px 0 4px">Stage 2 — equivalent NFA without ε-moves</h4>' +
        '<p class="small muted" style="margin:0 0 6px">δ′(q,a) = ε-closure(move(ε-closure(q), a)); a state is accepting if its ε-closure reaches an original final state.</p>' +
        '<pre class="code" style="white-space:pre-wrap">' + esc(A.toText(NE || N)) + '</pre>' +
        '</details>';

      const jump1 = $("#jumpStage1"), jump2 = $("#jumpStage2");
      if (jump1) jump1.addEventListener("click", () => selectStage("enfa-to-nfa", true));
      if (jump2) jump2.addEventListener("click", () => selectStage("nfa-to-dfa", true));
    } else {
      $("#enfaStep").innerHTML = "";
    }

    let L = 0, total = 1;
    while (L < 12 && N.alpha.length && total + Math.pow(N.alpha.length, L + 1) <= 5000) { L++; total += Math.pow(N.alpha.length, L); }
    const q = [[]]; let bad = 0, n = 0, ex = null;
    for (let k = 0; k < q.length; k++) {
      const w = q[k]; n++;
      if (A.runNFA(N, w) !== A.runDFA(N, M, w)) { bad++; ex = ex || w; }
      if (w.length < L) N.alpha.forEach(c => q.push([...w, c]));
    }
    $("#verify").innerHTML = bad
      ? `<div class="msg err">✗ ${bad} strings disagree, for example “${esc(ex.join("") || "ε")}”.</div>`
      : `<div class="msg ok">✓ Verified: the original ε-NFA, the intermediate ε-free NFA, and the constructed DFA agree on all ${n.toLocaleString()} strings up to length ${L}.</div>`;
  }

  // ---------------- UI Event Listeners ----------------
  const stageEnfaBtn = $("#stageEnfaBtn");
  const stageNfaDfaBtn = $("#stageNfaDfaBtn");
  const stageDirectBtn = $("#stageDirectBtn");
  const playPipelineBtn = $("#playPipelineBtn");

  if (stageEnfaBtn) stageEnfaBtn.addEventListener("click", () => selectStage("enfa-to-nfa"));
  if (stageNfaDfaBtn) stageNfaDfaBtn.addEventListener("click", () => selectStage("nfa-to-dfa"));
  if (stageDirectBtn) stageDirectBtn.addEventListener("click", () => selectStage("direct-dfa"));

  if (playPipelineBtn) playPipelineBtn.addEventListener("click", () => {
    if (!N) return;
    isPlayingPipeline = true;
    if (N.hasEps) {
      selectStage("enfa-to-nfa", true);
    } else {
      selectStage("nfa-to-dfa", true);
    }
  });

  // Listen to auto-simulate custom event from question input
  window.addEventListener("automata:simulate", e => {
    if (!N) return;
    isPlayingPipeline = true;
    if (N.hasEps) {
      selectStage("enfa-to-nfa", true);
    } else {
      selectStage("nfa-to-dfa", true);
    }
    // Smooth scroll to simulation view
    const simEl = $("#canvases");
    if (simEl && simEl.scrollIntoView) simEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  $$("[data-view]").forEach(b => b.addEventListener("click", () => {
    const v = b.dataset.view;
    $$("[data-view]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $("#nfaCanvas").hidden = v === "dfa"; $("#dfaCanvas").hidden = v === "nfa";
    $("#canvases").style.gridTemplateColumns = v === "both" ? "" : "minmax(0,1fr)";
    setTimeout(() => { nfaView.fit(); dfaView.fit(); }, 30);
  }));

  $("#toggleInput").addEventListener("click", e => {
    const ws = $("#ws"), hide = !ws.classList.contains("collapsed");
    ws.classList.toggle("collapsed", hide);
    e.target.textContent = hide ? "Show input" : "Hide input";
    e.target.setAttribute("aria-expanded", String(!hide));
    setTimeout(() => { nfaView.fit(); dfaView.fit(); }, 40);
  });

  const narrow = window.matchMedia("(max-width: 1100px)");
  const layoutCanvases = () => {
    if ($("#canvases").style.gridTemplateColumns !== "minmax(0,1fr)") {
      $("#canvases").style.gridTemplateColumns = narrow.matches ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)";
    }
  };
  narrow.addEventListener("change", layoutCanvases);
  layoutCanvases();

  $("#names").addEventListener("change", e => {
    nameMode = e.target.value;
    Studio.store.set("subset.names", nameMode);
    const M = currentM();
    if (M && activeStage !== "enfa-to-nfa") {
      dfaView.setGraph(dfaGraph(M), { keep: true });
      show(cur);
      results();
    }
  });

  $("#copyDfa").addEventListener("click", () => {
    const M = currentM();
    if (!M) return;
    navigator.clipboard.writeText(A.dfaToText(N, M, nameMode === "letters" ? "letters" : "D")).then(
      () => Studio.toast("DFA copied as text."),
      () => Studio.toast("Copy failed.", "err")
    );
  });

  $("#share").addEventListener("click", () => {
    const enc = btoa(unescape(encodeURIComponent(input.getText()))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const url = location.origin + location.pathname + "#a=" + enc;
    if (url.length > 6000) return Studio.toast("This automaton is too large for a link; copy its text instead.", "err");
    navigator.clipboard.writeText(url).then(
      () => Studio.toast("Link copied. Anyone opening it sees this NFA."),
      () => Studio.toast("Copy failed: " + url, "err")
    );
  });

  function fromHash() {
    if (!/^#a=/.test(location.hash)) return false;
    try {
      const t = decodeURIComponent(escape(atob(location.hash.slice(3).replace(/-/g, "+").replace(/_/g, "/"))));
      input.setText(t, true);
    } catch (e) {
      Studio.toast("The share link is damaged; showing your last NFA instead.", "err");
      input.run();
    }
    return true;
  }

  window.addEventListener("hashchange", fromHash);
  const h = Studio.takeHandoff("subset.html");
  if (h && h.src) input.setText(h.src, true);
  else if (!fromHash()) input.run();
})();
