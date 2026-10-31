// Question Lab + AI tutor. Talks to the Node backend (/api/*). Reuses the simulator's globals: go(), #src.
(() => {
const $ = id => document.getElementById(id), E = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
async function api(u, m, b) { const r = await fetch(u, { method: m || "GET", headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Request failed"); return j; }
const css = document.createElement("style");
css.textContent = ".bub{padding:8px 10px;border-radius:10px;margin:6px 0;white-space:pre-wrap;font-size:13px}.me{background:var(--ac);color:#fff;margin-left:18%}.ai{background:var(--bg);margin-right:8%}#chat{max-height:340px;overflow-y:auto}.q{display:flex;gap:6px;align-items:center;border-bottom:1px solid var(--bd);padding:6px 0;font-size:13px}.q span{flex:1}.q button,.mini{padding:4px 9px;font-size:12px}pre.nfa{background:var(--card);border:1px solid var(--bd);border-radius:6px;padding:6px;overflow-x:auto;margin:6px 0}";
document.head.append(css);
const lab = document.createElement("div"); lab.className = "grid"; lab.id = "lab";
lab.innerHTML = `<div class="card"><h2>4 · Question Lab</h2>
<input id="qt" placeholder="Question text, e.g. Convert this NFA (accepts strings ending in ab) to a DFA">
<div class="small" style="margin:6px 0">The NFA in the editor above is the question. Edit it freely, then save it.</div>
<div class="row"><button id="qs">💾 Save question</button><button class="g" id="gen">🎲 Random</button>
<input id="gn" type="number" min="2" max="7" value="4" title="states" style="width:60px"><input id="gk" type="number" min="1" max="4" value="2" title="symbols" style="width:60px"><label class="small"><input id="ge" type="checkbox" style="width:auto"> ε</label></div>
<div id="ql" style="margin-top:8px"></div>
<h2 style="margin-top:14px">Practice: submit your DFA</h2>
<textarea id="ans" style="height:140px" spellcheck="false" placeholder="Write your DFA in the same format, e.g.&#10;start: A&#10;final: C&#10;A,a = B&#10;A,b = A"></textarea>
<div class="row"><button id="chk">✔ Check my answer</button></div><div id="cv" style="margin-top:8px"></div><div class="err" id="le"></div></div>
<div class="card"><h2>5 · AI Tutor <span class="pill" id="mode">…</span></h2>
<div id="chat"></div>
<div class="row"><button class="g mini" data-p="Make me an easy practice question">Easy question</button><button class="g mini" data-p="Make a hard practice question with epsilon moves">Hard ε-question</button><button class="g mini" data-p="Give me a hint for the question in the editor">Hint</button><button class="g mini" data-p="Explain subset construction on the NFA in the editor">Explain</button></div>
<div class="row"><input id="ci" placeholder="Ask anything, or: make me a question about…" style="flex:1"><button id="cs">Send</button></div></div>`;
document.querySelector("main").append(lab);
const src = () => $("src").value, load = (text, s) => { if (text != null) $("qt").value = text; $("src").value = s; go(); };
const hist = [], blocks = [];
function bubble(role, text) {
  const d = document.createElement("div"); d.className = "bub " + (role === "user" ? "me" : "ai");
  d.innerHTML = E(text).replace(/```nfa\n([\s\S]*?)```/g, (_, c) => { blocks.push(c.trim()); return `</div><pre class="nfa">${c.trim()}</pre><button class="mini" data-load="${blocks.length - 1}">Load into simulator</button><div>`; });
  $("chat").append(d); $("chat").scrollTop = 1e6;
}
async function send(t) {
  if (!t.trim()) return; $("ci").value = ""; bubble("user", t); hist.push({ role: "user", content: t });
  try { const r = await api("/api/chat", "POST", { messages: hist, context: { question: $("qt").value, nfa: src() } }); hist.push({ role: "assistant", content: r.reply }); bubble("ai", r.reply); }
  catch (e) { hist.pop(); bubble("ai", "⚠ " + e.message); }
}
async function refresh() {
  try { const qs = await api("/api/questions"); $("ql").innerHTML = qs.length ? qs.map(q => `<div class="q"><span>${E(q.text)}</span><button class="g" data-ld="${q.id}">Load</button><button class="g" data-del="${q.id}">✕</button></div>`).join("") : '<div class="small">No saved questions yet.</div>'; lab.qs = qs; }
  catch (e) { $("le").textContent = "Backend not reachable. Start it with: node server.js"; }
}
lab.onclick = async e => {
  const t = e.target; $("le").textContent = "";
  try {
    if (t.dataset.load) load(null, blocks[+t.dataset.load]);
    if (t.dataset.p) send(t.dataset.p);
    if (t.dataset.ld) { const q = lab.qs.find(q => q.id === t.dataset.ld); load(q.text, q.src); }
    if (t.dataset.del) { await api("/api/questions?id=" + t.dataset.del, "DELETE"); refresh(); }
    if (t.id === "qs") { await api("/api/questions", "POST", { text: $("qt").value, src: src() }); refresh(); }
    if (t.id === "gen") { const r = await api(`/api/generate?n=${$("gn").value}&k=${$("gk").value}&eps=${$("ge").checked ? 1 : 0}`); load(r.text, r.src); }
    if (t.id === "cs") send($("ci").value);
    if (t.id === "chk") {
      const r = await api("/api/check", "POST", { question: src(), answer: $("ans").value });
      $("cv").innerHTML = `<span class="pill ${r.correct ? "y" : "n"}">${r.correct ? "✓ Correct" : "✗ Not yet"}</span> <span class="small">your states: ${r.yourStates} · reference DFA: ${r.referenceStates} · minimal: ${r.minimalStates}</span>`
        + (r.counterNote ? `<p>${E(r.counterNote)}</p>` : "") + r.problems.map(p => `<div class="small">• ${E(p)}</div>`).join("") + (r.equivalent && !r.isDfa ? '<p class="small">Same language, but it is not a valid DFA yet.</p>' : "");
    }
  } catch (err) { $("le").textContent = err.message; }
};
$("ci").onkeydown = e => { if (e.key === "Enter") send($("ci").value); };
api("/api/health").then(h => { $("mode").textContent = h.ai ? "AI online" : "offline mode"; $("mode").className = "pill " + (h.ai ? "y" : "n"); }).catch(() => { $("mode").textContent = "no backend"; $("mode").className = "pill n"; });
bubble("ai", "Hi! I can make practice questions, give hints and explain each step. Try a quick button below."); refresh();
})();
