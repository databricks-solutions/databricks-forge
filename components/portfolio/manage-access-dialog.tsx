"use client";

/**
 * Manage portfolio access dialog.
 *
 * Lets an existing portfolio admin grant/revoke the cross-estate Portfolio
 * (CDO) tier to other users in-tool — no redeploy. Backed by
 * `/api/portfolio/admins`. Bootstrap / env-configured admins are shown as
 * read-only (they come from deployment config and cannot be revoked here).
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, Users } from "lucide-react";

interface PortfolioAdmin {
  email: string;
  grantedByEmail: string | null;
  isBootstrap: boolean;
  createdAt: string;
}

export function ManageAccessDialog() {
  const t = useTranslations("portfolio.access");
  const [open, setOpen] = useState(false);
  const [admins, setAdmins] = useState<PortfolioAdmin[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyEmail, setBusyEmail] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/portfolio/admins");
      if (!resp.ok) throw new Error("Failed");
      const body = await resp.json();
      setAdmins(body.admins as PortfolioAdmin[]);
    } catch {
      toast.error(t("load_error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const add = useCallback(async () => {
    const value = email.trim();
    if (!value.includes("@")) {
      toast.error(t("invalid_email"));
      return;
    }
    setAdding(true);
    try {
      const resp = await fetch("/api/portfolio/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(body.error ?? "Failed");
      setEmail("");
      toast.success(t("granted", { email: body.email ?? value }));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("grant_error"));
    } finally {
      setAdding(false);
    }
  }, [email, load, t]);

  const remove = useCallback(
    async (target: string) => {
      setBusyEmail(target);
      try {
        const resp = await fetch(`/api/portfolio/admins?email=${encodeURIComponent(target)}`, {
          method: "DELETE",
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error ?? "Failed");
        toast.success(t("revoked", { email: target }));
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("revoke_error"));
      } finally {
        setBusyEmail(null);
      }
    },
    [load, t],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="min-h-11">
          <Users aria-hidden="true" className="mr-2 h-4 w-4" />
          {t("manage")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="portfolio-admin-email">{t("email_label")}</Label>
            <Input
            id="portfolio-admin-email"
            type="email"
            placeholder={t("email_placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            disabled={adding}
            aria-describedby="portfolio-admin-email-help"
          />
            <p id="portfolio-admin-email-help" className="sr-only">{t("email_help")}</p>
          </div>
          <Button className="min-h-11" onClick={add} disabled={adding || !email.trim()}>
            {adding ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <Plus aria-hidden="true" className="h-4 w-4" />
            )}
            <span className="ml-1">{t("add")}</span>
          </Button>
        </div>

        <div className="max-h-72 space-y-1.5 overflow-auto" aria-live="polite" aria-busy={loading}>
          {loading || admins === null ? (
            <>
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </>
          ) : admins.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            admins.map((a) => (
              <div
                key={a.email}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.email}</p>
                  {a.grantedByEmail && (
                    <p className="truncate text-xs text-muted-foreground">
                      {t("granted_by", { email: a.grantedByEmail })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.isBootstrap && (
                    <Badge variant="secondary" className="text-[10px]">
                      {t("config_badge")}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="min-h-11 min-w-11 text-muted-foreground hover:text-destructive"
                    disabled={a.isBootstrap || busyEmail === a.email}
                    onClick={() => remove(a.email)}
                    aria-label={t("revoke")}
                  >
                    {busyEmail === a.email ? (
                      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
