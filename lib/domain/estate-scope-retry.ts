export type EstateScopeRetryResult =
  | { ok: true; scopeId: string }
  | {
      ok: false;
      status: number;
      reason: "active_work" | "max_attempts" | "no_failed_scope" | "unknown";
    };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function retryEstateScope(
  programId: string,
  scopeId: string,
  fetcher: FetchLike = fetch,
): Promise<EstateScopeRetryResult> {
  const response = await fetcher(`/api/estate-programs/${programId}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scopeId }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    scopeId?: string;
    reason?: string;
  };
  if (response.status === 202 && body.scopeId) {
    return { ok: true, scopeId: body.scopeId };
  }
  const reason =
    body.reason === "active_work" ||
    body.reason === "max_attempts" ||
    body.reason === "no_failed_scope"
      ? body.reason
      : "unknown";
  return { ok: false, status: response.status, reason };
}
