"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Wand2, Trash2, Loader2, Clock, Download } from "lucide-react";
import { DemoWizard } from "@/components/demo/demo-wizard";
import { toast } from "sonner";
import type { DemoSessionSummary } from "@/lib/demo/types";

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function statusBadgeVariant(status: DemoSessionSummary["status"]) {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  return "outline";
}

export default function DemoPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<DemoSessionSummary[] | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/demo/sessions")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSessions(data);
        else setSessions([]);
      })
      .catch(() => setSessions([]));
  }, []);

  const handleDelete = async (sessionId: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/demo/sessions/${sessionId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data?.lakebaseDeleted !== false) {
        setSessions((prev) =>
          prev ? prev.filter((s) => s.sessionId !== sessionId) : []
        );
        toast.success("Session deleted");
      } else {
        toast.error(data?.error ?? "Failed to delete session");
      }
    } catch {
      toast.error("Failed to delete session");
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  const handleExport = (sessionId: string, format: "pptx" | "pdf") => {
    window.open(`/api/demo/sessions/${sessionId}/export?format=${format}`, "_blank");
  };

  if (sessions === null) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Demo Studio</h1>
          <Button onClick={() => setWizardOpen(true)}>
            <Wand2 className="mr-2 h-4 w-4" />
            Launch Demo Wizard
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">
                  No demo sessions yet. Launch the wizard to create your first
                  demo.
                </p>
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={() => setWizardOpen(true)}
                >
                  <Wand2 className="mr-2 h-4 w-4" />
                  Launch Demo Wizard
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer Name</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Catalog.Schema</TableHead>
                    <TableHead>Tables</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[120px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow
                      key={s.sessionId}
                      className="cursor-pointer"
                      onClick={() =>
                        router.push(`/demo/sessions/${s.sessionId}`)
                      }
                    >
                      <TableCell className="font-medium">
                        {s.customerName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{s.industryId}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(s.status)}>
                          {s.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.catalogName}.{s.schemaName}
                      </TableCell>
                      <TableCell>{s.tablesCreated}</TableCell>
                      <TableCell>{s.totalRows.toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(s.createdAt)}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <Download className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  handleExport(s.sessionId, "pptx")
                                }
                              >
                                PPTX
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  handleExport(s.sessionId, "pdf")
                                }
                              >
                                PDF
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(s.sessionId)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <DemoWizard open={wizardOpen} onOpenChange={setWizardOpen} />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete demo session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will drop all tables in the demo schema and remove the
              session. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && handleDelete(deleteId)}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
