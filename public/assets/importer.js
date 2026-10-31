/*
 * Importer — bring in ready-made questions by typing/pasting them or uploading a PDF.
 *   Importer.mount(host, { mode: "practice" | "bank", onPractise(question), onEdit(record), onSaved(items) })
 * Reading order: Gemini (if switched on and available) → built-in extractor (lib/extract.js).
 * PDFs are read in the browser with pdf.js; scanned PDFs need Gemini.
 */
(function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAX_PDF = 15 * 1024 * 1024, MAX_PAGES = 40;
  const SAMPLE = "Q1. Convert the following NFA into an equivalent DFA. (5 marks)\nδ      a        b\n→q0  {q0,q1}   {q0}\nq1     ∅       {q2}\n*q2    ∅        ∅\n\nQ2. Design a DFA over {a,b} that accepts all strings ending with abb.\n\nQ3. Check whether the strings abab, aab and ba are accepted by the NFA above.";

  let pdfjs = null;
  async function loadPdfJs() {
    if (pdfjs) return pdfjs;
    pdfjs = await import(new URL("vendor/pdfjs/pdf.min.mjs", location.href).href);
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs/pdf.worker.min.mjs", location.href).href;
    return pdfjs;
  }

  /** Read the text of a PDF, rebuilding lines and keeping column gaps (so transition tables survive). */
  async function pdfText(buf, onProgress) {
    const lib = await loadPdfJs();
    let doc;
    try { doc = await lib.getDocument({ data: buf, cMapUrl: new URL("vendor/pdfjs/cmaps/", location.href).href, cMapPacked: true, isEvalSupported: false }).promise; }
    catch (e) { throw new Error(/password/i.test(e.message || e.name) ? "This PDF is password-protected. Remove the password and try again." : "This file could not be read as a PDF: " + (e.message || e)); }
    const pages = Math.min(doc.numPages, MAX_PAGES), out = [];
    for (let p = 1; p <= pages; p++) {
      onProgress && onProgress(p, pages);
      const page = await doc.getPage(p), tc = await page.getTextContent();
      const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || 10;
        let row = rows.find(r => Math.abs(r.y - y) < h * 0.45);
        if (!row) { row = { y, h, items: [] }; rows.push(row); }
        row.items.push({ x, w: it.width || it.str.length * h * 0.5, s: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.items.sort((a, b) => a.x - b.x);
        let line = "", end = null;
        for (const it of r.items) {
          if (end != null) { const gap = it.x - end; line += gap > r.h * 1.2 ? "    " : gap > r.h * 0.15 ? " " : ""; }
          line += it.s; end = it.x + it.w;
        }
        out.push(line.replace(/\s+$/, ""));
      }
      out.push("");
    }
    if (doc.numPages > MAX_PAGES) out.push(`[Only the first ${MAX_PAGES} of ${doc.numPages} pages were read.]`);
    return out.join("\n");
  }

  const toBase64 = buf => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(new Error("The file could not be read.")); r.readAsDataURL(new Blob([buf])); });

  function mount(host, opts) {
    opts = Object.assign({ mode: "bank" }, opts || {});
    let drafts = [], file = null;
    host.innerHTML = `
      <div class="seg" role="tablist" style="margin-bottom:10px">
        <button type="button" role="tab" data-src="text" aria-selected="true">Type or paste</button>
        <button type="button" role="tab" data-src="pdf" aria-selected="false">Upload a PDF</button>
      </div>
      <div data-pane-src="text">
        <textarea class="imp-text code" rows="9" spellcheck="false" placeholder="Paste questions from a question paper, tutorial sheet or book, or type your own. Number them Q1, Q2 … or 1., 2. …&#10;Automata can be written as text lines, δ(q0,a) = {q1}, or a transition table."></textarea>
        <div class="row" style="margin-top:6px"><button class="btn sm quiet" data-a="sample">Show an example</button><span class="hint">Tables: a header row of symbols, then one row per state; mark the start with → and finals with *.</span></div>
      </div>
      <div data-pane-src="pdf" hidden>
        <label class="btn" style="cursor:pointer">Choose PDF<input type="file" class="imp-file" accept="application/pdf,.pdf" hidden></label>
        <span class="small imp-file-name muted" style="margin-left:8px">No file chosen (up to 15 MB, ${MAX_PAGES} pages)</span>
        <p class="hint" style="margin:8px 0 0">The text is read in your browser. Scanned (photographed) papers have no text layer, so they need Gemini.</p>
      </div>
      <label class="check" style="margin-top:12px"><input type="checkbox" class="imp-ai"> <span class="imp-ai-label">Let Gemini read it (best for diagrams, scans and unusual layouts)</span></label>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-a="go">Find questions</button><span class="small muted imp-status" aria-live="polite"></span></div>
      <div class="imp-out" style="margin-top:14px"></div>`;
    const $ = s => host.querySelector(s);
    let mode = "text";

    Studio.health().then(h => {
      const ok = h && !h.down && h.ai;
      $(".imp-ai").checked = ok; $(".imp-ai").disabled = !ok;
      if (!ok) $(".imp-ai-label").textContent = h && h.down ? "Gemini is unavailable (server offline) — the built-in extractor will be used" : "Gemini is not set up — the built-in extractor will be used";
    });

    host.addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.src) {
        mode = b.dataset.src;
        host.querySelectorAll("[data-src]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
        host.querySelectorAll("[data-pane-src]").forEach(p => (p.hidden = p.dataset.paneSrc !== mode));
      }
      if (b.dataset.a === "sample") { $(".imp-text").value = SAMPLE; }
      if (b.dataset.a === "go") run();
      const i = +b.dataset.i, d = drafts[i];
      if (!d) return;
      if (b.dataset.act === "practise") opts.onPractise && opts.onPractise(QGen.fromBank(d.rec));
      if (b.dataset.act === "edit") opts.onEdit && opts.onEdit(d.rec);
      if (b.dataset.act === "fixbank") Studio.handoff("bank.html", { draft: d.rec });
      if (b.dataset.act === "remove") { drafts.splice(i, 1); paint(); }
      if (b.dataset.act === "save") save([i]);
    });
    $(".imp-file").addEventListener("change", e => {
      file = e.target.files[0] || null;
      $(".imp-file-name").textContent = file ? `${file.name} (${(file.size / 1048576).toFixed(1)} MB)` : "No file chosen";
    });

    const status = t => ($(".imp-status").textContent = t || "");

    async function run() {
      const go = host.querySelector("[data-a=go]");
      go.disabled = true;
      drafts = []; paint();
      try {
        const useAI = $(".imp-ai").checked && !$(".imp-ai").disabled;
        let text = "", pdfB64 = null;
        if (mode === "pdf") {
          if (!file) throw new Error("Choose a PDF first.");
          if (file.size > MAX_PDF) throw new Error("That PDF is larger than 15 MB. Split it or upload fewer pages.");
          const buf = await file.arrayBuffer();
          const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
          if (head !== "%PDF-") throw new Error("That file is not a PDF.");
          if (useAI) pdfB64 = await toBase64(buf);
          else {
            status("Reading the PDF…");
            text = await pdfText(buf, (p, n) => status(`Reading page ${p} of ${n}…`));
          }
        } else {
          text = $(".imp-text").value;
          if (text.trim().length < 5) throw new Error("Type or paste at least one question.");
          if (text.length > 60000) throw new Error("That is more than 60,000 characters. Paste fewer questions at a time.");
        }
        let note = "";
        if (useAI) {
          status("Gemini is reading it…");
          try {
            const res = await Studio.api("/api/ai/extract", { body: pdfB64 ? { pdf: pdfB64, name: file.name } : { text }, timeout: 120000 });
            if (res.offline) note = "Gemini unavailable (" + (res.message || res.reason) + ") — used the built-in extractor.";
            else { drafts = res.drafts; note = `Gemini (${res.model}) read it; every question was checked by the engine.`; }
          } catch (err) { note = (err.offline ? "Server offline" : err.message) + " — used the built-in extractor."; }
          if (!drafts.length && pdfB64) { status("Reading the PDF…"); text = await pdfText(await file.arrayBuffer(), (p, n) => status(`Reading page ${p} of ${n}…`)); }
        }
        if (!drafts.length) {
          if (mode === "pdf" && text.replace(/\s/g, "").length < 30) throw new Error("This PDF has no selectable text (it may be a scan). Switch on Gemini, or type the questions.");
          if (mode === "pdf") $(".imp-text").value = text;
          drafts = Extract.extract(text);
          if (mode === "pdf") note = (note ? note + " " : "") + "The PDF text is also in the “Type or paste” box, so you can correct it and run again.";
        }
        status(note || `Found ${drafts.length} question${drafts.length === 1 ? "" : "s"}.`);
        if (!drafts.length) throw new Error("No questions found. Number them (Q1, Q2 … or 1., 2. …) and include the automaton as text or a table.");
        paint();
      } catch (err) {
        status("");
        $(".imp-out").innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
      } finally { go.disabled = false; }
    }

    function paint() {
      if (!drafts.length) { $(".imp-out").innerHTML = ""; return; }
      const ready = drafts.filter(d => d.ready).length;
      $(".imp-out").innerHTML = `<div class="row between" style="margin-bottom:8px"><b>${drafts.length} question${drafts.length === 1 ? "" : "s"} found · ${ready} ready</b>${ready ? `<button class="btn sm" data-a="saveall">Save ${ready} ready question${ready === 1 ? "" : "s"} to the bank</button>` : ""}</div>
        <div class="stack">${drafts.map((d, i) => {
          const r = d.rec, T = QGen.TYPES[r.type] || {};
          const auto = r.src || r.reference;
          return `<div class="panel" style="padding:12px;border-left:4px solid ${d.ready ? "var(--go)" : "var(--marker)"}">
            <div class="qmeta"><span class="pill ${d.ready ? "yes" : "neutral"}">${d.ready ? "Ready" : "Needs review"}</span><span class="tag" data-bloom="${esc(r.bloom)}">${esc(r.bloom)}</span><span class="tag">${esc(T.label || r.type)}</span><span class="tag">${esc(r.marks)} mark${r.marks == 1 ? "" : "s"}</span></div>
            <p style="margin:8px 0;white-space:pre-wrap">${esc(r.text)}</p>
            ${r.options && r.options.length ? `<ol type="a" class="small" style="margin:0 0 8px">${r.options.map((o, k) => `<li${k === r.answer ? ' style="font-weight:700"' : ""}>${esc(o)}${k === r.answer ? " ✓" : ""}</li>`).join("")}</ol>` : ""}
            ${r.strings && r.strings.length ? `<p class="small" style="margin:0 0 8px">Strings: <span class="mono">${r.strings.map(s => esc(s || "ε")).join(", ")}</span></p>` : ""}
            ${auto ? `<details class="small"><summary>${r.reference ? "Reference automaton (answer key)" : "Automaton found"}</summary><pre class="mono tiny" style="margin:6px 0;padding:8px;background:var(--sheet-2);border-radius:8px;overflow:auto">${esc(auto)}</pre></details>` : ""}
            ${(d.notes || []).map(n => `<div class="msg info small" style="margin-top:6px">${esc(n)}</div>`).join("")}
            ${(d.problems || []).length ? `<div class="msg warn small" style="margin-top:6px">${d.problems.map(esc).join(" ")}</div>` : ""}
            <div class="row" style="margin-top:8px">
              ${opts.mode === "practice" && d.ready ? `<button class="btn sm primary" data-act="practise" data-i="${i}">Practise</button>` : ""}
              ${opts.onEdit ? `<button class="btn sm${d.ready ? "" : " primary"}" data-act="edit" data-i="${i}">${d.ready ? "Edit" : "Fix in the form"}</button>` : d.ready ? "" : `<button class="btn sm primary" data-act="fixbank" data-i="${i}">Fix in the question bank</button>`}
              ${d.ready ? `<button class="btn sm" data-act="save" data-i="${i}">Save to bank</button>` : ""}
              <button class="btn sm quiet" data-act="remove" data-i="${i}">Remove</button>
            </div></div>`;
        }).join("")}</div>`;
      const all = host.querySelector("[data-a=saveall]");
      if (all) all.onclick = () => save(drafts.map((d, i) => (d.ready ? i : -1)).filter(i => i >= 0));
    }

    async function save(idx) {
      try {
        const res = await BankStore.save(idx.map(i => drafts[i].rec));
        Studio.toast(`Saved ${res.saved.length} question${res.saved.length === 1 ? "" : "s"} ${res.where === "server" ? "to the bank" : "in this browser"}.`, "ok");
        drafts = drafts.filter((_, i) => !idx.includes(i));
        paint();
        opts.onSaved && opts.onSaved(res.items);
      } catch (e) { Studio.toast(e.message, "err"); }
    }
  }

  window.Importer = { mount, pdfText };
})();
