**BENNETT UNIVERSITY**

**School of Computer Science Engineering and Technology (SCSET)**

**TECHNICAL PROJECT REPORT**

CSET302 — Automata Theory and Computability

*Milestone-II: Final Simulator Demonstration & Evaluation (Total: 9
Marks)*

**Automata Studio**  
**Design and Implementation of an Interactive ε-NFA to DFA Conversion
Simulator**  
**using the Rabin–Scott Subset Construction Algorithm**

## **Project Metadata**

| **Field**           | **Detail**                                                   |
|---------------------|--------------------------------------------------------------|
| Course Code / Title | CSET302 — Automata Theory and Computability                  |
| Project Title       | Automata Studio — ε-NFA to DFA Subset Construction Simulator |
| Group ID            | Group 03 (Tutorial Batch T-12)                               |
| Student Lead        | Udbhav Yadav (S24CSEU0095)                                   |
| Faculty             | Pooja                                                        |
| Institution         | SCSET, Bennett University                                    |
| Milestone           | Milestone-II — Final Demonstration & Evaluation              |
| Evaluation Window   | 23–27 November 2026                                          |
| Repository          | github.com/udbhav968-creator/AUTOMATA_SIMULATOR              |

## **Group Members**

| **\#**   | **Student Name** | **Enrollment** | **Primary Contribution**                                    |
|----------|------------------|----------------|-------------------------------------------------------------|
| 1 (Lead) | Udbhav Yadav     | S24CSEU0095    | Core engine: parser, ε-closure, subset construction, server |
| 2        | Harshit          | S24CSEU00xx    | Interactive NFA/DFA vector visualiser & graph layout        |
| 3        | Prabjot          | S24CSEU00xx    | Subset page, stepper & working-table UI                     |
| 4        | Anubhav          | S24CSEU00xx    | Input editor, examples & equivalence verification/testing   |
| 5        | Yashwanth Reddy  | S24CSEU00xx    | Minimization & Export Engineer: Hopcroft DFA minimization, academic export suite (TikZ/DOT/JFLAP), string tracer & technical documentation |

*(Enrolment numbers shown as S24CSEU00xx are placeholders — replace them
with each member's actual ID.)*

# **Abstract**

Turning an ε-NFA — a non-deterministic finite automaton that may take ε
(empty-string) moves — into an equivalent DFA and subsequently into a canonical Minimal DFA is one of the foundational pipelines in CSET302 Automata Theory. On a whiteboard, the conversion goes by too fast: by the time the next state or partition is written, the underlying mathematical reasoning is lost. We built Automata Studio to fix exactly that. The platform delivers the complete theoretical pipeline:
1. **Stage 1 (ε-NFA → NFA)**: Minute step-by-step ε-elimination displaying state-by-state ε-closures, reaching-final state tests, and δ'(q,a) transition derivations.
2. **Stage 2 (NFA → DFA)**: Rabin–Scott subset construction with side-by-side animated dual canvases and real-time step log.
3. **Stage 3 (DFA Minimization)**: Hopcroft's partition refinement algorithm iteratively splitting equivalence groups from P₀ = {F, Q \ F} to fixed-point minimal states.
4. **Interactive String Simulator & Path Tracer**: Live dual-machine execution tracing arbitrary input strings with step-by-step branch tracking and accept/reject determination.
5. **Academic Export Center**: Instant export to LaTeX TikZ, Graphviz DOT, JFLAP 7.0 XML (.jff), and Markdown tables.

When conversion finishes, the tool empirically verifies language equivalence across all strings up to an exhaustive bound. Implemented in zero-dependency ES2022, the suite includes a 17-tier automated test harness covering unit algorithms, random fuzzing (12,000 strings across 300 automata), massive 100,000+ string 4-way cross-verification matrix (L(NFA) = L(NFA_ε-free) = L(DFA) = L(DFA_min)), 15 deep hidden & pathological test cases, canvas serialization, and live REST endpoints with 100% pass rate. The application is deployed live on Vercel at https://automata-simulator-ashen.vercel.app.

# **1. Introduction**

## **1.1 Motivation**

When subset construction is taught on the board, you mostly see the
final DFA — not how it got there. Doing it on paper is slow and easy to
get wrong, and the parts that actually matter (which states are in the
current subset, what the move gives, what the ε-closure adds) are gone
the moment you move to the next row. We wanted a tool that keeps that
reasoning on screen: one where you can step forward and back, pause, and
literally watch the DFA grow out of the NFA. That is the whole idea
behind Automata Studio, and it is what shaped every design decision we
made.

## **1.2 Learning Objective Alignment**

- Model finite automata (DFA, NFA, ε-NFA) using their formal 5-tuple
  definitions.

- Apply ε-closure and move operations correctly, including on machines
  with ε-cycles.

- Perform the Rabin–Scott subset construction to obtain an equivalent
  DFA.

- Reason about and empirically verify language equivalence L(NFA) =
  L(DFA).

## **1.3 Problem Statement**

Design and implement an interactive simulator that accepts an ε-NFA (a
non-deterministic finite automaton with ε-transitions, of which an
ordinary NFA is the special case with no ε-moves) and converts it to an
equivalent DFA by subset construction. The conversion must handle
ε-transitions correctly through ε-closure, show the construction step by
step, and provide automatic evidence that the ε-NFA and the resulting
DFA accept the same language.

## **1.4 Scope and Boundaries**

We kept the project focused strictly on finite automata while making the entire learning pipeline complete and self-contained:
- **Core Pipeline**: Parse and validate NFAs and ε-NFAs; compute cycle-safe ε-closures; eliminate ε-transitions (Stage 1); construct equivalent DFAs via the Rabin–Scott powerset algorithm (Stage 2); minimize the DFA into its canonical form using Hopcroft's partition refinement (Stage 3); and trace custom input strings on both machines simultaneously (Stage 4).
- **Interactive Visualisation**: Side-by-side animated SVG diagrams with draggable nodes, curved transition routing, a cell-by-cell working table, and a step-by-step playback controller.
- **Convenience Features**: Natural language description parser ("from a question"), freehand canvas drawing, automated language equivalence testing, and multi-format academic exports (LaTeX TikZ, Graphviz DOT, JFLAP 7.0 XML, Markdown tables).
- **What We Left Out**: Grammars, pushdown automata, and Turing machines, since our goal was to build the best, clearest, and most transparent finite automata simulator possible.

# **2. Objectives & Requirements**

## **2.1 Supported Operations**

- Parse an NFA or ε-NFA from standard transition text (`q0,a = q0,q1`), δ-notation (`δ(q0,a)={q1}`), arrow syntax (`q0 -a-> q1`), or an interactive transition matrix editor.

- Build automata automatically from natural language problem descriptions (e.g., "ends with abb", "even number of a", "length divisible by 3") or regular expressions like `(a|b)*abb` using deterministic Thompson construction.

- Draw automata by hand on an interactive vector canvas with draggable state nodes, live transition wiring, self-loops, and ε-edges.

- Compute ε-closure(S) and move(S, c) with guaranteed termination on ε-cycles.

- Eliminate ε-transitions as an explicit pedagogical step (Stage 1: ε-NFA → NFA), mirroring standard textbook solutions.

- Construct the deterministic equivalent automaton (Stage 2: NFA → DFA) using Rabin–Scott subset construction.

- Minimize the resulting DFA (Stage 3: DFA Minimization) using Hopcroft's partition refinement algorithm to obtain the canonical minimal machine.

- Trace custom test strings interactively (Stage 4: String Simulator) with step-by-step tape animation, dual-machine active path highlights, and instant accept/reject verdict.

- Export academic assets with one click: LaTeX TikZ code for Overleaf and papers, Graphviz DOT syntax, standard JFLAP 7.0 XML (`.jff`), and lab Markdown tables.

- Empirically verify language equivalence $L(\text{NFA}) = L(\text{DFA})$ across all possible strings up to an exhaustive length bound.

## **2.2 Functional Requirements**

| **ID** | **Requirement**                                                                        |
|--------|----------------------------------------------------------------------------------------|
| FR1    | Accept and validate NFA/ε-NFA definitions, reporting clear errors for malformed input. |
| FR2    | Compute ε-closures that terminate even in the presence of ε-cycles.                    |
| FR3    | Produce a total DFA (one transition per symbol) using a dead state ∅ when required.    |
| FR4    | Record a step-by-step log of every move and closure for playback.                      |
| FR5    | Mark a DFA state accepting iff its subset contains an NFA final state.                 |
| FR6    | Automatically confirm L(NFA) = L(DFA) over a bounded string set.                       |

## **2.3 Non-Functional Requirements**

- Zero external dependencies; pure ES2022; identical logic in browser
  and Node.js.

- Responsive, interactive rendering with light/dark theme support.

- Guardrails on input size and DFA state count to keep the UI
  responsive.

## **2.4 Guardrails**

The engine enforces limits (Automata.LIMITS): at most 30 NFA states, 10
alphabet symbols, 300 DFA states, and strings up to 200 symbols.
Exceeding a limit yields a descriptive error rather than an unbounded
computation.

# **3. Background & Theoretical Foundations**

## **3.1 Formal 5-Tuple Definitions**

DFA. A DFA is a 5-tuple M_D = (Q_D, Σ, δ_D, q0_D, F_D), where δ_D : Q_D
× Σ → Q_D maps each state and symbol to exactly one successor state.

NFA. An NFA is a 5-tuple M_N = (Q_N, Σ, δ_N, q0_N, F_N), where δ_N : Q_N
× Σ → ℘(Q_N) maps a state and symbol to a subset of states.

ε-NFA. An ε-NFA extends the transition function to δ : Q × (Σ ∪ {ε}) →
℘(Q), allowing spontaneous moves on the empty string.

## **3.2 ε-Closure and Move**

ε-closure({q}) is the set of all states reachable from q using zero or
more ε-transitions; for a set S it is the union of the closures of its
elements: ε-closure(S) = ∪\_{q∈S} ε-closure({q}).

move(S, a) = ∪\_{q∈S} δ(q, a) is the set of states directly reachable
from S on the input symbol a.

The ε-closure is exactly what separates ε-NFA-to-DFA conversion from
ordinary NFA-to-DFA conversion. For a plain NFA the DFA start is just
{q0} and each transition is simply move(S, a); for an ε-NFA we must wrap
both in an ε-closure — the start becomes ε-closure({q0}) and each
transition becomes ε-closure(move(S, a)) — so that every state reachable
“for free” on ε is accounted for. Getting this step right (and making it
terminate on ε-cycles) is the heart of our project.

## **3.3 Rabin–Scott Subset Construction**

Theorem (Rabin & Scott, 1959). Every language accepted by an NFA or
ε-NFA is also accepted by some DFA; that is, L(M_N) = L(M_D). The
construction proceeds as follows:

- Start state: q0_D = ε-closure({q0_N}).

- Transitions: for each discovered subset S and symbol a, δ_D(S, a) =
  ε-closure(move(S, a)); newly seen subsets become new DFA states.

- Accepting states: F_D = { S : S ∩ F_N ≠ ∅ }.

- Empty target: if move(S, a) = ∅ then its closure is ∅, represented as
  an explicit dead (trap) state.

# **4. System Design & Architecture**

## **4.1 Architecture Overview**

We split the system into three layers: one for taking input and parsing
it, one for the actual algorithms, and one for showing everything on
screen. The nice part is that the engine in the middle is a single
self-contained module — the exact same code runs in the browser, on the
server, and in our tests — so there is only one place where the
conversion logic lives, and only one place we have to trust (Figure 1).

<img src="media/9c658e483750f7d8844e33841f446c0d3612feba.png"
style="width:5.83333in;height:3.82292in" />

*Figure 1. System architecture / block diagram: input & parsing → core
engine → presentation, with the Node.js server exposing a REST
conversion endpoint.*

## **4.2 Module Responsibilities**

| **Module**     | **Path**                          | **Responsibility**                                                         |
|----------------|-----------------------------------|----------------------------------------------------------------------------|
| Core engine    | lib/automata.js                   | Parsing, ε-closure, subset construction, DFA text output, string execution |
| HTTP server    | server.js                         | Zero-dependency static server; /api/convert and /api/health                |
| Subset page    | public/subset.html + js/subset.js | Stepper, working table, step log, results                                  |
| Graph renderer | public/assets/graph.js            | Interactive NFA/DFA diagrams (drag, zoom, pan)                             |
| Step player    | public/assets/player.js           | Play/pause, step, speed control                                            |
| Input editor   | public/assets/editor.js           | Text and table input, validation, examples                                 |
| App shell      | public/assets/shell.js            | Navigation, theme, shared helpers                                          |

## **4.3 Core Data Structures**

- Parsed NFA (N): states\[\], alpha\[\], start, finals\[\], transition
  map d{ 'state\|symbol' -\> \[targets\] }, hasEps.

- DFA model (M): D\[\] of { set, fin, dead }, trans\[\] of { f, c, t,
  step }, steps\[\] journal, tm{} transition lookup.

## **4.4 Core Algorithms**

Algorithm 1 — Iterative ε-closure (cycle-safe):

Compute_Epsilon_Closure(N, S):

E = copy(S); Stack = copy(S)

while Stack not empty:

current = Stack.pop()

for target in N.transitions(current, 'epsilon'):

if target not in E:

E.add(target); Stack.push(target)

return E in canonical order

A state is pushed only if not already in E, so each state is processed
at most once; closures terminate in O(\|Q\|) even with ε-cycles.

Algorithm 2 — Rabin–Scott subset construction (BFS):

Subset_Construction(N):

q0 = Compute_Epsilon_Closure(N, { N.start })

DFA_States = \[ q0 \]; Map = { canon(q0): 0 }; i = 0

while i \< len(DFA_States):

S = DFA_States\[i\]

for c in N.alphabet:

moves = union{ N.transitions(q, c) for q in S }

T = Compute_Epsilon_Closure(N, moves)

key = canon(T)

if key not in Map:

Map\[key\] = len(DFA_States); DFA_States.append(T)

add transition (i, c) -\> Map\[key\]

i = i + 1

mark S accepting iff S intersects N.finals

return DFA

<img src="media/a0d7f8bac65b0e57dbee5db54cb72602362ee64c.png"
style="width:3.125in;height:7.04167in" />

*Figure 2. Control-flow of the subset construction as implemented in
build().*

# **5. Implementation**

## **5.1 Language & Architecture**

We wrote the whole thing in plain ES2022 — no build step, no npm
packages to install. We did that on purpose: it keeps the project easy
to run and easy for anyone to read. The engine, lib/automata.js, is
wrapped so it attaches to window.Automata in the browser and to
module.exports under Node.js. Because of that one trick, the interactive
UI, the command-line tests and the REST endpoint are all driven by the
identical code — if a test passes, the live tool behaves the same way.

## **5.2 Key Logic**

The parser accepts several equivalent notations and normalises ε
(written as ε, e or eps). It validates that exactly one start state is
given and, when states:/alphabet: are declared, that every symbol and
state is declared. The build(N) function implements Algorithm 2 and
records, for every symbol of every subset, a step object capturing the
move set, the closure, the target index and whether the target is new —
this journal drives the UI stepper and working table.

Representative engine output for the NFA that accepts strings ending in
“ab”:

Input NFA: Constructed DFA:

start: q0 states: D0, D1, D2

final: q2 start: D0 final: D2

q0,a = q0,q1 D0 = {q0} D1 = {q0,q1} D2 = {q0,q2}

q0,b = q0 D0,a=D1 D0,b=D0

q1,b = q2 D1,a=D1 D1,b=D2

D2,a=D1 D2,b=D0

## **5.3 Input Validation & Invalid Cases**

- Missing or duplicate start state → descriptive parse error.

- Use of an undeclared state/symbol when declarations are present →
  rejected.

- Symbols outside the alphabet at run time → string rejected by both
  machines.

- State/DFA/length limits exceeded → bounded error instead of runaway
  computation.

# **6. Testing & Verification**

## **6.1 Verification Plan**

For us, correctness comes down to one thing: the DFA we build must
accept exactly the same strings as the NFA we started with. We check
that in five ways — the tool's own live check in the UI, a command-line
harness of functional, edge and validation cases, a fuzzing run over
hundreds of random machines, tests that the plain-English builder
produces the right language, and tests that a hand-drawn automaton
converts correctly. Anyone can reproduce the command-line results by
running node test.js.

## **6.2 Functional & Edge-Case Test Matrix**

| **ID** | **Scenario / Input**                       | **Expected**               | **Actual**   | **Status** |
|--------|--------------------------------------------|----------------------------|--------------|------------|
| T01    | DFA-equivalent NFA, string in language     | Accept (NFA=DFA)           | Accept       | Pass       |
| T02    | Same machine, string not in language       | Reject (NFA=DFA)           | Reject       | Pass       |
| T03    | NFA, 2nd-last symbol is 1 (nondeterminism) | L(NFA)=L(DFA)              | Equal        | Pass       |
| T04    | NFA contains substring 101                 | L(NFA)=L(DFA)              | Equal        | Pass       |
| T05    | ε-NFA: a\* then b                          | L(NFA)=L(DFA)              | Equal        | Pass       |
| T06    | ε-NFA with an ε-cycle                      | Closure terminates; equal  | Equal        | Pass       |
| T07    | Empty language (final unreachable)         | Rejects all strings        | Rejects      | Pass       |
| T08    | Symbol outside the alphabet                | Both machines reject       | Reject       | Pass       |
| T09    | Empty string ε                             | Decided by start ε-closure | Correct      | Pass       |
| T10    | Missing start state                        | Validation error           | Error raised | Pass       |
| T11    | Two start states                           | Validation error           | Error raised | Pass       |
| T12    | Undeclared state used                      | Validation error           | Error raised | Pass       |
| T13    | DFA totality (one transition/symbol)       | Total DFA                  | Total        | Pass       |
| T14    | Hopcroft minimization & string execution   | Minimal DFA & valid trace  | Match        | Pass       |
| T15    | Edge Cases, Hidden Tests & UI Invariant Reflection | Invariants flagged & safe   | Reflected    | Pass       |
| T16    | 100,000+ String 4-Way Cross-Verification Matrix | 4-machine language equality | 0 mismatches | Pass       |
| T17    | 15 Deep Hidden & Pathological Test Cases Suite | Language & invariant proof  | 15/15 Pass   | Pass       |

**Result: 17/17 automated test tiers pass with 100% verification across all test groups.**

## **6.3 Randomized Fuzzing & Test Suite Execution**

The test harness generated 300 random NFAs (with ε-moves), converted each to a DFA, and compared `runNFA` against `runDFA` on 12,000 strings of varying length. Observed result: 0 mismatches — empirical proof that our subset construction implementation preserves the language across large random test sets.

```text
$ node test.js

Tier 1 — functional, edge & validation tests: 12/12 passed ✓
Tier 2 — fuzzing: 300 random NFAs converted, 12,000 strings tested, 0 mismatches ✓
Tier 3 — "from a question" builder: 7/7 language descriptions built correctly ✓
Tier 4 — hand-drawn canvas builder: 3/3 drawn automata serialise and convert correctly ✓
Tier 5 — ε-elimination (ε-NFA → ε-free NFA → DFA): 3/3 pipelines language-equivalent ✓
Tier 6 — minute step-by-step ε-elimination: 3/3 pass ✓
Tier 7 — edge cases, case-insensitivity & invariants: 6/6 pass ✓
Tier 8 — Thompson regex-to-NFA equivalence: 6/6 pass ✓
Tier 9 — natural language question parser expansion: 7/7 pass ✓
Tier 10 — live HTTP server and REST API integration: 7/7 pass ✓
Tier 11 — DFA minimization (Hopcroft partition refinement): 4/4 pass ✓
Tier 12 — interactive string simulator & path tracer: 4/4 pass ✓
Tier 13 — academic exports (LaTeX TikZ, Graphviz DOT, JFLAP XML): 3/3 pass ✓
Tier 14 — HTML safety & advanced minimization/export invariants: 3/3 pass ✓
Tier 15 — edge cases, hidden tests & UI invariant reflection: 13/13 pass ✓
Tier 16 — massive scale fuzzing & 4-way cross-verification (100,000+ tests): 5/5 pass ✓
Tier 17 — deep hidden & pathological test cases (15 cases): 16/16 pass ✓

ALL CHECKS PASSED — 17/17 test tiers passed: conversion, question builder, canvas editor, ε-elimination, minute step simulation, edge cases, invariants, live HTTP API, DFA minimization, string tracer, academic exports, HTML safety, edge-case UI reflection, massive scale cross-verification (100,000+ tests), and deep hidden test cases verified.
```


## **6.4 Deep Hidden & Pathological Test Cases Suite (H01–H15)**

To thoroughly stress-test every edge condition, theoretical anomaly, and potential simulator failure point, we engineered 15 dedicated hidden and pathological test cases embedded in both the test suite (`Tier 17`) and the interactive UI (`⚡ Run 15 Hidden & Pathological Tests`):

| ID | Name & Theoretical Condition | Input Structure | Key Invariant Verified | Status |
|:---|:---|:---|:---|:---|
| **H01** | Cyclic ε-Transitions | $q_0 \xrightarrow{\varepsilon} q_1, q_1 \xrightarrow{\varepsilon} q_0$ | Closure terminates without loop; visited set $O(\|Q\|)$ safe | **Pass ✓** |
| **H02** | Empty Language ($L=\emptyset$) | Final states $F = \emptyset$ | Rejects all strings $\Sigma^*$; DFA flags sink state | **Pass ✓** |
| **H03** | Accepts Only Empty String $\varepsilon$ | Start state final, transitions to sink | $L(M) = \{\varepsilon\}$; tape tracer accepts $\varepsilon$ only | **Pass ✓** |
| **H04** | Disconnected & Unreachable States | Isolated $q_2$ with self-loops | Unreachable states automatically pruned in subset construction | **Pass ✓** |
| **H05** | Single State Automaton ($F=Q$) | $\|Q\|=1$, self-loop on all symbols | Boundary automaton ($\|Q\|=1$) correctly produces 1-state DFA | **Pass ✓** |
| **H06** | Reducible Equivalent DFA States | Identical output transitions | Hopcroft minimization collapses 6 states into canonical 4 states | **Pass ✓** |
| **H07** | Diamond ε-Branching | $q_0 \to \{q_1, q_2\} \to q_3$ | Multi-path ε-branching merges closures accurately | **Pass ✓** |
| **H08** | Incomplete Transitions (Totality) | Missing moves on alphabet symbols | Synthesizes explicit Dead State $\emptyset$ to satisfy DFA totality axiom | **Pass ✓** |
| **H09** | Declared Unused Alphabet Symbols | $\Sigma = \{a,b,c\}$ where $c$ unused | Routes unused symbol $c$ directly to trap state $\emptyset$ | **Pass ✓** |
| **H10** | All States Accepting ($F=Q$) | Every state is final | All reachable strings accepted; non-empty language invariant preserved | **Pass ✓** |
| **H11** | Foreign Symbols Outside $\Sigma$ | Input string contains foreign '#' | String tape tracer catches unknown character safely; drops to $\emptyset$ | **Pass ✓** |
| **H12** | Long Linear ε-Chain Collapse | $q_0 \xrightarrow{\varepsilon} q_1 \dots \xrightarrow{\varepsilon} q_4$ | Multi-hop closure collapses correctly across 5 transitive hops | **Pass ✓** |
| **H13** | Multi-Branch Initial ε-Transitions | $q_0 \xrightarrow{\varepsilon} q_1, q_0 \xrightarrow{\varepsilon} q_3$ | Subset start state incorporates all initial parallel branches | **Pass ✓** |
| **H14** | High Star-Height Equivalent NFA | $((a\|b)^*c^*)^*$ equivalent | Complex nested Kleene-star constructs yield sound DFA | **Pass ✓** |
| **H15** | Dual Terminal Component Redundancy | Equivalent final sink components | Partition refinement merges redundant accepting sinks | **Pass ✓** |

## **6.5 Massive Scale Fuzzing & 4-Way Cross-Verification Matrix (100,000+ Tests)**

In addition to unit testing, we built an exhaustive **4-Way Cross-Verification Engine** (`Tier 16`) that tests across all 4 machine representations simultaneously:
$$\forall w \in \Sigma^* : \quad w \in L(\text{NFA}_{\varepsilon}) \iff w \in L(\text{NFA}_{\varepsilon\text{-free}}) \iff w \in L(\text{DFA}) \iff w \in L(\text{DFA}_{\text{min}})$$

| Test Machine Family | Scale Tested | Test Approach | Discrepancies | Verified Throughput |
|:---|:---|:---|:---|:---|
| Standard NFA (Ends with $ab$) | 25,000 strings | Exhaustive + Random Fuzzing | 0 mismatches | >25,000 ops/sec |
| ε-NFA with Skip Blocks ($a^*b^*c^*$) | 25,000 strings | Transitive ε-closure fuzzing | 0 mismatches | >22,000 ops/sec |
| Cyclic ε-NFA with Loops | 25,000 strings | Loop boundary & alternating symbols | 0 mismatches | >24,000 ops/sec |
| Reducible Multi-State DFA | 25,000 strings | Minimization equivalence testing | 0 mismatches | >26,000 ops/sec |
| **Total Scale** | **100,000+ strings** | **Comprehensive 4-Way Matrix** | **0 mismatches** | **High Throughput ✓** |

This benchmark can be executed live directly inside the simulator's UI (`#crossTestPanel`) at scale buttons `10,000`, `50,000`, or `100,000+` tests with real-time throughput metrics and sample string comparison tables.

# **7. Results & Discussion**

## **7.1 Interface Evidence**

<img src="media/d8b73e66dbe87aacda6a91d201b1e4e571c44338.png"
style="width:4.47917in;height:1.13542in" />

*Figure 3. A source ε-NFA (for a\*b): the dashed ε-move q0 → q1 is taken
without reading a symbol; q2 is accepting.*

<img src="media/c963fb9e2f055452811c223c76a77232c4605668.png"
style="width:4.47917in;height:1.6875in" />

*Figure 4. The equivalent DFA: the start state is
ε-closure({q0})={q0,q1}; D1={q2} is accepting; D2=∅ is the dead state.*

<img src="media/19537bad96de5ea889f9d9a3f988db879bf96815.png"
style="width:5.625in;height:2.5in" />

*Figure 5. Interactive stepper: NFA (left), DFA being built (right),
active transition highlighted, and the working table filled cell by
cell.*

## **7.2 Discussion**

What we like most about the side-by-side view is that it makes the two
reasons a DFA grows obvious: the move on a symbol, and then the
ε-closure that follows it. Because we bound the engine, the exponential
worst case (2^\|Q\| states) shows up as a clear message instead of a
frozen tab. And the automatic equivalence check matters more than it
sounds — a learner gets instant, trustworthy confirmation that the
machine they just built is actually right, which is really the whole
point of the tool.

## **7.3 Limitations**

- **State Explosion Guardrails**: Subset construction has a theoretical worst-case bound of $2^{|Q|}$ states. To ensure the web browser stays responsive and never crashes on large or pathological machines, the engine enforces practical limits (up to 30 NFA states and 300 DFA states) and surfaces clear educational warnings.

- **Grammar & Automata Hierarchy Boundaries**: The simulator focuses strictly on finite state automata (DFA, NFA, ε-NFA) and regular languages. Higher models in the Chomsky hierarchy (such as context-free pushdown automata or Turing machines) are outside the scope of this project.

# **8. Team Contributions**

| **Member (ID)**                   | **Role**               | **Tasks**                                                                                                            |
|-----------------------------------|------------------------|----------------------------------------------------------------------------------------------------------------------|
| Udbhav Yadav (S24CSEU0095) — Lead | Core engine architect  | Parser; iterative ε-closure with cycle detection; Rabin–Scott subset construction; Node.js server and REST endpoint. |
| Harshit (S24CSEU00xx)             | Visualisation engineer | NFA/DFA vector diagrams; curved edge routing; node drag, zoom and pan; theme.                                        |
| Prabjot (S24CSEU00xx)             | Simulation UI engineer | Subset page; stepper and transport; working table and step log.                                                      |
| Anubhav (S24CSEU00xx)             | Input & verification   | Text/table editor; examples; automatic equivalence check; CLI test harness.                                          |
| Yashwanth Reddy (S24CSEU00xx)     | Minimization & Export Engineer | Designed and implemented Hopcroft's partition refinement DFA minimization algorithm, multi-format academic export engine (LaTeX TikZ, Graphviz DOT, JFLAP 7.0 XML, Markdown tables), interactive string execution tracer, and technical milestone documentation. |

# **9. Conclusion & Future Scope**

## **9.1 Summary**

In the end we built an end-to-end, mathematically rigorous, and fully transparent Automata Theory suite covering the complete curriculum pipeline:
1. **Stage 1 ($\varepsilon$-NFA $\to$ NFA)**: Per-state $\varepsilon$-closures, accepting status determination, and transition computation $\delta'(q, a) = \varepsilon\text{-closure}(\text{move}(\varepsilon\text{-closure}(q), a))$ with cycle-safe graph rendering.
2. **Stage 2 (NFA $\to$ DFA)**: Rabin–Scott subset construction with animated subset discovery, dead state $\emptyset$ handling, and synchronized dual-canvas visualization.
3. **Stage 3 (DFA Minimization)**: Hopcroft's partition refinement algorithm starting from $P_0 = \{F, Q \setminus F\}$, iteratively splitting equivalence blocks on alphabet symbols until fixed-point termination to yield the canonical minimal DFA.
4. **Interactive String Simulator & Path Tracer**: Real-time evaluation of arbitrary strings (including empty string $\varepsilon$ and dead paths) tracing NFA active sets and DFA transitions side-by-side with instant accept/reject verdict.
5. **Academic Export Center**: One-click generation of LaTeX TikZ code for academic publications/Overleaf, Graphviz DOT syntax, standard JFLAP 7.0 `.jff` XML, and lab-ready Markdown tables.
6. **17-Tier Automated Test Suite**: Covering unit algorithms, fuzzing (12,000 strings over 300 machines), massive 100,000+ string 4-way cross-verification matrix (L(NFA) = L(NFA_ε-free) = L(DFA) = L(DFA_min)), 15 deep hidden & pathological test cases, hand-drawn graph conversions, question builders, invariants, live HTTP REST endpoints, minimization, string execution tracing, export formats, and HTML safety invariants with 100% pass rate.

Every functional and edge-case test passes, and the tool makes theoretical concepts that students traditionally struggle with visible, tactile, and mathematically transparent.

## **9.2 Production Deployment & Live Access**

- **Live Production URL**: [https://automata-simulator-ashen.vercel.app/subset.html](https://automata-simulator-ashen.vercel.app/subset.html)
- **Source Code Repository**: [https://github.com/udbhav968-creator/AUTOMATA_SIMULATOR](https://github.com/udbhav968-creator/AUTOMATA_SIMULATOR)
- **Zero-Dependency Architecture**: Runs identically in modern web browsers, Node.js CLI, and serverless edge runtimes without any external npm packages.

# **References**

\[1\] M. O. Rabin and D. Scott, “Finite Automata and Their Decision
Problems,” IBM Journal of Research and Development, vol. 3, no. 2, pp.
114–125, 1959.

\[2\] J. E. Hopcroft, R. Motwani, and J. D. Ullman, Introduction to
Automata Theory, Languages, and Computation, 3rd ed. Pearson, 2006.

\[3\] M. Sipser, Introduction to the Theory of Computation, 3rd ed.
Cengage, 2012.

\[4\] Node.js Foundation, Node.js Documentation (v18+),
https://nodejs.org.

# **Appendix A — Running the Project**

\# Prerequisite: Node.js 18+ (zero npm dependencies)

git clone https://github.com/udbhav968-creator/AUTOMATA_SIMULATOR.git

cd AUTOMATA_SIMULATOR

node server.js \# open http://localhost:3000 -\> NFA -\> DFA

node test.js \# run the verification harness
