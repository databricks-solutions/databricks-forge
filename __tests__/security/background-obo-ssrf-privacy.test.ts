import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  assertSafePublicUrl,
  assertSafePublicUrlWithDns,
  isPrivateOrReservedIp,
  safePublicFetch,
  SsrfBlockedError,
} from "@/lib/resilient-fetch";
import { redactSampleDataFromPrompt } from "@/lib/lakebase/prompt-logs";
import {
  stashQueuedOboToken,
  consumeQueuedOboToken,
  clearQueuedOboTokens,
  encryptQueuedOboEnvelope,
  decryptQueuedOboEnvelope,
} from "@/lib/auth/queued-token-store";

const mockRetrieveContext = vi.fn();

vi.mock("@/lib/embeddings/retriever", () => ({
  retrieveContext: (...args: unknown[]) => mockRetrieveContext(...args),
}));

import { runEvidenceLinking } from "@/lib/demo/research-engine/passes/evidence-linking";

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: () => undefined,
};

describe("PR-03 SSRF guard, queued OBO store, sample-data redaction & RAG session isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQueuedOboTokens();
  });

  describe("SSRF guard (assertSafePublicUrl & safePublicFetch)", () => {
    it("blocks private, loopback, link-local, and cloud metadata IPs", () => {
      expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("10.1.2.3")).toBe(true);
      expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
      expect(isPrivateOrReservedIp("192.168.1.10")).toBe(true);
      expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
      expect(isPrivateOrReservedIp("::1")).toBe(true);
      expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
      expect(isPrivateOrReservedIp("93.184.216.34")).toBe(false);
    });

    it("throws SsrfBlockedError on cloud metadata, localhost, and internal URLs", () => {
      expect(() => assertSafePublicUrl("http://169.254.169.254/latest/meta-data/")).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertSafePublicUrl("http://127.0.0.1:8000/api/health")).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertSafePublicUrl("http://localhost:3000/")).toThrow(SsrfBlockedError);
      expect(() => assertSafePublicUrl("http://metadata.google.internal/")).toThrow(
        SsrfBlockedError,
      );
      expect(() => assertSafePublicUrl("file:///etc/passwd")).toThrow(SsrfBlockedError);
      expect(assertSafePublicUrl("https://www.databricks.com/").hostname).toBe(
        "www.databricks.com",
      );
    });

    it("blocks open-redirect pivots to internal cloud metadata IP", async () => {
      const fakeFetch = vi.fn(async () => {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/iam/" },
        });
      });

      await expect(
        safePublicFetch(
          "https://example.com/redirect",
          undefined,
          fakeFetch as unknown as typeof fetch,
        ),
      ).rejects.toThrow(SsrfBlockedError);
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    });

    it("blocks public hostnames whose DNS records resolve to private or metadata IPs", async () => {
      const fakeFetch = vi.fn(async () => new Response("ok", { status: 200 }));
      await expect(
        assertSafePublicUrlWithDns("https://rebind.attacker.example/api", async () => [
          { address: "169.254.169.254" },
        ]),
      ).rejects.toThrow(SsrfBlockedError);

      await expect(
        safePublicFetch(
          "https://rebind.attacker.example/api",
          undefined,
          fakeFetch as unknown as typeof fetch,
          async () => [{ address: "10.24.0.8" }],
        ),
      ).rejects.toThrow(SsrfBlockedError);
      expect(fakeFetch).not.toHaveBeenCalled();
    });
  });

  describe("redactSampleDataFromPrompt", () => {
    it("redacts ---BEGIN SAMPLE DATA--- blocks and ### SAMPLE DATA sections", () => {
      const promptWithMarkers = [
        "### 3. DATA SCHEMA",
        "main.crm.customers (id, ssn)",
        "---BEGIN SAMPLE DATA---",
        "### SAMPLE DATA",
        "| 1 | 999-00-1234 |",
        "---END SAMPLE DATA---",
        "### 5. INSTRUCTIONS",
      ].join("\n");

      const redacted = redactSampleDataFromPrompt(promptWithMarkers);
      expect(redacted).not.toContain("999-00-1234");
      expect(redacted).toContain("[REDACTED SAMPLE DATA:");
      expect(redacted).toContain("main.crm.customers");
    });
  });

  describe("queued OBO token store", () => {
    it("stashes and consumes an OBO token exactly once and encrypts cross-instance envelopes", () => {
      stashQueuedOboToken("run-1", "obo-secret-123");
      expect(consumeQueuedOboToken("run-1")).toBe("obo-secret-123");
      expect(consumeQueuedOboToken("run-1")).toBeNull();

      const expiresAt = Date.now() + 60_000;
      const encrypted = encryptQueuedOboEnvelope("obo-cross-instance-xyz", expiresAt);
      expect(encrypted).not.toContain("obo-cross-instance-xyz");
      const decrypted = decryptQueuedOboEnvelope(encrypted);
      expect(decrypted).toEqual({
        oboToken: "obo-cross-instance-xyz",
        expiresAt,
      });
    });
  });

  describe("runEvidenceLinking session & user isolation", () => {
    it("filters out company_research chunks belonging to another sessionId", async () => {
      mockRetrieveContext.mockResolvedValue([
        {
          id: "chunk-other",
          kind: "company_research",
          sourceId: "session-alice",
          content: "Confidential uploaded board deck from Alice's session.",
          score: 0.91,
          metadata: { customerName: "Acme", sourceTitle: "Alice Deck", sourceUrl: "https://a.com" },
        },
        {
          id: "chunk-mine",
          kind: "company_research",
          sourceId: "session-bob",
          content: "Public annual report passage from Bob's own session.",
          score: 0.85,
          metadata: { customerName: "Acme", sourceTitle: "Bob Report", sourceUrl: "https://b.com" },
        },
      ]);

      const result = await runEvidenceLinking(
        {
          customerName: "Acme",
          industryId: "retail",
          sessionId: "session-bob",
          ownerEmail: "bob@company.com",
          executiveBrief: {
            whoTheyAre: "Acme",
            whatTheyCareAbout: "Retail",
            whatsLikelyBroken: "Inventory",
            whyNow: "Margin",
            whereWeWin: "Lakehouse",
            situationComplicationResolution: {
              situation: "S",
              complication: "C",
              resolution: "R",
            },
            evidence: [{ tier: "sourced", claim: "Acme margin pressure" }],
          },
        },
        noopLogger,
      );

      expect(mockRetrieveContext).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          userEmail: "bob@company.com",
          metadataFilter: { customerName: "Acme" },
        }),
      );
      const attached = result.executiveBrief?.evidence?.[0];
      expect(attached?.tier).toBe("sourced");
      expect(attached?.quote).toContain("Bob's own session");
      expect(attached?.quote).not.toContain("Alice's session");
    });
  });
});
