"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AnswerStream } from "./answer-stream";
import { ActionCardList, type ActionCardData } from "./action-card";
import { SqlRunner } from "./sql-runner";
import { DeployOptions } from "./deploy-options";
import type { AssistantPersona } from "@/lib/assistant/prompts";
import {
  FALLBACK_QUESTIONS,
  FALLBACK_QUESTIONS_ANALYST,
  FALLBACK_QUESTIONS_TECH,
  FALLBACK_QUESTIONS_STRATEGIC,
} from "@/lib/assistant/suggested-question-defaults";
import {
  BrainCircuit,
  Send,
  Loader2,
  User,
  Bot,
  Trash2,
  ThumbsUp,
  ThumbsDown,
  AlertCircle,
  Target,
  Briefcase,
  Wrench,
  Sparkles,
  BarChart3,
  Database,
  Lightbulb,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { GenieBuilderModal } from "./genie-builder-modal";
import { GenieDeployDialog } from "./genie-deploy-dialog";
import { ErdModal } from "./erd-modal";

// ---------------------------------------------------------------------------
// Types (exported for consumers)
// ---------------------------------------------------------------------------

export interface TableEnrichmentData {
  tableFqn: string;
  owner: string | null;
  numRows: string | null;
  sizeInBytes: string | null;
  lastModified: string | null;
  createdBy: string | null;
  dataDomain: string | null;
  dataTier: string | null;
  healthScore: number | null;
  issues: string[];
  recommendations: string[];
  lastWriteTimestamp: string | null;
  lastWriteOperation: string | null;
  upstreamTables: string[];
  downstreamTables: string[];
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: SourceData[];
  actions?: ActionCardData[];
  intent?: { intent: string; confidence: number };
  sqlBlocks?: string[];
  tableEnrichments?: TableEnrichmentData[];
  isStreaming?: boolean;
  logId?: string;
  feedback?: "up" | "down" | null;
}

export interface SourceData {
  index: number;
  label: string;
  kind: string;
  sourceId: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

export interface AskForgeChatProps {
  /** Render mode -- 'full' gives a spacious layout, 'compact' is for the sheet */
  mode?: "full" | "compact";
  /** Active persona controlling response style */
  persona?: AssistantPersona;
  /** External session ID tied to a conversation. If omitted, generates a new one. */
  sessionId?: string;
  /** Pre-loaded messages from a saved conversation */
  initialMessages?: ConversationMessage[];
  /** Dynamic suggested questions shown on the empty state (falls back to defaults) */
  suggestedQuestions?: string[];
  /** Called when a SQL block should be opened in a dialog */
  onOpenSql?: (sql: string, allBlocks?: string[]) => void;
  /** Called when a deploy-as-notebook action fires */
  onDeploySql?: (sql: string) => void;
  /** Called when a deploy-dashboard action fires (full payload from the action) */
  onDeployDashboard?: (payload: Record<string, unknown>) => void;
  /** Called when table enrichments are received for the latest message */
  onTableEnrichments?: (enrichments: TableEnrichmentData[]) => void;
  /** Called when referenced table FQNs are available from the response */
  onReferencedTables?: (tables: string[]) => void;
  /** Called when chat-mentioned table FQNs (from question + SQL blocks) are available */
  onChatMentionedTables?: (tables: string[]) => void;
  /** Called when source references are available from the response */
  onSources?: (sources: SourceData[]) => void;
  /** Called when the backend creates a conversation for this session */
  onConversationCreated?: (conversationId: string) => void;
  /** Called when the user clears the conversation (parent should start a new session) */
  onClear?: () => void;
  /** Called when the user changes persona in the empty state */
  onPersonaChange?: (persona: AssistantPersona) => void;
}

export interface AskForgeChatHandle {
  submitQuestion: (question: string) => void;
}

const FALLBACK_QUESTIONS_GENIE_BUILDER: string[] = [
  "I want a Genie Space for our sales pipeline data in main.sales",
  "Build a space for HR analytics covering headcount and attrition",
  "Create a space for our finance schema focused on revenue reporting",
];

function getFallbackQuestions(persona: AssistantPersona): string[] {
  if (persona === "genie-builder") return FALLBACK_QUESTIONS_GENIE_BUILDER;
  if (persona === "strategic") return FALLBACK_QUESTIONS_STRATEGIC;
  if (persona === "tech") return FALLBACK_QUESTIONS_TECH;
  if (persona === "analyst") return FALLBACK_QUESTIONS_ANALYST;
  return FALLBACK_QUESTIONS;
}

const SUGGESTION_ICONS = [Sparkles, BarChart3, Database, Lightbulb];

const PERSONA_META: Record<AssistantPersona, { icon: React.ReactNode; label: string }> = {
  business: { icon: <Target className="size-3.5" />, label: "Business" },
  analyst: { icon: <Briefcase className="size-3.5" />, label: "Analyst" },
  tech: { icon: <Wrench className="size-3.5" />, label: "Tech" },
  strategic: { icon: <BarChart3 className="size-3.5" />, label: "Strategic" },
  "genie-builder": { icon: <Sparkles className="size-3.5" />, label: "Genie Builder" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AskForgeChat = React.forwardRef<AskForgeChatHandle, AskForgeChatProps>(
  function AskForgeChat(
    {
      mode = "full",
      persona = "business",
      sessionId: externalSessionId,
      initialMessages,
      suggestedQuestions,
      onOpenSql,
      onDeploySql,
      onDeployDashboard,
      onTableEnrichments,
      onReferencedTables,
      onChatMentionedTables,
      onSources,
      onConversationCreated,
      onClear,
      onPersonaChange,
    },
    ref,
  ) {
    const router = useRouter();
    const [messages, setMessages] = React.useState<ConversationMessage[]>(initialMessages ?? []);
    const [input, setInput] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [activeSql, setActiveSql] = React.useState<string | null>(null);
    const [deploySql, setDeploySql] = React.useState<string | null>(null);
    const [genieModalOpen, setGenieModalOpen] = React.useState(false);
    const [genieModalPayload, setGenieModalPayload] = React.useState<{
      tables: string[];
      domain?: string;
      conversationSummary?: string;
      tableEnrichments?: TableEnrichmentData[];
      sqlBlocks?: string[];
    } | null>(null);
    const [erdModalTables, setErdModalTables] = React.useState<string[] | null>(null);
    const [deployJobId, _setDeployJobId] = React.useState<string | null>(null);
    const [deployDialogOpen, setDeployDialogOpen] = React.useState(false);
    const [pendingAction, setPendingAction] = React.useState<string | null>(null);
    const [preparingMessageId, setPreparingMessageId] = React.useState<string | null>(null);
    const [fallbackSessionId] = React.useState(() => crypto.randomUUID());
    const sessionId = externalSessionId ?? fallbackSessionId;
    const inputRef = React.useRef<HTMLTextAreaElement>(null);
    const messagesEndRef = React.useRef<HTMLDivElement>(null);
    const lastChunkTimeRef = React.useRef<number>(0);
    const streamingMsgIdRef = React.useRef<string | null>(null);

    React.useEffect(() => {
      setMessages(initialMessages ?? []);
    }, [initialMessages]);

    const scrollToBottom = React.useCallback(() => {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }, 50);
    }, []);

    // Detect when LLM streaming has stopped but done event hasn't arrived yet
    React.useEffect(() => {
      if (!loading) {
        setPreparingMessageId(null);
        return;
      }
      const timer = setInterval(() => {
        const msgId = streamingMsgIdRef.current;
        if (msgId && lastChunkTimeRef.current > 0 && Date.now() - lastChunkTimeRef.current > 800) {
          setPreparingMessageId(msgId);
        }
      }, 500);
      return () => clearInterval(timer);
    }, [loading]);

    const handleSubmit = async (externalQuestion?: string) => {
      const question = (externalQuestion ?? input).trim();
      if (!question || loading) return;

      const userMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: question,
      };

      const assistantMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        isStreaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setLoading(true);
      setActiveSql(null);
      lastChunkTimeRef.current = 0;
      streamingMsgIdRef.current = assistantMsg.id;
      setPreparingMessageId(null);
      scrollToBottom();

      try {
        const history = messages
          .filter((m) => !m.isStreaming)
          .map((m) => ({ role: m.role, content: m.content }));

        const resp = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, history, sessionId, persona }),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const reader = resp.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        let streamedContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === "chunk") {
                lastChunkTimeRef.current = Date.now();
                streamedContent += parsed.content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: streamedContent } : m,
                  ),
                );
                scrollToBottom();
              } else if (parsed.type === "done") {
                streamingMsgIdRef.current = null;
                setPreparingMessageId(null);
                const enrichments = parsed.tableEnrichments ?? [];
                const tables: string[] = parsed.tables ?? [];
                const sources: SourceData[] = parsed.sources ?? [];
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id
                      ? {
                          ...m,
                          content: parsed.answer,
                          isStreaming: false,
                          sources,
                          actions: parsed.actions ?? [],
                          intent: parsed.intent ?? undefined,
                          sqlBlocks: parsed.sqlBlocks ?? [],
                          tableEnrichments: enrichments,
                          logId: parsed.logId ?? undefined,
                          feedback: null,
                        }
                      : m,
                  ),
                );
                onTableEnrichments?.(enrichments);
                onReferencedTables?.(tables);
                onChatMentionedTables?.(parsed.chatMentionedTables ?? []);
                onSources?.(sources);
                if (parsed.conversationId) {
                  onConversationCreated?.(parsed.conversationId);
                }
              } else if (parsed.type === "error") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsg.id
                      ? {
                          ...m,
                          content: `**Error:** ${parsed.error}`,
                          isStreaming: false,
                        }
                      : m,
                  ),
                );
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content: `**Error:** ${err instanceof Error ? err.message : "Something went wrong"}`,
                  isStreaming: false,
                }
              : m,
          ),
        );
      } finally {
        setLoading(false);
        scrollToBottom();
      }
    };

    React.useImperativeHandle(ref, () => ({
      submitQuestion: (q: string) => {
        setInput(q);
        setTimeout(() => handleSubmit(q), 0);
      },
    }));

    const handleAction = (action: ActionCardData, msgSqlBlocks?: string[]) => {
      setPendingAction(action.type);
      const clearPending = () => setTimeout(() => setPendingAction(null), 300);

      if (action.type === "run_sql" && action.payload.sql) {
        const allBlocks =
          msgSqlBlocks && msgSqlBlocks.length > 0 ? msgSqlBlocks : [action.payload.sql as string];
        if (onOpenSql) {
          onOpenSql(action.payload.sql as string, allBlocks);
        } else {
          setActiveSql(action.payload.sql as string);
          setDeploySql(null);
        }
        clearPending();
      } else if (action.type === "deploy_notebook" && action.payload.sql) {
        if (onDeploySql) {
          onDeploySql(action.payload.sql as string);
        } else {
          setDeploySql(action.payload.sql as string);
          setActiveSql(null);
        }
        clearPending();
      } else if (action.type === "deploy_dashboard") {
        if (onDeployDashboard) {
          onDeployDashboard(action.payload);
        }
        clearPending();
      } else if (action.type === "view_tables") {
        if (action.payload.fqn) {
          router.push(`/environment/table/${encodeURIComponent(action.payload.fqn as string)}`);
        } else if (Array.isArray(action.payload.tables) && action.payload.tables.length === 1) {
          router.push(
            `/environment/table/${encodeURIComponent(action.payload.tables[0] as string)}`,
          );
        } else {
          const tables = Array.isArray(action.payload.tables) ? action.payload.tables : [];
          const highlightParam =
            tables.length > 0
              ? `&highlight=${encodeURIComponent((tables as string[]).join(","))}`
              : "";
          router.push(`/environment?tab=tables${highlightParam}`);
        }
      } else if (action.type === "view_erd") {
        setErdModalTables((action.payload.tables as string[]) ?? []);
        clearPending();
      } else if (action.type === "create_genie_space") {
        const buildTables = (action.payload.tables as string[]) ?? [];
        const buildDomain = (action.payload.domainHint as string) || undefined;
        const buildSummary = (action.payload.conversationSummary as string) || undefined;
        const buildSqlBlocks = (action.payload.sqlBlocks as string[]) || undefined;

        setGenieModalPayload({
          tables: buildTables,
          domain: buildDomain,
          conversationSummary: buildSummary,
          tableEnrichments: (action.payload.tableEnrichments as TableEnrichmentData[]) || undefined,
          sqlBlocks: buildSqlBlocks,
        });
        setGenieModalOpen(true);
        clearPending();
      } else if (action.type === "start_discovery") {
        router.push("/configure");
      } else if (action.type === "view_run" && action.payload.runId) {
        router.push(`/runs/${action.payload.runId}`);
      } else if (action.type === "ask_genie" && action.payload.url) {
        window.open(action.payload.url as string, "_blank");
        clearPending();
      } else if (action.type === "export_report") {
        router.push("/environment?tab=summary");
      } else if (action.type === "view_portfolio") {
        router.push("/business-value");
      } else if (action.type === "view_stakeholders") {
        router.push("/business-value/stakeholders");
      } else if (action.type === "view_roadmap") {
        router.push("/business-value/roadmap");
      } else if (
        action.type === "generate_business_case" ||
        action.type === "draft_executive_memo"
      ) {
        router.push("/business-value");
      } else {
        clearPending();
      }
    };

    const handleRequestFix = (sql: string, error: string) => {
      setInput(`Fix this SQL error:\n\nSQL: ${sql}\n\nError: ${error}`);
      setActiveSql(null);
      inputRef.current?.focus();
    };

    const handleFeedback = async (msgId: string, logId: string, rating: "up" | "down") => {
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, feedback: rating } : m)));
      try {
        await fetch("/api/assistant/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logId, rating }),
        });
      } catch {
        // feedback is best-effort
      }
    };

    const handleClear = () => {
      setMessages([]);
      setActiveSql(null);
      setDeploySql(null);
      onTableEnrichments?.([]);
      onReferencedTables?.([]);
      onChatMentionedTables?.([]);
      onSources?.([]);
      onClear?.();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    };

    const isCompact = mode === "compact";

    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div
          className={cn(
            "flex items-center justify-between border-b px-4 py-3",
            persona === "genie-builder" &&
              "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30",
            persona === "strategic" &&
              "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30",
          )}
        >
          <div className="flex items-center gap-2">
            {persona === "genie-builder" ? (
              <>
                <Sparkles className="size-5 text-amber-600 dark:text-amber-400" />
                <h2 className="text-base font-semibold">Genie Studio Builder</h2>
                <Badge className="border-amber-300 bg-amber-100 text-[10px] text-amber-700 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                  AI
                </Badge>
              </>
            ) : persona === "strategic" ? (
              <>
                <BarChart3 className="size-5 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-base font-semibold">Strategic Advisor</h2>
                <Badge className="border-emerald-300 bg-emerald-100 text-[10px] text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                  AI
                </Badge>
              </>
            ) : (
              <>
                <BrainCircuit className="size-5 text-primary" />
                <h2 className="text-base font-semibold">Ask Forge</h2>
                <Badge variant="secondary" className="text-[10px]">
                  AI
                </Badge>
              </>
            )}
            {messages.length > 0 && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                {PERSONA_META[persona].icon}
                {PERSONA_META[persona].label}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {persona === "genie-builder" && (
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              >
                <Link href="/genie">
                  <ArrowLeft className="size-3.5" />
                  <span className="hidden sm:inline">Genie Studio</span>
                </Link>
              </Button>
            )}
            {persona === "strategic" && (
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              >
                <Link href="/business-value">
                  <ArrowLeft className="size-3.5" />
                  <span className="hidden sm:inline">Business Value</span>
                </Link>
              </Button>
            )}
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={handleClear}
                title="Start a new conversation"
              >
                <Trash2 className="size-3.5" />
                <span className="hidden sm:inline">New chat</span>
              </Button>
            )}
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 overflow-y-auto">
          <div
            className={`space-y-4 p-4 ${isCompact ? "" : "mx-auto w-full max-w-[min(90%,72rem)]"}`}
          >
            {messages.length === 0 &&
              (suggestedQuestions && suggestedQuestions.length === 0 ? (
                <div
                  className={`flex flex-col items-center justify-center gap-5 text-center ${isCompact ? "py-16" : "py-20"}`}
                >
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/10">
                    <AlertCircle className="size-7 text-primary/60" />
                  </div>
                  <div>
                    <p className={`font-semibold ${isCompact ? "" : "text-lg"}`}>
                      No data available yet
                    </p>
                    <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
                      Run an environment scan or discovery pipeline to start asking questions.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => router.push("/environment")}>
                      Go to Environment
                    </Button>
                    <Button variant="default" size="sm" onClick={() => router.push("/configure")}>
                      Go to Configure
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className={`flex flex-col items-center justify-center gap-6 text-center ${isCompact ? "py-12" : "py-16"}`}
                >
                  {/* Branded icon */}
                  <div
                    className={cn(
                      "flex size-16 items-center justify-center rounded-2xl ring-1",
                      persona === "genie-builder"
                        ? "bg-gradient-to-br from-amber-200/40 to-amber-100/20 ring-amber-300/30 dark:from-amber-900/30 dark:to-amber-950/20 dark:ring-amber-700/30"
                        : "bg-gradient-to-br from-primary/20 to-primary/5 ring-primary/10",
                    )}
                  >
                    {persona === "genie-builder" ? (
                      <Sparkles className="size-8 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <BrainCircuit className="size-8 text-primary" />
                    )}
                  </div>

                  {/* Headline */}
                  <div>
                    {persona === "genie-builder" ? (
                      <>
                        <h2
                          className={`font-semibold tracking-tight ${isCompact ? "text-lg" : "text-xl"}`}
                        >
                          Build a Genie Space
                        </h2>
                        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
                          Describe what you need in plain language. I&apos;ll ask a few focused
                          questions, then generate your space.
                        </p>
                        <div className="mx-auto mt-4 flex max-w-sm items-center justify-center gap-6 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <span className="flex size-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                              1
                            </span>
                            Describe
                          </div>
                          <div className="h-px w-4 bg-border" />
                          <div className="flex items-center gap-1.5">
                            <span className="flex size-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                              2
                            </span>
                            Review
                          </div>
                          <div className="h-px w-4 bg-border" />
                          <div className="flex items-center gap-1.5">
                            <span className="flex size-5 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                              3
                            </span>
                            Deploy
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <h2
                          className={`font-semibold tracking-tight ${isCompact ? "text-lg" : "text-xl"}`}
                        >
                          What can I help you find?
                        </h2>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          Grounded in your actual metadata, tables, and lineage.
                        </p>
                      </>
                    )}
                  </div>

                  {/* Persona selector -- only in empty state, full mode, NOT for genie-builder */}
                  {!isCompact && onPersonaChange && persona !== "genie-builder" && (
                    <ToggleGroup
                      type="single"
                      size="sm"
                      variant="outline"
                      value={persona}
                      onValueChange={(v) => {
                        if (v) onPersonaChange(v as AssistantPersona);
                      }}
                      className="rounded-lg border bg-muted/30 p-1"
                    >
                      <ToggleGroupItem value="business" className="gap-1.5 rounded-md px-3 text-xs">
                        <Target className="size-3.5" />
                        Business
                      </ToggleGroupItem>
                      <ToggleGroupItem value="analyst" className="gap-1.5 rounded-md px-3 text-xs">
                        <Briefcase className="size-3.5" />
                        Analyst
                      </ToggleGroupItem>
                      <ToggleGroupItem value="tech" className="gap-1.5 rounded-md px-3 text-xs">
                        <Wrench className="size-3.5" />
                        Tech
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="strategic"
                        className="gap-1.5 rounded-md px-3 text-xs"
                      >
                        <BarChart3 className="size-3.5" />
                        Strategic
                      </ToggleGroupItem>
                    </ToggleGroup>
                  )}

                  {/* Suggestion cards */}
                  <div
                    className={`w-full ${isCompact ? "flex flex-wrap justify-center gap-2" : "mx-auto grid max-w-xl grid-cols-2 gap-3"}`}
                  >
                    {(suggestedQuestions ?? getFallbackQuestions(persona))
                      .slice(0, isCompact ? 6 : 4)
                      .map((q, i) => {
                        if (isCompact) {
                          return (
                            <button
                              key={q}
                              onClick={() => {
                                setInput(q);
                                inputRef.current?.focus();
                              }}
                              className="rounded-full border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
                            >
                              {q}
                            </button>
                          );
                        }
                        const Icon = SUGGESTION_ICONS[i % SUGGESTION_ICONS.length];
                        return (
                          <button
                            key={q}
                            onClick={() => {
                              setInput(q);
                              inputRef.current?.focus();
                            }}
                            className="group flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
                          >
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Icon className="size-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm leading-snug text-foreground/80 group-hover:text-foreground">
                                {q}
                              </p>
                              <span className="mt-1.5 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                                Ask this
                                <ArrowRight className="size-3" />
                              </span>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}

            {messages.map((msg) => (
              <div key={msg.id} className="space-y-3">
                <div
                  className={cn(
                    "flex items-start gap-3",
                    msg.role === "assistant" && "rounded-lg bg-muted/30 p-4",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-primary ring-1 ring-border",
                    )}
                  >
                    {msg.role === "user" ? (
                      <User className="size-3.5" />
                    ) : (
                      <Bot className="size-3.5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {msg.role === "user" ? (
                      <p className="text-sm leading-relaxed">{msg.content}</p>
                    ) : (
                      <>
                        {msg.intent && persona !== "business" && (
                          <Badge variant="outline" className="mb-2 text-[10px]">
                            {msg.intent.intent} · {(msg.intent.confidence * 100).toFixed(0)}%
                          </Badge>
                        )}
                        <AnswerStream
                          content={msg.content}
                          isStreaming={msg.isStreaming ?? false}
                          isPreparing={preparingMessageId === msg.id}
                          onRunSql={
                            onOpenSql
                              ? (sql) => {
                                  const allBlocks =
                                    msg.sqlBlocks && msg.sqlBlocks.length > 0
                                      ? msg.sqlBlocks
                                      : [sql];
                                  onOpenSql(sql, allBlocks);
                                }
                              : undefined
                          }
                        />
                      </>
                    )}
                  </div>
                </div>

                {msg.role === "assistant" &&
                  !msg.isStreaming &&
                  msg.actions &&
                  msg.actions.length > 0 && (
                    <div className="ml-10">
                      <ActionCardList
                        actions={msg.actions}
                        onAction={(a) => handleAction(a, msg.sqlBlocks)}
                        pendingAction={pendingAction}
                      />
                    </div>
                  )}

                {msg.role === "assistant" && !msg.isStreaming && msg.logId && (
                  <div className="ml-10 flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-7 w-7 p-0",
                        msg.feedback === "up" ? "text-green-600" : "text-muted-foreground",
                      )}
                      onClick={() => handleFeedback(msg.id, msg.logId!, "up")}
                      disabled={!!msg.feedback}
                      title="Helpful"
                    >
                      <ThumbsUp className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-7 w-7 p-0",
                        msg.feedback === "down" ? "text-red-600" : "text-muted-foreground",
                      )}
                      onClick={() => handleFeedback(msg.id, msg.logId!, "down")}
                      disabled={!!msg.feedback}
                      title="Not helpful"
                    >
                      <ThumbsDown className="size-3.5" />
                    </Button>
                    {msg.feedback && (
                      <span className="text-[10px] text-muted-foreground">
                        {msg.feedback === "up" ? "Thanks!" : "We'll improve"}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Inline SQL runner -- only used in compact/sheet mode without dialog support */}
            {activeSql && !onOpenSql && (
              <div className="ml-8">
                <SqlRunner sql={activeSql} onRequestFix={handleRequestFix} />
              </div>
            )}

            {deploySql && !onDeploySql && (
              <div className="ml-8">
                <DeployOptions sql={deploySql} />
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t px-4 py-3">
          <div className={isCompact ? "" : "mx-auto w-full max-w-[min(90%,72rem)]"}>
            <div className="flex items-end gap-2 rounded-xl border bg-muted/20 p-2 shadow-sm transition-shadow focus-within:border-primary/30 focus-within:shadow-md focus-within:ring-1 focus-within:ring-primary/20">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  persona === "genie-builder"
                    ? "Describe the tables, domain, and questions for your Genie Space…"
                    : persona === "strategic"
                      ? "Ask about business value, ROI, strategy, or board-level insights…"
                      : "Ask about your data estate…"
                }
                className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none"
                rows={input.includes("\n") ? Math.min(5, input.split("\n").length + 1) : 1}
                disabled={loading}
              />
              <Button
                size="sm"
                className="size-9 shrink-0 rounded-lg p-0"
                onClick={() => handleSubmit()}
                disabled={loading || !input.trim()}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </Button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground/60">
              Enter to send · Shift+Enter for new line · ⌘J to toggle
            </p>
          </div>
        </div>

        {genieModalPayload && (
          <GenieBuilderModal
            open={genieModalOpen}
            onOpenChange={setGenieModalOpen}
            tables={genieModalPayload.tables}
            domain={genieModalPayload.domain}
            conversationSummary={genieModalPayload.conversationSummary}
            tableEnrichments={genieModalPayload.tableEnrichments}
            sqlBlocks={genieModalPayload.sqlBlocks}
          />
        )}

        {deployJobId && (
          <GenieDeployDialog
            open={deployDialogOpen}
            onOpenChange={setDeployDialogOpen}
            jobId={deployJobId}
          />
        )}

        {erdModalTables && erdModalTables.length > 0 && (
          <ErdModal tableFqns={erdModalTables} onClose={() => setErdModalTables(null)} />
        )}
      </div>
    );
  },
);
