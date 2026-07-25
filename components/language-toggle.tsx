"use client";

import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  LOCALE_COOKIE,
  LOCALE_NATIVE_LABELS,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/i18n/config";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function LanguageToggle() {
  const locale = useLocale() as Locale;
  const t = useTranslations("language_toggle");
  const [isPending, startTransition] = useTransition();

  const handleSelect = (next: Locale) => {
    if (next === locale) return;
    // eslint-disable-next-line react-hooks/immutability -- document.cookie is a browser-API setter, not a module-level mutation; user-triggered side effect belongs in the event handler, not useEffect.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
    startTransition(() => {
      window.location.reload();
    });
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={isPending}
              aria-label={t("label")}
            >
              <Languages className="h-4 w-4" />
              <span className="sr-only">{t("label")}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("tooltip")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {SUPPORTED_LOCALES.map((value) => (
          <DropdownMenuItem key={value} onClick={() => handleSelect(value)}>
            {LOCALE_NATIVE_LABELS[value]}
            {locale === value && (
              <span className="ml-auto text-xs text-primary">Active</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
