"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, X, DollarSign } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface ValueCaptureDialogProps {
  runId: string;
  useCaseId: string;
  useCaseName: string;
  estimatedValue?: number;
  onCaptured?: () => void;
}

const VALUE_TYPES = [
  { value: "cost_savings", label: "Cost Savings" },
  { value: "revenue_uplift", label: "Revenue Uplift" },
  { value: "risk_reduction", label: "Risk Reduction" },
  { value: "efficiency_gain", label: "Efficiency Gain" },
] as const;

export function ValueCaptureDialog({
  runId,
  useCaseId,
  useCaseName,
  estimatedValue,
  onCaptured,
}: ValueCaptureDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [valueType, setValueType] = useState("cost_savings");
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");

  async function handleSubmit() {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return;

    setSaving(true);
    try {
      const res = await fetch("/api/business-value/value-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          useCaseId,
          valueType,
          amount: numAmount,
          evidence: evidence || undefined,
        }),
      });
      if (res.ok) {
        setOpen(false);
        setAmount("");
        setEvidence("");
        onCaptured?.();
      }
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setOpen(true)}>
        <DollarSign className="h-3 w-3" />
        Capture
      </Button>
    );
  }

  return (
    <Card className="border-primary/20 shadow-lg">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold truncate max-w-[200px]" title={useCaseName}>
            {useCaseName}
          </h4>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>

        {estimatedValue != null && estimatedValue > 0 && (
          <p className="text-xs text-muted-foreground">
            Estimated: {formatCurrency(estimatedValue)}
          </p>
        )}

        <div className="space-y-2">
          <Label className="text-xs">Value Type</Label>
          <Select value={valueType} onValueChange={setValueType}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VALUE_TYPES.map((vt) => (
                <SelectItem key={vt.value} value={vt.value} className="text-xs">
                  {vt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Actual Value ($)</Label>
          <Input
            type="number"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Evidence (optional)</Label>
          <Textarea
            placeholder="How was this value measured?"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            className="text-xs min-h-[60px]"
          />
        </div>

        <Button
          size="sm"
          className="w-full h-8 text-xs"
          onClick={handleSubmit}
          disabled={saving || !amount || parseFloat(amount) <= 0}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Plus className="h-3 w-3 mr-1" />
          )}
          Record Value
        </Button>
      </CardContent>
    </Card>
  );
}
