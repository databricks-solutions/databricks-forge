export function isBenchmarkAdmin(email: string | null): boolean {
  if (!email) return false;
  const allow = (process.env.FORGE_BENCHMARK_ADMINS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) return true;
  return allow.includes(email.toLowerCase());
}
