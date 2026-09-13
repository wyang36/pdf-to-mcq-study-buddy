"use client";

import { useEffect, useState } from "react";
import {
  useCopilotAction,
  useCopilotAdditionalInstructions,
  useCopilotReadable,
} from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import type { LessonPlan } from "@/lib/types";
import type { LearningObjective } from "@/lib/types";
import type { LessonInterrupt, PublicMCQ } from "@/lib/protocol";
import type { Provider } from "@/agent/llm";
import { PdfUpload, type ExtractedDoc } from "./PdfUpload";
import { PlanApproval } from "./PlanApproval";
import { McqCard, type Feedback } from "./McqCard";
import { SummaryCard } from "./SummaryCard";

interface ClientState {
  phase: string;
  documentTitle: string;
  plan: LessonPlan | null;
  currentObjectiveIndex: number;
  results: { objectiveId: string; attempts: number; solved: boolean }[];
  summary: import("@/lib/types").LessonSummary | null;
  statusMessage: string;
}

interface ActiveQuestion {
  mcq: PublicMCQ;
  objective: LearningObjective;
  objectiveNumber: number;
  objectiveTotal: number;
  attempts: number;
}

interface LessonResponse {
  threadId: string;
  state: ClientState;
  interrupt: LessonInterrupt | null;
  done: boolean;
}

export function LessonApp({
  provider,
  chainLabel,
}: {
  provider: Provider;
  chainLabel: string;
}) {
  const [doc, setDoc] = useState<ExtractedDoc | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [state, setState] = useState<ClientState | null>(null);
  const [interrupt, setInterrupt] = useState<LessonInterrupt | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<ActiveQuestion | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Expose the current question to the tutor chat — WITHOUT the correct answer,
  // which never leaves the server, so the assistant physically cannot spoil it.
  useCopilotReadable({
    description:
      "The multiple-choice question the learner is currently working on in their lesson. Use it to give conceptual help and hints. You do NOT know which option is correct and must never claim to.",
    value: activeQuestion
      ? {
          lessonTitle: state?.plan?.title,
          objective: activeQuestion.objective.title,
          objectiveDescription: activeQuestion.objective.description,
          question: activeQuestion.mcq.question,
          options: activeQuestion.mcq.options,
          conceptualHint: activeQuestion.mcq.hint,
        }
      : "The learner is not on a question right now.",
  });

  function applyResponse(data: LessonResponse) {
    setThreadId(data.threadId);
    setState(data.state);
    setInterrupt(data.interrupt);

    const intr = data.interrupt;
    if (intr?.kind === "question") {
      setActiveQuestion({
        mcq: intr.mcq,
        objective: intr.objective,
        objectiveNumber: intr.objectiveNumber,
        objectiveTotal: intr.objectiveTotal,
        attempts: intr.attempts,
      });
      setFeedback(
        intr.lastWrongOptionId
          ? {
              status: "wrong",
              wrongOptionId: intr.lastWrongOptionId,
              hint: intr.mcq.hint,
            }
          : null,
      );
    } else if (intr?.kind === "reveal_correct") {
      setFeedback({
        status: "correct",
        correctOptionId: intr.correctOptionId,
        explanation: intr.explanation,
      });
    } else {
      setActiveQuestion(null);
      setFeedback(null);
    }
  }

  // Returns the snapshot as well as applying it, so a generative-UI tool call can
  // tell the agent what happened without re-reading React state it cannot see.
  async function callLesson(
    body: Record<string, unknown>,
  ): Promise<LessonResponse | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        // Generation legitimately takes 10-20s when the chain falls through to a
        // backup, but a request that never settles leaves the button spinning
        // forever with no way back — which is what a dev-server recompile does to
        // an in-flight fetch. Fail loudly instead of hanging.
        signal: AbortSignal.timeout(120_000),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      applyResponse(data as LessonResponse);
      return data as LessonResponse;
    } catch (e) {
      const timedOut =
        e instanceof DOMException &&
        (e.name === "TimeoutError" || e.name === "AbortError");
      setError(
        timedOut
          ? "That took too long and was cancelled. The model chain may be rate limited — try again."
          : e instanceof Error
            ? e.message
            : "Something went wrong",
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    doc &&
    callLesson({
      action: "start",
      documentTitle: doc.title,
      sourceText: doc.text,
    });
  const resume = (payload: unknown) =>
    callLesson({ action: "resume", threadId, resume: payload });

  function restart() {
    setDoc(null);
    setThreadId(null);
    setState(null);
    setInterrupt(null);
    setActiveQuestion(null);
    setFeedback(null);
    setError(null);
  }

  // CopilotKit's "Powered by" tag calls a useDarkMode() that branches on
  // `typeof window === "undefined"` during render (react-ui 1.8.14,
  // chunk-JGMFJZMG.mjs), so the server emits the light colour and a dark-mode
  // browser hydrates with the dark one — the first case Next's hydration error
  // lists. The markup is theirs and showPoweredBy is derived internally from
  // holding a CopilotKit Cloud key, so the fix available to us is to keep the
  // chat out of the server render. Nothing is lost: the panel is interactive-only
  // and starts closed, and the readables, actions and instructions are registered
  // by hooks above rather than by this subtree.
  const [chatMounted, setChatMounted] = useState(false);
  useEffect(() => setChatMounted(true), []);

  const showQuiz =
    activeQuestion &&
    (interrupt?.kind === "question" || interrupt?.kind === "reveal_correct");
  const showPlan = interrupt?.kind === "approve_plan" && state?.plan;
  const showSummary = state?.phase === "done" && state.summary && state.plan;

  // --- Generative UI --------------------------------------------------------
  //
  // Both human-in-the-loop moments are exposed as tool calls, so the agent can
  // render the real widget inside the chat thread and WAIT for the learner,
  // rather than telling them to go click the page. Same components as the page
  // uses, same server round trip, so the graph stays the single source of truth
  // and the two surfaces cannot disagree.
  //
  // Neither action takes the plan or the question as a parameter. They render
  // from the snapshot the page already holds, which means the agent cannot
  // invent a question, reword an option, or smuggle in an answer key it does not
  // have. All it controls is WHEN the widget appears.

  useCopilotAction(
    {
      name: "reviewLessonPlan",
      description:
        "Show the learner their draft lesson plan and wait for them to approve or edit it. Use this when the lesson is waiting on plan approval.",
      renderAndWaitForResponse: ({ status, respond }) => {
        if (!state?.plan || interrupt?.kind !== "approve_plan") {
          return (
            <p className="text-sm text-gray-500">
              No lesson plan is waiting for review right now.
            </p>
          );
        }
        return (
          <PlanApproval
            plan={state.plan}
            busy={busy || status === "complete"}
            onApprove={async () => {
              await resume({ action: "approve" });
              respond?.(
                "The learner approved the plan as drafted. The first question is ready.",
              );
            }}
            onRevise={async (plan) => {
              await resume({ action: "revise", plan });
              respond?.(
                `The learner edited the plan down to ${plan.objectives.length} objectives and approved it.`,
              );
            }}
          />
        );
      },
    },
    [state?.plan, interrupt?.kind, busy],
  );

  useCopilotAction(
    {
      name: "answerMcq",
      description:
        "Show the learner the question they are currently on and wait for them to submit an answer. Use this when they say they are ready to answer, or after you have explained a concept they were stuck on.",
      renderAndWaitForResponse: ({ status, respond }) => {
        if (!activeQuestion) {
          return (
            <p className="text-sm text-gray-500">
              There is no active question — the lesson is either not started or
              already finished.
            </p>
          );
        }
        return (
          <McqCard
            mcq={activeQuestion.mcq}
            objective={activeQuestion.objective}
            objectiveNumber={activeQuestion.objectiveNumber}
            objectiveTotal={activeQuestion.objectiveTotal}
            attempts={activeQuestion.attempts}
            feedback={feedback}
            busy={busy || status === "complete"}
            onSubmit={async (optionId) => {
              const data = await resume({ action: "answer", optionId });
              const next = data?.interrupt;
              if (next?.kind === "reveal_correct") {
                respond?.(
                  `Correct. The explanation shown to the learner was: ${next.explanation}. Congratulate them briefly and offer to continue.`,
                );
              } else if (next?.kind === "question") {
                // The retry is free, and the agent still does not learn the
                // answer — only the hint the graph chose to release.
                respond?.(
                  `Incorrect. The learner can retry at no penalty. The hint shown was: ${next.mcq.hint}. You still do NOT know which option is correct, so do not guess it. Offer to explain the concept, then call answerMcq again when they are ready.`,
                );
              } else {
                respond?.("Answer submitted.");
              }
            }}
            onContinue={async () => {
              await resume({ action: "continue" });
              respond?.("The learner moved on to the next objective.");
            }}
            onSkip={async () => {
              await resume({ action: "skip" });
              respond?.(
                "The learner skipped this question. It is recorded as unsolved and no explanation was revealed.",
              );
            }}
          />
        );
      },
    },
    [activeQuestion, feedback, busy],
  );

  // No useCopilotChatSuggestions here on purpose. It drives CopilotKit's
  // extract(), which forces the model to answer one specific tool call and
  // throws "extract() failed: No function call occurred" when the model replies
  // with text instead — which our providers do for its object[] schema. It also
  // spends an extra model request on every phase change, which is expensive
  // against a 20-request daily free tier. The instructions hook below is the
  // part that was actually carrying weight.
  //
  // Phase-bound instructions. The static tutor prompt cannot know whether the
  // learner is mid-question or staring at a finished summary; this does, and it
  // is what makes "steer them back to the lesson" concrete rather than a wish.
  useCopilotAdditionalInstructions(
    {
      instructions: !threadId
        ? "The learner has not started a lesson yet. If they ask to begin, tell them to upload a PDF on the page first."
        : interrupt?.kind === "approve_plan"
          ? "The lesson is waiting for the learner to approve their plan. Call reviewLessonPlan to show it to them instead of describing it in prose."
          : activeQuestion
            ? `The learner is on objective ${activeQuestion.objectiveNumber} of ${activeQuestion.objectiveTotal}, attempt ${activeQuestion.attempts + 1}. Answer conceptual questions about it, then call answerMcq so they can submit. Never state or hint which lettered option is correct; you do not have it.`
            : state?.phase === "done"
              ? "The lesson is complete and the summary is on screen. Help the learner interpret it or plan what to study next; do not invent new questions."
              : "A question is being generated. Keep the learner oriented and do not start a parallel quiz in chat.",
    },
    [threadId, interrupt?.kind, activeQuestion, state?.phase],
  );


  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧠</span>
            <span className="font-semibold text-gray-900">PDF Lesson Agent</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="rounded-full bg-gray-100 px-2 py-0.5" title="Active LLM fallback chain">
              LLM: {chainLabel}
            </span>
            {threadId && (
              <button
                onClick={restart}
                className="font-medium text-indigo-600 hover:underline"
              >
                Restart
              </button>
            )}
          </div>
        </div>
      </header>

      {provider === "mock" && (
        <div className="mx-auto mt-3 max-w-4xl px-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Running in <strong>mock mode</strong> — plan &amp; questions use offline
            heuristics and the tutor chat is disabled. Set <code>ANTHROPIC_API_KEY</code>{" "}
            or <code>OPENAI_API_KEY</code> (see README) for full AI generation.
          </div>
        </div>
      )}

      <main className="mx-auto max-w-4xl px-4 py-8">
        {error && (
          <div className="mx-auto mb-4 max-w-2xl rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 1 · Upload */}
        {!doc && <PdfUpload onExtracted={setDoc} />}

        {/* 1b · Doc ready → draft plan */}
        {doc && !threadId && (
          <div className="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <div className="text-4xl">✅</div>
            <h2 className="mt-2 text-lg font-semibold text-gray-900">
              Loaded “{doc.title || "your document"}”
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {doc.pages} page{doc.pages === 1 ? "" : "s"} ·{" "}
              {doc.text.length.toLocaleString()} characters extracted
              {doc.truncated ? " (truncated)" : ""}.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                onClick={restart}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Choose a different PDF
              </button>
              <button
                onClick={start}
                disabled={busy}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? "Analyzing…" : "Draft lesson plan →"}
              </button>
            </div>
          </div>
        )}

        {/* Loading between steps (planning / grading / summarizing) */}
        {threadId && busy && !showQuiz && !showPlan && (
          <div className="mx-auto max-w-md py-16 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            <p className="mt-4 text-sm text-gray-500">
              {state?.statusMessage || "The agent is thinking…"}
            </p>
          </div>
        )}

        {/* 2 · Plan approval (HITL) */}
        {showPlan && (
          <PlanApproval
            plan={state!.plan!}
            busy={busy}
            onApprove={() => resume({ action: "approve" })}
            onRevise={(p) => resume({ action: "revise", plan: p })}
          />
        )}

        {/* 3 · Quiz loop */}
        {showQuiz && (
          <McqCard
            key={`${activeQuestion!.objectiveNumber}-${activeQuestion!.mcq.question}`}
            mcq={activeQuestion!.mcq}
            objective={activeQuestion!.objective}
            objectiveNumber={activeQuestion!.objectiveNumber}
            objectiveTotal={activeQuestion!.objectiveTotal}
            attempts={activeQuestion!.attempts}
            feedback={feedback}
            busy={busy}
            onSubmit={(optionId) => resume({ action: "answer", optionId })}
            onContinue={() => resume({ action: "continue" })}
            onSkip={() => resume({ action: "skip" })}
          />
        )}

        {/* 4 · Summary */}
        {showSummary && (
          <SummaryCard
            summary={state!.summary!}
            plan={state!.plan!}
            results={state!.results}
            onRestart={restart}
          />
        )}
      </main>

      {chatMounted && (
        <CopilotSidebar
          defaultOpen={false}
          clickOutsideToClose
          labels={{
            title: "Study Buddy",
            initial:
              provider === "mock"
                ? "Tutor chat needs an API key. Add GEMINI_API_KEY (or any other provider key) to .env.local and restart the server to chat with me."
                : "Hi! I'm your tutor. Ask me to explain a concept or give you a hint — but I won't give away the answer. 😉",
          }}
          instructions={TUTOR_INSTRUCTIONS}
        />
      )}
    </div>
  );
}

const TUTOR_INSTRUCTIONS = `You are "Study Buddy", a patient, encouraging tutor helping a learner through an interactive lesson generated from their uploaded PDF. The multiple-choice question they are currently working on is available to you as readable context.

You can: explain concepts, define terms, provide analogies, and give conceptual hints that guide their reasoning.

STRICT RULES — never break these:
1. You do NOT know which lettered option (A/B/C/D) is correct, and you must never claim to know, guess it for them, or restate the exact wording of any option as "the answer".
2. Never tell the learner which option to pick. If they ask you to "just give me the answer", warmly decline and offer a conceptual hint or the "conceptualHint" from context instead.
3. Always steer the learner back to making their own selection and continuing the lesson. End hint responses by encouraging them to try answering.
4. Keep replies short (2-4 sentences).`;
