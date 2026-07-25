/**
 * Task 7 Req3: client-side HTTP error classification.
 *
 * A pure mapping from an HTTP status to a stable category + retryability so
 * every client fetch can distinguish 404 (not found) / 403 (forbidden) /
 * 409 (conflict, i.e. a user action is required) / 5xx (retry) before showing
 * a success toast. Kept pure/deterministic so it is testable in node.
 */

import { describe, expect, it } from "vitest";
import { classifyHttpStatus, describeHttpError } from "@/lib/http/api-error";

describe("classifyHttpStatus", () => {
  it("maps 404 to not_found (non-retryable)", () => {
    const c = classifyHttpStatus(404);
    expect(c.category).toBe("not_found");
    expect(c.retryable).toBe(false);
  });

  it("maps 403 to forbidden (non-retryable)", () => {
    expect(classifyHttpStatus(403).category).toBe("forbidden");
    expect(classifyHttpStatus(403).retryable).toBe(false);
  });

  it("maps 401 to unauthorized", () => {
    expect(classifyHttpStatus(401).category).toBe("unauthorized");
  });

  it("maps 409 to conflict (a user action is required, non-retryable)", () => {
    const c = classifyHttpStatus(409);
    expect(c.category).toBe("conflict");
    expect(c.retryable).toBe(false);
  });

  it("maps 5xx to server (retryable)", () => {
    expect(classifyHttpStatus(500).category).toBe("server");
    expect(classifyHttpStatus(503).retryable).toBe(true);
  });

  it("maps other 4xx to client (non-retryable)", () => {
    expect(classifyHttpStatus(400).category).toBe("client");
    expect(classifyHttpStatus(422).category).toBe("client");
    expect(classifyHttpStatus(400).retryable).toBe(false);
  });

  it("treats 2xx as ok", () => {
    expect(classifyHttpStatus(200).category).toBe("ok");
    expect(classifyHttpStatus(204).category).toBe("ok");
  });
});

describe("describeHttpError", () => {
  it("prefers a server-supplied message when present", () => {
    expect(describeHttpError(409, "Cancel the sequence first.")).toBe("Cancel the sequence first.");
  });

  it("falls back to a category default when no server message", () => {
    expect(describeHttpError(404, "")).toMatch(/not found/i);
    expect(describeHttpError(403, null)).toMatch(/permission|forbidden/i);
    expect(describeHttpError(500, undefined)).toMatch(/again|later|server/i);
  });
});
