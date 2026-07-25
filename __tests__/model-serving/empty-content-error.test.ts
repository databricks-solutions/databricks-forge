import { describe, it, expect } from "vitest";
import {
  EmptyContentError,
  ModelServingError,
  isEmptyContentError,
} from "@/lib/dbx/model-serving";

describe("EmptyContentError", () => {
  it("is a subclass of ModelServingError", () => {
    const err = new EmptyContentError("FOO_PROMPT", "model-x", null);
    expect(err).toBeInstanceOf(EmptyContentError);
    expect(err).toBeInstanceOf(ModelServingError);
    expect(err).toBeInstanceOf(Error);
  });

  it("uses statusCode 0 to signal a non-HTTP failure mode", () => {
    const err = new EmptyContentError("FOO_PROMPT", "model-x", "stop");
    expect(err.statusCode).toBe(0);
  });

  it("captures the model identifier and finish reason for diagnostics", () => {
    const err = new EmptyContentError("BAR_PROMPT", "databricks-claude-opus-4-7", "length");
    expect(err.model).toBe("databricks-claude-opus-4-7");
    expect(err.finishReason).toBe("length");
  });

  it("renders a self-describing message for logs and prompt audit", () => {
    const err = new EmptyContentError("BAZ", "ep-1", "stop");
    expect(err.message).toContain("BAZ");
    expect(err.message).toContain("ep-1");
    expect(err.message).toContain("stop");
  });

  it("isEmptyContentError narrows correctly on the typed error", () => {
    const err: unknown = new EmptyContentError("X", "y", null);
    expect(isEmptyContentError(err)).toBe(true);
  });

  it("isEmptyContentError returns false for a generic ModelServingError", () => {
    const err: unknown = new ModelServingError("rate limited", 429);
    expect(isEmptyContentError(err)).toBe(false);
  });

  it("isEmptyContentError returns false for a vanilla Error", () => {
    expect(isEmptyContentError(new Error("nope"))).toBe(false);
    expect(isEmptyContentError("not an error")).toBe(false);
    expect(isEmptyContentError(null)).toBe(false);
  });
});
