"use strict";
const http = require("http"), fs = require("fs"), path = require("path");
const A = require("./lib/automata");

const PORT = +process.env.PORT || 3000;
const PUB = path.join(__dirname, "public");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8"
};

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req, cap = 1e6) {
  return new Promise((resolve, reject) => {
    let data = "", size = 0;
    req.on("data", c => { size += c.length; if (size > cap) { reject(Object.assign(new Error("Request too large."), { status: 413 })); req.destroy(); } else data += c; });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(Object.assign(new Error("Invalid JSON body."), { status: 400 })); } });
    req.on("error", reject);
  });
}

// --- API: just the NFA -> DFA subset construction ---
async function api(req, res, url) {
  const p = url.pathname, method = req.method;
  if (p === "/api/health") return send(res, 200, { ok: true, limits: A.LIMITS });
  if (p === "/api/convert" && method === "POST") {
    const b = await readBody(req), N = A.parse(b.src), M = A.build(N);
    const elim = N.hasEps ? A.buildEpsElimination(N) : null;
    return send(res, 200, {
      states: M.D.map((d, i) => ({ id: "D" + i, set: d.set, final: d.fin, start: i === 0 })),
      transitions: M.trans.map(t => ({ from: "D" + t.f, symbol: t.c, to: "D" + t.t })),
      steps: M.steps.length,
      dfaText: A.dfaToText(N, M),
      warnings: N.warn,
      hasEps: N.hasEps,
      elimination: elim ? {
        states: elim.NE.states,
        finals: elim.NE.finals,
        text: A.toText(elim.NE),
        steps: elim.steps.length
      } : null
    });
  }
  return send(res, 404, { error: "Unknown endpoint " + p });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/automata.js") return stream(res, path.join(__dirname, "lib", "automata.js"));
  if (p === "/extract.js") return stream(res, path.join(__dirname, "lib", "extract.js"));
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
    if (e.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Try:  PORT=3001 node server.js`);
    else console.error(e);
    process.exit(1);
  });
  server.listen(PORT, () => console.log(`NFA -> DFA simulator on http://localhost:${PORT}`));
}
module.exports = { server };
