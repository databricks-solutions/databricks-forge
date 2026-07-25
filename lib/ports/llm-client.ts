/**
 * Abstract LLM client interface.
 *
 * Decouples engines from Databricks Model Serving so they can be ported
 * to any LLM provider (OpenAI, Anthropic, local models, test stubs).
 *
 * The default Databricks implementation wraps `cachedChatCompletion`
 * from `@/lib/toolkit/llm-cache`, which includes retry, rate limiting,
 * and in-memory caching.
 *
 * @module ports/llm-client
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequestOptions {
  endpoint: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  content: string;
  usage: TokenUsage | null;
  model: string;
  finishReason: string | null;
}

export type StreamCallback = (chunk: string) => void;

/**
 * Abstract LLM client. Engines depend on this interface rather than
 * importing `cachedChatCompletion` or `chatCompletion` directly.
 */
export interface LLMClient {
  /**
   * Send a chat completion request and return the full response.
   * Implementations should handle retry, rate limiting, and caching.
   */
  chat(options: LLMRequestOptions): Promise<LLMResponse>;

  /**
   * Send a streaming chat completion request.
   * Optional -- engines that don't stream don't need to call this.
   */
  chatStream?(options: LLMRequestOptions, onChunk?: StreamCallback): Promise<LLMResponse>;
}
