# Automata Studio — CSET302 simulator

Interactive simulator for **NFA → DFA conversion** (subset construction with ε-closures), with string runs, DFA minimisation, Bloom-levelled practice, timed exams, a question bank and a **Gemini** tutor that falls back to a built-in tutor whenever Gemini is unavailable.

Zero dependencies: only **Node 18+** is needed (no `npm install`).

```bash
node server.js        # open http://localhost:3000
node test.js          # 40 edge cases + 300 fuzzed NFAs + grader self-check
```

## Turn on the Gemini tutor (optional)

1. Get a free key at <https://aistudio.google.com/apikey>.
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY=…`.
3. Restart `node server.js`. The menu shows **Gemini tutor ready**.

Without a key, everything still works and the built-in tutor answers from the simulator's own engine. The key stays on the server and is never sent to the browser. `.env` is in `.gitignore` — never commit it.

## Pages

| Page | What it does |
|---|---|
| `index.html` | Home, with a live subset-construction demo |
| `subset.html` | **NFA → DFA**: NFA and DFA diagrams side by side, move and ε-closure highlighted per step, working table filled cell by cell, exhaustive verification |
| `run.html` | **String run**: input tape, all active states at once, computation tree, equivalent DFA path, batch testing |
| `minimize.html` | **DFA minimisation**: unreachable removal, trap state, table filling round by round, partition refinement, minimal DFA |
| `practice.html` | Practice with instant grading and hints; **timed exams** with countdown, flags, auto-submit and Bloom/outcome breakdown; history |
| `bank.html` | **Manual questions**: write, edit, import/export; Gemini drafts for review; answer key computed by the engine |
| `tutor.html` | Full-page AI tutor (also a floating button on every page) |
| `theory.html` | M1 design evidence: problem, formal model, pseudocode, complexity, architecture, manual example, edge cases, tool review |
| `tools.html` | Language properties and equivalence of two automata (or regex vs automaton) |
| `tests.html` | Live test suite with expected vs actual results |
| `report.html` | Generates the M2 technical report (diagrams, logs, tests, contributions) — print to PDF |

## Simulation controls

Play/pause, step back/forward, first/last, a scrubber with markers on new-state steps, speeds **0.25× 0.5× 1× 2× 4× Instant**, and a running clock. Keys: <kbd>Space</kbd>, <kbd>←</kbd> <kbd>→</kbd>, <kbd>Home</kbd> <kbd>End</kbd>; <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs the input.

Diagrams lay states out in layers from the start state, route every edge around other states and self-loops, keep labels from colliding, and put loops on the emptiest side. Drag states, drag to pan, <kbd>Ctrl</kbd>+scroll or pinch to zoom, double-click to fit, export PNG/SVG.

## Questions and Bloom's taxonomy

| Bloom's level | Question types (auto-graded) | Outcome |
|---|---|---|
| Remember | Multiple choice on definitions | LO1 |
| Understand | True/false, written answers (self-marked) | LO1 |
| Apply | ε-closure, move + closure, accept/reject, subset table | LO2, LO3 |
| Analyze | Count DFA/minimal states, find equivalent states | LO2, LO4 |
| Evaluate | Judge a student's DFA and give a counter-example | LO5 |
| Create | Convert NFA to DFA, design an automaton for a language | LO2, LO6 |

Automata answers are graded by **language equivalence**, so any correct machine earns full marks; wrong ones get the shortest counter-example string. Feedback targets common mistakes (forgot the ε-closure, forgot the dead state, counted 2ⁿ instead of reachable subsets).

## Input format

```
states: q0, q1, q2        # optional; if given, every state must be declared
alphabet: a, b            # optional; if given, every symbol must be declared
start: q0                 # exactly one
final: q2                 # any number, or ∅
q0,a = q0,q1              # also: δ(q0,a) = {q0,q1}   or   q0 -a-> q1
q1,ε = q2                 # ε may be written ε, e, eps, λ   (upper-case E is a normal state)
```

Regular expressions: symbols, `|` or `+` for union, `*`, `?`, brackets, `ε`.

## Limits and edge cases

Limits: 30 NFA states, 300 DFA states, 10 symbols, 200-symbol strings, 40-character regular expressions. Every limit and every invalid input produces a specific message (with the line number for text input). Handled cases include ε-cycles, ε self-loops, start state final, no final states, unreachable states, duplicate targets, dead state, unused symbols, multi-character symbols, Windows line endings, incomplete DFAs (trap added), NFAs given to the minimiser (offer to convert), symbols outside Σ in a string, damaged share links, disabled browser storage, and exam timers that expire while the page is closed.

## AI fallbacks

| Situation | What happens |
|---|---|
| Model not found or retired | Next model in `GEMINI_FALLBACK_MODELS` |
| 429 / 5xx | One retry, then the next model |
| No answer within `GEMINI_TIMEOUT_MS` | One retry, then the next model |
| Gemini writes an automaton the engine rejects | Gemini is told the exact parser error and rewrites it once; still broken → marked in the chat |
| AI question fails validation | One repair round; otherwise generated locally |
| Wrong key, no key, all models failing, rate limit | Built-in tutor answers, with a note saying why |
| Server not running (e.g. static hosting) | Built-in tutor in the browser; question bank stored in the browser |
| Timed exam running | Tutor paused |

## Structure

```
server.js            static files, question bank API, Gemini proxy
lib/automata.js      engine (shared by browser, server and tests)
lib/qgen.js          question generation and grading
lib/cases.js         edge-case suite
data/questions.json  question bank (9 sample questions, Remember → Create)
public/*.html        pages
public/js/           page scripts
public/assets/       styles, shell, graph renderer, step player, editor, chat, question view
test.js              command-line tests
```

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Server and Gemini status |
| `POST /api/chat {messages, context}` | Tutor reply, or `{offline:true, reason}` |
| `POST /api/ai/question {type, difficulty, topic}` | Engine-validated question from Gemini |
| `GET / POST / DELETE /api/questions` | Question bank (POST also accepts `{questions:[…]}`) |
| `POST /api/convert {src}` | NFA → DFA |
| `POST /api/check {question, answer}` | Grade a student DFA |
| `GET /api/generate?n=&k=&eps=1` | Random NFA |
