import { FormEvent, useEffect, useState } from "react";
import { Eye, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { RichTextEditor } from "../components/editor/RichTextEditor.js";
import { api, type Template } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Textarea } from "../components/ui/textarea.js";
import { Label } from "../components/ui/label.js";
import { Spinner } from "../components/ui/spinner.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Card, CardContent } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog.js";

interface TemplateForm {
  name: string;
  subject: string;
  html: string;
  text: string;
}

const emptyForm: TemplateForm = {
  name: "",
  subject: "",
  html: "",
  text: ""
};

function htmlIsEmpty(html: string) {
  const stripped = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return stripped === "" && !/<(img|hr|br)/i.test(html);
}

function formatDate(value?: string) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
}

export function Templates() {
  const { currentOrganizationId: organizationId } = useSession();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<Template | null>(null);

  async function load() {
    if (!organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setTemplates(await api.listTemplates(organizationId));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to load templates"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [organizationId]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(template: Template) {
    setEditing(template);
    setForm({
      name: template.name,
      subject: template.subject,
      html: template.html,
      text: template.text ?? ""
    });
    setDialogOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }
    if (htmlIsEmpty(form.html)) {
      toast.error("The email body cannot be empty.");
      return;
    }

    const payload = {
      organizationId,
      name: form.name,
      subject: form.subject,
      html: form.html,
      text: form.text || undefined
    };

    setSaving(true);
    try {
      if (editing) {
        await api.updateTemplate(editing.id, payload);
        toast.success("Template updated.");
      } else {
        await api.createTemplate(payload);
        toast.success("Template saved.");
      }
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save template"
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteTemplate(deleteTarget.id);
      toast.success("Template deleted.");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Templates"
        description="Create reusable email templates with variables like {{firstName}}."
        actions={
          <Button onClick={openCreate} disabled={!organizationId}>
            <Plus className="h-4 w-4" />
            New template
          </Button>
        }
      />

      <section className="space-y-3 p-6">
        {loading ? (
          [0, 1].map((index) => (
            <Card key={index}>
              <CardContent className="p-5">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="mt-2 h-4 w-56" />
                <Skeleton className="mt-4 h-20 w-full" />
              </CardContent>
            </Card>
          ))
        ) : templates.length === 0 ? (
          <Card>
            <EmptyState
              icon={FileText}
              title="No templates yet"
              description="Create a reusable template to speed up sending."
              action={
                <Button onClick={openCreate} disabled={!organizationId} variant="outline">
                  <Plus className="h-4 w-4" />
                  New template
                </Button>
              }
            />
          </Card>
        ) : (
          templates.map((template) => (
            <Card key={template.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-semibold">{template.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {template.subject}
                    </p>
                    {formatDate(template.updatedAt) ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Updated {formatDate(template.updatedAt)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setPreviewTarget(template)}
                      aria-label="Preview template"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(template)}
                      aria-label="Edit template"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(template)}
                      aria-label="Delete template"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div
                  className="prose prose-sm mt-4 max-h-48 max-w-none overflow-auto rounded-md border bg-muted/30 p-3 dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: template.html }}
                />
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit template" : "New template"}
            </DialogTitle>
            <DialogDescription>
              Use the toolbar to insert variables like{" "}
              <code className="text-xs">{"{{firstName}}"}</code>. They are
              replaced when you send.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  placeholder="Welcome, {{firstName}}"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Email body</Label>
              <RichTextEditor
                value={form.html}
                onChange={(html) => setForm((prev) => ({ ...prev, html }))}
                placeholder="Write your email…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="text">Plain text fallback (optional)</Label>
              <Textarea
                id="text"
                rows={3}
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner /> : null}
                {editing ? "Save changes" : "Create template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={previewTarget !== null}
        onOpenChange={(open) => !open && setPreviewTarget(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewTarget?.name}</DialogTitle>
            <DialogDescription>{previewTarget?.subject}</DialogDescription>
          </DialogHeader>
          <div
            className="prose prose-sm max-h-[60vh] max-w-none overflow-auto rounded-md border bg-white p-4 dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: previewTarget?.html ?? "" }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete template?"
        description={`"${deleteTarget?.name}" will be permanently removed.`}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </>
  );
}
