"use client";

import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { retryEstateScope } from "@/lib/domain/estate-scope-retry";

export function ScopeRetryButton({
  programId,
  scopeId,
  label,
  disabled = false,
  onRetried,
}: {
  programId: string;
  scopeId: string;
  label: string;
  disabled?: boolean;
  onRetried: () => Promise<void> | void;
}) {
  const t = useTranslations("estatePrograms.detail");
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    setRetrying(true);
    try {
      const result = await retryEstateScope(programId, scopeId);
      if (!result.ok) {
        const key =
          result.reason === "active_work"
            ? "retry.active"
            : result.reason === "max_attempts"
              ? "retry.exhausted"
              : result.reason === "no_failed_scope"
                ? "retry.noLongerFailed"
                : "retry.failed";
        toast.error(t(key as "retry.failed"));
        return;
      }
      toast.success(t("retry.started", { label }));
      await onRetried();
    } catch {
      toast.error(t("retry.failed"));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled || retrying}
      aria-label={t("retry.label", { label })}
      onClick={() => void retry()}
    >
      {retrying ? (
        <Loader2 aria-hidden="true" className="mr-1 h-4 w-4 animate-spin" />
      ) : (
        <RotateCcw aria-hidden="true" className="mr-1 h-4 w-4" />
      )}
      {retrying ? t("retry.retrying") : t("retry.action")}
    </Button>
  );
}
