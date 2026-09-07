# 🧠 Memorang Lesson Agent

An AI learning agent that turns a **PDF into an interactive, quiz-driven lesson** — with a human-in-the-loop plan approval step, custom MCQ widgets, green/red feedback with hints and explanations, and a personalized wrap-up.

Built with **LangGraph.js** (agent orchestration + real interrupt-based HITL) and **CopilotKit** (tutor chat + generative context), fully in **TypeScript** on **Next.js**. It runs against **Anthropic or OpenAI**, and ships with a **deterministic mock mode** so you can run and demo the entire flow with no API key.

---

## The flow

```
Upload PDF ──► Agent extracts text ──► Drafts a lesson plan (objectives + difficulty)
                                             │
                                   ◄── HITL: you review / edit / approve ──►
                                             │
        ┌────────────────────────────────────┴───────────────────────────┐
        │  For each objective:                                            │
        │    • Agent generates an MCQ from the PDF                         │
        │    • Widget renders question + radio choices + submit            │
        │    • Correct  → green highlight + explanation → continue         │
        │    • Incorrect→ red highlight + hint → retry (no penalty)        │
        │    • Tutor chat can explain / hint — but never reveals the answer│
        └────────────────────────────────────┬───────────────────────────┘
                                             │
                              Summary: score, strengths, focus areas, study tips
```

Each arrow marked **HITL** is a genuine LangGraph `interrupt()` — the graph pauses, the server returns the pending question to the browser, and only resumes when you send a decision back via a `Command`.

---

## How it maps to the acceptance criteria

| Criterion | Where |
| --- | --- |
| Accepts a PDF upload and parses relevant content | [`/api/extract-pdf`](src/app/api/extract-pdf/route.ts) (`pdfjs-dist`) + [`PdfUpload`](src/components/PdfUpload.tsx) |
| Presents a plan (objectives + difficulty) for generation | `make_plan` node in [`graph.ts`](src/agent/graph.ts), rendered by [`PlanApproval`](src/components/PlanApproval.tsx) |
| HITL interrupt to review the plan before proceeding | `approve_plan` node → `interrupt()`; resumed from the UI |
| MCQs generated directly from the PDF content | `generate_question` node → [`generateMCQ`](src/agent/llm.ts) (prompt is grounded in the extracted text) |
| MCQ widget renders with radio selection | [`McqCard`](src/components/McqCard.tsx) |
| Correct answer → explanation displayed | `reveal` node returns the explanation; green highlight in `McqCard` |
| Incorrect answer → hint + retry without penalty | `ask_question` loops back through a graph edge; attempts are tracked but never block progress |
| Proceed through all MCQs until completion | `advance` node + conditional edges iterate every objective |
| Summary of results + study tips at the end | `summarize` node → [`SummaryCard`](src/components/SummaryCard.tsx) |
| "Learn more / hint" without giving away the answer | CopilotKit tutor sidebar; the correct option **never leaves the server** (see below) |

---

## Quick start

**Requirements:** Node 20+ (tested on Node 22).

```bash
npm install
cp .env.example .env.local     # optional — see "Configuring the LLM" below
npm run dev
```

Open http://localhost:3000, upload a text-based PDF, and go.

> **No API key?** It just works in **mock mode** — the plan and questions are generated with offline heuristics so you can click through the whole flow. The tutor chat is the only thing that needs a real model.

---

## Configuring the LLM

The provider is chosen by `LLM_PROVIDER`, or auto-detected from whichever key is present. Set these in `.env.local`:

```bash
# Pick one explicitly...
LLM_PROVIDER=anthropic          # or "openai" or "mock"

# ...and provide the matching key:
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Optional model overrides:
# ANTHROPIC_MODEL=claude-sonnet-5
# OPENAI_MODEL=gpt-4o
```

Auto-detection order when `LLM_PROVIDER` is unset: **Anthropic key → OpenAI key → mock**. The active provider is shown in the app header (`LLM: anthropic | openai | mock`).

---

## Architecture

```
Browser (Next.js / React)
 ├─ PdfUpload ─────────────► POST /api/extract-pdf ──► pdfjs-dist → text
 ├─ PlanApproval / McqCard / SummaryCard   (custom generative-UI widgets)
 │      ▲  state + pending interrupt
 │      │  POST /api/lesson  { start | resume }
 │      ▼
 └─ CopilotKit <CopilotSidebar>  ──────────► POST /api/copilotkit (tutor chat)

Server
 ├─ /api/lesson   → drives the LangGraph agent (MemorySaver checkpointer, thread_id)
 └─ agent/graph.ts → make_plan → approve_plan⏸ → generate_question
                       → ask_question⏸ → (reveal⏸ | retry | skip) → advance → summarize
```

### Why the answer can't leak

Cheating-resistance is enforced structurally, not just by prompt:

- The full MCQ (with `correctOptionId` + `explanation`) lives **only in the agent's server-side state**.
- The `/api/lesson` responses and the `question` interrupt send a **`PublicMCQ`** — the correct id and explanation are stripped ([`toPublicMCQ`](src/lib/protocol.ts)).
- The explanation + correct id are revealed **only after** you answer correctly (the `reveal` interrupt).
- The CopilotKit tutor is given the question and a conceptual hint via `useCopilotReadable`, but **not the answer** — so even if asked directly, it physically doesn't have it. Its system prompt also instructs it to give conceptual help and steer you back to finishing the lesson.

### One-interrupt-per-node

LangGraph nodes re-execute on resume, so the graph is designed with **at most one `interrupt()` per node**. Retries are modeled as a graph **edge** looping back into `ask_question` (not an in-node loop), which keeps checkpoint/resume behavior deterministic.

---

## Project structure

```
src/
├─ agent/
│  ├─ graph.ts       # LangGraph state machine (the lesson flow + HITL)
│  ├─ state.ts       # graph state channels
│  ├─ llm.ts         # provider-configurable model + mock; structured generation
│  └─ prompts.ts     # system/user prompts for plan, MCQ, summary
├─ app/
│  ├─ api/
│  │  ├─ lesson/       # start/resume the agent, returns answer-safe state
│  │  ├─ extract-pdf/  # server-side PDF text extraction
│  │  └─ copilotkit/   # CopilotKit runtime for the tutor chat
│  ├─ page.tsx / layout.tsx / globals.css
├─ components/
│  ├─ LessonApp.tsx    # orchestrator: API state machine + tutor sidebar
│  ├─ PdfUpload.tsx  PlanApproval.tsx  McqCard.tsx  SummaryCard.tsx  Providers.tsx
└─ lib/
   ├─ types.ts        # shared domain types
   └─ protocol.ts     # HITL wire contract (interrupt / resume payloads)
```

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (also full typecheck) |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |

---

## Notes & trade-offs

- **State store:** the agent uses LangGraph's in-memory `MemorySaver` keyed by `thread_id`, which is perfect for a single-process demo. For multi-instance production you'd swap in a Postgres/Redis checkpointer — the graph code doesn't change.
- **Scanned PDFs:** extraction is text-based; image-only PDFs (no text layer) are rejected with a clear message. Add OCR if you need them.
- **Mock mode** is heuristic (keyword/sentence based) — great for demoing the mechanics offline, but a real key produces genuinely content-grounded questions and a working tutor chat.
