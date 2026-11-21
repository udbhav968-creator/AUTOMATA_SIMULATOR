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
| 5        | Yashwanth Reddy  | S24CSEU00xx    | Documentation, report & demonstration assets                |

*(Enrolment numbers shown as S24CSEU00xx are placeholders — replace them
with each member's actual ID.)*

# **Abstract**

Turning an ε-NFA — a non-deterministic finite automaton that may take ε
(empty-string) moves — into an equivalent DFA is one of the first things
we learn in CSET302 — and, as a team, it was also one of the first
things we found genuinely hard to picture. On a whiteboard the subset
construction goes by too fast: by the time the next row is written, the
reasoning behind the last one has vanished. We built Automata Studio to
fix exactly that. You type an NFA (or draw one, or describe it in plain
English), and the tool walks through the Rabin–Scott construction one
subset at a time, showing the set it is working on, the move on each
symbol, the ε-closure it takes, and the moment a brand-new DFA state
appears. The original NFA and the growing DFA sit side by side, and a
working table fills in cell by cell as you step through. When the
conversion finishes, the tool checks its own answer: it runs both
machines on every string up to a length bound and confirms they accept
the same language. We wrote it in plain ES2022 with no external
libraries, so the same engine runs in the browser, on a small Node.js
server, and in our test suite. That suite passes every functional,
edge-case and validation check, and a fuzzing run converted 300 random
NFAs and confirmed NFA–DFA equivalence over 12,000 test strings with
zero mismatches.

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

We kept the scope tight on purpose. What the tool does: parse and
validate NFAs and ε-NFAs; compute ε-closures and moves; run the subset
construction with a full step log, a working table and side-by-side
graphs; check NFA–DFA equivalence automatically; and offer a REST
endpoint. To make input easier we also added a rule-based builder that
turns a plain-English description or a regular expression into an NFA,
and a canvas where you can draw one by hand — but both of these just
feed the same converter. What we deliberately left out: DFA minimisation
and anything beyond finite automata (pushdown or Turing machines). We
would rather do one thing — NFA to DFA — really well and make it
completely transparent.

# **2. Objectives & Requirements**

## **2.1 Supported Operations**

- Parse an NFA / ε-NFA from transition text, δ-notation or arrow
  notation, or a table editor.

- Build an NFA from a plain-English language description
  (ending/starting with, containing, even/odd count, length or count
  divisible by k, at least/at most/exactly n, not containing, binary
  divisible by k) or a regular expression — a deterministic rule-based
  parser, no AI.

- Draw an automaton by hand on an interactive canvas — place state
  circles, drag them, draw transition wires (including self-loops and
  ε-moves), and mark the start and accepting states; the drawing is
  converted to the engine's automaton.

- Compute ε-closure(S) and move(S, c) for any subset S and symbol c.

- Construct the equivalent DFA by the Rabin–Scott subset construction.

- Eliminate ε-moves as an explicit intermediate step — build the
  equivalent ε-free NFA (ε-NFA → NFA), shown in a “Step 0 — eliminate ε”
  panel — then run subset construction on it (NFA → DFA), mirroring a
  hand solution.

- Animate the construction and render the NFA and DFA as interactive
  graphs.

- Verify automatically that the NFA and DFA accept the same language.

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

**Result: 12/12 grouped functional, edge-case and validation checks pass
(T01–T13 above are the individual assertions behind those groups).**

## **6.3 Randomized Fuzzing**

The harness generated 300 random NFAs (with ε-moves), converted each to
a DFA, and compared runNFA against runDFA on 12,000 strings of varying
length. Observed result: 0 mismatches — empirical confirmation that the
subset construction preserves the language across a large random sample.

\$ node test.js

Tier 1 - functional, edge & validation tests: 12/12 passed OK

Tier 2 - fuzzing: 300 random NFAs converted, 12,000 strings tested, 0
mismatches OK

Tier 3 - from-a-question builder: 7/7 language descriptions built
correctly OK

Tier 4 - hand-drawn canvas builder: 3/3 drawn automata serialise and
convert correctly OK

Tier 5 - ε-elimination (ε-NFA → ε-free NFA → DFA): 3/3 pipelines
language-equivalent OK

ALL CHECKS PASSED - subset construction, question builder and canvas
builder all verified.

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

- Subset construction is exponential in the worst case; very large NFAs
  hit the state limit by design.

- The tool handles regular languages only; it does not minimise the
  resulting DFA.

# **8. Team Contributions**

| **Member (ID)**                   | **Role**               | **Tasks**                                                                                                            |
|-----------------------------------|------------------------|----------------------------------------------------------------------------------------------------------------------|
| Udbhav Yadav (S24CSEU0095) — Lead | Core engine architect  | Parser; iterative ε-closure with cycle detection; Rabin–Scott subset construction; Node.js server and REST endpoint. |
| Harshit (S24CSEU00xx)             | Visualisation engineer | NFA/DFA vector diagrams; curved edge routing; node drag, zoom and pan; theme.                                        |
| Prabjot (S24CSEU00xx)             | Simulation UI engineer | Subset page; stepper and transport; working table and step log.                                                      |
| Anubhav (S24CSEU00xx)             | Input & verification   | Text/table editor; examples; automatic equivalence check; CLI test harness.                                          |
| Yashwanth Reddy (S24CSEU00xx)     | Documentation & QA     | Technical report; README; demonstration assets and figures.                                                          |

# **9. Conclusion & Future Scope**

## **9.1 Summary**

In the end we built a focused, correct and transparent ε-NFA-to-DFA
converter (with the ordinary no-ε NFA handled as the natural special
case). It runs the Rabin–Scott subset construction with a cycle-safe
ε-closure at its core, shows every single step, and checks its own
answer automatically. Every functional and edge-case test passes, and
our fuzzing run — 12,000 strings across 300 machines, many of them with
ε-moves — confirmed L(ε-NFA) = L(DFA) with zero mismatches. More than
the marks, the thing we are happiest with is that the tool makes a
process we once found confusing — especially the ε-closure step —
genuinely easy to see.

## **9.2 Future Scope**

- Add an optional DFA minimisation stage (Myhill–Nerode) as a follow-on
  view.

- Export the constructed DFA to common formats (JFLAP, DOT/Graphviz).

- Support regular-expression input via Thompson construction as an
  alternative front end.

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
