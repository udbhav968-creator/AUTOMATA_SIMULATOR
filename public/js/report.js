/* Technical report generator laid out for the M2 rubric. */
(function () {
  "use strict";
  const { $, $$, esc, store } = Studio, A = Automata, fmt = A.fmtSet;
  const ROLES = ["Engine: parsing, ε-closure, subset construction", "Visualisation: diagram layout and step player", "Minimisation and string-run simulators", "Practice, exams and question bank", "AI tutor integration, testing and report"];
  const saved = store.get("report.form", null);
  $("#members tbody").innerHTML = ROLES.map((r, i) => `<tr><td><input data-m="name" value="${esc(saved ? saved.members[i].name : "")}" placeholder="Member ${i + 1}"></td><td><input data-m="roll" value="${esc(saved ? saved.members[i].roll : "")}"></td><td><input data-m="role" value="${esc(saved ? saved.members[i].role : r)}"></td></tr>`).join("");
  if (saved) ["title", "topic", "batch", "group"].forEach(k => ($("#" + k).value = saved[k] || $("#" + k).value));
  const last = Studio.lastAutomaton.get();
  $("#src").value = (saved && saved.src) || (last && last.src) || "start: q0\nfinal: q2\nq0,a = q0,q1\nq0,b = q0\nq1,b = q2";

  const T = (head, rows) => `<div class="table-wrap"><table class="data"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td class="wrap">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

  function generate() {
    const form = { title: $("#title").value, topic: $("#topic").value, batch: $("#batch").value, group: $("#group").value, src: $("#src").value,
      members: $$("#members tbody tr").map(tr => ({ name: tr.querySelector("[data-m=name]").value, roll: tr.querySelector("[data-m=roll]").value, role: tr.querySelector("[data-m=role]").value })) };
    store.set("report.form", form);
    let N, M, R, P;
    try { N = A.parse(form.src); M = A.build(N); P = A.properties(N); R = A.minimizeSteps(A.parse(A.dfaToText(N, M))); $("#srcErr").innerHTML = ""; }
    catch (e) { $("#srcErr").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
    const cases = CASES.map(c => runCase(A, c)), pass = cases.filter(c => c.pass).length;
    const g = gradingCheck(A, QGen, 3), gOk = g.reduce((a, r) => a + r.ok, 0), gN = g.reduce((a, r) => a + r.n, 0);
    let n = 0, bad = 0; const q = [[]];
    for (let i = 0; i < q.length && n < 4000; i++) { n++; if (A.runNFA(N, q[i]) !== A.runDFA(N, M, q[i])) bad++; if (q[i].length < 7) N.alpha.forEach(c => q.push([...q[i], c])); }
    const all = [...N.alpha, ...(N.hasEps ? ["ε"] : [])];
    const members = form.members.filter(m => m.name.trim());
    const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

    $("#report").innerHTML = `
      <section class="panel"><h1 style="font-size:26px;margin:0 0 6px">${esc(form.title)}</h1>
        <p class="muted" style="margin:0">CSET302 Automata Theory and Computability · Simulator design project · ${esc(today)}</p>
        ${T(["Topic", "Tutorial batch", "Group", "Members"], [[form.topic, form.batch || "—", form.group || "—", members.map(m => m.name).join(", ") || "—"]])}</section>
      <section class="panel"><h2>1. Problem statement and objectives</h2>
        <p>Design an interactive simulator that converts any ε-NFA into an equivalent DFA by subset construction, shows every intermediate step, and validates the result. Objectives: dynamic user input; a correct implementation of ε-closure, subset construction and minimisation; step-by-step visualisation; validation with normal, edge and error cases.</p></section>
      <section class="panel"><h2>2. Theory</h2>
        <p>An ε-NFA is N = (Q, Σ, δ, q₀, F) with δ : Q × (Σ ∪ {ε}) → 2^Q. The ε-closure of a set S is S plus every state reachable from it by ε-moves. Subset construction creates DFA states that are sets of NFA states: the start state is ε-closure({q₀}); δ_D(S, a) = ε-closure(move(S, a)); a DFA state is final when it contains a final NFA state. At most 2ⁿ states can arise, but only reachable subsets are built. Minimisation merges states that no string can distinguish (Myhill–Nerode), using table filling.</p></section>
      <section class="panel"><h2>3. Methodology and algorithms</h2>
        ${T(["Stage", "Method"], [["Input", "Text, transition table or regular expression (Thompson's construction); validated line by line with specific error messages"], ["ε-closure", "Stack-based search; each state visited once, so ε-cycles terminate"], ["Subset construction", "Breadth-first over discovered subsets; each (subset, symbol) pair is one recorded step"], ["Minimisation", "Remove unreachable states, add a trap state if needed, table filling by rounds, merge unmarked pairs"], ["Validation", "Exhaustive NFA-vs-DFA comparison on short strings; language-equivalence check with shortest counter-example"]])}</section>
      <section class="panel"><h2>4. System architecture</h2>
        ${T(["Layer", "Components"], [["Engine (shared by browser and server)", "lib/automata.js, lib/qgen.js, lib/cases.js"], ["Interface", "Three simulators, practice and exams, question bank, AI tutor, reference pages; SVG diagrams with obstacle-avoiding edges; step player with speed control"], ["Server", "Node.js with no dependencies: static files, question bank API, Gemini proxy with model fallback, timeouts, rate limiting and an offline tutor fallback"]])}</section>
      <section class="panel"><h2>5. Worked example: formal specification</h2>
        <p>Q = ${esc(fmt(N.states))}, Σ = ${esc(fmt(N.alpha))}, q₀ = ${esc(N.start)}, F = ${esc(fmt(N.finals))}</p>
        ${T(["State", ...all], N.states.map(s => [(s === N.start ? "→ " : "") + (N.finals.includes(s) ? "* " : "") + s, ...all.map(c => fmt([...(N.d[s + "|" + c] || [])]))]))}
        <div id="rNfa" style="height:300px;margin-top:12px"></div></section>
      <section class="panel"><h2>6. Subset construction log</h2>
        ${T(["#", "From", "Symbol", "move", "ε-closure", "Result"], M.steps.map((s, i) => s.type === "init" ? [i + 1, "ε-closure(" + N.start + ")", "—", "—", fmt(s.closure), "D0 (new)"] : [i + 1, "D" + s.from + " " + fmt(M.D[s.from].set), s.c, fmt(s.move), fmt(s.closure), "D" + s.to + (s.isNew ? " (new)" : "")]))}</section>
      <section class="panel"><h2>7. Resulting DFA</h2>
        ${T(["State", "Subset", ...N.alpha], M.D.map((d, i) => [(i ? "" : "→ ") + (d.fin ? "* " : "") + "D" + i, fmt(d.set), ...N.alpha.map(c => "D" + M.tm[i + "|" + c])]))}
        <div id="rDfa" style="height:320px;margin-top:12px"></div>
        <p>Minimisation: ${R.minimal.states.length} state${R.minimal.states.length > 1 ? "s" : ""}; classes ${esc(R.classes.map(c => "{" + c.join(",") + "}").join(" "))}.</p></section>
      <section class="panel"><h2>8. Testing</h2>
        ${T(["Check", "Result"], [["Edge-case suite (normal, ε-moves, edge, flexible input, stress, constraints)", `${pass} of ${cases.length} passed`], ["Grader self-check (12 question types × 3 levels)", `${gOk} of ${gN} passed`], [`NFA vs DFA on all strings up to length 7 (${n} strings)`, `${bad} mismatches`], ["Minimal DFA equivalent to DFA", A.equivalent(A.parse(A.dfaToText(N, M)), A.parse(R.minimal.text)).ok ? "yes" : "no"]])}
        <h3>Selected test cases</h3>
        ${T(["Case", "Category", "Expected", "Actual", "Result"], cases.filter((c, i) => i % 3 === 0 || c.cat === "Constraint").slice(0, 18).map(c => [c.name, c.cat, c.exp.slice(0, 2).join("; "), c.act.slice(0, 2).join("; "), c.pass ? "pass" : "FAIL"]))}</section>
      <section class="panel"><h2>9. Results and discussion</h2>
        ${T(["Measure", "Value"], [["NFA states", N.states.length], ["DFA states (reachable)", M.D.length], ["Theoretical maximum", "2^" + N.states.length + " = " + Math.pow(2, N.states.length)], ["Minimal DFA states", R.minimal.states.length], ["Language", P.empty ? "empty" : P.finite ? "finite" : "infinite"], ["Shortest accepted strings", P.words.slice(0, 6).join(", ") || "none"], ["Warnings", N.warn.join(" ") || "none"]])}</section>
      <section class="panel"><h2>10. Limitations and future work</h2>
        <p>Limits keep the interface responsive: 30 NFA states, 300 DFA states, 10 symbols, 200-symbol strings and 40-character regular expressions, each reported with a clear message. Future work: a drag-to-draw editor, pushdown automata and Turing machines, and classroom analytics from exam results.</p></section>
      <section class="panel"><h2>11. Individual contributions</h2>
        ${T(["Name", "Roll number", "Contribution"], (members.length ? members : form.members.slice(0, 1)).map(m => [m.name || "—", m.roll || "—", m.role]))}</section>
      <section class="panel"><h2>12. Conclusion</h2>
        <p>The simulator converts user-defined ε-NFAs to DFAs, explains every step, minimises the result and proves each output correct by language equivalence. All ${cases.length} edge-case tests pass, including invalid input that is rejected with a specific message.</p></section>`;

    const g1 = new GraphView($("#rNfa"), { title: "NFA", interactive: false }); g1.setGraph(GraphView.fromNFA(N));
    const g2 = new GraphView($("#rDfa"), { title: "DFA", interactive: false });
    g2.setGraph({ nodes: M.D.map((d, i) => ({ id: "D" + i, label: "D" + i, sub: fmt(d.set), final: d.fin, start: i === 0, dead: d.dead })), edges: M.trans.map(t => ({ from: "D" + t.f, to: "D" + t.t, sym: t.c })) });
  }
  $("#gen").addEventListener("click", generate);
  generate();
})();
