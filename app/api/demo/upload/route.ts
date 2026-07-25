import { NextResponse } from "next/server";
import { isDemoModeEnabled } from "@/lib/demo/config";
import { logger } from "@/lib/logger";
import type { ParsedDocument } from "@/lib/demo/types";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;
const MAX_TEXT_CHARS = 100_000;

export async function POST(request: Request) {
  if (!(await isDemoModeEnabled())) {
    return NextResponse.json({ error: "Demo mode is not enabled" }, { status: 404 });
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const category = (formData.get("category") as string) ?? "other";

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Maximum ${MAX_FILES} files allowed` },
        { status: 400 },
      );
    }

    const documents: ParsedDocument[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        documents.push({
          filename: file.name,
          mimeType: file.type,
          text: "",
          charCount: 0,
          category: category as ParsedDocument["category"],
        });
        continue;
      }

      let text = "";

      if (file.type === "application/pdf") {
        try {
          const buffer = Buffer.from(await file.arrayBuffer());
          const mod = await import("pdf-parse");
          const pdfParse = ((mod as Record<string, unknown>).default ?? mod) as (
            buf: Buffer
          ) => Promise<{ text: string }>;
          const result = await pdfParse(buffer);
          text = result.text.slice(0, MAX_TEXT_CHARS);
        } catch (err) {
          logger.warn("[demo/upload] PDF parse failed", {
            filename: file.name,
            error: String(err),
          });
        }
      } else {
        text = (await file.text()).slice(0, MAX_TEXT_CHARS);
      }

      documents.push({
        filename: file.name,
        mimeType: file.type,
        text,
        charCount: text.length,
        category: category as ParsedDocument["category"],
      });
    }

    return NextResponse.json({ documents });
  } catch (err) {
    logger.error("[demo/upload] Error", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
