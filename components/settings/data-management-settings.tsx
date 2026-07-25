"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface DataManagementSettingsProps {
  onClearLocalData: () => void;
  onDeleteAllData: () => void;
  deleting: boolean;
}

export function DataManagementSettings({
  onClearLocalData,
  onDeleteAllData,
  deleting,
}: DataManagementSettingsProps) {
  const t = useTranslations("settings.data_management");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">{t("clear.label")}</p>
            <p className="text-xs text-muted-foreground">{t("clear.description")}</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                {t("clear.button")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("clear.dialog.title")}</AlertDialogTitle>
                <AlertDialogDescription>{t("clear.dialog.body")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("clear.dialog.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={onClearLocalData}>
                  {t("clear.dialog.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Separator />

        <div className="flex items-center justify-between rounded-md border border-destructive/50 bg-destructive/5 p-3">
          <div>
            <p className="text-sm font-medium text-destructive">{t("delete.label")}</p>
            <p className="text-xs text-muted-foreground">{t("delete.description")}</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={deleting}>
                {deleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <AlertTriangle className="mr-2 h-4 w-4" />
                )}
                {deleting ? t("delete.button_busy") : t("delete.button_idle")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("delete.dialog.title")}</AlertDialogTitle>
                <AlertDialogDescription>{t("delete.dialog.body")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("delete.dialog.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDeleteAllData}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {t("delete.dialog.confirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
