"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  COMMENT_OUTPUT_LANGUAGES,
  type CommentOutputLanguage,
} from "@/lib/ai/comment-engine/types";

interface AiOutputSettingsProps {
  aiCommentLanguage: CommentOutputLanguage;
  onAiCommentLanguageChange: (value: CommentOutputLanguage) => void;
}

const LANGUAGE_NATIVE_LABELS: Record<CommentOutputLanguage, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  es: "Español",
};

export function AiOutputSettings({
  aiCommentLanguage,
  onAiCommentLanguageChange,
}: AiOutputSettingsProps) {
  const t = useTranslations("settings.ai_output");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="aiCommentLanguage">{t("comment_language_label")}</Label>
          <Select
            value={aiCommentLanguage}
            onValueChange={(v) => onAiCommentLanguageChange(v as CommentOutputLanguage)}
          >
            <SelectTrigger id="aiCommentLanguage" className="w-80">
              <div className="flex items-center gap-2">
                <Languages className="h-4 w-4 text-muted-foreground" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              {COMMENT_OUTPUT_LANGUAGES.map((lang) => (
                <SelectItem key={lang} value={lang}>
                  {LANGUAGE_NATIVE_LABELS[lang]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("comment_language_hint")}</p>
        </div>
      </CardContent>
    </Card>
  );
}
