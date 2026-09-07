"use client";

import { useState } from "react";
import type { Difficulty, LessonPlan } from "@/lib/types";

const DIFFS: Difficulty[] = ["beginner", "intermediate", "advanced"];

const diffColor: Record<Difficulty, string> = {
  beginner: "bg-emerald-100 text-emerald-800",
  intermediate: "bg-amber-100 text-amber-800",
  advanced: "bg-rose-100 text-rose-800",
};

export function PlanApproval({
  plan,
  busy,
  onApprove,
  onRevise,
}: {
  plan: LessonPlan;
  busy: boolean;
  onApprove: () => void;
  onRevise: (plan: LessonPlan) => void;
}) {
  const [draft, setDraft] = useState<LessonPlan>(plan);
  const [editing, setEditing] = useState(false);

  function updateObjective(id: string, patch: Partial<LessonPlan["objectives"][number]>) {
    setDraft((d) => ({
      ...d,
      objectives: d.objectives.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
  }

  function removeObjective(id: string) {
    setDraft((d) => ({
      ...d,
      objectives: d.objectives.filter((o) => o.id !== id),
    }));
  }

  const changed = JSON.stringify(draft) !== JSON.stringify(plan);

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
          Step 2 · Review the plan
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${diffColor[draft.overallDifficulty]}`}
        >
          {draft.overallDifficulty}
        </span>
      </div>

      <h2 className="mt-3 text-xl font-semibold text-gray-900">{draft.title}</h2>
      <p className="mt-1 text-sm text-gray-600">{draft.summary}</p>

      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Learning objectives ({draft.objectives.length})
          </h3>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="text-xs font-medium text-indigo-600 hover:underline"
          >
            {editing ? "Done editing" : "Edit"}
          </button>
        </div>

        <ol className="space-y-3">
          {draft.objectives.map((o, i) => (
            <li
              key={o.id}
              className="rounded-xl border border-gray-100 bg-gray-50 p-3"
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <input
                      value={o.title}
                      onChange={(e) => updateObjective(o.id, { title: e.target.value })}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm font-medium"
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-900">{o.title}</p>
                  )}
                  <p className="mt-0.5 text-xs text-gray-500">{o.description}</p>
                </div>
                <div className="flex flex-none items-center gap-2">
                  {editing ? (
                    <select
                      value={o.difficulty}
                      onChange={(e) =>
                        updateObjective(o.id, {
                          difficulty: e.target.value as Difficulty,
                        })
                      }
                      className="rounded border border-gray-300 px-1.5 py-1 text-xs"
                    >
                      {DIFFS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${diffColor[o.difficulty]}`}
                    >
                      {o.difficulty}
                    </span>
                  )}
                  {editing && draft.objectives.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeObjective(o.id)}
                      className="text-xs text-rose-500 hover:text-rose-700"
                      aria-label="Remove objective"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        {changed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRevise(draft)}
            className="rounded-lg border border-indigo-600 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
          >
            Save changes &amp; start
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={changed ? () => onRevise(draft) : onApprove}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Starting…" : "Approve & start quiz"}
        </button>
      </div>
    </div>
  );
}
