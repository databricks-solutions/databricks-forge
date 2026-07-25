"use client";

/**
 * Estate Programs index.
 *
 * Lists the caller's company-level estate programs and lets them create a new
 * one. Each program groups many estate scans into one aggregate view; the
 * detail page renders the company -> domain -> entity -> table tree.
 */

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Plus, Database, Layers, ScanSearch, Network } from "lucide-react";
import { toast } from "sonner";
import { useIndustryOutcomes } from "@/lib/hooks/use-industry-outcomes";
import { buildEstateProgramCreatePayload } from "@/lib/domain/estate-program-form";
import { readApiError } from "@/lib/http/api-error";

interface ProgramRow {
  id: string;
  name: string;
  description: string | null;
  industryId: string | null;
  createdAt: string;
  _count?: { scopes: number; scans: number };
}

export default function EstateProgramsPage() {
  const t = useTranslations("estatePrograms");
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [industryId, setIndustryId] = useState("");
  const [subVertical, setSubVertical] = useState("");
  const [orgContext, setOrgContext] = useState("");

  const { getOptions: getIndustryOptions, loading: industriesLoading } = useIndustryOutcomes();
  const industryOptions = getIndustryOptions();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/estate-programs");
      if (!resp.ok) {
        const err = await readApiError(resp);
        throw new Error(err.message);
      }
      const data = await resp.json();
      setPrograms(data.programs ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async () => {
    if (!name.trim()) {
      toast.error(t("toast.nameRequired"));
      return;
    }
    setCreating(true);
    try {
      const payload = buildEstateProgramCreatePayload({
        name,
        description,
        industryId,
        subVertical,
        orgContext,
      });
      const resp = await fetch("/api/estate-programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const err = await readApiError(resp);
        throw new Error(err.message);
      }
      toast.success(t("toast.created"));
      setName("");
      setDescription("");
      setIndustryId("");
      setSubVertical("");
      setOrgContext("");
      setShowForm(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("toast.createFailed"));
    } finally {
      setCreating(false);
    }
  }, [name, description, industryId, subVertical, orgContext, load, t]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Building2 className="h-6 w-6" />
            {t("title")}
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" />
          {t("newProgram")}
        </Button>
      </div>

      {/* How it works — make the flow explicit */}
      <Card className="bg-muted/30">
        <CardContent className="grid gap-4 py-4 md:grid-cols-3">
          <Step
            n={1}
            icon={<Building2 className="h-4 w-4" />}
            title={t("howItWorks.step1Title")}
            body={t("howItWorks.step1Body")}
          />
          <Step
            n={2}
            icon={<ScanSearch className="h-4 w-4" />}
            title={t("howItWorks.step2Title")}
            body={t("howItWorks.step2Body")}
          />
          <Step
            n={3}
            icon={<Network className="h-4 w-4" />}
            title={t("howItWorks.step3Title")}
            body={t("howItWorks.step3Body")}
          />
        </CardContent>
      </Card>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t("form.title")}</CardTitle>
            <CardDescription>{t("form.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("form.nameLabel")}</label>
              <Input
                placeholder={t("form.namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("form.industryLabel")}</label>
              <Select
                value={industryId || "__none__"}
                onValueChange={(v) => setIndustryId(v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("form.industryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("form.industryNone")}</SelectItem>
                  {industryOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {industriesLoading && (
                <p className="text-muted-foreground text-xs">{t("form.industryLoading")}</p>
              )}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("form.descriptionLabel")}</label>
              <Textarea
                placeholder={t("form.descriptionPlaceholder")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">{t("form.advanced")}</summary>
              <div className="mt-3 space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t("form.subVerticalLabel")}</label>
                  <Input
                    placeholder={t("form.subVerticalPlaceholder")}
                    value={subVertical}
                    maxLength={120}
                    onChange={(e) => setSubVertical(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">{t("form.subVerticalHelp")}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">{t("form.orgContextLabel")}</label>
                  <Textarea
                    placeholder={t("form.orgContextPlaceholder")}
                    value={orgContext}
                    maxLength={2000}
                    rows={3}
                    onChange={(e) => setOrgContext(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">{t("form.orgContextHelp")}</p>
                </div>
              </div>
            </details>
            <div className="flex gap-2">
              <Button onClick={create} disabled={creating}>
                {creating ? t("form.creating") : t("form.create")}
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                {t("form.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : programs.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-3 py-12 text-center text-sm">
            <p>{t("empty")}</p>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t("newProgram")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {programs.map((p) => (
            <Link key={p.id} href={`/environment/programs/${p.id}`}>
              <Card className="transition-colors hover:border-primary">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{p.name}</CardTitle>
                    {p.industryId && (
                      <Badge variant="secondary">
                        {industryOptions.find((o) => o.id === p.industryId)?.name ?? p.industryId}
                      </Badge>
                    )}
                  </div>
                  {p.description && <CardDescription>{p.description}</CardDescription>}
                </CardHeader>
                <CardContent className="text-muted-foreground flex gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <Layers className="h-4 w-4" />
                    {t("scopesCount", { count: p._count?.scopes ?? 0 })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Database className="h-4 w-4" />
                    {t("scansCount", { count: p._count?.scans ?? 0 })}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="bg-primary/10 text-primary flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
        {n}
      </div>
      <div>
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {title}
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">{body}</p>
      </div>
    </div>
  );
}
