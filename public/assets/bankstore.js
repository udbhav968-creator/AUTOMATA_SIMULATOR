/*
 * BankStore — saved questions. Uses the server (data/questions.json) when it is running,
 * and this browser's storage when it is not (static hosting, server stopped).
 */
(function () {
  "use strict";
  const LOCAL = "bank.local";
  let where = null;

  async function list() {
    try { const items = await Studio.api("/api/questions", { timeout: 8000 }); where = "server"; return { items, where }; }
    catch (e) { if (!e.offline) throw e; where = "browser"; return { items: Studio.store.get(LOCAL, []), where }; }
  }

  async function save(recs) {
    recs = (Array.isArray(recs) ? recs : [recs]).map(r => QGen.cleanBank(r));
    const problems = recs.map(r => QGen.validateBank(r)).filter(p => p.length);
    if (recs.length === 1 && problems.length) { const e = new Error(problems[0].join(" ")); e.problems = problems[0]; throw e; }
    try {
      const res = await Studio.api("/api/questions", { body: recs.length === 1 ? recs[0] : { questions: recs } });
      where = "server";
      return { items: res.questions, saved: res.saved, rejected: res.rejected || [], where };
    } catch (e) {
      if (!e.offline) throw e;
      where = "browser";
      const items = Studio.store.get(LOCAL, []), saved = [], rejected = [];
      recs.forEach(r => {
        const p = QGen.validateBank(r);
        if (p.length) { rejected.push({ text: r.text.slice(0, 60), problems: p }); return; }
        const i = items.findIndex(x => x.id === r.id);
        if (i >= 0) items[i] = r; else items.push(r);
        saved.push(r.id);
      });
      if (items.length > 500) throw new Error("This browser's question bank is full (500 questions).");
      if (!Studio.store.set(LOCAL, items)) throw new Error("This browser would not save the question (storage full or disabled).");
      return { items, saved, rejected, where };
    }
  }

  async function remove(id) {
    try { const res = await Studio.api("/api/questions?id=" + encodeURIComponent(id), { method: "DELETE" }); where = "server"; return res.questions; }
    catch (e) {
      if (!e.offline) throw e;
      where = "browser";
      const items = Studio.store.get(LOCAL, []).filter(x => x.id !== id);
      Studio.store.set(LOCAL, items);
      return items;
    }
  }

  window.BankStore = { list, save, remove, get where() { return where; } };
})();
