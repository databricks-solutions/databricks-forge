"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface VoteButtonProps {
  runId: string;
  useCaseId: string;
  initialCount?: number;
  hasVoted?: boolean;
  compact?: boolean;
}

export function VoteButton({
  runId,
  useCaseId,
  initialCount = 0,
  hasVoted = false,
  compact = false,
}: VoteButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [voted, setVoted] = useState(hasVoted);
  const [loading, setLoading] = useState(false);

  async function handleVote() {
    setLoading(true);
    try {
      const res = await fetch("/api/business-value/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, useCaseId }),
      });
      if (res.ok) {
        const data = await res.json();
        setCount(data.total);
        setVoted((prev) => !prev);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  if (compact) {
    return (
      <button
        onClick={handleVote}
        disabled={loading}
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors",
          voted
            ? "bg-primary/10 text-primary font-medium"
            : "bg-muted text-muted-foreground hover:bg-muted/80",
        )}
      >
        <ThumbsUp className={cn("h-3 w-3", voted && "fill-current")} />
        {count > 0 && count}
      </button>
    );
  }

  return (
    <Button
      variant={voted ? "default" : "outline"}
      size="sm"
      className="h-7 gap-1 text-xs"
      onClick={handleVote}
      disabled={loading}
    >
      <ThumbsUp className={cn("h-3 w-3", voted && "fill-current")} />
      {count > 0 ? count : "Vote"}
    </Button>
  );
}
