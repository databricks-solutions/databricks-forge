import { describe, expect, it } from "vitest";

import { parseGenieConversationResponse } from "@/lib/dbx/genie-conversation";

describe("parseGenieConversationResponse", () => {
  it("extracts executable SQL from a modern query attachment", () => {
    expect(
      parseGenieConversationResponse({
        content: "show me revenue by month",
        attachments: [
          {
            query: {
              query: "  SELECT month, SUM(revenue) FROM sales GROUP BY month  ",
              description: "Revenue by month",
            },
          },
        ],
      }),
    ).toEqual({
      sql: "SELECT month, SUM(revenue) FROM sales GROUP BY month",
    });
  });

  it.each([
    { text: { content: "Which date range should I use?" } },
    { text: { content: ["Which date range", "should I use?"] } },
    { text: "Which date range should I use?" },
  ])("extracts a text-only clarification from observed attachment shape %#", (attachment) => {
    expect(
      parseGenieConversationResponse({
        content: "raw user prompt must not be echoed",
        attachments: [attachment],
      }),
    ).toEqual({
      textResponse: "Which date range should I use?",
    });
  });

  it("falls back to legacy query_result query_text and preserves error text", () => {
    expect(
      parseGenieConversationResponse({
        query_result: { query_text: " SELECT * FROM legacy_table " },
        error: { message: "legacy warning" },
      }),
    ).toEqual({
      sql: "SELECT * FROM legacy_table",
      error: "legacy warning",
    });
  });

  it("ignores malformed attachments, prefers modern SQL, and never uses top-level content", () => {
    expect(
      parseGenieConversationResponse({
        content: "SELECT secret_prompt FROM raw_content",
        attachments: [
          null,
          { query: { query: " " } },
          { text: { content: 42 } },
          { query: { query: " SELECT modern_sql " } },
          { text: { content: "Useful explanation" } },
        ],
        query_result: { query_text: "SELECT legacy_sql" },
      }),
    ).toEqual({
      sql: "SELECT modern_sql",
      textResponse: "Useful explanation",
    });

    expect(
      parseGenieConversationResponse({
        content: "raw prompt only",
        attachments: [{ unknown: true }],
      }),
    ).toEqual({});
  });
});
