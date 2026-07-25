/**
 * Lakebase schema management.
 *
 * Schema is managed by Prisma (prisma/schema.prisma).
 * `prisma db push` runs automatically at server startup via scripts/start.sh,
 * creating tables on first deploy and applying additive changes thereafter.
 *
 * These functions are retained as no-ops for backward compatibility.
 */

export async function ensureMigrated(): Promise<void> {
  // Handled automatically at startup by scripts/start.sh
}

export async function runMigrations(): Promise<void> {
  // Handled automatically at startup by scripts/start.sh
}
