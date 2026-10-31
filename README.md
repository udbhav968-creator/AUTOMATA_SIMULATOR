# NFA → DFA Studio (CSET302) — full-stack + AI

Zero-dependency project: needs only **Node 18+** (no `npm install`).

```
node server.js          # then open http://localhost:3000
node test.js            # engine tests
```
Optional AI tutor: copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Without it, the chatbot runs in offline rule-based mode.

## Structure
- `lib/automata.js` — parser, ε-closure, subset construction, minimization, NFA/DFA equivalence (shortest counter-example), random question generator
- `server.js` — static server + REST API + AI tutor proxy (API key stays on the server)
- `public/index.html` — interactive simulator (step replay, diagram, string tracer, validation)
- `public/lab.js` — Question Lab (write/save/generate questions, submit-your-DFA checker) and AI chat
- `data/questions.json` — saved questions

## API
| Endpoint | Purpose |
|---|---|
| `POST /api/convert {src}` | NFA → DFA states, transitions, steps, minimal size |
| `GET /api/generate?n=4&k=2&eps=1` | random NFA question |
| `POST /api/check {question, answer}` | checks a student DFA by language equivalence |
| `GET/POST/DELETE /api/questions` | saved questions |
| `POST /api/chat {messages, context}` | AI tutor (can create questions as ```nfa blocks) |
| `GET /api/health` | AI on/offline |

NFA format: `states:`, `start:`, `final:`, then `q0,a = q0,q1`; use `ε` or `e` for epsilon.
