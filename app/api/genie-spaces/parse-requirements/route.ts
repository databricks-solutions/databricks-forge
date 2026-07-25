import { NextRequest, NextResponse } from "next/server";
import { parseMarkdown, parsePdf, extractRequirements } from "@/lib/genie/requirements-parser";
import { logActivity } from "@/lib/lakebase/activity-log";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const textContent = formData.get("text") as string | null;

    if (!file && !textContent) {
      return NextResponse.json(
        { error: "Either a file or text content is required" },
        { status: 400 },
      );
    }

    let doc;

    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());

      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        doc = await parsePdf(buffer, file.name);
      } else {
        const text = buffer.toString("utf-8");
        doc = parseMarkdown(text, file.name);
      }
    } else {
      doc = parseMarkdown(textContent!, "requirements.txt");
    }

    if (doc.wordCount < 10) {
      return NextResponse.json(
        { error: "Document is too short to extract meaningful requirements" },
        { status: 400 },
      );
    }

    const requirements = await extractRequirements(doc);

    logActivity("parsed_requirements", {
      metadata: {
        documentTitle: doc.title,
        format: doc.format,
        wordCount: doc.wordCount,
        tablesExtracted: requirements.tables.length,
        questionsExtracted: requirements.businessQuestions.length,
        confidence: requirements.confidence,
      },
    });

    return NextResponse.json({
      document: {
        title: doc.title,
        format: doc.format,
        wordCount: doc.wordCount,
      },
      requirements,
    });
  } catch (err) {
    logger.error("Requirements parsing failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Requirements parsing failed" },
      { status: 500 },
    );
  }
}
