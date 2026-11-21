# Figures & Diagrams Index

Visual evidence and diagrams for the **Automata Studio — NFA → DFA** simulator.

## UI screenshots (`screenshots/`)

| Figure | File | Description |
|---|---|---|
| Figure 1 | `Fig01_NFA_Visualization.png` | Source NFA for strings ending in `ab` (start arrow → q0, accepting q2). |
| Figure 2 | `Fig02_Equivalent_DFA.png` | Equivalent DFA from subset construction: D0={q0}, D1={q0,q1}, D2={q0,q2} (accepting). |
| Figure 3 | `Fig07_Subset_Construction_Stepper_UI.png` | Interactive stepper: NFA (left), DFA being built (right), active transition highlighted, working table filling cell by cell. |

## Generated diagrams (`diagrams/`)

| File | Description |
|---|---|
| `architecture.png` | System architecture / block diagram (input → engine → presentation + REST). |
| `subset_flowchart.png` | Flowchart of the Rabin–Scott subset construction algorithm. |
| `nfa_example.png` | State diagram of the example NFA (strings ending in `ab`). |
| `dfa_example.png` | State diagram of the equivalent DFA. |

*Diagrams are generated with Graphviz from the `.dot` sources in `diagrams/`.*
