import { NextResponse } from "next/server";
import { isDemoModeEnabled } from "@/lib/demo/config";
import { getDemoSession, getDemoSessionResearch } from "@/lib/lakebase/demo-sessions";
import { generateDemoResearchPptx } from "@/lib/export/demo-research-pptx";
import { generateDemoResearchPdf } from "@/lib/export/demo-research-pdf";
import { logger } from "@/lib/logger";
import { loadDemoSessionOrRespond } from "@/lib/auth/route-guards";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    if (!(await isDemoModeEnabled())) {
      return NextResponse.json({ error: "Demo mode is not enabled" }, { status: 404 });
    }

    const { sessionId } = await params;
    const guard = await loadDemoSessionOrRespond(request, sessionId, "read");
    if (!guard.ok) return guard.response;
    const session = await getDemoSession(sessionId);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const research = await getDemoSessionResearch(sessionId);

    if (!research) {
      return NextResponse.json({ error: "Research not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") ?? "pptx";
    const safeName = session.customerName.replace(/[^a-zA-Z0-9-_]/g, "_");
    const date = new Date().toISOString().split("T")[0];

    if (format === "pdf") {
      const buffer = await generateDemoResearchPdf(research, session.customerName);
      const filename = `${safeName}_demo_research_${date}.pdf`;
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const buffer = await generateDemoResearchPptx(research, session.customerName);
    const filename = `${safeName}_demo_research_${date}.pptx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    logger.error("[api/demo/export] GET failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to generate export" }, { status: 500 });
  }
}
