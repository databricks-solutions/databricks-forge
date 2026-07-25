"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Cable,
  ShieldCheck,
  Building2,
  ExternalLink,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import type {
  ConnectionSummary,
  CreateConnectionInput,
  TestConnectionResult,
} from "@/lib/connections/types";

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/connections");
      if (res.ok) setConnections(await res.json());
    } catch {
      toast.error("Failed to load connections");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/connections/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConnections((prev) => prev.filter((c) => c.id !== id));
        toast.success("Connection deleted");
      } else {
        toast.error("Failed to delete connection");
      }
    } catch {
      toast.error("Failed to delete connection");
    }
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Connections"
        subtitle="Manage external platform connections for metadata scanning and migration."
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Connection
              </Button>
            </DialogTrigger>
            <AddConnectionDialog
              onCreated={() => {
                setDialogOpen(false);
                fetchConnections();
              }}
            />
          </Dialog>
        }
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-24 mt-1" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : connections.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Cable className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold text-lg">No connections yet</h3>
            <p className="text-muted-foreground text-sm max-w-sm mt-1">
              Add a Microsoft Fabric or Power BI connection to scan your external analytics estate
              and plan a migration to Databricks.
            </p>
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Connection
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {connections.map((conn) => (
            <ConnectionCard key={conn.id} connection={conn} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connection Card
// ---------------------------------------------------------------------------

function ConnectionCard({
  connection: conn,
  onDelete,
}: {
  connection: ConnectionSummary;
  onDelete: (id: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/connections/${conn.id}/test`, { method: "POST" });
      const data: TestConnectionResult = await res.json();
      setTestResult(data);
      if (data.success) toast.success(data.message);
      else toast.error(data.message);
    } catch {
      setTestResult({ success: false, message: "Test failed", workspaces: [] });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle
              className="text-base flex min-w-0 items-center gap-2 truncate"
              title={conn.name}
            >
              <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
              {conn.name}
            </CardTitle>
            <CardDescription className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="max-w-full text-xs capitalize"
                title={conn.connectorType}
              >
                {conn.connectorType}
              </Badge>
              <Badge
                variant={conn.accessLevel === "admin" ? "default" : "secondary"}
                className="text-xs"
              >
                {conn.accessLevel === "admin" ? (
                  <>
                    <ShieldCheck className="h-3 w-3 mr-1" />
                    Admin Scanner
                  </>
                ) : (
                  <>
                    <Building2 className="h-3 w-3 mr-1" />
                    Per-Workspace
                  </>
                )}
              </Badge>
            </CardDescription>
          </div>
          <Badge variant={conn.status === "active" ? "default" : "secondary"} className="text-xs">
            {conn.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground space-y-1">
          {conn.tenantId && <p>Tenant: {conn.tenantId}</p>}
          <p>Created: {new Date(conn.createdAt).toLocaleDateString()}</p>
          {conn.lastTestedAt && (
            <p>Last tested: {new Date(conn.lastTestedAt).toLocaleDateString()}</p>
          )}
        </div>

        {testResult && (
          <div
            className={`flex items-center gap-2 text-xs p-2 rounded-md ${
              testResult.success
                ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            {testResult.message}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
            Test
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete connection?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &ldquo;{conn.name}&rdquo; and all associated scan
                  data. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(conn.id)}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Add Connection Dialog
// ---------------------------------------------------------------------------

function AddConnectionDialog({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [accessLevel, setAccessLevel] = useState<"admin" | "workspace">("admin");
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const payload: CreateConnectionInput = {
        name: name.trim(),
        connectorType: "fabric",
        accessLevel,
        tenantId: tenantId.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      };
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create connection");
      }
      toast.success("Connection created");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create connection");
    } finally {
      setSaving(false);
    }
  };

  const valid = name.trim() && tenantId.trim() && clientId.trim() && clientSecret.trim();

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Add Fabric / Power BI Connection</DialogTitle>
        <DialogDescription>
          Connect to Microsoft Fabric or Power BI to scan your analytics estate.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 py-2">
        <div className="space-y-2">
          <Label>Connection Name</Label>
          <Input
            placeholder="e.g. Production Power BI"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Access Level</Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={accessLevel === "admin" ? "default" : "outline"}
              size="sm"
              onClick={() => setAccessLevel("admin")}
              className="flex-1"
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
              Admin Scanner
            </Button>
            <Button
              type="button"
              variant={accessLevel === "workspace" ? "default" : "outline"}
              size="sm"
              onClick={() => setAccessLevel("workspace")}
              className="flex-1"
            >
              <Building2 className="h-3.5 w-3.5 mr-1.5" />
              Per-Workspace
            </Button>
          </div>
          {accessLevel === "admin" ? (
            <p className="text-xs text-muted-foreground">
              Requires: Entra ID app registration, SP in allowed security group, Fabric admin
              enables scanner APIs. Returns full metadata including M expressions, sensitivity
              labels, and Fabric artifacts.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No admin access needed. SP or user token with workspace Member/Admin role. Returns
              reduced metadata (no M expressions, no sensitivity labels).
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Tenant ID</Label>
          <Input
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Client ID</Label>
          <Input
            placeholder="Entra ID Application (Client) ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Client Secret</Label>
          <Input
            type="password"
            placeholder="Entra ID Client Secret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Encrypted at rest. Never exposed to the frontend after creation.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={handleSubmit} disabled={!valid || saving}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Create Connection
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
