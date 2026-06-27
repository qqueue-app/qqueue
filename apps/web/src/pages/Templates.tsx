import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, FileText, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { STARTER_TEMPLATES } from "../components/editor/starters.js";
import {
  applyVariables,
  resolveVariableData
} from "../components/editor/variables.js";
import { api, type Template } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Badge } from "../components/ui/badge.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Card, CardContent } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog.js";

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
}

// Lightweight, non-interactive thumbnail of the rendered template.
function TemplateThumbnail({ template }: { template: Template }) {
  const data = resolveVariableData(
    template.variables,
    template.previewData ?? undefined
  );
  const body = applyVariables(template.html, data);
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8" /><style>
    body{margin:0;padding:16px;font-family:Inter,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1f2933;font-size:13px;line-height:1.55;background:#fff}
    img{max-width:100%;height:auto}a{color:#2e7d63}h1{font-size:18px;margin:0 0 8px}h2{font-size:15px;margin:14px 0 6px}p{margin:0 0 10px}
    hr{border:none;border-top:1px solid #e4e7eb;margin:14px 0}
  </style></head><body>${body}</body></html>`;
  return (
    <div className="pointer-events-none h-40 overflow-hidden rounded-t-lg border-b bg-white">
      <iframe
        title={`${template.name} preview`}
        sandbox=""
        srcDoc={srcDoc}
        tabIndex={-1}
        aria-hidden="true"
        className="h-[400px] w-[200%] origin-top-left scale-50 border-0"
      />
    </div>
  );
}

function StarterGallery({
  open,
  onOpenChange,
  onPick
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (key: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Start a new template</DialogTitle>
          <DialogDescription>
            Pick a starting point. You can change everything afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {STARTER_TEMPLATES.map((starter) => (
            <button
              key={starter.key}
              type="button"
              onClick={() => onPick(starter.key)}
              className="rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{starter.name}</h3>
                <Badge variant="secondary">{starter.category}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {starter.description}
              </p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Templates() {
  const navigate = useNavigate();
  const { currentOrganizationId: organizationId } = useSession();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cloningId, setCloningId] = useState<string | null>(null);

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

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const template of templates) {
      if (template.category) set.add(template.category);
    }
    return [...set].sort();
  }, [templates]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return templates.filter((template) => {
      if (activeCategory && template.category !== activeCategory) return false;
      if (!term) return true;
      return [
        template.name,
        template.subject,
        template.description ?? "",
        template.category ?? "",
        ...(template.tags ?? [])
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [templates, search, activeCategory]);

  async function duplicate(template: Template) {
    setCloningId(template.id);
    try {
      await api.cloneTemplate(template.id);
      toast.success("Template duplicated.");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to duplicate."
      );
    } finally {
      setCloningId(null);
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

  function startNew(starterKey: string) {
    setGalleryOpen(false);
    navigate(`/templates/new?starter=${encodeURIComponent(starterKey)}`);
  }

  return (
    <>
      <PageHeader
        title="Templates"
        description="Design reusable emails with variables like {{firstName}}, a live preview, and starter layouts."
        actions={
          <Button onClick={() => setGalleryOpen(true)} disabled={!organizationId}>
            <Plus className="h-4 w-4" />
            New template
          </Button>
        }
      />

      <section className="space-y-4 p-6">
        {!loading && templates.length > 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search templates…"
                className="pl-8"
              />
            </div>
            {categories.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveCategory(null)}
                  className="focus:outline-none"
                >
                  <Badge variant={activeCategory ? "outline" : "default"}>
                    All
                  </Badge>
                </button>
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className="focus:outline-none"
                  >
                    <Badge
                      variant={
                        activeCategory === category ? "default" : "outline"
                      }
                    >
                      {category}
                    </Badge>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Card key={index}>
                <Skeleton className="h-40 w-full rounded-b-none" />
                <CardContent className="p-4">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="mt-2 h-4 w-48" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : templates.length === 0 ? (
          <Card>
            <EmptyState
              icon={FileText}
              title="No templates yet"
              description="Create a reusable template to speed up sending."
              action={
                <Button
                  onClick={() => setGalleryOpen(true)}
                  disabled={!organizationId}
                  variant="outline"
                >
                  <Plus className="h-4 w-4" />
                  New template
                </Button>
              }
            />
          </Card>
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={Search}
              title="No matches"
              description="No templates match your search or filter."
            />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((template) => (
              <Card
                key={template.id}
                className="group overflow-hidden transition-shadow hover:shadow-md"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/templates/${template.id}/edit`)}
                  className="block w-full text-left"
                  aria-label={`Edit ${template.name}`}
                >
                  <TemplateThumbnail template={template} />
                </button>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">{template.name}</h2>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {template.description || template.subject}
                      </p>
                    </div>
                    {template.category ? (
                      <Badge variant="secondary" className="shrink-0">
                        {template.category}
                      </Badge>
                    ) : null}
                  </div>

                  {template.tags && template.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {template.tags.slice(0, 4).map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(template.updatedAt)
                        ? `Updated ${formatDate(template.updatedAt)}`
                        : ""}
                    </span>
                    <div className="flex gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          navigate(`/templates/${template.id}/edit`)
                        }
                        aria-label="Edit template"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => duplicate(template)}
                        disabled={cloningId === template.id}
                        aria-label="Duplicate template"
                      >
                        <Copy className="h-4 w-4" />
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
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <StarterGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        onPick={startNew}
      />

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
