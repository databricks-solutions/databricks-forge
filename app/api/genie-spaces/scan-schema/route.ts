import { NextRequest, NextResponse } from "next/server";
import { scanSchema, profileKeyColumns, selectTablesWithLLM } from "@/lib/genie/schema-scanner";
import { validateIdentifier, IdentifierValidationError } from "@/lib/validation";
import { logActivity } from "@/lib/lakebase/activity-log";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { catalog, schema, excludePatterns, userHint, includeProfile } = body as {
      catalog: string;
      schema: string;
      excludePatterns?: string[];
      userHint?: string;
      includeProfile?: boolean;
    };

    if (!catalog || !schema) {
      return NextResponse.json({ error: "catalog and schema are required" }, { status: 400 });
    }

    let safeCatalog: string;
    let safeSchema: string;
    try {
      safeCatalog = validateIdentifier(catalog, "catalog");
      safeSchema = validateIdentifier(schema, "schema");
    } catch (err) {
      if (err instanceof IdentifierValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    const scan = await scanSchema(safeCatalog, safeSchema, excludePatterns);

    if (scan.tables.length === 0) {
      return NextResponse.json(
        { error: `No tables found in ${catalog}.${schema}` },
        { status: 404 },
      );
    }

    if (includeProfile !== false) {
      scan.profiles = await profileKeyColumns(scan);
    }

    const selection = await selectTablesWithLLM(scan, userHint);

    logActivity("scanned_schema", {
      metadata: {
        catalog: safeCatalog,
        schema: safeSchema,
        tableCount: scan.tables.length,
        selectedCount: selection.selectedTables.length,
      },
    });

    return NextResponse.json({ scan, selection });
  } catch (err) {
    logger.error("Schema scan failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Schema scan failed" },
      { status: 500 },
    );
  }
}
