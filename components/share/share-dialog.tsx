"use client";

/**
 * ShareDialog -- owner-only dialog for managing access to a single resource.
 *
 * Loads the current ACL on open, lets the owner add/edit/remove viewer
 * grants, and updates the in-memory list optimistically. All mutations go
 * through `/api/share`.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { ResourceType } from "@/lib/lakebase/acl";

interface AclEntryView {
  id: string;
  viewerEmail: string;
  permission: "view" | "edit";
  grantedBy: string;
  createdAt: string;
}

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: ResourceType;
  resourceId: string;
  resourceLabel?: string;
  /** Called whenever the ACL changes -- the parent can refresh badges, etc. */
  onChange?: () => void;
}

const RESOURCE_LABELS: Partial<Record<ResourceType, string>> = {
  run: "this run",
  scan: "this scan",
  genie_space: "this Genie space",
  demo_session: "this demo session",
  comment_job: "this comment job",
  strategy_document: "this strategy document",
  document: "this document",
  fabric_scan: "this Fabric scan",
  fabric_migration: "this Fabric migration",
};

export function ShareDialog({
  open,
  onOpenChange,
  resourceType,
  resourceId,
  resourceLabel,
  onChange,
}: ShareDialogProps) {
  const [entries, setEntries] = useState<AclEntryView[]>([]);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newPermission, setNewPermission] = useState<"view" | "edit">("view");

  const labelText = useMemo(
    () => resourceLabel ?? RESOURCE_LABELS[resourceType] ?? "this resource",
    [resourceLabel, resourceType],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/share?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`;
      const res = await fetch(url, { cache: "no-store", credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        acl: AclEntryView[];
        owner: { email: string };
      };
      setEntries(
        data.acl.map((e) => ({
          ...e,
          createdAt: typeof e.createdAt === "string" ? e.createdAt : new Date(e.createdAt).toISOString(),
        })),
      );
      setOwnerEmail(data.owner.email);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load sharing settings";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [resourceType, resourceId]);

  useEffect(() => {
    if (open) {
      void refresh();
    } else {
      setNewEmail("");
      setNewPermission("view");
      setError(null);
    }
  }, [open, refresh]);

  async function handleAdd() {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceType,
          resourceId,
          viewerEmail: email,
          permission: newPermission,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Shared with ${email}`);
      setNewEmail("");
      setNewPermission("view");
      await refresh();
      onChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to share");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(viewerEmail: string, permission: "view" | "edit") {
    setSaving(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceType,
          resourceId,
          viewerEmail,
          permission,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await refresh();
      onChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update permission");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(viewerEmail: string) {
    setSaving(true);
    try {
      const url = `/api/share?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}&viewerEmail=${encodeURIComponent(viewerEmail)}`;
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Removed ${viewerEmail}`);
      await refresh();
      onChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to revoke access");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share {labelText}</DialogTitle>
          <DialogDescription>
            Grant a teammate view or edit access. Only the owner can manage sharing.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {ownerEmail && (
            <div className="flex items-center justify-between rounded border bg-muted/40 px-3 py-2 text-sm">
              <span className="truncate">
                <span className="font-medium">{ownerEmail}</span>{" "}
                <span className="text-muted-foreground">(you)</span>
              </span>
              <Badge variant="outline">Owner</Badge>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No teammates have access yet.</p>
          ) : (
            <ul className="space-y-2">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm"
                >
                  <span className="truncate">{e.viewerEmail}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Select
                      value={e.permission}
                      onValueChange={(v) => handleUpdate(e.viewerEmail, v as "view" | "edit")}
                      disabled={saving}
                    >
                      <SelectTrigger className="h-8 w-[88px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="view">View</SelectItem>
                        <SelectItem value="edit">Edit</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(e.viewerEmail)}
                      disabled={saving}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Revoke access for {e.viewerEmail}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2 pt-2">
          <Label htmlFor="share-email" className="text-sm font-medium">
            Add teammate
          </Label>
          <div className="flex gap-2">
            <Input
              id="share-email"
              type="email"
              placeholder="teammate@company.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              disabled={saving}
              className="flex-1"
            />
            <Select
              value={newPermission}
              onValueChange={(v) => setNewPermission(v as "view" | "edit")}
              disabled={saving}
            >
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="view">View</SelectItem>
                <SelectItem value="edit">Edit</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleAdd} disabled={saving || !newEmail.trim()}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              <span className="ml-1.5 hidden sm:inline">Share</span>
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
