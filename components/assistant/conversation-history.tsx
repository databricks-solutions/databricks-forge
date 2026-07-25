"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  PanelLeftClose,
  PanelLeft,
  Check,
  X,
  Sparkles,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  id: string;
  title: string;
  sessionId: string;
  persona?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationHistoryProps {
  activeConversationId: string | null;
  /** Increment to trigger a refetch of the conversation list */
  refreshKey?: number;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

// ---------------------------------------------------------------------------
// Date grouping
// ---------------------------------------------------------------------------

interface GroupedConversations {
  label: string;
  conversations: ConversationSummary[];
}

interface GroupedConversationsEx extends GroupedConversations {
  accent?: "amber" | "emerald";
}

function groupConversations(conversations: ConversationSummary[]): GroupedConversationsEx[] {
  const genieBuilder: ConversationSummary[] = [];
  const strategic: ConversationSummary[] = [];
  const regular: ConversationSummary[] = [];

  for (const conv of conversations) {
    if (conv.persona === "genie-builder") {
      genieBuilder.push(conv);
    } else if (conv.persona === "strategic") {
      strategic.push(conv);
    } else {
      regular.push(conv);
    }
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const weekStart = new Date(todayStart.getTime() - 7 * 86_400_000);

  const dateGroups: Record<string, ConversationSummary[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    Older: [],
  };

  for (const conv of regular) {
    const date = new Date(conv.updatedAt);
    if (date >= todayStart) {
      dateGroups.Today.push(conv);
    } else if (date >= yesterdayStart) {
      dateGroups.Yesterday.push(conv);
    } else if (date >= weekStart) {
      dateGroups["Previous 7 days"].push(conv);
    } else {
      dateGroups.Older.push(conv);
    }
  }

  const result: GroupedConversationsEx[] = [];

  if (genieBuilder.length > 0) {
    result.push({ label: "Genie Builder", conversations: genieBuilder, accent: "amber" });
  }

  if (strategic.length > 0) {
    result.push({ label: "Strategic Advisor", conversations: strategic, accent: "emerald" });
  }

  for (const [label, items] of Object.entries(dateGroups)) {
    if (items.length > 0) {
      result.push({ label, conversations: items });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConversationHistory({
  activeConversationId,
  refreshKey = 0,
  onSelectConversation,
  onNewConversation,
  collapsed,
  onToggleCollapse,
}: ConversationHistoryProps) {
  const [conversations, setConversations] = React.useState<ConversationSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState("");
  const editInputRef = React.useRef<HTMLInputElement>(null);

  const fetchConversations = React.useCallback(async () => {
    try {
      const resp = await fetch("/api/assistant/conversations");
      if (!resp.ok) return;
      const data = await resp.json();
      setConversations(data.conversations ?? []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchConversations();
  }, [fetchConversations, refreshKey]);

  React.useEffect(() => {
    if (editingId) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingId]);

  const handleRename = async (id: string) => {
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }

    try {
      await fetch(`/api/assistant/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)));
    } catch {
      // best-effort
    } finally {
      setEditingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/assistant/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        onNewConversation();
      }
    } catch {
      // best-effort
    }
  };

  const handleDeleteAll = async () => {
    try {
      await fetch("/api/assistant/conversations", { method: "DELETE" });
      setConversations([]);
      onNewConversation();
    } catch {
      // best-effort
    }
  };

  const startEditing = (conv: ConversationSummary) => {
    setEditingId(conv.id);
    setEditTitle(conv.title);
  };

  const groups = groupConversations(conversations);

  if (collapsed) {
    return (
      <div className="flex h-full w-10 flex-col items-center border-r bg-muted/20 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="relative mb-2 h-8 w-8 p-0"
          onClick={onToggleCollapse}
          title={`Expand history${conversations.length > 0 ? ` (${conversations.length})` : ""}`}
        >
          <PanelLeft className="size-4" />
          {conversations.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
              {conversations.length > 9 ? "9+" : conversations.length}
            </span>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onNewConversation}
          title="New conversation"
        >
          <MessageSquarePlus className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col border-r bg-muted/20">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <span className="text-xs font-medium text-muted-foreground">History</span>
        <div className="flex items-center gap-0.5">
          {conversations.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  title="Delete all conversations"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete all conversations?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all {conversations.length} conversation
                    {conversations.length !== 1 ? "s" : ""} and their messages. This cannot be
                    undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={handleDeleteAll}
                  >
                    Delete all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onNewConversation}
            title="New conversation"
          >
            <MessageSquarePlus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onToggleCollapse}
            title="Collapse history"
          >
            <PanelLeftClose className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Conversation list */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {loading && (
            <div className="space-y-3 px-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          )}

          {!loading && conversations.length === 0 && (
            <div className="px-2 py-8 text-center">
              <p className="text-xs text-muted-foreground">No conversations yet</p>
              <p className="mt-1 text-[10px] text-muted-foreground/70">
                Start a conversation to see it here
              </p>
            </div>
          )}

          {!loading &&
            groups.map((group) => (
              <div key={group.label} className="mb-3">
                <p
                  className={cn(
                    "mb-1.5 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider",
                    (group as GroupedConversationsEx).accent === "amber"
                      ? "text-amber-600 dark:text-amber-400"
                      : (group as GroupedConversationsEx).accent === "emerald"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground",
                  )}
                >
                  {(group as GroupedConversationsEx).accent === "amber" && (
                    <Sparkles className="size-3" />
                  )}
                  {(group as GroupedConversationsEx).accent === "emerald" && (
                    <BarChart3 className="size-3" />
                  )}
                  {group.label}
                </p>
                {group.conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={cn(
                      "group relative flex items-center rounded-md py-1.5 text-sm transition-colors",
                      activeConversationId === conv.id
                        ? "bg-accent text-accent-foreground pl-3.5 pr-2"
                        : "px-2 text-foreground/80 hover:bg-accent/50",
                    )}
                  >
                    {activeConversationId === conv.id && (
                      <span
                        className={cn(
                          "absolute left-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full",
                          conv.persona === "genie-builder"
                            ? "bg-amber-500"
                            : conv.persona === "strategic"
                              ? "bg-emerald-500"
                              : "bg-primary",
                        )}
                      />
                    )}
                    {editingId === conv.id ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <Input
                          ref={editInputRef}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(conv.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="h-6 flex-1 px-1 text-xs"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 shrink-0 p-0"
                          onClick={() => handleRename(conv.id)}
                        >
                          <Check className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 shrink-0 p-0"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="size-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <button
                          className="min-w-0 flex-1 truncate text-left text-xs"
                          onClick={() => onSelectConversation(conv.id)}
                          title={conv.title}
                        >
                          {conv.title}
                        </button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "ml-1 h-5 w-5 shrink-0 p-0",
                                activeConversationId === conv.id
                                  ? "opacity-70"
                                  : "opacity-0 group-hover:opacity-100",
                              )}
                            >
                              <MoreHorizontal className="size-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36">
                            <DropdownMenuItem onClick={() => startEditing(conv)}>
                              <Pencil className="mr-2 size-3" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => handleDelete(conv.id)}
                            >
                              <Trash2 className="mr-2 size-3" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
