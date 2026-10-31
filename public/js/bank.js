/* Question bank: write, review, save, import and export questions. */
(function () {
  "use strict";
  const { $, $$, esc } = Studio, Q = QGen, A = Automata;
  const VERBS = { Remember: "Define, List, Identify, State, Name", Understand: "Explain, Describe, Classify, Summarise", Apply: "Compute, Trace, Apply, Construct, Simulate", Analyze: "Determine, Distinguish, Compare, Examine", Evaluate: "Justify, Judge, Verify, Critique", Create: "Design, Construct, Develop, Formulate" };
  let items = [], editing = null, tfValue = true, ready = false;

  $("#type").innerHTML = Q.BANK_TYPES.map(t => `<option value="${t}">${esc(Q.TYPES[t].label)}</option>`).join("");
  $("#bloom").innerHTML = Q.BLOOM.map(b => `<option>${b}</option>`).join("");
  $("#lo").innerHTML = Object.keys(Q.OUTCOMES).map(k => `<option value="${k}" title="${esc(Q.OUTCOMES[k])}">${k}</option>`).join("");
  $("#fBloom").innerHTML += Q.BLOOM.map(b => `<option>${b}</option>`).join("");

  const autoEd = new AutomatonInput($("#autoEd"), { kind: "nfa", runLabel: "Check automaton", onRun: () => ready && refresh(), onChange: () => ready && refresh(), rows: 8 });
  const refEd = new AutomatonInput($("#refEd"), { kind: "nfa", runLabel: "Check automaton", onRun: () => ready && refresh(), onChange: () => ready && refresh(), rows: 8, examples: Q.LANGS.map(l => ({ name: l.d, src: l.ref })) });

  function setOptions(list, answer) {
    list = list && list.length ? list : ["", "", "", ""];
    $("#opts").innerHTML = list.map((o, i) => `<div class="row"><input type="radio" name="right" value="${i}"${i === answer ? " checked" : ""} aria-label="Option ${i + 1} is correct"><input class="opt" value="${esc(o)}" placeholder="Option ${i + 1}" style="flex:1"><button class="btn sm quiet" data-del-opt="${i}" aria-label="Remove option ${i + 1}">✕</button></div>`).join("");
  }
  function getOptions() { return $$("#opts .opt").map(i => i.value); }

  function showFields() {
    const t = $("#type").value;
    $$("[data-for]").forEach(el => (el.hidden = !el.dataset.for.split(" ").includes(t)));
    $("#verbHint").textContent = "Action verbs for " + $("#bloom").value + ": " + VERBS[$("#bloom").value] + ".";
  }

  function record() {
    const t = $("#type").value;
    const rec = { id: editing || undefined, type: t, text: $("#text").value, bloom: $("#bloom").value, lo: $("#lo").value, difficulty: $("#diff").value, marks: +$("#marks").value, author: $("#author").value };
    if (["construct", "accept", "closure", "count"].includes(t)) rec.src = autoEd.getText();
    if (t === "design") { rec.reference = refEd.getText(); rec.requireDFA = $("#reqDfa").checked; }
    if (t === "accept") rec.strings = $("#strings").value.split(/\r?\n/).map(s => s.trim()).filter((s, i, a) => s || i < a.length - 1).map(s => (s === "ε" ? "" : s));
    if (t === "closure") rec.state = $("#state").value;
    if (t === "count") rec.what = $("#what").value;
    if (t === "mcq") { const c = $("#opts input[type=radio]:checked"); const opts = getOptions(); rec.options = opts; rec.answer = c && (opts[+c.value] || "").trim() ? opts.slice(0, +c.value).filter(x => x.trim()).length : -1; rec.explanation = $("#expl").value; }
    if (t === "tf") { rec.answer = tfValue; rec.explanation = $("#expl").value; }
    if (t === "short") rec.model = $("#model").value;
    return rec;
  }

  function refresh() {
    const t = $("#type").value;
    if (t === "closure") {
      const N = autoEd.lastValid, cur = $("#state").value;
      $("#state").innerHTML = N ? N.states.map(s => `<option${s === cur ? " selected" : ""}>${esc(s)}</option>`).join("") : "<option value=''>Fix the automaton first</option>";
    }
    const rec = Q.cleanBank(record()), problems = Q.validateBank(rec);
    $("#errors").innerHTML = problems.length ? `<div class="msg warn"><b>Before saving:</b><ul>${problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : "";
    if (problems.length) { $("#key").innerHTML = '<span class="muted">The key appears when the question is complete.</span>'; return; }
    const q = Q.fromBank(rec);
    let key = Q.explain(q);
    if (t === "construct") { const N = A.parse(rec.src), M = A.build(N); key = `The DFA has ${M.D.length} states (${A.minimize(N, M)} after minimising). Any equivalent DFA is accepted.\n` + key; }
    if (t === "design") { const N = A.parse(rec.reference); const words = A.properties(N).words.slice(0, 8); key = `Students' automata are compared with your reference by language equivalence. Shortest accepted strings: ${words.join(", ") || "none"}.`; }
    if (t === "short") key = "Self-marked against your model answer.";
    $("#key").innerHTML = `<pre class="mono" style="white-space:pre-wrap;margin:0">${esc(key)}</pre>`;
  }

  function fill(rec) {
    editing = rec.id && items.some(x => x.id === rec.id) ? rec.id : null;
    $("#formTitle").textContent = editing ? "Edit question" : "New question";
    $("#saveCopy").hidden = !editing;
    $("#type").value = rec.type || "construct";
    $("#bloom").value = rec.bloom || Q.TYPES[$("#type").value].bloom;
    $("#lo").value = rec.lo || Q.TYPES[$("#type").value].lo;
    $("#diff").value = rec.difficulty || "Medium";
    $("#marks").value = rec.marks || 5;
    $("#author").value = rec.author || Studio.store.get("bank.author", "");
    $("#text").value = rec.text || "";
    if (rec.src) autoEd.setText(rec.src);
    if (rec.reference) refEd.setText(rec.reference);
    $("#reqDfa").checked = rec.requireDFA !== false;
    $("#strings").value = (rec.strings || []).map(s => s || "ε").join("\n");
    $("#what").value = rec.what || "dfa";
    setOptions(rec.options, rec.type === "mcq" ? rec.answer : 0);
    tfValue = rec.type === "tf" ? !!rec.answer : true;
    $$("#tfSeg button").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.v === "true") === tfValue)));
    $("#expl").value = rec.explanation || "";
    $("#model").value = rec.model || "";
    showFields();
    refresh();
    if (rec.state) { $("#state").value = rec.state; refresh(); }
  }

  function blank() { fill({ type: $("#type").value || "construct" }); }

  /* ---------------------------------------------------------------- library */
  async function load() {
    try {
      const res = await BankStore.list();
      items = res.items;
      $("#where").textContent = res.where === "server" ? "saved on the server" : "saved in this browser (server offline)";
    } catch (e) { $("#where").textContent = ""; Studio.toast(e.message, "err"); }
    paint();
  }
  function paint() {
    const term = $("#q").value.trim().toLowerCase(), lvl = $("#fBloom").value;
    const shown = items.filter(x => (!lvl || x.bloom === lvl) && (!term || (x.text + " " + x.type + " " + (x.author || "")).toLowerCase().includes(term)));
    $("#list").innerHTML = shown.length ? shown.slice().reverse().map(x => `<div class="panel" style="padding:12px">
        <div class="qmeta"><span class="tag" data-bloom="${esc(x.bloom)}">${esc(x.bloom)}</span><span class="tag">${esc(Q.TYPES[x.type] ? Q.TYPES[x.type].label : x.type)}</span><span class="tag">${esc(x.difficulty)}</span><span class="tag">${esc(x.marks)} marks</span>${x.origin === "ai" ? '<span class="tag">Gemini draft</span>' : ""}</div>
        <p class="small" style="margin:8px 0">${esc(x.text.length > 180 ? x.text.slice(0, 177) + "…" : x.text)}</p>
        <div class="row"><button class="btn sm" data-edit="${esc(x.id)}">Edit</button><button class="btn sm" data-try="${esc(x.id)}">Try</button><button class="btn sm quiet" data-dup="${esc(x.id)}">Duplicate</button><button class="btn sm quiet danger" data-del="${esc(x.id)}">Delete</button></div></div>`).join("")
      : `<p class="muted small">${items.length ? "No question matches the filter." : "No saved questions yet. Write one on the left, or draft one with Gemini."}</p>`;
  }

  async function save(asCopy) {
    const rec = record();
    if (asCopy) delete rec.id;
    Studio.store.set("bank.author", rec.author || "");
    try {
      const res = await BankStore.save(rec);
      items = res.items;
      const id = res.saved[0];
      Studio.toast(asCopy ? "Saved as a copy." : editing ? "Question updated." : "Question saved.", "ok");
      editing = id; $("#formTitle").textContent = "Edit question"; $("#saveCopy").hidden = false;
      $("#where").textContent = res.where === "server" ? "saved on the server" : "saved in this browser (server offline)";
      paint();
    } catch (e) { Studio.toast(e.message, "err"); }
  }

  /* ---------------------------------------------------------------- AI draft */
  async function aiDraft() {
    const type = $("#type").value, difficulty = $("#aiDiff").value, btn = $("#aiGo");
    btn.disabled = true; btn.textContent = "Drafting…";
    let rec = null, note = "";
    try {
      const res = await Studio.api("/api/ai/question", { body: { type, difficulty, topic: $("#aiTopic").value }, timeout: 60000 });
      if (res.offline) note = (res.reason === "no-key" ? "Gemini is not set up on the server" : "Gemini unavailable: " + (res.message || res.reason)) + ". The simulator drafted this one instead.";
      else rec = res.question;
    } catch (e) { note = (e.offline ? "Server offline" : e.message) + ". The simulator drafted this one instead."; }
    if (!rec) {
      const q = Q.makeQuestion(type === "short" ? "short" : type, { difficulty });
      rec = { type, text: q.prompt, difficulty, marks: q.marks, bloom: q.bloom, lo: q.lo, src: q.src, origin: "ai" };
      if (type === "design") { rec.reference = q.data.reference; rec.requireDFA = q.data.requireDFA; }
      if (type === "accept") rec.strings = q.data.strings;
      if (type === "closure") rec.state = q.data.state;
      if (type === "count") rec.what = q.data.what;
      if (type === "mcq") { rec.options = q.data.options; rec.answer = q.key.index; rec.explanation = q.explanation; }
      if (type === "tf") { rec.answer = q.key.value; rec.explanation = q.explanation || ""; }
      if (type === "short") rec.model = q.data.model;
    }
    editing = null;
    fill(rec);
    btn.disabled = false; btn.textContent = "Draft question";
    Studio.toast(note || "Draft ready. Check it, edit anything, then save.");
  }

  /* ---------------------------------------------------------------- import / export */
  $("#export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ app: "Automata Studio", exported: new Date().toISOString(), questions: items }, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "question-bank.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 500);
  });
  $("#importFile").addEventListener("change", async e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (f.size > 2e6) return Studio.toast("That file is larger than 2 MB.", "err");
    let data;
    try { data = JSON.parse(await f.text()); } catch (err) { return Studio.toast("The file is not valid JSON.", "err"); }
    const list = Array.isArray(data) ? data : Array.isArray(data.questions) ? data.questions : null;
    if (!list || !list.length) return Studio.toast("No questions found in the file.", "err");
    try {
      const res = await BankStore.save(list.slice(0, 100).map(x => ({ ...x, id: undefined })));
      items = res.items; paint();
      Studio.toast(`Imported ${res.saved.length} question${res.saved.length === 1 ? "" : "s"}${res.rejected.length ? `; ${res.rejected.length} skipped because they did not validate` : ""}.`, res.rejected.length ? "" : "ok");
    } catch (err) { Studio.toast(err.message, "err"); }
  });

  /* ---------------------------------------------------------------- wiring */
  $("#type").addEventListener("change", () => { $("#bloom").value = Q.TYPES[$("#type").value].bloom; $("#lo").value = Q.TYPES[$("#type").value].lo; showFields(); refresh(); });
  $("#bloom").addEventListener("change", showFields);
  ["#text", "#strings", "#expl", "#model", "#marks"].forEach(s => $(s).addEventListener("input", Studio.debounce(refresh, 250)));
  ["#state", "#what", "#reqDfa", "#diff", "#lo"].forEach(s => $(s).addEventListener("change", refresh));
  $("#opts").addEventListener("input", Studio.debounce(refresh, 250));
  $("#opts").addEventListener("change", refresh);
  $("#opts").addEventListener("click", e => { const b = e.target.closest("[data-del-opt]"); if (!b) return; const o = getOptions(); if (o.length <= 2) return Studio.toast("A multiple-choice question needs at least two options.", "err"); o.splice(+b.dataset.delOpt, 1); setOptions(o, 0); refresh(); });
  $("#addOpt").addEventListener("click", () => { const o = getOptions(); if (o.length >= 6) return Studio.toast("Use at most six options.", "err"); const c = $("#opts input[type=radio]:checked"); o.push(""); setOptions(o, c ? +c.value : 0); });
  $$("#tfSeg button").forEach(b => b.addEventListener("click", () => { tfValue = b.dataset.v === "true"; $$("#tfSeg button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); refresh(); }));
  $("#save").addEventListener("click", () => save(false));
  $("#saveCopy").addEventListener("click", () => save(true));
  $("#reset").addEventListener("click", () => { editing = null; fill({ type: $("#type").value }); $("#text").value = ""; refresh(); });
  $("#try").addEventListener("click", () => { const rec = Q.cleanBank(record()), p = Q.validateBank(rec); if (p.length) return Studio.toast("Complete the question first: " + p[0], "err"); Studio.handoff("practice.html", { question: Q.fromBank(rec) }); });
  $("#aiGo").addEventListener("click", aiDraft);
  $("#q").addEventListener("input", paint);
  $("#fBloom").addEventListener("change", paint);
  $("#list").addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    const id = b.dataset.edit || b.dataset.try || b.dataset.dup || b.dataset.del, rec = items.find(x => x.id === id);
    if (!rec) return;
    if (b.dataset.edit) { fill(rec); window.scrollTo({ top: 0, behavior: "smooth" }); }
    if (b.dataset.try) Studio.handoff("practice.html", { question: Q.fromBank(rec) });
    if (b.dataset.dup) { const copy = { ...rec }; delete copy.id; editing = null; fill(copy); $("#formTitle").textContent = "New question (copy)"; $("#saveCopy").hidden = true; }
    if (b.dataset.del) {
      if (!(await Studio.confirmBox("Delete this question?", rec.text.slice(0, 140), "Delete"))) return;
      try { items = await BankStore.remove(id); if (editing === id) { editing = null; $("#formTitle").textContent = "New question"; } paint(); Studio.toast("Question deleted."); }
      catch (err) { Studio.toast(err.message, "err"); }
    }
  });

  Studio.context = () => ({ page: "Question bank editor", question: $("#text").value, automaton: autoEd.getText() });
  Studio.chatChips = ["Suggest a Create-level question", "Rewrite my question with a Bloom verb", "Is my question clear?"];

  setOptions(null, 0);
  ready = true;
  const h = Studio.takeHandoff("bank.html");
  load().then(() => { if (h && h.draft) { fill(h.draft); Studio.toast("Draft loaded from the tutor. Review it, then save."); } else blank(); });
})();
