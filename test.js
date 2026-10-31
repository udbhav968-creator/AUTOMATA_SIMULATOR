const A = require("./lib/automata"), { CASES, runCase } = require("./public/cases.js");
let fail = 0; for (const c of CASES) { const r = runCase(A, c); if (!r.pass) { fail++; console.log("✗", r.name, "\n  expected:", r.exp.join(" | "), "\n  actual:  ", r.act.join(" | ")); } }
for (let i = 0; i < 300; i++) A.build(A.parse(A.generate(5, 3, true)));
console.log(`${CASES.length - fail}/${CASES.length} edge-case tests passed${fail ? " ✗" : " ✓"}`); process.exit(fail ? 1 : 0);
