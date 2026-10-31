// Zero-dependency Node server: static files + REST API + AI tutor proxy.  Run: node server.js
const http = require("http"), fs = require("fs"), path = require("path"), A = require("./lib/automata");
try { fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n").forEach(l => { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }); } catch {}
const PORT = process.env.PORT || 3000, KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const DB = path.join(__dirname, "data", "questions.json"), PUB = path.join(__dirname, "public");
const load = () => { try { return JSON.parse(fs.readFileSync(DB, "utf8")); } catch { return []; } };
const save = q => { fs.mkdirSync(path.dirname(DB), { recursive: true }); fs.writeFileSync(DB, JSON.stringify(q, null, 2)); };
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const send = (res, c, o) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { let b = ""; req.on("data", d => { b += d; if (b.length > 1e6) req.destroy(); }); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });
const FORMAT = "states: q0,q1,q2\nstart: q0\nfinal: q2\nq0,a = q0,q1\nq1,b = q2\nq2,ε = q0   (use ε or e for epsilon moves)";
function offline(msgs, ctx) {
  const last = (msgs[msgs.length - 1] || {}).content || "";
  if (/question|generate|make|create|practice/i.test(last)) return "Practice question: convert this NFA to an equivalent DFA using subset construction.\n```nfa\n" + A.generate(4, 2, /eps|ε|epsilon/i.test(last)) + "\n```\nTip: start with the ε-closure of the start state, then compute move() and closure for every symbol. (Offline mode: set ANTHROPIC_API_KEY for the full AI tutor.)";
  try { const N = A.parse(ctx.nfa), M = A.build(N); return `Your NFA has ${N.states.length} states; its DFA has ${M.D.length} reachable states (${A.minimize(N, M)} after minimization). Hint: begin with ε-closure(${N.start}) = {${M.D[0].set}} and process each symbol in turn. (Offline mode: set ANTHROPIC_API_KEY for the full AI tutor.)`; }
  catch (e) { return "I can't read the NFA in the editor yet: " + e.message; }
}
async function chat(b) {
  const msgs = (Array.isArray(b.messages) ? b.messages : []).filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-12), ctx = b.context || {};
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") throw new Error("Send a user message.");
  if (!KEY) return { reply: offline(msgs, ctx), mode: "offline" };
  const system = `You are an Automata Theory tutor inside an NFA→DFA simulator for B.Tech students (CSET302). Help with subset construction, ε-closure, DFA minimization and writing exam-style questions.
When asked to create a question: give a short problem statement, then the NFA in a fenced code block labelled nfa, in exactly this format:\n${FORMAT}
Be concise. When a student is attempting a question, give hints first and the full solution only if they ask.
Current question text: ${String(ctx.question || "(none)").slice(0, 500)}
NFA currently in the editor:\n${String(ctx.nfa || "").slice(0, 1500)}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, messages: msgs }) });
  const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || "AI request failed");
  return { reply: j.content.filter(c => c.type === "text").map(c => c.text).join("\n"), mode: "ai" };
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = u.pathname;
  try {
    if (p === "/api/health") return send(res, 200, { ok: true, ai: !!KEY, model: MODEL });
    if (p === "/api/generate") { const src = A.generate(u.searchParams.get("n"), u.searchParams.get("k"), u.searchParams.get("eps") === "1"); return send(res, 200, { text: "Convert the following NFA to an equivalent DFA using subset construction.", src }); }
    if (p === "/api/convert" && req.method === "POST") { const b = await body(req), N = A.parse(b.src), M = A.build(N); return send(res, 200, { states: M.D.map((d, i) => ({ id: "D" + i, set: d.set, final: d.fin })), transitions: M.trans.map(t => ({ from: "D" + t.f, symbol: t.c, to: "D" + t.t })), steps: M.steps, minimalStates: A.minimize(N, M) }); }
    if (p === "/api/check" && req.method === "POST") {
      const b = await body(req), Q = A.parse(b.question), S = A.parse(b.answer), problems = A.dfaProblems(S), eq = A.equivalent(Q, S), ref = A.build(Q);
      const j = Q.alpha.every(a => a.length === 1) ? "" : " ", counter = eq.ok ? null : (eq.counter.join(j) || "ε");
      return send(res, 200, { correct: eq.ok && !problems.length, equivalent: eq.ok, isDfa: !problems.length, problems, counterExample: counter, counterNote: eq.ok ? null : `The string “${counter}” is ${eq.nfaAccepts ? "accepted by the NFA but rejected by your machine" : "rejected by the NFA but accepted by your machine"}.`, yourStates: S.states.length, referenceStates: ref.D.length, minimalStates: A.minimize(Q, ref) });
    }
    if (p === "/api/questions") {
      let qs = load();
      if (req.method === "GET") return send(res, 200, qs);
      if (req.method === "POST") {
        const b = await body(req), text = String(b.text || "").trim();
        if (text.length < 5) throw new Error("Question text must be at least 5 characters.");
        A.build(A.parse(b.src));
        const rec = { id: String(b.id || Date.now().toString(36)), text: text.slice(0, 500), src: String(b.src).slice(0, 5000), marks: Math.min(Math.max(+b.marks || 5, 1), 20), level: ["Easy", "Medium", "Hard"].includes(b.level) ? b.level : "Medium", at: new Date().toISOString() };
        const i = qs.findIndex(q => q.id === rec.id); if (i >= 0) qs[i] = rec; else qs.push(rec);
        if (qs.length > 200) throw new Error("Question library is full (200).");
        save(qs); return send(res, 200, qs);
      }
      if (req.method === "DELETE") { qs = qs.filter(q => q.id !== u.searchParams.get("id")); save(qs); return send(res, 200, qs); }
    }
    if (p === "/api/chat" && req.method === "POST") return send(res, 200, await chat(await body(req)));
    if (p.startsWith("/api/")) return send(res, 404, { error: "Unknown endpoint" });
    const lib = p === "/automata.js", f = lib ? path.join(__dirname, "lib", "automata.js") : path.join(PUB, p === "/" ? "index.html" : p);
    if ((!lib && !f.startsWith(PUB)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, 400, { error: e.message }); }
}).listen(PORT, () => console.log(`NFA→DFA Studio on http://localhost:${PORT}  (AI tutor: ${KEY ? "ON" : "offline mode"})`));
