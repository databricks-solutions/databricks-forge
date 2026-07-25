"use client";

/**
 * ShareButton -- standardised "Share" affordance.
 *
 * Wraps `<ShareDialog>` so every detail page just renders one component
 * with the current resource. Visible only when:
 *   - the user-isolation flag is on, AND
 *   - the current viewer is the owner.
 *
 * For shared resources owned by someone else, render `<SharedBadge>`
 * separately to indicate provenance.
 */

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareDialog } from "@/components/share/share-dialog";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import type { ResourceType } from "@/lib/lakebase/acl";

interface ShareButtonProps {
  resourceType: ResourceType;
  resourceId: string;
  ownerEmail: string | null | undefined;
  resourceLabel?: string;
  size?: "sm" | "default" | "lg";
  variant?: "outline" | "default" | "ghost";
  onChange?: () => void;
}

export function ShareButton({
  resourceType,
  resourceId,
  ownerEmail,
  resourceLabel,
  size = "sm",
  variant = "outline",
  onChange,
}: ShareButtonProps) {
  const { email, isolationEnabled } = useCurrentUser();
  const [open, setOpen] = useState(false);

  if (!isolationEnabled) return null;
  if (!email || !ownerEmail) return null;
  // Defensive: callers must pass the *tracking-row* id (not e.g. a
  // Databricks Genie spaceId). Empty resourceId would 404 on /api/share.
  if (!resourceId) return null;
  // Only the owner can share.
  if (email.toLowerCase().trim() !== ownerEmail.toLowerCase().trim()) return null;

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        className="gap-1.5"
      >
        <Share2 className="h-4 w-4" />
        <span>Share</span>
      </Button>
      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        resourceType={resourceType}
        resourceId={resourceId}
        resourceLabel={resourceLabel}
        onChange={onChange}
      />
    </>
  );
}

/**
 * Small inline badge to indicate the current resource was shared with
 * the viewer (vs owned by them). Drop this next to the title on detail
 * pages.
 */
export function SharedByBadge({
  ownerEmail,
}: {
  ownerEmail: string | null | undefined;
}) {
  const { email, isolationEnabled } = useCurrentUser();
  if (!isolationEnabled) return null;
  if (!email || !ownerEmail) return null;
  if (email.toLowerCase().trim() === ownerEmail.toLowerCase().trim()) return null;

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
      title={`Shared by ${ownerEmail}`}
    >
      Shared by {ownerEmail}
    </span>
  );
}
