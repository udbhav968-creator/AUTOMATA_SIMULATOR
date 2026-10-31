/*
 * Automata Studio server — zero dependencies, Node 18+.
 *   node server.js        then open http://localhost:3000
 *
 * Serves the pages in /public, the engine (/automata.js, /qgen.js), a small JSON question bank,
 * and a Gemini proxy so the API key never reaches the browser.
 * Every AI route degrades gracefully: when Gemini is missing, slow, rate-limited or returns something
 * unusable, the response says { offline: true, reason } and the browser switches to its built-in tutor.
 */
"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const A = require("./lib/automata"), Q = require("./lib/qgen");

/* ---------------------------------------------------------------- configuration (.env is optional) */
try {
  fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
} catch (e) { /* no .env file: fine */ }

const PORT = +process.env.PORT || 3000;
const KEY = (process.env.GEMINI_API_KEY || "").trim();
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.1-flash-lite,gemini-2.5-flash").split(",").map(s => s.trim()).filter(Boolean);
const MODELS = [...new Set([MODEL, ...FALLBACKS])];
const BASE = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
const TIMEOUT = +process.env.GEMINI_TIMEOUT_MS || 30000;
const RATE = +process.env.AI_RATE_LIMIT || 20; // AI requests per minute per client
const DB = path.join(__dirname, "data", "questions.json"), PUB = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };
let workingModel = null; // the first model that answered successfully

/* ---------------------------------------------------------------- question bank storage */
function loadBank() {
  try {
    const list = JSON.parse(fs.readFileSync(DB, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    if (fs.existsSync(DB) && e instanceof SyntaxError) {
      const backup = DB + ".broken-" + Date.now();
      fs.copyFileSync(DB, backup);
      console.warn("questions.json was not valid JSON; a copy was kept at " + backup);
    }
    return [];
  }
}
function saveBank(list) {
  fs.mkdirSync(path.dirname(DB), { recursive: true });
  const tmp = DB + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, DB); // atomic replace: a crash never leaves half a file
}

/* ---------------------------------------------------------------- http helpers */
function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > (limit || 300000)) { reject(Object.assign(new Error("Request is too large."), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(Object.assign(new Error("The request body is not valid JSON."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}
const hits = new Map();
function rateLimited(req) {
  const ip = req.socket.remoteAddress || "?", now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list);
  return list.length > RATE;
}

/* ---------------------------------------------------------------- Gemini */
const FORMAT = "states: q0,q1,q2\nalphabet: a,b\nstart: q0\nfinal: q2\nq0,a = q0,q1\nq0,b = q0\nq1,b = q2\nq2,ε = q0";
const TUTOR = `You are the AI tutor inside Automata Studio, a simulator for the B.Tech course CSET302 Automata Theory and Computability.
Topics: DFA, NFA, ε-NFA, ε-closure, subset construction (NFA→DFA), DFA minimisation (table filling, partition refinement), Thompson's construction, string acceptance, language equivalence.

How to answer:
- Be accurate, short and student-friendly. Use plain text with **bold** and \`code\`; avoid tables.
- Use set notation like {q0,q1} and ∅ for the empty set. Show the ε-closure after every move.
- When the student is solving something, give a hint first; give the full solution only when asked.
- If the student's claim is wrong, say so clearly and show why with a concrete string or step.
- When you write any automaton, put it in a fenced code block labelled nfa (\`\`\`nfa … \`\`\`) using exactly this format, one transition per line, ε for epsilon:
${FORMAT}
- State names: letters/digits only (q0, A, D1). Alphabet symbols: single letters or digits. At most 8 states.
- When asked to create questions, follow Bloom's taxonomy: name the level (Remember, Understand, Apply, Analyze, Evaluate, Create), start the question with a matching action verb, and include the automaton block when the question needs one.`;

function toGeminiContents(messages) {
  const out = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].parts[0].text += "\n\n" + m.content;
    else out.push({ role, parts: [{ text: m.content }] });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

/** Call Gemini, walking the model fallback list. Returns { text, model } or throws with err.reason. */
async function gemini(contents, system, opts) {
  opts = opts || {};
  if (!KEY) throw Object.assign(new Error("No GEMINI_API_KEY is set on the server."), { reason: "no-key" });
  const order = workingModel ? [workingModel, ...MODELS.filter(m => m !== workingModel)] : MODELS;
  let lastErr = null;
  for (const model of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), TIMEOUT);
      try {
        const body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: opts.temperature ?? 0.5, maxOutputTokens: opts.maxTokens || 4096 } };
        if (opts.json) body.generationConfig.responseMimeType = "application/json";
        const r = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST", signal: ctrl.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": KEY },
          body: JSON.stringify(body)
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg = (j.error && j.error.message) || `HTTP ${r.status}`;
          if (r.status === 401 || r.status === 403 || /API key/i.test(msg)) throw Object.assign(new Error("Gemini rejected the API key: " + msg), { reason: "bad-key", fatal: true });
          if (r.status === 404 || (r.status === 400 && /not found|not supported|unknown model/i.test(msg))) { lastErr = Object.assign(new Error(`Model ${model} is not available: ${msg}`), { reason: "model" }); break; }
          if (r.status === 429 || r.status >= 500) { lastErr = Object.assign(new Error(`Gemini is busy (${msg}).`), { reason: r.status === 429 ? "quota" : "server" }); if (attempt === 0) { await new Promise(s => setTimeout(s, 1200)); continue; } break; }
          throw Object.assign(new Error("Gemini error: " + msg), { reason: "request" });
        }
        if (j.promptFeedback && j.promptFeedback.blockReason) throw Object.assign(new Error("Gemini blocked this request (" + j.promptFeedback.blockReason + ")."), { reason: "blocked", fatal: true });
        const cand = (j.candidates || [])[0];
        const text = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts.filter(p => !p.thought && typeof p.text === "string").map(p => p.text).join("").trim() : "";
        if (!text) {
          lastErr = Object.assign(new Error("Gemini returned an empty answer" + (cand && cand.finishReason ? " (" + cand.finishReason + ")" : "") + "."), { reason: "empty" });
          if (cand && /SAFETY|RECITATION|PROHIBITED/.test(cand.finishReason || "")) { lastErr.fatal = true; throw lastErr; }
          break;
        }
        workingModel = model;
        return { text, model, truncated: cand.finishReason === "MAX_TOKENS" };
      } catch (e) {
        if (e.fatal) throw e;
        if (e.name === "AbortError") lastErr = Object.assign(new Error(`Gemini did not answer within ${TIMEOUT / 1000} s.`), { reason: "timeout" });
        else if (e.reason) lastErr = e;
        else lastErr = Object.assign(new Error("Cannot reach Gemini: " + e.message), { reason: "network" });
        if (lastErr.reason === "request") throw lastErr;
        if (attempt === 0 && (lastErr.reason === "timeout" || lastErr.reason === "network")) continue;
        break;
      } finally { clearTimeout(timer); }
    }
  }
  throw lastErr || Object.assign(new Error("Gemini is unavailable."), { reason: "unavailable" });
}

/** Check every ```nfa block in a reply with the real engine. */
function checkBlocks(text) {
  const blocks = [];
  const re = /```(?:nfa|dfa|automaton)\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    const src = m[1].trim();
    try { const N = A.parse(src); A.build(N); blocks.push({ src, ok: true, states: N.states.length, warn: N.warn }); }
    catch (e) { blocks.push({ src, ok: false, error: e.message }); }
  }
  return blocks;
}

function contextText(ctx) {
  ctx = ctx || {};
  const parts = [];
  if (ctx.page) parts.push("Page the student is on: " + String(ctx.page).slice(0, 60));
  if (ctx.automaton) parts.push("Automaton currently loaded:\n" + String(ctx.automaton).slice(0, 2000));
  if (ctx.step) parts.push("Current simulator step: " + String(ctx.step).slice(0, 800));
  if (ctx.question) parts.push("Question the student is working on: " + String(ctx.question).slice(0, 1200));
  if (ctx.answer) parts.push("Student's answer so far: " + String(ctx.answer).slice(0, 1200));
  return parts.length ? "\n\nContext from the simulator (may be empty):\n" + parts.join("\n") : "";
}

async function chat(body) {
  const msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) })).slice(-14);
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") throw Object.assign(new Error("Send a message first."), { status: 400 });
  if (body.context && body.context.exam) return { reply: "A timed exam is running, so the tutor is paused. It will be back when you submit.", mode: "paused" };
  const system = TUTOR + contextText(body.context);
  let out = await gemini(toGeminiContents(msgs), system);
  let blocks = checkBlocks(out.text);
  // One repair round: tell the model exactly what the parser rejected.
  if (blocks.some(b => !b.ok)) {
    const errs = blocks.filter(b => !b.ok).map(b => "- " + b.error).join("\n");
    try {
      const fixed = await gemini(toGeminiContents([...msgs, { role: "assistant", content: out.text }, { role: "user", content: `The automaton block(s) you wrote could not be parsed:\n${errs}\nRewrite your whole previous answer with corrected nfa blocks in exactly this format:\n${FORMAT}` }]), system);
      const fb = checkBlocks(fixed.text);
      if (fb.every(b => b.ok)) { out = fixed; blocks = fb; }
    } catch (e) { /* keep the first answer; the browser marks the broken block */ }
  }
  return { reply: out.text, mode: "ai", model: out.model, blocks, truncated: out.truncated };
}

const QUESTION_PROMPT = `Create ONE exam question for CSET302 and reply with JSON only, no prose, using this shape:
{"type": one of "construct","design","accept","closure","count","mcq","tf","short",
 "text": the question (start with a Bloom action verb),
 "bloom": one of "Remember","Understand","Apply","Analyze","Evaluate","Create",
 "difficulty": "Easy"|"Medium"|"Hard", "marks": 1-10,
 "src": automaton text for construct/accept/closure/count (format below),
 "reference": a correct automaton for design questions,
 "requireDFA": true|false for design,
 "strings": ["ab","ba"] for accept (2-6 strings over the alphabet),
 "state": "q0" for closure,
 "what": "dfa"|"minimal" for count,
 "options": [...] and "answer": index for mcq, "answer": true|false for tf,
 "model": model answer for short, "explanation": one sentence for mcq/tf}
Automaton format (one transition per line, ε for epsilon, at most 7 states, alphabet {a,b}):
${FORMAT}`;

async function aiQuestion(body) {
  const want = Q.BANK_TYPES.includes(body.type) ? body.type : null;
  const diff = ["Easy", "Medium", "Hard"].includes(body.difficulty) ? body.difficulty : "Medium";
  const topic = String(body.topic || "").slice(0, 300);
  const ask = `${QUESTION_PROMPT}\n\nRequested type: ${want || "any suitable type"}. Difficulty: ${diff}.${topic ? " Topic or idea: " + topic : ""}`;
  const contents = [{ role: "user", parts: [{ text: ask }] }];
  let lastProblems = [];
  for (let round = 0; round < 2; round++) {
    const out = await gemini(contents, TUTOR, { json: true, temperature: 0.8 });
    let rec;
    try { rec = JSON.parse(out.text.replace(/^```(?:json)?\s*|\s*```$/g, "")); }
    catch (e) { lastProblems = ["The reply was not valid JSON."]; contents.push({ role: "model", parts: [{ text: out.text }] }, { role: "user", parts: [{ text: "That was not valid JSON. Reply with the JSON object only." }] }); continue; }
    if (Array.isArray(rec)) rec = rec[0];
    if (want && rec && !rec.type) rec.type = want;
    const clean = rec && typeof rec === "object" ? Q.cleanBank({ ...rec, origin: "ai" }) : null;
    lastProblems = clean ? Q.validateBank(clean) : ["Empty question."];
    if (!lastProblems.length) return { question: clean, model: out.model };
    contents.push({ role: "model", parts: [{ text: out.text }] }, { role: "user", parts: [{ text: "The simulator rejected this question:\n- " + lastProblems.join("\n- ") + "\nFix it and reply with the corrected JSON object only." }] });
  }
  throw Object.assign(new Error("Gemini's question did not pass validation: " + lastProblems.join(" ")), { reason: "invalid" });
}

/* ---------------------------------------------------------------- routes */
async function api(req, res, url) {
  const p = url.pathname, method = req.method;
  if (p === "/api/health") return send(res, 200, { ok: true, ai: !!KEY, provider: "gemini", model: workingModel || MODEL, models: MODELS, limits: A.LIMITS });

  if (p === "/api/chat" && method === "POST") {
    const body = await readBody(req);
    if (body.context && body.context.exam) return send(res, 200, { reply: "A timed exam is running, so the tutor is paused. It will be back when you submit.", mode: "paused" });
    if (rateLimited(req)) return send(res, 200, { offline: true, reason: "rate", message: `Too many AI requests (limit ${RATE} per minute). Using the built-in tutor for a moment.` });
    try { return send(res, 200, await chat(body)); }
    catch (e) { if (e.status) throw e; return send(res, 200, { offline: true, reason: e.reason || "error", message: e.message }); }
  }

  if (p === "/api/ai/question" && method === "POST") {
    const body = await readBody(req);
    if (rateLimited(req)) return send(res, 200, { offline: true, reason: "rate", message: "Too many AI requests; a question was generated locally instead." });
    try { return send(res, 200, await aiQuestion(body)); }
    catch (e) { return send(res, 200, { offline: true, reason: e.reason || "error", message: e.message }); }
  }

  if (p === "/api/questions") {
    let list = loadBank();
    if (method === "GET") return send(res, 200, list);
    if (method === "POST") {
      const body = await readBody(req);
      const incoming = Array.isArray(body.questions) ? body.questions : [body];
      if (incoming.length > 100) return send(res, 400, { error: "Import at most 100 questions at a time." });
      const saved = [], rejected = [];
      for (const rec of incoming) {
        const clean = Q.cleanBank(rec || {}), problems = Q.validateBank(clean);
        if (problems.length) { rejected.push({ text: String((rec && rec.text) || "").slice(0, 60), problems }); continue; }
        const i = list.findIndex(q => q.id === clean.id);
        if (i >= 0) list[i] = clean; else list.push(clean);
        saved.push(clean.id);
      }
      if (list.length > 500) return send(res, 400, { error: "The question bank is full (500 questions). Delete some first." });
      if (!saved.length) return send(res, 400, { error: rejected[0] ? rejected[0].problems.join(" ") : "Nothing to save.", rejected });
      saveBank(list);
      return send(res, 200, { questions: list, saved, rejected });
    }
    if (method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return send(res, 400, { error: "Missing ?id=" });
      const before = list.length;
      list = list.filter(q => q.id !== id);
      if (list.length === before) return send(res, 404, { error: "No question with that id." });
      saveBank(list);
      return send(res, 200, { questions: list });
    }
  }

  // Engine endpoints (kept for scripts and for the earlier version of the app)
  if (p === "/api/convert" && method === "POST") {
    const b = await readBody(req), N = A.parse(b.src), M = A.build(N);
    return send(res, 200, { states: M.D.map((d, i) => ({ id: "D" + i, set: d.set, final: d.fin })), transitions: M.trans.map(t => ({ from: "D" + t.f, symbol: t.c, to: "D" + t.t })), steps: M.steps.length, minimalStates: A.minimize(N, M), warnings: N.warn });
  }
  if (p === "/api/check" && method === "POST") {
    const b = await readBody(req), q = { type: "construct", src: b.question, data: { requireDFA: true } };
    return send(res, 200, Q.grade(q, { text: b.answer }));
  }
  if (p === "/api/generate") {
    const s = url.searchParams;
    return send(res, 200, { text: "Convert the following NFA to an equivalent DFA using subset construction.", src: A.generate({ n: s.get("n"), k: s.get("k"), eps: s.get("eps") === "1" }) });
  }
  return send(res, 404, { error: "Unknown endpoint " + p });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/automata.js" || p === "/qgen.js" || p === "/cases.js") return stream(res, path.join(__dirname, "lib", p.slice(1)));
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const html = path.join(PUB, "404.html");
    res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    return res.end(fs.existsSync(html) ? fs.readFileSync(html) : "Not found");
  }
  stream(res, file);
}
function stream(res, file) {
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'"
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });
    serveStatic(req, res, url);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 400, { error: e.message, code: e.code });
  }
});

if (require.main === module) {
  server.on("error", e => {
    if (e.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Close the other server or run:  PORT=3001 node server.js`);
    else console.error(e);
    process.exit(1);
  });
  server.listen(PORT, () => console.log(`Automata Studio on http://localhost:${PORT}\nAI tutor: ${KEY ? "Gemini (" + MODELS.join(" → ") + ")" : "offline mode — add GEMINI_API_KEY to .env to enable Gemini"}`));
}
module.exports = { server, gemini, checkBlocks, toGeminiContents };
