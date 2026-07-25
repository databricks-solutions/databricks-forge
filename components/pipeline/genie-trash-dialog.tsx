"use client";

import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TrashPreviewSection, type TrashPreview } from "./genie-trash-preview";

interface GenieTrashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: TrashPreview | null;
  previewLoading: boolean;
  dropChecked: boolean;
  onDropCheckedChange: (v: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function GenieTrashDialog({
  open,
  onOpenChange,
  preview,
  previewLoading,
  dropChecked,
  onDropCheckedChange,
  onConfirm,
  onClose,
}: GenieTrashDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onOpenChange(false);
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Trash Genie Space?</AlertDialogTitle>
          <AlertDialogDescription>
            This will move the space to trash in Databricks.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {previewLoading && (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking deployed resources...
          </div>
        )}

        {!previewLoading && preview && (
          <TrashPreviewSection
            preview={preview}
            dropChecked={dropChecked}
            onDropCheckedChange={onDropCheckedChange}
          />
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={previewLoading}>
            Trash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
