import { NextResponse } from "next/server";
import { isDemoModeEnabled } from "@/lib/demo/config";
import { executeSQL } from "@/lib/dbx/sql";
import { validateIdentifier, IdentifierValidationError } from "@/lib/validation";
import { logger } from "@/lib/logger";

export async function POST(request: Request) {
  if (!(await isDemoModeEnabled())) {
    return NextResponse.json({ error: "Demo mode is not enabled" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const { catalog, schema, createCatalog = false } = body as {
      catalog: string;
      schema: string;
      createCatalog?: boolean;
    };

    if (!catalog || !schema) {
      return NextResponse.json({ error: "catalog and schema are required" }, { status: 400 });
    }

    // Validate identifiers
    try {
      validateIdentifier(catalog, "catalog");
      validateIdentifier(schema, "schema");
    } catch (err) {
      if (err instanceof IdentifierValidationError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    const result: {
      catalogExists: boolean;
      catalogAccessible: boolean;
      schemaExists: boolean;
      canCreateCatalog: boolean;
      canCreateSchema: boolean;
      error?: string;
    } = {
      catalogExists: false,
      catalogAccessible: false,
      schemaExists: false,
      canCreateCatalog: false,
      canCreateSchema: false,
    };

    // Check catalog access
    try {
      const catalogs = await executeSQL(`SHOW CATALOGS LIKE '${catalog}'`);
      result.catalogExists = catalogs.rows.length > 0;
      result.catalogAccessible = result.catalogExists;
    } catch (err) {
      result.error = `Cannot list catalogs: ${err instanceof Error ? err.message : String(err)}`;
      return NextResponse.json(result);
    }

    // Check create catalog permission if needed
    if (!result.catalogExists && createCatalog) {
      try {
        await executeSQL(`CREATE CATALOG IF NOT EXISTS \`${catalog}\``);
        result.canCreateCatalog = true;
        result.catalogExists = true;
        result.catalogAccessible = true;
        // Drop it -- we just validated we can create it
        // Actually keep it, the wizard will use it
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("INSUFFICIENT_PERMISSIONS") || msg.includes("PERMISSION_DENIED")) {
          result.error = "You don't have permission to create catalogs. Please select an existing catalog or ask your admin to grant CREATE CATALOG permission.";
        } else {
          result.error = `Cannot create catalog: ${msg}`;
        }
        return NextResponse.json(result);
      }
    }

    // Check schema
    if (result.catalogAccessible) {
      try {
        const schemas = await executeSQL(
          `SHOW SCHEMAS IN \`${catalog}\` LIKE '${schema}'`,
        );
        result.schemaExists = schemas.rows.length > 0;
      } catch {
        // Schema list failed -- might not have USE CATALOG
      }

      // Check create schema permission
      try {
        await executeSQL(
          `CREATE SCHEMA IF NOT EXISTS \`${catalog}\`.\`${schema}\``,
        );
        result.canCreateSchema = true;
        result.schemaExists = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("INSUFFICIENT_PERMISSIONS") || msg.includes("PERMISSION_DENIED")) {
          result.error = "You don't have permission to create schemas in this catalog.";
        } else {
          result.error = `Cannot create schema: ${msg}`;
        }
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    logger.error("[demo/validate-catalog] Error", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
