/**
 * Default Databricks LLM client implementation.
 *
 * Wraps `cachedChatCompletion` (retry + rate-limit + cache) and
 * `chatCompletionStream` from `@/lib/dbx/model-serving`.
 */

import { cachedChatCompletion } from "@/lib/toolkit/llm-cache";
import { chatCompletionStream, ModelServingError } from "@/lib/dbx/model-serving";
import { getFallbacksForTier } from "@/lib/dbx/task-router";
import type { LLMClient, LLMRequestOptions, LLMResponse, StreamCallback } from "../llm-client";

export const databricksLLMClient: LLMClient = {
  async chat(options: LLMRequestOptions): Promise<LLMResponse> {
    const resp = await cachedChatCompletion({
      endpoint: options.endpoint,
      messages: options.messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      responseFormat: options.responseFormat,
      signal: options.signal,
    });
    return {
      content: resp.content,
      usage: resp.usage,
      model: resp.model,
      finishReason: resp.finishReason,
    };
  },

  async chatStream(options: LLMRequestOptions, onChunk?: StreamCallback): Promise<LLMResponse> {
    const doStream = async (opts: LLMRequestOptions) => {
      const resp = await chatCompletionStream(
        {
          endpoint: opts.endpoint,
          messages: opts.messages,
          temperature: opts.temperature,
          maxTokens: opts.maxTokens,
          responseFormat: opts.responseFormat,
          signal: opts.signal,
        },
        onChunk,
      );
      return {
        content: resp.content,
        usage: resp.usage,
        model: resp.model,
        finishReason: resp.finishReason,
      };
    };

    try {
      return await doStream(options);
    } catch (error) {
      if (
        error instanceof ModelServingError &&
        (error.statusCode === 429 || error.endpointUnavailable)
      ) {
        const fallbacks = getFallbacksForTier("generation", options.endpoint);
        for (const alt of fallbacks.slice(0, 2)) {
          try {
            return await doStream({ ...options, endpoint: alt });
          } catch {
            continue;
          }
        }
      }
      throw error;
    }
  },
};
