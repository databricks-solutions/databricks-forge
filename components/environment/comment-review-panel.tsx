"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X, ChevronRight, Pencil, Lock, Undo2, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Proposal {
  id: string;
  jobId: string;
  tableFqn: string;
  columnName: string | null;
  originalComment: string | null;
  proposedComment: string;
  editedComment: string | null;
  status: string;
  errorMessage: string | null;
  appliedAt: string | null;
}

interface CommentReviewPanelProps {
  tableFqn: string;
  proposals: Proposal[];
  permissions: Record<string, { canModify: boolean }>;
  onUpdateProposals: (
    updates: Array<{ id: string; status: string; editedComment?: string | null }>,
  ) => Promise<void>;
  onApplyTable: (tableFqn: string) => Promise<void>;
  onUndoTable: (tableFqn: string) => Promise<void>;
  onResyncTable?: (tableFqn: string) => Promise<void>;
  onNextTable: () => void;
}

export function CommentReviewPanel({
  tableFqn,
  proposals,
  permissions,
  onUpdateProposals,
  onApplyTable,
  onUndoTable,
  onResyncTable,
  onNextTable,
}: CommentReviewPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [applyingTable, setApplyingTable] = useState(false);
  const [resyncing, setResyncing] = useState(false);

  const tableProposal = proposals.find((p) => !p.columnName);
  const columnProposals = proposals.filter((p) => p.columnName);
  const canModify = permissions[tableFqn]?.canModify ?? true;

  const pendingCount = proposals.filter((p) => p.status === "pending").length;
  const acceptedCount = proposals.filter((p) => p.status === "accepted").length;
  const appliedCount = proposals.filter((p) => p.status === "applied").length;

  const startEdit = useCallback((proposal: Proposal) => {
    setEditingId(proposal.id);
    setEditValue(proposal.editedComment ?? proposal.proposedComment);
  }, []);

  const saveEdit = useCallback(
    async (proposal: Proposal) => {
      await onUpdateProposals([{ id: proposal.id, status: "accepted", editedComment: editValue }]);
      setEditingId(null);
    },
    [editValue, onUpdateProposals],
  );

  const handleAcceptAll = useCallback(async () => {
    const pending = proposals.filter((p) => p.status === "pending" || p.status === "rejected");
    if (pending.length === 0) return;
    await onUpdateProposals(pending.map((p) => ({ id: p.id, status: "accepted" })));
  }, [proposals, onUpdateProposals]);

  const handleAcceptAllAndNext = useCallback(async () => {
    await handleAcceptAll();
    onNextTable();
  }, [handleAcceptAll, onNextTable]);

  const handleApplyTable = useCallback(async () => {
    setApplyingTable(true);
    try {
      await onApplyTable(tableFqn);
    } finally {
      setApplyingTable(false);
    }
  }, [onApplyTable, tableFqn]);

  const handleResync = useCallback(async () => {
    if (!onResyncTable) return;
    setResyncing(true);
    try {
      await onResyncTable(tableFqn);
    } finally {
      setResyncing(false);
    }
  }, [onResyncTable, tableFqn]);

  const parts = tableFqn.split(".");

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-6">
        {/* Table header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold font-mono">{parts.pop()}</h2>
            <p className="text-xs text-muted-foreground font-mono">{tableFqn}</p>
          </div>
          <div className="flex items-center gap-2">
            {!canModify && (
              <Badge variant="outline" className="text-amber-600 border-amber-300">
                <Lock className="mr-1 h-3 w-3" />
                Read-only
              </Badge>
            )}
            {onResyncTable && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResync}
                disabled={resyncing}
                title="Refresh current comments from Unity Catalog"
              >
                <RefreshCw className={cn("mr-1 h-3.5 w-3.5", resyncing && "animate-spin")} />
                Resync
              </Button>
            )}
            {appliedCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => onUndoTable(tableFqn)}>
                <Undo2 className="mr-1 h-3.5 w-3.5" />
                Undo
              </Button>
            )}
          </div>
        </div>

        {/* Table-level comment */}
        {tableProposal && (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">Table Comment</span>
                <ProposalActions
                  proposal={tableProposal}
                  onAccept={() => onUpdateProposals([{ id: tableProposal.id, status: "accepted" }])}
                  onReject={() => onUpdateProposals([{ id: tableProposal.id, status: "rejected" }])}
                  onEdit={() => startEdit(tableProposal)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <CommentCard
                  label="Current"
                  comment={tableProposal.originalComment}
                  variant="original"
                />
                {editingId === tableProposal.id ? (
                  <div className="space-y-2">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Proposed (editing)
                    </span>
                    <Textarea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="text-sm min-h-[80px]"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveEdit(tableProposal)}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <CommentCard
                    label="Proposed"
                    comment={tableProposal.editedComment ?? tableProposal.proposedComment}
                    variant="proposed"
                    status={tableProposal.status}
                  />
                )}
              </div>
              {tableProposal.errorMessage && (
                <div className="mt-2 flex items-start gap-2 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span className="break-all line-clamp-2">{tableProposal.errorMessage}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Column comments */}
        {columnProposals.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">
                Column Comments ({columnProposals.length})
              </span>
              <Button variant="outline" size="sm" onClick={handleAcceptAll}>
                <Check className="mr-1 h-3.5 w-3.5" />
                Accept All Columns
              </Button>
            </div>

            <div className="rounded-md border">
              <div className="grid grid-cols-[180px_1fr_1fr_100px] gap-px bg-muted text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <div className="bg-background px-3 py-2">Column</div>
                <div className="bg-background px-3 py-2">Current</div>
                <div className="bg-background px-3 py-2">Proposed</div>
                <div className="bg-background px-3 py-2 text-center">Actions</div>
              </div>

              {columnProposals.map((p, idx) => (
                <div
                  key={p.id}
                  className={cn(
                    "grid grid-cols-[180px_1fr_1fr_100px] gap-px border-t",
                    p.status === "accepted" && "bg-green-50/50 dark:bg-green-950/10",
                    p.status === "rejected" && "bg-red-50/50 dark:bg-red-950/10",
                    p.status === "applied" && "bg-blue-50/50 dark:bg-blue-950/10",
                    p.status === "failed" && "bg-destructive/5",
                    p.status === "pending" && idx % 2 === 1 && "bg-muted/30",
                  )}
                >
                  <div className="px-3 py-2">
                    <span className="text-xs font-mono font-medium">{p.columnName}</span>
                  </div>
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    {p.originalComment ?? <span className="italic">No comment</span>}
                  </div>
                  <div className="px-3 py-2">
                    {editingId === p.id ? (
                      <div className="space-y-1">
                        <Textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="text-xs min-h-[60px]"
                        />
                        <div className="flex gap-1">
                          <Button size="sm" className="h-6 text-xs" onClick={() => saveEdit(p)}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs">{p.editedComment ?? p.proposedComment}</span>
                    )}
                    {p.errorMessage && (
                      <div className="mt-1 flex items-start gap-1 text-[10px] text-destructive">
                        <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                        <span className="break-all line-clamp-2">{p.errorMessage}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-center gap-1 px-2 py-2">
                    <ProposalActions
                      proposal={p}
                      compact
                      onAccept={() => onUpdateProposals([{ id: p.id, status: "accepted" }])}
                      onReject={() => onUpdateProposals([{ id: p.id, status: "rejected" }])}
                      onEdit={() => startEdit(p)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="text-xs text-muted-foreground">
            {acceptedCount} accepted, {pendingCount} pending
          </div>
          <div className="flex items-center gap-2">
            {acceptedCount > 0 && canModify && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleApplyTable}
                disabled={applyingTable}
              >
                Apply This Table
              </Button>
            )}
            <Button size="sm" onClick={handleAcceptAllAndNext}>
              Accept All & Next
              <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CommentCard({
  label,
  comment,
  variant,
  status,
}: {
  label: string;
  comment: string | null;
  variant: "original" | "proposed";
  status?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {status && (
          <Badge
            variant="secondary"
            className={cn(
              "text-[9px]",
              status === "accepted" &&
                "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
              status === "rejected" &&
                "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
              status === "applied" &&
                "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
            )}
          >
            {status}
          </Badge>
        )}
      </div>
      <div
        className={cn(
          "rounded-md border p-3 text-sm min-h-[60px]",
          variant === "original" && "bg-muted/30",
          variant === "proposed" && "bg-background",
        )}
      >
        {comment ?? <span className="italic text-muted-foreground">No comment</span>}
      </div>
    </div>
  );
}

function ProposalActions({
  proposal,
  compact,
  onAccept,
  onReject,
  onEdit,
}: {
  proposal: Proposal;
  compact?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  if (proposal.status === "applied") {
    return (
      <Badge
        variant="secondary"
        className="text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
      >
        Applied
      </Badge>
    );
  }

  const btnSize = compact ? "h-6 w-6" : "h-7 w-7";

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant={proposal.status === "accepted" ? "default" : "ghost"}
        size="icon"
        className={btnSize}
        onClick={onAccept}
        title="Accept"
      >
        <Check className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant={proposal.status === "rejected" ? "destructive" : "ghost"}
        size="icon"
        className={btnSize}
        onClick={onReject}
        title="Reject"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className={btnSize} onClick={onEdit} title="Edit">
        <Pencil className="h-3 w-3" />
      </Button>
    </div>
  );
}
