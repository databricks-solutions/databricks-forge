"use client";

import { useState, useRef, useEffect } from "react";
import { Upload, Globe, Building2, Zap, Scale, Flame, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ResearchPreset, DemoScope, ParsedDocument } from "@/lib/demo/types";

interface CompanyInfoStepProps {
  customerName: string;
  onCustomerNameChange: (v: string) => void;
  websiteUrl: string;
  onWebsiteUrlChange: (v: string) => void;
  industryId: string;
  onIndustryIdChange: (v: string) => void;
  preset: ResearchPreset;
  onPresetChange: (v: ResearchPreset) => void;
  scope: DemoScope;
  onScopeChange: (v: DemoScope) => void;
  uploadedDocs: ParsedDocument[];
  onUploadedDocsChange: (v: ParsedDocument[]) => void;
  pastedContext: string;
  onPastedContextChange: (v: string) => void;
  genieMode: boolean;
  onGenieModeChange: (v: boolean) => void;
}

const PRESETS: { value: ResearchPreset; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    value: "quick",
    label: "Quick",
    icon: <Zap className="h-4 w-4" />,
    desc: "Website only. ~30s. Good for fast standup.",
  },
  {
    value: "balanced",
    label: "Balanced",
    icon: <Scale className="h-4 w-4" />,
    desc: "Website + investor docs. ~60-90s. Good depth.",
  },
  {
    value: "full",
    label: "Full",
    icon: <Flame className="h-4 w-4" />,
    desc: "All sources + deep analysis. ~2-3min. Consultant-grade.",
  },
];

export function CompanyInfoStep({
  customerName,
  onCustomerNameChange,
  websiteUrl,
  onWebsiteUrlChange,
  industryId,
  onIndustryIdChange,
  preset,
  onPresetChange,
  scope,
  onScopeChange,
  uploadedDocs,
  onUploadedDocsChange,
  pastedContext,
  onPastedContextChange,
  genieMode,
  onGenieModeChange,
}: CompanyInfoStepProps) {
  const [uploading, setUploading] = useState(false);
  const [industries, setIndustries] = useState<Array<{ id: string; name: string }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/industries")
      .then((r) => r.json())
      .then((data) => setIndustries(data.industries ?? []))
      .catch(() => {});
  }, []);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }

      const resp = await fetch("/api/demo/upload", { method: "POST", body: formData });
      const data = await resp.json();
      if (data.documents) {
        onUploadedDocsChange([...uploadedDocs, ...data.documents]);
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6 px-1">
      {/* Customer Name */}
      <div className="space-y-2">
        <Label htmlFor="customer-name" className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Customer Name
        </Label>
        <Input
          id="customer-name"
          placeholder="e.g. Rio Tinto, ANZ Bank, Woolworths"
          value={customerName}
          onChange={(e) => onCustomerNameChange(e.target.value)}
        />
      </div>

      {/* Website */}
      <div className="space-y-2">
        <Label htmlFor="website-url" className="flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Website URL
        </Label>
        <Input
          id="website-url"
          type="url"
          placeholder="https://www.company.com"
          value={websiteUrl}
          onChange={(e) => onWebsiteUrlChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          We&apos;ll scrape the website for company context. Leave blank to skip.
        </p>
      </div>

      {/* Industry (optional) */}
      <div className="space-y-2">
        <Label>Industry (optional -- auto-detected if blank)</Label>
        <Select value={industryId || "__auto__"} onValueChange={(v) => onIndustryIdChange(v === "__auto__" ? "" : v)}>
          <SelectTrigger>
            <SelectValue placeholder="Auto-detect from website" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__auto__">Auto-detect from website</SelectItem>
            {industries.map((ind) => (
              <SelectItem key={ind.id} value={ind.id}>
                {ind.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Research Preset */}
      <div className="space-y-2">
        <Label>Research Depth</Label>
        <div className="grid grid-cols-3 gap-3">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => onPresetChange(p.value)}
              className={`rounded-lg border p-3 text-left transition-all ${
                preset === p.value
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <div className="flex items-center gap-2 font-medium text-sm">
                {p.icon}
                {p.label}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{p.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Division / Scope */}
      <div className="space-y-2">
        <Label htmlFor="division">Division / Scope (optional)</Label>
        <Input
          id="division"
          placeholder="e.g. Aluminium Division, Wealth Management"
          value={scope.division ?? ""}
          onChange={(e) => onScopeChange({ ...scope, division: e.target.value || undefined })}
        />
        <p className="text-xs text-muted-foreground">
          Focus the demo on a specific division, department, or subsidiary.
        </p>
      </div>

      {/* Demo Objective */}
      <div className="space-y-2">
        <Label htmlFor="objective">Demo Objective (optional)</Label>
        <Textarea
          id="objective"
          placeholder="What should the demo emphasise? e.g. Customer 360, Supply Chain Optimisation"
          value={scope.demoObjective ?? ""}
          onChange={(e) => onScopeChange({ ...scope, demoObjective: e.target.value || undefined })}
          rows={2}
        />
      </div>

      {/* Genie Mode */}
      <div className="space-y-2">
        <Label>Genie Mode</Label>
        <button
          type="button"
          onClick={() => onGenieModeChange(!genieMode)}
          aria-pressed={genieMode}
          className={`w-full rounded-lg border p-3 text-left transition-all ${
            genieMode
              ? "border-violet-500 bg-violet-50 ring-1 ring-violet-500 dark:bg-violet-950/30"
              : "border-border hover:border-primary/50"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <Sparkles
                className={`h-4 w-4 mt-0.5 ${
                  genieMode ? "text-violet-600 dark:text-violet-400" : "text-muted-foreground"
                }`}
              />
              <div>
                <div className="text-sm font-medium">
                  Bias for Genie Space demos
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Wider row counts, more fact tables, richer dimensions. Auto-deploys a Genie Space bound to the generated schema.
                </p>
              </div>
            </div>
            <div
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                genieMode ? "bg-violet-600" : "bg-muted"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  genieMode ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </div>
          </div>
        </button>
      </div>

      {/* Document Upload */}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Additional Documents (optional)
        </Label>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Uploading..." : "Upload Files"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.md,.txt,.doc,.docx"
            className="hidden"
            onChange={(e) => handleFileUpload(e.target.files)}
          />
        </div>

        {uploadedDocs.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {uploadedDocs.map((doc, i) => (
              <Badge key={i} variant="secondary">
                {doc.filename} ({Math.round(doc.charCount / 1000)}K chars)
              </Badge>
            ))}
          </div>
        )}

        <Textarea
          placeholder="Or paste strategy documents, annual report excerpts, etc."
          value={pastedContext}
          onChange={(e) => onPastedContextChange(e.target.value)}
          rows={3}
          className="mt-2"
        />
      </div>
    </div>
  );
}
