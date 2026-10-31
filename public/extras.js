// Simulator extras: remember last NFA for the Report page, share links, JSON import/export.
(() => { const $ = id => document.getElementById(id), row = $("go").parentElement;
const mk = (t, f) => { const b = document.createElement("button"); b.className = "g"; b.textContent = t; b.onclick = f; row.append(b); return b; };
const enc = s => btoa(unescape(encodeURIComponent(s))), dec = s => decodeURIComponent(escape(atob(s)));
mk("🔗 Share link", () => { const u = location.origin + location.pathname + "#" + enc($("src").value); navigator.clipboard?.writeText(u); $("err").style.color = "var(--ok)"; $("err").textContent = "Link copied (also in the address bar)."; location.hash = enc($("src").value); });
mk("⬇ Export JSON", () => { try { const N = Automata.parse($("src").value), j = { states: N.states, alphabet: N.alpha, start: N.start, finals: N.finals, transitions: Object.entries(N.d).map(([k, v]) => ({ from: k.split("|")[0], symbol: k.split("|")[1], to: [...v] })) }; navigator.clipboard?.writeText(JSON.stringify(j, null, 1)); $("err").style.color = "var(--ok)"; $("err").textContent = "JSON copied to clipboard."; } catch (e) { $("err").textContent = e.message; } });
mk("⬆ Import JSON", () => { const t = prompt("Paste NFA JSON (states, alphabet, start, finals, transitions)"); if (!t) return; try { const j = JSON.parse(t); $("src").value = ["states: " + j.states.join(","), "alphabet: " + (j.alphabet || []).join(","), "start: " + j.start, "final: " + (j.finals || []).join(","), ...j.transitions.map(x => `${x.from},${x.symbol} = ${[].concat(x.to).join(",")}`)].join("\n"); go(); } catch (e) { $("err").textContent = "Invalid JSON: " + e.message; } });
if (location.hash.length > 3) try { $("src").value = dec(location.hash.slice(1)); } catch {}
$("ex").append(new Option("✏ Custom — write your own", "__blank"));
const oc = $("ex").onchange; $("ex").onchange = () => { const v = $("ex").value, q = (window.__qs || []).find(x => "q:" + x.id === v);
  if (q) { $("qt") && ($("qt").value = q.text); $("src").value = q.src; go(); } else if (v === "__blank") { $("src").value = "states: q0,q1\nalphabet: a,b\nstart: q0\nfinal: q1\nq0,a = q1"; go(); } else oc(); };
fetch("/api/questions").then(r => r.json()).then(list => { window.__qs = list; if (list.length) { const g = document.createElement("optgroup"); g.label = "Saved questions"; list.forEach(q => g.append(new Option(`${q.text.slice(0, 48)} (${q.marks || 5}m)`, "q:" + q.id))); $("ex").append(g); }
  const q = list.find(x => x.id === new URLSearchParams(location.search).get("q")); if (q) { $("qt") && ($("qt").value = q.text); $("src").value = q.src; go(); } }).catch(() => {});
const g0 = window.go; window.go = function () { g0(); try { localStorage.setItem("nfa.src", $("src").value); localStorage.setItem("nfa.q", $("qt") ? $("qt").value : ""); } catch {} };
$("go").onclick = window.go; $("err").style.color = ""; go(); })();
