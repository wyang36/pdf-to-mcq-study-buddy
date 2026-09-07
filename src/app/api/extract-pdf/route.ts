import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Max characters of extracted text we keep for prompting (keeps token use sane). */
const MAX_CHARS = 18000;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "expected multipart/form-data with a 'file' field" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "please upload a .pdf file" }, { status: 415 });
  }

  try {
    // Legacy build runs in Node without a browser DOM.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    let text = "";
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      text += pageText + "\n\n";
      if (text.length > MAX_CHARS * 1.5) break; // don't over-read huge PDFs
    }

    const cleaned = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    const truncated = cleaned.slice(0, MAX_CHARS);
    const title = file.name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();

    if (truncated.length < 40) {
      return NextResponse.json(
        {
          error:
            "Couldn't extract readable text — this looks like a scanned/image-only PDF. Try a text-based PDF.",
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      title,
      text: truncated,
      pages: doc.numPages,
      truncated: cleaned.length > MAX_CHARS,
    });
  } catch (err) {
    console.error("[/api/extract-pdf] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to parse PDF" },
      { status: 500 },
    );
  }
}
