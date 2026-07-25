"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { BrainCircuit } from "lucide-react";

/**
 * Header trigger for Ask Forge. Navigates to the full-page /ask-forge route.
 * Cmd+J shortcut toggles navigation.
 */
export function AskForgePanel() {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("ask_forge");

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "j") {
        e.preventDefault();
        if (pathname === "/ask-forge") {
          router.back();
        } else {
          router.push("/ask-forge");
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pathname, router]);

  const isActive = pathname === "/ask-forge";

  return (
    <Button
      variant={isActive ? "secondary" : "ghost"}
      size="sm"
      className="hidden gap-1.5 text-xs md:flex"
      onClick={() => router.push("/ask-forge")}
    >
      <BrainCircuit className="size-4" />
      {t("label")}
      <kbd className="ml-1 inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
        ⌘J
      </kbd>
    </Button>
  );
}
