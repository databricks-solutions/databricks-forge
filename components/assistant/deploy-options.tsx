"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Loader2, Check, AlertCircle } from "lucide-react";

interface DeployOptionsProps {
  sql: string;
}

export function DeployOptions({ sql }: DeployOptionsProps) {
  const [title, setTitle] = React.useState("Forge Assistant Query");
  const [path, setPath] = React.useState("/Shared/forge_assistant/");
  const [deploying, setDeploying] = React.useState(false);
  const [result, setResult] = React.useState<{
    success: boolean;
    path?: string;
    error?: string;
  } | null>(null);

  const handleDeploy = async () => {
    setDeploying(true);
    setResult(null);
    try {
      const resp = await fetch("/api/sql/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql, target: "notebook", title, path }),
      });
      const data = await resp.json();
      setResult(data);
    } catch {
      setResult({ success: false, error: "Network error" });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        <BookOpen className="size-4 text-primary" />
        <p className="text-sm font-medium">Deploy as SQL Notebook</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="notebook-title" className="text-xs">
            Title
          </Label>
          <Input
            id="notebook-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notebook-path" className="text-xs">
            Workspace Path
          </Label>
          <Input
            id="notebook-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={handleDeploy} disabled={deploying}>
        {deploying ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <BookOpen className="size-3.5" />
        )}
        {deploying ? "Deploying…" : "Deploy Notebook"}
      </Button>

      {result?.success && (
        <div className="flex items-center gap-2 text-xs text-green-600">
          <Check className="size-3.5" />
          <span>Deployed to</span>
          <Badge variant="secondary" className="text-[10px]">
            {result.path}
          </Badge>
        </div>
      )}

      {result && !result.success && (
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="size-3.5" />
          <span>{result.error}</span>
        </div>
      )}
    </div>
  );
}
