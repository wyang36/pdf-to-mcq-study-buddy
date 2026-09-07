"use client";

import { useRef, useState } from "react";

export interface ExtractedDoc {
  title: string;
  text: string;
  pages: number;
  truncated: boolean;
}

export function PdfUpload({
  onExtracted,
}: {
  onExtracted: (doc: ExtractedDoc) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setFileName(file.name);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract-pdf", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to parse PDF");
      onExtracted(data as ExtractedDoc);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to parse PDF");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
        className="rounded-2xl border-2 border-dashed border-indigo-300 bg-white p-10 text-center shadow-sm"
      >
        <div className="text-5xl">📄</div>
        <h2 className="mt-3 text-lg font-semibold text-gray-800">
          Upload a PDF to start your lesson
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          The agent reads it, drafts a lesson plan for your approval, then quizzes
          you objective by objective.
        </p>

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-6 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Reading PDF…" : "Choose PDF"}
        </button>
        <p className="mt-2 text-xs text-gray-400">or drag &amp; drop it here</p>

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        {fileName && !error && (
          <p className="mt-4 truncate text-xs text-gray-500">Selected: {fileName}</p>
        )}
        {error && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
