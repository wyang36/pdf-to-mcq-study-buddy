"use client";

import { useState } from "react";
import { useCopilotReadable } from "@copilotkit/react-core";
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

export function LessonApp({ provider }: { provider: Provider }) {
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

  async function callLesson(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      applyResponse(data as LessonResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
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

  const showQuiz =
    activeQuestion &&
    (interrupt?.kind === "question" || interrupt?.kind === "reveal_correct");
  const showPlan = interrupt?.kind === "approve_plan" && state?.plan;
  const showSummary = state?.phase === "done" && state.summary && state.plan;

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧠</span>
            <span className="font-semibold text-gray-900">Memorang Lesson Agent</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="rounded-full bg-gray-100 px-2 py-0.5">
              LLM: {provider}
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

      <CopilotSidebar
        defaultOpen={false}
        clickOutsideToClose
        labels={{
          title: "Study Buddy",
          initial:
            provider === "mock"
              ? "Tutor chat needs an API key. Add ANTHROPIC_API_KEY or OPENAI_API_KEY and restart the server to chat with me."
              : "Hi! I'm your tutor. Ask me to explain a concept or give you a hint — but I won't give away the answer. 😉",
        }}
        instructions={TUTOR_INSTRUCTIONS}
      />
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
