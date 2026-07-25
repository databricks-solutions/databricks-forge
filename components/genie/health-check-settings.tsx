"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Settings, Loader2, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type {
  CheckDefinition,
  CategoryDefinition,
  Severity,
} from "@/lib/genie/health-checks/types";

interface HealthConfigResponse {
  config: {
    overrides: Array<{
      checkId: string;
      enabled?: boolean;
      params?: Record<string, unknown>;
      severity?: Severity;
    }>;
    customChecks: Array<Record<string, unknown>>;
    categoryWeights: Record<string, number> | null;
  };
  resolvedChecks: CheckDefinition[];
  categories: Record<string, CategoryDefinition>;
  validationErrors: string[];
}

interface CheckOverrideState {
  enabled: boolean;
  severity: Severity;
  params: Record<string, unknown>;
}

export function HealthCheckSettingsDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checks, setChecks] = useState<CheckDefinition[]>([]);
  const [categories, setCategories] = useState<Record<string, CategoryDefinition>>({});
  const [overrides, setOverrides] = useState<Record<string, CheckOverrideState>>({});
  const [categoryWeights, setCategoryWeights] = useState<Record<string, number>>({});

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/genie-spaces/health-config");
      if (!res.ok) throw new Error("Failed to load config");
      const data: HealthConfigResponse = await res.json();

      setChecks(data.resolvedChecks);
      setCategories(data.categories);

      const overrideMap: Record<string, CheckOverrideState> = {};
      for (const check of data.resolvedChecks) {
        overrideMap[check.id] = {
          enabled: check.enabled !== false,
          severity: check.severity,
          params: check.params,
        };
      }
      setOverrides(overrideMap);

      const weights: Record<string, number> = {};
      for (const [id, cat] of Object.entries(data.categories)) {
        weights[id] = cat.weight;
      }
      setCategoryWeights(weights);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load health config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadConfig();
  }, [open, loadConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const overridesList = Object.entries(overrides)
        .filter(([id]) => {
          const original = checks.find((c) => c.id === id);
          if (!original) return false;
          return (
            overrides[id].enabled !== (original.enabled !== false) ||
            overrides[id].severity !== original.severity
          );
        })
        .map(([checkId, state]) => ({
          checkId,
          enabled: state.enabled,
          severity: state.severity,
        }));

      const res = await fetch("/api/genie-spaces/health-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          overrides: overridesList,
          customChecks: [],
          categoryWeights,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Save failed");
      }

      toast.success("Health check settings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const overrideMap: Record<string, CheckOverrideState> = {};
    for (const check of checks) {
      overrideMap[check.id] = {
        enabled: true,
        severity: check.severity,
        params: check.params,
      };
    }
    setOverrides(overrideMap);

    const defaultWeights: Record<string, number> = {};
    for (const id of Object.keys(categories)) {
      defaultWeights[id] = 25;
    }
    setCategoryWeights(defaultWeights);
  };

  const toggleCheck = (checkId: string) => {
    setOverrides((prev) => ({
      ...prev,
      [checkId]: { ...prev[checkId], enabled: !prev[checkId]?.enabled },
    }));
  };

  const updateWeight = (catId: string, weight: number) => {
    setCategoryWeights((prev) => ({ ...prev, [catId]: weight }));
  };

  const checksByCategory = Object.keys(categories).map((catId) => ({
    catId,
    label: categories[catId].label,
    checks: checks.filter((c) => c.category === catId),
  }));

  const totalWeight = Object.values(categoryWeights).reduce((a, b) => a + b, 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Health Check Settings">
          <Settings className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Health Check Settings</DialogTitle>
          <DialogDescription>
            Configure check thresholds, enable/disable individual checks, and adjust category
            weights.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-8">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : (
          <Tabs defaultValue="checks" className="mt-2">
            <TabsList>
              <TabsTrigger value="checks">Checks</TabsTrigger>
              <TabsTrigger value="weights">Category Weights</TabsTrigger>
            </TabsList>

            <TabsContent value="checks" className="mt-4 space-y-6">
              {checksByCategory.map(({ catId, label, checks: catChecks }) => (
                <div key={catId}>
                  <h3 className="mb-2 text-sm font-medium">{label}</h3>
                  <div className="space-y-2">
                    {catChecks.map((check) => {
                      const state = overrides[check.id];
                      if (!state) return null;
                      return (
                        <div
                          key={check.id}
                          className="flex items-center justify-between rounded border px-3 py-2"
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={state.enabled}
                              onCheckedChange={() => toggleCheck(check.id)}
                            />
                            <div>
                              <span
                                className={`text-sm ${state.enabled ? "" : "text-muted-foreground line-through"}`}
                              >
                                {check.description}
                              </span>
                            </div>
                          </div>
                          <Badge
                            variant={
                              check.severity === "critical"
                                ? "destructive"
                                : check.severity === "warning"
                                  ? "secondary"
                                  : "outline"
                            }
                            className="text-[10px]"
                          >
                            {check.severity}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="weights" className="mt-4 space-y-6">
              <p className="text-sm text-muted-foreground">
                Adjust how much each category contributes to the overall health score. Weights
                should sum to 100.
              </p>
              {Object.entries(categories).map(([catId, cat]) => (
                <div key={catId} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label>{cat.label}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={categoryWeights[catId] ?? 25}
                        onChange={(e) => updateWeight(catId, parseInt(e.target.value) || 0)}
                        className="h-7 w-16 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                  </div>
                  <Slider
                    value={[categoryWeights[catId] ?? 25]}
                    onValueChange={([v]) => updateWeight(catId, v)}
                    min={0}
                    max={100}
                    step={5}
                  />
                </div>
              ))}
              <div
                className={`text-sm font-medium ${totalWeight === 100 ? "text-green-600" : "text-red-600"}`}
              >
                Total: {totalWeight}%{totalWeight !== 100 && " (must equal 100)"}
              </div>
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={handleReset}>
            <RotateCcw className="mr-2 size-4" />
            Reset Defaults
          </Button>
          <Button onClick={handleSave} disabled={saving || totalWeight !== 100}>
            {saving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
