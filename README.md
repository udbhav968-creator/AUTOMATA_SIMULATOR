# Automata Studio — ε-NFA → DFA Subset Construction Simulator

**Group 03 (Tutorial Batch T-12) · CSET302 — Automata Theory and Computability · Bennett University (SCSET)**
**Milestone-II: Final Simulator Demonstration & Evaluation (23–27 November 2026)**

---

## Overview

**Automata Studio** is a zero-dependency, interactive web simulator that converts an
**ε-NFA** — a non-deterministic finite automaton with ε (empty-string) transitions, of
which an ordinary **NFA** is the special case with no ε-moves — into an equivalent
deterministic finite automaton (**DFA**) using the **Rabin–Scott powerset / subset
construction** algorithm. The step that makes this an *ε-NFA* converter (rather than a plain
NFA one) is the **ε-closure**: the start state is ε-closure({q0}) and every transition is
ε-closure(move(S, a)), so states reachable "for free" on ε are always included.

The simulator is built for teaching and for Milestone-II evaluation: it does not just
print the final DFA, it *shows the construction happening*. For every step it displays the
subset being processed, the `move` on each input symbol, the resulting **ε-closure**, and
whether a brand-new DFA state has been discovered — with the source NFA and the growing DFA
drawn side by side and a working table that fills in cell by cell.

After conversion, the engine automatically **verifies correctness**: it checks that the
original NFA and the constructed DFA accept exactly the same strings up to a bounded length,
giving immediate evidence that the conversion preserves the language.

---

## Visual demonstration

A small **ε-NFA** (for the language `a*b`) and the DFA the tool builds from it. The ε-move from
q0 to q1 (dashed) is why the DFA start state is the ε-closure `{q0,q1}` rather than just `{q0}`.

| Source ε-NFA | Subset-constructed DFA |
|:---:|:---:|
| <img src="diagrams/enfa_example.png" width="420" alt="Example epsilon-NFA accepting a*b with an epsilon move" /> | <img src="diagrams/enfa_dfa_example.png" width="420" alt="Equivalent DFA produced by subset construction" /> |
| An ε-NFA for `a*b` — note the dashed ε-transition q0 → q1 and the accepting double-ring q2. | The equivalent DFA: D0 = ε-closure({q0}) = {q0,q1} (start), D1 = {q2} (accepting), D2 = ∅ (dead). |

In the live tool these are drawn side by side and animated step by step — the NFA lights up the
states in each subset while the DFA grows beside it, with a working table and a play / step / speed
transport (see the sequence diagram below for the exact flow).

---

## Architecture & diagrams

**System architecture (block diagram).** Three layers — input & parsing, the core engine,
and the interactive presentation — with the Node.js server exposing a REST conversion endpoint.

<p align="center"><img src="diagrams/architecture.png" width="760" alt="System architecture block diagram" /></p>

**Subset construction (flowchart).** The exact control flow of the Rabin–Scott algorithm as
implemented in `build()`.

<p align="center"><img src="diagrams/subset_flowchart.png" width="360" alt="Subset construction flowchart" /></p>

**Conversion sequence.** How a request flows from the user through the engine to the UI:

<p align="center"><img src="diagrams/sequence.png" width="360" alt="Conversion sequence diagram" /></p>

---

## Supported features

* **Flexible NFA / ε-NFA input** — plain transition lines (`q0,a = q0,q1`), delta notation
  (`δ(q0,a) = {q1}`) and arrow notation (`q0 -a-> q1`); ε-moves written as `ε`, `e` or `eps`.
  Optional `states:` / `alphabet:` declarations are validated when present.
* **A built-in table editor** and a **Random** example generator for quick input.
* **Draw it by hand** ("Draw" tab) — an interactive canvas where you place state circles, drag them around, draw transition wires between them (including self-loops and ε-moves), and mark the start and accepting states. The drawing is turned into the automaton the converter runs on.
* **Build an NFA from a plain-English language description** ("From a question" tab) — understands *ending with* / *starting with* / *containing* a pattern, *even/odd number of* a symbol, *length divisible by k*, *at least / at most / exactly n*, *not containing…*, *binary divisible by k*, and regular expressions like `(a|b)*abb`. This is a deterministic rule-based parser (no AI); it then feeds the subset-construction converter.
* **Iterative ε-closure** computation with cycle termination.
* **Explicit ε-elimination step (ε-NFA → NFA → DFA).** When the input has ε-moves, the result panel shows a *"Step 0 — eliminate ε"* section: the equivalent NFA **without** ε-moves, built as δ′(q,a) = ε-closure(move(ε-closure(q), a)) with a state accepting iff its ε-closure reaches an original final. The DFA is then the subset construction of that ε-free NFA — mirroring exactly how the conversion is solved by hand.
* **Rabin–Scott subset construction** with a full **step-by-step stepper** (play / pause,
  step forward / back, variable speed) driven by `player.js`.
* **Side-by-side vector visualisation** of the NFA and the DFA (draggable nodes, auto-curved
  bidirectional edges, zoom / pan) rendered by `graph.js`.
* **Subset construction working table** and a complete **step log** of every `move` and
  closure performed.
* **DFA state-naming modes** — `D0, D1, D2…`, `A, B, C…`, or raw subsets `{q0,q1}`.
* **Automatic equivalence verification** — confirms the NFA and the DFA agree on all strings
  up to a computed length bound, and reports a counter-example if they ever disagree.
* **Dead / trap state (∅) handling** so the produced DFA is total.
* **Copy DFA as text** and a **shareable link** that re-opens the exact automaton.
* **REST endpoint** `POST /api/convert` that returns the DFA states, transitions and text for
  programmatic use (works locally and on Vercel serverless).

### Example questions you can type in the "From a question" tab

All of these are recognised by the builder (verified by the test suite). Type one, press **Build the NFA**, then **Convert**:

```text
strings over {a,b} ending with abb
strings over {a,b} starting with a
strings over {0,1} containing the substring 101
strings over {a,b} that contain aa
strings over {a,b} with an even number of a
strings over {a,b} with an odd number of b
strings over {0,1} with length divisible by 3
strings over {a,b} of length at least 2
strings over {a,b} not containing bb
binary strings divisible by 3
the regular expression (a|b)*abb
```

If a wording isn't recognised, the tab says so and suggests supported phrasings. The builder is deterministic and rule-based (no AI); non-regular languages such as aⁿbⁿ or palindromes cannot be built.

---

## Technology stack and dependencies

| Component | Detail |
|---|---|
| Language | JavaScript (pure **ES2022**), HTML5, CSS3 |
| Runtime | **Node.js 18+** (developed and tested on Node.js v22) |
| npm dependencies | **None** — zero external packages |
| Rendering | Native SVG / Canvas; no front-end framework |
| Deployment | Static files + a native Node HTTP server; **Vercel**-ready via `vercel.json` |

The entire project runs identically in the browser and on the Node.js server because the
core engine (`lib/automata.js`) is a universal module exported to both `window.Automata`
and `module.exports`.

---

## Installation

Only Node.js 18+ is required; there is nothing to `npm install`.

```bash
# 1. Clone the repository
git clone https://github.com/udbhav968-creator/AUTOMATA_SIMULATOR.git
cd AUTOMATA_SIMULATOR

# 2. (No dependency install needed — zero npm dependencies)
```

## How to run

```bash
node server.js
```

Then open **http://localhost:3000** in a browser and go to **ε-NFA → DFA**.
The entry point is `server.js`; on a busy port use `PORT=3001 node server.js`.

---

## Example

**Input NFA** (strings over `{0,1}` whose second-to-last symbol is `1`):

```text
start: q0
final: q2
q0,0 = q0
q0,1 = q0,q1
q1,0 = q2
q1,1 = q2
```

**Output DFA produced by subset construction:**

```text
# DFA from subset construction
states: D0, D1, D2, D3
alphabet: 0, 1
start: D0
final: D2, D3
# D0 = {q0}
# D1 = {q0,q1}
# D2 = {q0,q2}
# D3 = {q0,q1,q2}
D0,0 = D0     D0,1 = D1
D1,0 = D2     D1,1 = D3
D2,0 = D0     D2,1 = D1
D3,0 = D2     D3,1 = D3
```

A 3-state NFA converts to a 4-state DFA. The simulator animates each subset as it is
discovered and then confirms that both machines accept the same language.

The classic textbook case — strings over `{a,b}` ending in `ab` — converts like this:

<p align="center">
  <img src="diagrams/nfa_example.png" width="420" alt="Example NFA ending in ab" />
  <img src="diagrams/dfa_example.png" width="420" alt="Equivalent DFA" />
</p>

---

## Project structure

```text
AUTOMATA_SIMULATOR/
├── api/
│   └── index.js          # Vercel serverless entry point (delegates to server.js)
├── lib/
│   └── automata.js       # Core engine: parser, ε-closure, subset construction, DFA output
├── public/
│   ├── index.html        # Home page + animated subset-construction demo
│   ├── subset.html       # ε-NFA → DFA subset construction visualiser (main page)
│   ├── 404.html          # Not-found page
│   ├── js/
│   │   └── subset.js     # Controller for the subset construction page
│   └── assets/
│       ├── app.css       # Styles (light / dark aware)
│       ├── shell.js      # App shell, navigation, theme, helpers (window.Studio)
│       ├── graph.js      # Interactive NFA / DFA vector graph renderer (window.GraphView)
│       ├── player.js     # Step player / transport controls (window.StepPlayer)
│       ├── editor.js     # Automaton text + table input widget (window.AutomatonInput)
│       └── favicon.svg
├── report/               # Milestone-II technical project report (md / docx / pdf)
├── screenshots/          # Numbered demonstration figures
├── server.js             # Zero-dependency HTTP server + /api/convert, /api/health
├── test.js               # Command-line verification harness
├── package.json          # Project metadata (zero dependencies)
├── vercel.json           # Vercel deployment configuration
└── README.md             # This file
```

### Core engine API (`lib/automata.js`)

| Function | Purpose |
|---|---|
| `parse(text)` | Parse and validate an NFA / ε-NFA into an internal 5-tuple object |
| `closure(N, S)` / `closureDetail(N, S)` | ε-closure of a set of states (set, plus added states and edges) |
| `moveDetail(N, S, c)` | `move(S, c)` — the union of transitions on symbol `c` |
| `build(N)` | Rabin–Scott subset construction → DFA states, transitions and step log |
| `dfaToText(N, M, mode)` | Render the constructed DFA as text (chosen naming mode) |
| `runNFA(N, w)` / `runDFA(N, M, w)` | Execute a string on the NFA / DFA (used for verification) |
| `isDeterministic(N)` / `dfaProblems(N)` | Input validation helpers |

---

## Testing

The simulator is verified at three levels.

**1. Automatic equivalence verification (built in).**
After every conversion the page runs the constructed DFA and the original NFA on *all*
strings up to a computed length bound and confirms they accept exactly the same set. The
result appears as a green “✓ Verified: the NFA and the DFA agree on all N strings up to
length L” message, or a red message with the shortest disagreeing string if they ever differ.
This directly demonstrates L(NFA) = L(DFA).

**2. Hand-worked cross-check.**
For the example above, tracing by hand confirms D0={q0}, D1={q0,q1}, D2={q0,q2},
D3={q0,q1,q2}, with D2 and D3 accepting — matching the tool's output. Results can also be
cross-checked against a trusted reference tool such as JFLAP.

**3. Command-line harness.**
```bash
node test.js
```
Output on the current build:
```text
Tier 1 — functional, edge & validation tests: 12/12 passed ✓
Tier 2 — fuzzing: 300 random NFAs converted, 12,000 strings tested, 0 mismatches ✓

ALL CHECKS PASSED — subset construction verified (L(NFA) = L(DFA)).
```
Tier 1 covers DFA-equivalent inputs, non-deterministic NFAs, ε-NFAs (including an ε-cycle),
the empty language, invalid-definition rejection, and structural guarantees (single start
state, a total DFA with one transition per symbol). Tier 2 generates 300 random NFAs,
converts each, and checks that `runNFA` and `runDFA` agree on 12,000 strings.

**Representative test cases**

| Test ID | Input / scenario | Expected result | Status |
|---|---|---|---|
| T01 | DFA-equivalent NFA, string in language | Accept (NFA and DFA agree) | Pass |
| T02 | Same machine, string not in language | Reject (NFA and DFA agree) | Pass |
| T03 | Symbol outside the alphabet | Rejected / flagged as invalid | Pass |
| T04 | Empty string ε | Decided by start-state ε-closure | Pass |
| T05 | ε-NFA with ε-cycle | ε-closure terminates; correct DFA | Pass |
| T06 | Malformed definition (no start state) | Clear validation error, no crash | Pass |

---

## Known limitations and troubleshooting

* **State explosion.** Subset construction is worst-case 2^|Q|; the engine bounds the number
  of states and string length (see `Automata.LIMITS`) so the browser stays responsive.
* **Regular languages only.** The tool converts finite automata; it does not handle
  context-free or more powerful models.
* **Port already in use.** If `node server.js` reports `EADDRINUSE`, run
  `PORT=3001 node server.js` and open the new port.
* **Blank graph.** Make sure JavaScript is enabled; the diagrams are drawn client-side.

---

## Team contributions and acknowledgements

| Member | Enrollment | Primary contribution |
|---|---|---|
| **Udbhav Yadav (Lead)** | S24CSEU0095 | Core engine — parser, iterative ε-closure, Rabin–Scott subset construction, server architecture (`lib/automata.js`, `server.js`) |
| **Harshit** | *S24CSEU00xx* | Interactive NFA / DFA vector visualiser and graph layout (`public/assets/graph.js`) |
| **Prabjot** | *S24CSEU00xx* | Subset construction page, stepper and working-table UI (`public/subset.html`, `public/js/subset.js`, `player.js`) |
| **Anubhav** | *S24CSEU00xx* | Input editor, the from-a-question builder, equivalence verification and testing (`editor.js`, `lib/extract.js`, `test.js`) |
| **Yashwanth Reddy** | *S24CSEU00xx* | Documentation, report and demonstration assets (`report/`, `screenshots/`, `diagrams/`) |

*Faculty: Pooja. Enrolment numbers shown as S24CSEU00xx are placeholders — replace them with each member's actual ID.*

**Acknowledgements.** Built for CSET302 — Automata Theory and Computability, School of
Computer Science Engineering and Technology (SCSET), Bennett University. The conversion
algorithm follows the classical Rabin–Scott subset construction as presented in standard
automata theory texts (Hopcroft, Motwani & Ullman; Sipser).
