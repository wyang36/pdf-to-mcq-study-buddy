"use client";

import { useState } from "react";
import type { LearningObjective } from "@/lib/types";
import type { PublicMCQ } from "@/lib/protocol";

export type Feedback =
  | { status: "wrong"; wrongOptionId: string; hint: string }
  | { status: "correct"; correctOptionId: string; explanation: string }
  | null;

export function McqCard({
  mcq,
  objective,
  objectiveNumber,
  objectiveTotal,
  attempts,
  feedback,
  busy,
  onSubmit,
  onContinue,
  onSkip,
}: {
  mcq: PublicMCQ;
  objective: LearningObjective;
  objectiveNumber: number;
  objectiveTotal: number;
  attempts: number;
  feedback: Feedback;
  busy: boolean;
  onSubmit: (optionId: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const solved = feedback?.status === "correct";

  function optionClasses(id: string): string {
    const base =
      "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm transition cursor-pointer";
    if (solved && feedback.correctOptionId === id) {
      return `${base} border-emerald-500 bg-emerald-50 text-emerald-900`;
    }
    if (feedback?.status === "wrong" && feedback.wrongOptionId === id) {
      return `${base} border-rose-400 bg-rose-50 text-rose-900`;
    }
    if (!solved && selected === id) {
      return `${base} border-indigo-500 bg-indigo-50`;
    }
    return `${base} border-gray-200 bg-white hover:border-indigo-300`;
  }

  const progressPct = Math.round(((objectiveNumber - 1) / objectiveTotal) * 100);

  return (
    <div className="mx-auto max-w-2xl">
      {/* progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs font-medium text-gray-500">
          <span>
            Objective {objectiveNumber} of {objectiveTotal} · {objective.title}
          </span>
          <span>{progressPct}%</span>
        </div>
        <div className="mt-1 h-1.5 w-full rounded-full bg-gray-200">
          <div
            className="h-1.5 rounded-full bg-indigo-600 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold leading-snug text-gray-900">
          {mcq.question}
        </h2>
        {attempts > 0 && !solved && (
          <p className="mt-1 text-xs text-gray-400">Attempt {attempts + 1}</p>
        )}

        <div className="mt-4 space-y-2.5" role="radiogroup" aria-label="Answer choices">
          {mcq.options.map((opt) => {
            const disabled = solved || busy;
            const isChecked = selected === opt.id;
            return (
              <label
                key={opt.id}
                className={optionClasses(opt.id)}
                aria-checked={isChecked}
                role="radio"
              >
                <input
                  type="radio"
                  name={`mcq-${objectiveNumber}`}
                  value={opt.id}
                  checked={isChecked}
                  disabled={disabled}
                  onChange={() => setSelected(opt.id)}
                  className="h-4 w-4 accent-indigo-600"
                />
                <span className="font-medium uppercase text-gray-400">{opt.id}.</span>
                <span className="flex-1">{opt.text}</span>
                {solved && feedback.correctOptionId === opt.id && <span>✅</span>}
                {feedback?.status === "wrong" && feedback.wrongOptionId === opt.id && (
                  <span>❌</span>
                )}
              </label>
            );
          })}
        </div>

        {/* feedback */}
        {feedback?.status === "wrong" && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            <p className="font-semibold">Not quite — try again.</p>
            <p className="mt-1">
              <span className="font-medium">Hint:</span> {feedback.hint}
            </p>
          </div>
        )}
        {solved && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <p className="font-semibold">Correct! 🎉</p>
            <p className="mt-1">{feedback.explanation}</p>
          </div>
        )}

        {/* actions */}
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onSkip}
            disabled={busy || solved}
            className="text-xs font-medium text-gray-400 hover:text-gray-600 disabled:opacity-40"
          >
            Skip this objective
          </button>

          {solved ? (
            <button
              type="button"
              onClick={onContinue}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "…" : "Continue →"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => selected && onSubmit(selected)}
              disabled={busy || !selected}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Checking…" : "Submit answer"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
