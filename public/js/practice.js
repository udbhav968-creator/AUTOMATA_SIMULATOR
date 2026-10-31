/* Practice & timed exam page. */
(function () {
  "use strict";
  const { $, $$, esc, store } = Studio, Q = QGen;
  const BLOOM_COLOURS = { Remember: "#5a7bd8", Understand: "#3d9ac6", Apply: "#2aa57f", Analyze: "#b9a12a", Evaluate: "#e07b2c", Create: "#d4475c" };

  /* ================================================================ tabs */
  function tab(name) {
    $$("[data-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    $$("[data-pane]").forEach(p => (p.hidden = p.dataset.pane !== name));
    if (name === "history") history();
  }
  $$("[data-tab]").forEach(b => b.addEventListener("click", () => {
    if (exam && b.dataset.tab !== "exam") { Studio.toast("Finish or submit the exam first.", "err"); return; }
    tab(b.dataset.tab);
  }));

  /* ================================================================ practice */
  const typeSel = $("#pType");
  typeSel.innerHTML = '<option value="any">Any type (mixed levels)</option>' + Q.BLOOM.map(b => {
    const items = Object.entries(Q.TYPES).filter(([, t]) => t.bloom === b);
    return items.length ? `<optgroup label="${b}">${items.map(([k, t]) => `<option value="${k}">${esc(t.label)} — ${esc(t.verb)}</option>`).join("")}</optgroup>` : "";
  }).join("");
  typeSel.value = store.get("practice.type", "any");
  $("#pDiff").value = store.get("practice.diff", "Medium");

  let pq = null, pctl = null, pStart = 0, checked = false;
  const stats = store.get("practice.stats", {});

  async function newQuestion(forced) {
    let type = typeSel.value;
    const diff = $("#pDiff").value, source = $("#pSource").value;
    if (source === "own" && !forced) { tab("own"); return; }
    store.set("practice.type", type); store.set("practice.diff", diff);
    if (type === "any") { const ts = Object.keys(Q.TYPES).filter(t => t !== "short"); type = ts[Math.floor(Math.random() * ts.length)]; }
    $("#pHintBox").innerHTML = "";
    let q = forced || null;
    if (!q && source === "bank") {
      try {
        const { items, where } = await BankStore.list();
        const pool = items.map(Q.fromBank).filter(Boolean).filter(x => (typeSel.value === "any" || x.type === type));
        if (!pool.length) Studio.toast(`No ${typeSel.value === "any" ? "" : Q.TYPES[type].label.toLowerCase() + " "}questions in the bank${where === "browser" ? " in this browser" : ""} yet — generating one instead.`);
        else q = pool[Math.floor(Math.random() * pool.length)];
      } catch (e) { Studio.toast(e.message, "err"); }
    }
    if (!q && source === "ai") {
      $("#pCard").innerHTML = '<p class="muted">Asking Gemini for a question, then checking it with the engine…</p>';
      const bankType = Q.BANK_TYPES.includes(type) ? type : "construct";
      try {
        const res = await Studio.api("/api/ai/question", { body: { type: bankType, difficulty: diff }, timeout: 60000 });
        if (res.offline) Studio.toast((res.reason === "no-key" ? "Gemini is not set up on the server" : "Gemini unavailable") + " — generated locally instead.");
        else { q = Q.fromBank(res.question); if (q && bankType !== type) Studio.toast("Gemini writes bank-style questions; this type was swapped for “Convert NFA to DFA”."); }
      } catch (e) { Studio.toast((e.offline ? "Server offline" : e.message) + " — generated locally instead."); }
    }
    if (!q) q = Q.makeQuestion(type, { difficulty: diff });
    show(q);
  }

  function show(q) {
    pq = q; checked = false; pStart = Date.now();
    pctl = QView.render(q, $("#pCard"), { mode: "practice" });
    $("#pActions").hidden = false;
    $("#pOpen").hidden = !q.src;
    $("#pSol").disabled = false;
  }

  function record(score) {
    const s = stats[pq.type] || { n: 0, sum: 0 };
    s.n++; s.sum += score; stats[pq.type] = s;
    store.set("practice.stats", stats);
    paintStats();
  }
  function paintStats() {
    const all = Object.values(stats), n = all.reduce((a, s) => a + s.n, 0), sum = all.reduce((a, s) => a + s.sum, 0);
    const streak = store.get("practice.streak", 0);
    $("#pStats").innerHTML = [[n, "answered"], [n ? Math.round(sum / n * 100) + "%" : "—", "average score"], [streak, "correct in a row"]].map(s => `<div class="stat"><b>${s[0]}</b><span>${s[1]}</span></div>`).join("");
  }

  $("#pNew").addEventListener("click", () => newQuestion());
  $("#pNext").addEventListener("click", () => newQuestion());
  $("#pCheck").addEventListener("click", () => {
    if (!pq) return;
    const res = Q.grade(pq, pctl.collect());
    pctl.feedback(res, { solution: res.score < 1 && !res.manual });
    if (res.manual && pctl.collect().self == null) return;
    if (!checked) {
      record(res.score);
      store.set("practice.streak", res.correct ? store.get("practice.streak", 0) + 1 : 0);
      paintStats();
      checked = true;
    }
  });
  $("#pHint").addEventListener("click", () => { if (pq) $("#pHintBox").innerHTML = `<div class="msg info"><b>Hint.</b> ${esc(Q.hint(pq))}</div>`; });
  $("#pSol").addEventListener("click", () => {
    if (!pq) return;
    if (pq.type === "short") { pctl.showModel(); return; }
    const res = Q.grade(pq, pctl.collect());
    pctl.feedback(res, { solution: true });
    if (!checked) { record(0); store.set("practice.streak", 0); paintStats(); checked = true; }
  });
  $("#pAsk").addEventListener("click", () => window.Tutor && window.Tutor.open("Give me a hint for this question without giving away the answer."));
  $("#pOpen").addEventListener("click", () => {
    if (!pq || !pq.src) return;
    const page = pq.type === "accept" ? "run.html" : pq.type === "classes" ? "minimize.html" : "subset.html";
    Studio.handoff(page, { src: pq.src });
  });
  setInterval(() => { if (pq && !$("[data-pane=practice]").hidden) { const s = Math.floor((Date.now() - pStart) / 1000); $("#pClock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; } }, 1000);

  /* ================================================================ exam */
  let exam = null, ectl = null, timerId = null;
  const warned = new Set();
  $("#eBloom").innerHTML = Q.BLOOM.map(b => `<label class="check"><input type="checkbox" value="${b}" checked> <span class="tag" data-bloom="${b}">${b}</span></label>`).join("");

  async function startExam() {
    const count = Math.min(25, Math.max(3, +$("#eCount").value || 10));
    const minutes = Math.min(180, Math.max(2, +$("#eMin").value || 30));
    const blooms = $$("#eBloom input:checked").map(i => i.value);
    if (!blooms.length) { Studio.toast("Choose at least one Bloom level.", "err"); return; }
    let bank = [];
    if ($("#eBank").checked) { try { bank = (await BankStore.list()).items; } catch (e) { /* ignore */ } }
    const questions = Q.makeExam({ count, difficulty: $("#eDiff").value, blooms, bank, seed: Date.now() });
    if (!questions.length) { Studio.toast("No questions match these settings.", "err"); return; }
    exam = { questions, answers: {}, flags: {}, current: 0, startedAt: Date.now(), durationMs: minutes * 60000, settings: { count, minutes, difficulty: $("#eDiff").value, blooms } };
    saveExam();
    runExam();
  }
  function saveExam() { if (exam) store.set("exam.current", exam); }

  function runExam() {
    $("#examSetup").hidden = true; $("#examResult").hidden = true; $("#examRun").hidden = false;
    tab("exam");
    warned.clear();
    renderExamQuestion();
    clearInterval(timerId);
    timerId = setInterval(tickExam, 250);
    tickExam();
  }
  function remaining() { return exam.startedAt + exam.durationMs - Date.now(); }
  function tickExam() {
    if (!exam) return;
    const ms = remaining();
    if (ms <= 0) { submitExam(true); return; }
    const s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
    $("#eTimer").textContent = `${m}:${String(s % 60).padStart(2, "0")}`;
    $("#eTimer").classList.toggle("low", ms <= 60000);
    for (const [lim, txt] of [[300000, "5 minutes left."], [60000, "1 minute left — your answers are saved."]]) if (ms <= lim && !warned.has(lim) && exam.durationMs > lim) { warned.add(lim); Studio.toast(txt); }
  }
  function storeAnswer() { if (exam && ectl) { exam.answers[exam.questions[exam.current].id] = ectl.collect(); saveExam(); paintNav(); } }
  function answered(q) {
    const r = exam.answers[q.id]; if (!r) return false;
    switch (q.type) {
      case "mcq": return r.index != null; case "tf": return r.value != null;
      case "accept": return (r.values || []).some(v => v != null);
      case "table": return (r.cells || []).flat().some(v => v && v.trim());
      case "evaluate": return r.verdict != null;
      case "count": return String(r.value || "").trim() !== "";
      case "short": return !!(r.answer || "").trim();
      default: return !!(r.text || "").trim();
    }
  }
  function paintNav() {
    $("#eNav").innerHTML = exam.questions.map((q, i) => `<button type="button" data-go="${i}" class="${answered(q) ? "done" : ""} ${i === exam.current ? "here" : ""} ${exam.flags[q.id] ? "flag" : ""}" aria-label="Question ${i + 1}${answered(q) ? ", answered" : ""}${exam.flags[q.id] ? ", flagged" : ""}">${i + 1}</button>`).join("");
    const n = exam.questions.filter(answered).length;
    $("#eProgress").textContent = `${n} / ${exam.questions.length}`;
    $("#eFlag").textContent = exam.flags[exam.questions[exam.current].id] ? "Remove flag" : "Flag for review";
    $("#ePrev").disabled = exam.current === 0; $("#eNext").disabled = exam.current === exam.questions.length - 1;
  }
  function renderExamQuestion() {
    const q = exam.questions[exam.current];
    $("#eCard").innerHTML = `<div class="tiny muted" style="margin-bottom:8px">Question ${exam.current + 1} of ${exam.questions.length}</div><div id="eQ"></div>`;
    ectl = QView.render(q, $("#eQ"), { mode: "exam", response: exam.answers[q.id], onChange: Studio.debounce(storeAnswer, 200) });
    paintNav();
  }
  function go(i) { storeAnswer(); exam.current = Math.max(0, Math.min(exam.questions.length - 1, i)); saveExam(); renderExamQuestion(); window.scrollTo({ top: 0, behavior: "smooth" }); }

  async function submitExam(auto) {
    if (!exam) return;
    storeAnswer();
    if (!auto) {
      const left = exam.questions.filter(q => !answered(q)).length;
      const ok = await Studio.confirmBox("Submit the exam?", left ? `${left} question${left > 1 ? "s are" : " is"} unanswered and will score zero.` : "All questions are answered. You cannot change answers after submitting.", "Submit");
      if (!ok || !exam) return;
    }
    clearInterval(timerId);
    const done = exam; exam = null; store.del("exam.current");
    const used = Math.min(done.durationMs, Date.now() - done.startedAt);
    const rows = done.questions.map(q => ({ q, r: done.answers[q.id] || {}, g: Q.grade(q, done.answers[q.id] || {}) }));
    const total = rows.reduce((a, x) => a + x.q.marks, 0), got = rows.reduce((a, x) => a + x.q.marks * x.g.score, 0);
    const byBloom = {};
    rows.forEach(x => { const b = byBloom[x.q.bloom] = byBloom[x.q.bloom] || { got: 0, total: 0 }; b.got += x.q.marks * x.g.score; b.total += x.q.marks; });
    const byLO = {};
    rows.forEach(x => { const b = byLO[x.q.lo] = byLO[x.q.lo] || { got: 0, total: 0 }; b.got += x.q.marks * x.g.score; b.total += x.q.marks; });
    const hist = store.get("exam.history", []);
    hist.unshift({ at: Date.now(), got: Math.round(got * 10) / 10, total, count: rows.length, usedMs: used, auto: !!auto, byBloom });
    store.set("exam.history", hist.slice(0, 20));
    showResult(rows, got, total, used, byBloom, byLO, auto);
  }

  function showResult(rows, got, total, used, byBloom, byLO, auto) {
    $("#examRun").hidden = true; $("#examResult").hidden = false;
    const pct = total ? Math.round(got / total * 100) : 0, mm = Math.floor(used / 60000), ss = Math.round((used % 60000) / 1000);
    const bars = Q.BLOOM.filter(b => byBloom[b]).map(b => { const x = byBloom[b], p = Math.round(x.got / x.total * 100); return `<div class="bar-row"><span class="tag" data-bloom="${b}">${b}</span><div class="bar-track"><div class="bar-fill" style="width:${p}%;--b:${BLOOM_COLOURS[b]}"></div></div><span class="small">${round(x.got)}/${x.total}</span></div>`; }).join("");
    const los = Object.keys(byLO).sort().map(k => `<tr><td><b>${k}</b></td><td class="wrap small">${esc(Q.OUTCOMES[k])}</td><td>${round(byLO[k].got)} / ${byLO[k].total}</td></tr>`).join("");
    const review = rows.map((x, i) => {
      const cls = x.g.score >= 0.999 ? "good" : x.g.score > 0 ? "part" : "bad";
      const exp = Q.explain(x.q);
      return `<div class="panel"><div class="row between"><b>Question ${i + 1}</b><span class="small">${round(x.q.marks * x.g.score)} / ${x.q.marks}</span></div>
        <div class="qmeta" style="margin:6px 0"><span class="tag" data-bloom="${x.q.bloom}">${x.q.bloom}</span><span class="tag">${esc(x.q.lo)}</span><span class="tag">${esc(Q.TYPES[x.q.type].label)}</span></div>
        <p style="margin:4px 0">${esc(x.q.prompt)}</p>
        <p class="small" style="margin:4px 0"><span class="muted">Your answer:</span> <span class="mono">${esc(QView.summary(x.q, x.r))}</span></p>
        <div class="feedback ${cls}" style="margin-top:6px">${esc(x.g.feedback)}${exp ? `<div class="mono small" style="white-space:pre-wrap;margin-top:6px">${esc(exp)}</div>` : ""}</div>
        ${x.q.src ? `<button class="btn sm quiet" data-review-src="${i}" style="margin-top:6px">Open this automaton in the simulator</button>` : ""}</div>`;
    }).join("");
    $("#examResult").innerHTML = `<div class="panel"><div class="row between"><div><h2 style="margin:0">Result${auto ? " (submitted automatically when time ran out)" : ""}</h2><p class="muted" style="margin:4px 0 0">Time used ${mm}:${String(ss).padStart(2, "0")} · ${rows.length} questions</p></div>
        <div style="text-align:right"><div class="timer-big">${round(got)} / ${total}</div><div class="muted">${pct}%</div></div></div>
        <h3>By Bloom's level</h3><div class="bars">${bars}</div>
        <h3>By learning outcome</h3><div class="table-wrap"><table class="data"><tbody>${los}</tbody></table></div>
        <div class="row" style="margin-top:14px"><button class="btn primary" id="eAgain">New exam</button><button class="btn" id="ePrint">Print result</button></div></div>
      <h2 class="section-title" style="margin-top:20px">Review</h2>${review}`;
    $("#eAgain").onclick = () => { $("#examResult").hidden = true; $("#examSetup").hidden = false; };
    $("#ePrint").onclick = () => print();
    $("#examResult").onclick = e => { const b = e.target.closest("[data-review-src]"); if (b) Studio.handoff("subset.html", { src: rows[+b.dataset.reviewSrc].q.src }); };
    window.scrollTo({ top: 0 });
  }
  const round = v => Math.round(v * 10) / 10;

  $("#eStart").addEventListener("click", startExam);
  $("#eSubmit").addEventListener("click", () => submitExam(false));
  $("#ePrev").addEventListener("click", () => go(exam.current - 1));
  $("#eNext").addEventListener("click", () => go(exam.current + 1));
  $("#eNav").addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) go(+b.dataset.go); });
  $("#eFlag").addEventListener("click", () => { const id = exam.questions[exam.current].id; exam.flags[id] = !exam.flags[id]; saveExam(); paintNav(); });
  window.addEventListener("beforeunload", e => { if (exam) { storeAnswer(); e.preventDefault(); e.returnValue = ""; } });

  /* ================================================================ history */
  function history() {
    const h = store.get("exam.history", []);
    $("#hExams").innerHTML = h.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Score</th><th>%</th><th>Questions</th><th>Time</th><th>Weakest level</th></tr></thead><tbody>${h.map(x => {
      const weak = Object.entries(x.byBloom || {}).sort((a, b) => a[1].got / a[1].total - b[1].got / b[1].total)[0];
      return `<tr><td>${new Date(x.at).toLocaleString()}</td><td>${x.got} / ${x.total}</td><td>${Math.round(x.got / x.total * 100)}%</td><td>${x.count}</td><td>${Math.round(x.usedMs / 60000)} min${x.auto ? " (auto)" : ""}</td><td>${weak ? `<span class="tag" data-bloom="${weak[0]}">${weak[0]}</span>` : "—"}</td></tr>`;
    }).join("")}</tbody></table></div>` : '<p class="muted">No exams yet. Start one from the Timed exam tab.</p>';
    const rows = Object.entries(stats);
    $("#hTypes").innerHTML = rows.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Type</th><th>Bloom's level</th><th>Answered</th><th>Average</th></tr></thead><tbody>${rows.map(([t, s]) => `<tr><td>${esc(Q.TYPES[t] ? Q.TYPES[t].label : t)}</td><td><span class="tag" data-bloom="${Q.TYPES[t] ? Q.TYPES[t].bloom : ""}">${Q.TYPES[t] ? Q.TYPES[t].bloom : ""}</span></td><td>${s.n}</td><td>${Math.round(s.sum / s.n * 100)}%</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">Nothing practised yet.</p>';
  }
  $("#hClear").addEventListener("click", async () => {
    if (!(await Studio.confirmBox("Clear history?", "This removes past exam results and practice statistics from this browser.", "Clear"))) return;
    store.del("exam.history"); store.del("practice.stats"); store.del("practice.streak");
    Object.keys(stats).forEach(k => delete stats[k]); history(); paintStats();
  });

  /* ================================================================ tutor context and start-up */
  Studio.context = () => exam
    ? { page: "Timed exam", exam: true }
    : { page: "Practice", question: pq ? pq.prompt + (pq.src ? "\nAutomaton:\n" + pq.src : "") + (pq.data && pq.data.strings ? "\nStrings: " + pq.data.strings.join(", ") : "") : "", questionObj: pq, answer: pctl ? JSON.stringify(pctl.collect()).slice(0, 800) : "", automaton: pq && pq.src };
  Studio.chatChips = ["Give me a hint", "Why is my answer wrong?", "Explain the Bloom level of this question"];
  paintStats();
  Importer.mount($("#importHost"), { mode: "practice", onPractise: q => { tab("practice"); show(q); window.scrollTo({ top: 0, behavior: "smooth" }); } });

  const saved = store.get("exam.current", null);
  const h = Studio.takeHandoff("practice.html");
  if (saved && saved.questions && saved.questions.length) {
    exam = saved;
    if (remaining() <= 0) { Studio.toast("Time ran out while you were away; the exam was submitted automatically."); submitExam(true); tab("exam"); }
    else { Studio.toast("Your exam is still running — picked up where you left off."); runExam(); }
  } else if (h && h.question) { tab("practice"); show(h.question); }
  else if (h && h.practise) { typeSel.value = h.practise.type; newQuestion(); }
  else newQuestion();
})();
