# PDF → Interactive Lesson Agent

Turns an uploaded PDF into a quiz-driven lesson: the agent drafts a lesson plan, pauses for human approval, then generates one multiple-choice question per objective, grades answers, hints on misses, and writes a personalized wrap-up.

**Stack:** LangGraph.js (orchestration + `interrupt()`-based HITL), CopilotKit (tutor chat), Next.js App Router, TypeScript, Tailwind. Model access goes through a configurable fallback chain ending in a deterministic offline mock, so the full flow runs with no API key.

## Quick start

Requires Node 20+ (tested on 22).

```bash
npm install
cp .env.example .env.local     # optional; without keys it runs in mock mode
npm run dev
```

Open http://localhost:3000 and upload a text-based PDF.

## LLM configuration

Every generation walks a fallback chain: on any error (bad key, rate limit, malformed output) it tries the next provider, ending at an offline mock. The active chain renders in the app header, e.g. `LLM: gemini → openrouter`.

```bash
GEMINI_API_KEY=...        # https://aistudio.google.com/apikey
OPENROUTER_API_KEY=...    # https://openrouter.ai/keys — free-model backup
AI_GATEWAY_API_KEY=...    # https://vercel.com/ai-gateway — OpenAI-compatible, ~375 models
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

Auto-detect order, filtered to providers that have a key: `gemini → openrouter → vercel → anthropic → openai → mock`.

| Variable | Effect |
| --- | --- |
| `LLM_PROVIDER` | Pin a single primary: `gemini\|openrouter\|vercel\|anthropic\|openai\|mock` |
| `LLM_FALLBACK_PROVIDER` | One backup, used only when `LLM_PROVIDER` is set |
| `GEMINI_MODEL`, `OPENROUTER_MODEL`, `AI_GATEWAY_MODEL`, `ANTHROPIC_MODEL`, `OPENAI_MODEL` | Per-provider model override |

Two operational notes:

- Gemini's free tier is ~20 requests/day **per model**; one lesson run costs ~6 before any tutor chat. Past that the chain still works, but every call first pays a failed Gemini attempt — pin `LLM_PROVIDER=openrouter` or switch `GEMINI_MODEL` (separate daily bucket) for extended demos.
- OpenRouter retires free model slugs without notice. If the backup 404s, pick a current slug or set `OPENROUTER_MODEL=openrouter/free` to let OpenRouter route across whatever is free that day.

## Flow

```
Upload PDF ─► extract text ─► draft plan (objectives + difficulty)
                                   │
                         ⏸ HITL: review / edit / approve
                                   │
     ┌─────────────────────────────┴──────────────────────────────┐
     │ per objective:                                             │
     │   generate MCQ from the PDF text                           │
     │   ⏸ HITL: learner answers                                  │
     │   correct   → ⏸ reveal explanation → advance               │
     │   incorrect → hint → retry (unlimited, no penalty)         │
     │   skip      → advance                                      │
     └─────────────────────────────┬──────────────────────────────┘
                                   │
              summary: score, strengths, focus areas, study tips
```

Each ⏸ is a real LangGraph `interrupt()`: the graph suspends, `/api/lesson` returns the pending payload, and a `Command({ resume })` restarts it from the checkpoint.

## Architecture

```
Browser
 ├─ PdfUpload ────────────────► POST /api/extract-pdf   pdfjs-dist → text
 ├─ PlanApproval / McqCard / SummaryCard
 │     ▲ state + pending interrupt
 │     ▼ POST /api/lesson { start | resume }
 └─ CopilotSidebar ───────────► POST /api/copilotkit    tutor chat

Server
 ├─ /api/lesson    drives the graph; MemorySaver checkpointer keyed by thread_id
 └─ agent/graph.ts make_plan → approve_plan⏸ → generate_question
                   → ask_question⏸ → (reveal⏸ | retry | skip) → advance → summarize
```

### Answer containment

The correct option is structurally unreachable from the browser, not just discouraged by prompt:

- The full MCQ (`correctOptionId`, `explanation`) exists only in server-side graph state.
- Interrupt payloads and API responses carry a `PublicMCQ` with both fields stripped ([`toPublicMCQ`](src/lib/protocol.ts)).
- They are released only by the `reveal` interrupt, after a correct answer.
- The tutor chat receives the question and a conceptual hint via `useCopilotReadable` — never the answer — so it cannot leak what it was never given.
- [`agent/llm.ts`](src/agent/llm.ts) and [`agent/graph.ts`](src/agent/graph.ts) import `server-only`, making a client-side import of the answer key or the provider credentials a build error rather than a convention.

### One interrupt per node

LangGraph re-executes a node on resume, so each node contains at most one `interrupt()`. Retries are a conditional **edge** back into `ask_question` rather than an in-node loop, which keeps checkpoint/resume deterministic.

### Question prefetching

Generating an MCQ is a 6–12s round trip. Paying it on click stalled every transition, so [`graph.ts`](src/agent/graph.ts) generates objective *n+1*'s question in the background while the learner works on *n*, and warms the first question while the plan sits in review. Measured with a 12s pause per question: plan approval → Q1 dropped from 9.6s to 0.1s, and Continue → next question from 6–12s to ~0.02s. A revised plan invalidates anything queued against the old objectives.

### Option shuffling

Models put the correct answer first far more often than chance — measured at 3/4 on this prompt. [`llm.ts`](src/agent/llm.ts) deals the options into a random order and re-letters them server-side after generation, which fixes the bias for every provider at once instead of relying on prompt instructions.

### Structured output without tool calling

`withStructuredOutput()` is deliberately unused: its JSON Schema (with `$ref` for reused enums) is rejected by Gemini's `response_schema`, and many free models have no function-calling support. Instead the prompt requests a bare JSON object, and the response is parsed and validated with zod — the most provider-agnostic path, and what makes the fallback chain viable across such different models.

## Implementation map

| Concern | Location |
| --- | --- |
| PDF text extraction | [`/api/extract-pdf`](src/app/api/extract-pdf/route.ts), [`PdfUpload`](src/components/PdfUpload.tsx) |
| Graph, nodes, routing, prefetch | [`agent/graph.ts`](src/agent/graph.ts) |
| State channels | [`agent/state.ts`](src/agent/state.ts) |
| Provider chain, generation, mock | [`agent/llm.ts`](src/agent/llm.ts) |
| Prompts | [`agent/prompts.ts`](src/agent/prompts.ts) |
| HITL wire contract | [`lib/protocol.ts`](src/lib/protocol.ts) |
| Start/resume endpoint | [`/api/lesson`](src/app/api/lesson/route.ts) |
| Tutor chat runtime | [`/api/copilotkit`](src/app/api/copilotkit/route.ts) |
| UI state machine | [`LessonApp`](src/components/LessonApp.tsx) |
| Widgets | [`PlanApproval`](src/components/PlanApproval.tsx), [`McqCard`](src/components/McqCard.tsx), [`SummaryCard`](src/components/SummaryCard.tsx) |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build (includes a full typecheck) |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest run (`npm run test:watch` to watch) |

## Tests

`npm test` covers the pure logic that would fail silently in the UI:

- `toPublicMCQ` strips the answer key from every payload that crosses the wire, asserted on the serialized JSON rather than the object.
- `shuffleOptions` keeps `correctOptionId` on the correct text across 2,000 shuffles, re-letters `a`–`d`, spreads the answer across all four positions, and handles duplicate option texts.
- `afterAsk` / `afterAdvance` route correctly, including the off-by-one where the index equals the objective count.
- The `/api/lesson` request schema accepts each resume verb and rejects unknown verbs, malformed plans and non-string option ids.

The suite is node-only and network-free; `server-only` is aliased to a stub in [`vitest.config.mts`](vitest.config.mts), since that guard is enforced by `next build`.

## Trade-offs and limits

- **Checkpointer:** `MemorySaver` keyed by `thread_id` — single-process only. Swapping in a Postgres/Redis checkpointer requires no graph changes. The prefetch cache is likewise in-process.
- **CopilotKit is pinned to 1.8.x.** Releases from 1.70 on are effectively v2 under a v1 version number: they deprecate the `LangChainAdapter` the tutor chat uses and require an explicit `BuiltInAgent` with AI SDK models. Upgrading is a migration, not a version bump, and would give up the shared LangChain provider chain. The in-app upgrade nag is switched off via `showDevConsole={false}`.
- **Chat fallback:** the tutor chat walks the same provider chain, pulling the first stream chunk eagerly so an error surfaces early enough to fail over rather than mid-reply.
- **Scanned PDFs:** extraction is text-layer only; image-only PDFs are rejected with an explicit message. OCR would be an added step.
- **Mock mode** is keyword/sentence heuristics — enough to exercise every path offline, but questions are not genuinely content-grounded and the tutor chat is disabled.
