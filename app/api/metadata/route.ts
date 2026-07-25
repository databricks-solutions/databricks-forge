/**
 * API: /api/metadata
 *
 * GET -- browse Unity Catalog metadata (catalogs, schemas, tables)
 *
 * Query params:
 *   ?type=warmup               -- wake the SQL warehouse + report status
 *   ?type=catalogs             -- list catalogs
 *   ?type=schemas&catalog=X    -- list schemas in catalog X
 *   ?type=tables&catalog=X&schema=Y -- list tables in X.Y
 */

import { NextRequest, NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/error-utils";
import { logger } from "@/lib/logger";
import {
  listCatalogs,
  listSchemas,
  listTables,
  ensureWarehouseReady,
  MetadataError,
} from "@/lib/queries/metadata";
import { validateIdentifier, IdentifierValidationError } from "@/lib/validation";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "catalogs";
    const catalogRaw = searchParams.get("catalog");
    const schemaRaw = searchParams.get("schema") ?? undefined;

    switch (type) {
      case "warmup": {
        const status = await ensureWarehouseReady();
        return NextResponse.json(status, {
          status: status.ready ? 200 : 503,
        });
      }
      case "catalogs": {
        const start = Date.now();
        const catalogs = await listCatalogs();
        return NextResponse.json({
          catalogs,
          _meta: { latencyMs: Date.now() - start },
        });
      }
      case "schemas": {
        if (!catalogRaw) {
          logger.warn("Missing required catalog param for schemas", {
            type: "schemas",
            queryParams: { type, catalog: catalogRaw, schema: schemaRaw },
          });
          return NextResponse.json(
            { error: "catalog query param is required", code: "INVALID_REQUEST" },
            { status: 400 },
          );
        }
        const catalog = validateIdentifier(catalogRaw, "catalog");
        const schemas = await listSchemas(catalog);
        return NextResponse.json({ schemas });
      }
      case "tables": {
        if (!catalogRaw) {
          logger.warn("Missing required catalog param for tables", {
            type: "tables",
            queryParams: { type, catalog: catalogRaw, schema: schemaRaw },
          });
          return NextResponse.json(
            { error: "catalog query param is required", code: "INVALID_REQUEST" },
            { status: 400 },
          );
        }
        const catalog = validateIdentifier(catalogRaw, "catalog");
        const schema = schemaRaw ? validateIdentifier(schemaRaw, "schema") : undefined;
        const tables = await listTables(catalog, schema);
        return NextResponse.json({ tables });
      }
      default:
        logger.warn("Unknown metadata type requested", {
          type,
          allowedTypes: ["warmup", "catalogs", "schemas", "tables"],
        });
        return NextResponse.json(
          {
            error: `Unknown type: ${type}. Use warmup, catalogs, schemas, or tables.`,
            code: "INVALID_REQUEST",
          },
          { status: 400 },
        );
    }
  } catch (error) {
    if (error instanceof IdentifierValidationError) {
      logger.warn("Identifier validation failed", {
        error: error.message,
        errorCode: "INVALID_REQUEST",
      });
      return NextResponse.json({ error: error.message, code: "INVALID_REQUEST" }, { status: 400 });
    }
    if (error instanceof MetadataError) {
      const status = error.code === "INSUFFICIENT_PERMISSIONS" ? 403 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    logger.error("Failed to fetch metadata", {
      error: error instanceof Error ? error.message : String(error),
      path: "/api/metadata",
    });
    return NextResponse.json(
      { error: safeErrorMessage(error), code: "WAREHOUSE_UNAVAILABLE" },
      { status: 502 },
    );
  }
}
