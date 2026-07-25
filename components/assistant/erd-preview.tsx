"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitBranch, Copy, Check } from "lucide-react";

interface ERDPreviewProps {
  mermaidCode: string;
}

/**
 * Renders Mermaid ERD code as a syntax-highlighted code block.
 *
 * Full Mermaid rendering would require a client-side library (mermaid.js).
 * This preview shows the raw Mermaid code with a copy button, which
 * can be pasted into any Mermaid-compatible renderer.
 */
export function ERDPreview({ mermaidCode }: ERDPreviewProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(mermaidCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!mermaidCode) return null;

  const lineCount = mermaidCode.split("\n").length;
  const entityCount = (mermaidCode.match(/\b\w+\s*\{/g) || []).length;
  const relationCount = (mermaidCode.match(/\|\|--|o\{--|--o\{|--\|\|/g) || []).length;

  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="size-4 text-primary" />
          <p className="text-sm font-medium">Entity Relationship Diagram</p>
          <Badge variant="secondary" className="text-[10px]">
            {entityCount} entities · {relationCount} relations
          </Badge>
        </div>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleCopy}>
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy Mermaid"}
        </Button>
      </div>
      <pre className="max-h-[300px] overflow-auto rounded-md bg-muted p-3 text-xs">
        <code>
          {mermaidCode.length > 2000
            ? mermaidCode.slice(0, 2000) + `\n... (${lineCount} lines total)`
            : mermaidCode}
        </code>
      </pre>
    </div>
  );
}
