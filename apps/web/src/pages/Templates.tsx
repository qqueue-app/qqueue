import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Copy,
  FileText,
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { STARTER_TEMPLATES } from "../components/editor/starters.js";
import {
  applyVariables,
  resolveVariableData,
} from "../components/editor/variables.js";
import { api, type Template } from "../lib/api.js";
import { formatFullDate, formatMailDate } from "../lib/format.js";
import { qk } from "../lib/query-client.js";
import { useApiMutation, useOrgQuery } from "../lib/use-api.js";
import { useSession } from "../lib/session-context.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent } from "../components/ui/card.js";
import { DataGrid } from "../components/ui/data-grid.js";
import { IconButton } from "../components/ui/icon-button.js";
import { Input } from "../components/ui/input.js";
import { RowActions } from "../components/ui/row-actions.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { Hint } from "../components/ui/tooltip.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import { EMAIL_ACCENT, EMAIL_NEUTRALS } from "../lib/email-palette.js";

const VIEW_STORAGE_KEY = "qqueue.templates-view";

type View = "gallery" | "list";

// Lightweight, non-interactive thumbnail of the rendered template.
function TemplateThumbnail({ template }: { template: Template }) {
  const data = resolveVariableData(
    template.variables,
    template.previewData ?? undefined
  );
  const body = applyVariables(template.html, data);
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8" /><style>
    body{margin:0;padding:16px;font-family:Inter,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:${EMAIL_NEUTRALS.text};font-size:13px;line-height:1.55;background:${EMAIL_NEUTRALS.paper}}
    img{max-width:100%;height:auto}a{color:${EMAIL_ACCENT}}h1{font-size:18px;margin:0 0 8px}h2{font-size:15px;margin:14px 0 6px}p{margin:0 0 10px}
    hr{border:none;border-top:1px solid ${EMAIL_NEUTRALS.border};margin:14px 0}
  </style></head><body>${body}</body></html>`;
  return (
    <div className="pointer-events-none h-40 overflow-hidden rounded-t-card border-b border-border bg-email-paper">
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
  onPick,
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
              className="rounded-card border border-border bg-surface p-4 text-left shadow-card transition-colors duration-fast ease-out hover:border-border-strong hover:bg-surface-sunken"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-body font-semibold text-text">{starter.name}</h3>
                <Badge variant="secondary">{starter.category}</Badge>
              </div>
              <p className="mt-1 text-ui text-text-secondary">
                {starter.description}
              </p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Templates.
 *
 * Two views, because there are two jobs. Choosing a design is visual, so the
 * gallery of thumbnails stays the default. Finding the one you edited last
 * Tuesday among ninety of them is a scanning job, and that's what the list view
 * is for. The choice is remembered per browser.
 */
export function Templates() {
  const navigate = useNavigate();
  const { currentOrganizationId: organizationId } = useSession();

  const [view, setView] = useState<View>(() => {
    try {
      return window.localStorage.getItem(VIEW_STORAGE_KEY) === "list"
        ? "list"
        : "gallery";
    } catch {
      return "gallery";
    }
  });
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);

  const templatesQuery = useOrgQuery(
    organizationId,
    qk.templates(organizationId ?? ""),
    (id) => api.listTemplates(id)
  );
  const templates = useMemo(
    () => templatesQuery.data ?? [],
    [templatesQuery.data]
  );

  const duplicate = useApiMutation(
    (template: Template) => api.cloneTemplate(template.id),
    {
      successMessage: "Template duplicated.",
      errorMessage: "Couldn't duplicate that template.",
      invalidates: [qk.templates(organizationId ?? "")],
    }
  );

  const remove = useApiMutation(
    (template: Template) => api.deleteTemplate(template.id),
    {
      successMessage: "Template deleted.",
      errorMessage: "Couldn't delete that template.",
      invalidates: [qk.templates(organizationId ?? "")],
      onSuccess: () => setDeleteTarget(null),
    }
  );

  function chooseView(next: View) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Private browsing blocks localStorage; the view just resets next visit.
    }
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const template of templates) {
      if (template.category) set.add(template.category);
    }
    return [...set].sort();
  }, [templates]);

  // The gallery filters here; the list view hands filtering to the DataGrid's
  // own search, so only the category chips apply to it.
  const galleryFiltered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return templates.filter((template) => {
      if (activeCategory && template.category !== activeCategory) return false;
      if (!term) return true;
      return [
        template.name,
        template.subject,
        template.description ?? "",
        template.category ?? "",
        ...(template.tags ?? []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [templates, search, activeCategory]);

  const listFiltered = useMemo(
    () =>
      activeCategory
        ? templates.filter((template) => template.category === activeCategory)
        : templates,
    [templates, activeCategory]
  );

  const columns = useMemo<ColumnDef<Template, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Name",
        meta: { title: "Name" },
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.name}</div>
            <div className="truncate text-meta text-text-tertiary">
              {row.original.description || row.original.subject}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "subject",
        header: "Subject line",
        meta: { title: "Subject line", hideBelowLg: true },
        cell: ({ getValue }) => (
          <span className="block max-w-cell-lg truncate text-text-secondary">
            {String(getValue())}
          </span>
        ),
      },
      {
        accessorKey: "category",
        header: "Category",
        meta: { title: "Category", hideBelowMd: true },
        cell: ({ getValue }) => {
          const value = getValue() as string | null;
          return value ? (
            <Badge variant="secondary">{value}</Badge>
          ) : (
            <span className="text-text-tertiary">—</span>
          );
        },
      },
      {
        accessorKey: "updatedAt",
        header: "Updated",
        meta: { title: "Updated", hideBelowMd: true },
        cell: ({ getValue }) => (
          <Hint label={formatFullDate(String(getValue()))}>
            <span className="cursor-help text-text-secondary" data-numeric>
              {formatMailDate(String(getValue()))}
            </span>
          </Hint>
        ),
      },
      {
        id: "actions",
        header: "",
        meta: { pinned: true, align: "right" },
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            rowLabel={row.original.name}
            actions={[
              {
                label: "Edit this template",
                icon: Pencil,
                primary: true,
                onSelect: () => navigate(`/templates/${row.original.id}/edit`),
              },
              {
                label: "Make a copy",
                icon: Copy,
                disabled: duplicate.isPending,
                onSelect: () => duplicate.mutate(row.original),
              },
              {
                label: "Delete template",
                icon: Trash2,
                destructive: true,
                onSelect: () => setDeleteTarget(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [navigate, duplicate]
  );

  const loading = templatesQuery.isPending;

  return (
    <>
      <PageHeader
        title="Templates"
        description="Reusable email designs with placeholders like {{firstName}}, a live preview, and starter layouts."
        actions={
          <Button
            onClick={() => setGalleryOpen(true)}
            disabled={!organizationId}
          >
            <Plus className="h-4 w-4" />
            New template
          </Button>
        }
      />

      <section className="max-w-table space-y-4 p-4 sm:p-6">
        {!loading && templates.length > 0 ? (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            {view === "gallery" ? (
              <div className="relative w-full xs:w-field-search">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search templates…"
                  aria-label="Search templates"
                  className="pl-control"
                />
              </div>
            ) : null}

            {categories.length > 0 ? (
              <div className="flex flex-wrap gap-field">
                <button
                  type="button"
                  aria-pressed={activeCategory === null}
                  onClick={() => setActiveCategory(null)}
                  className="inline-flex min-h-touch items-center rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                >
                  <Badge variant={activeCategory ? "outline" : "default"}>
                    All
                  </Badge>
                </button>
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={activeCategory === category}
                    onClick={() => setActiveCategory(category)}
                    className="inline-flex min-h-touch items-center rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
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

            <div className="flex items-center gap-1 rounded-control border border-border p-1 lg:ml-auto">
              <IconButton
                label="Show thumbnails"
                size="sm"
                variant={view === "gallery" ? "solid" : "ghost"}
                onClick={() => chooseView("gallery")}
              >
                <LayoutGrid />
              </IconButton>
              <IconButton
                label="Show as a list"
                size="sm"
                variant={view === "list" ? "solid" : "ghost"}
                onClick={() => chooseView("list")}
              >
                <ListIcon />
              </IconButton>
            </div>
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
          <EmptyState
            icon={FileText}
            title="No templates yet"
            description="Design one once, then send it as often as you like."
            action={
              <Button
                onClick={() => setGalleryOpen(true)}
                disabled={!organizationId}
                variant="secondary"
              >
                <Plus className="h-4 w-4" />
                New template
              </Button>
            }
          />
        ) : view === "list" ? (
          <DataGrid
            label="Templates"
            data={listFiltered}
            columns={columns}
            getRowId={(row) => row.id}
            onRowClick={(template) =>
              navigate(`/templates/${template.id}/edit`)
            }
            getRowLabel={(template) => `Edit ${template.name}`}
            searchPlaceholder="Search templates…"
            empty={
              <EmptyState
                icon={FileText}
                title="Nothing in this category"
                description="Pick a different category, or choose All."
              />
            }
            noResults={
              <EmptyState
                icon={Search}
                title="No matching templates"
                description="Try a different search."
              />
            }
            /*
              Duplicate and delete live behind hover on the desktop card, so on
              a phone they need a tap path of their own (§5) — the row itself
              only opens the editor.
            */
            renderMobileRow={(template) => (
              <div className="flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-body font-medium text-text">
                    {template.name}
                  </span>
                  <RowActions
                    className="-my-1 -mr-1"
                    rowLabel={template.name}
                    actions={[
                      {
                        label: "Make a copy",
                        icon: Copy,
                        disabled: duplicate.isPending,
                        onSelect: () => duplicate.mutate(template),
                      },
                      {
                        label: "Delete template",
                        icon: Trash2,
                        destructive: true,
                        onSelect: () => setDeleteTarget(template),
                      },
                    ]}
                  />
                </div>
                <p className="truncate text-ui text-text-secondary">
                  {template.description || template.subject}
                </p>
                <div className="flex items-center justify-between gap-2">
                  {template.category ? (
                    <Badge variant="secondary">{template.category}</Badge>
                  ) : (
                    <span />
                  )}
                  <span className="text-meta text-text-tertiary" data-numeric>
                    Updated {formatMailDate(template.updatedAt)}
                  </span>
                </div>
              </div>
            )}
          />
        ) : galleryFiltered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No matches"
            description="No templates match your search or filter."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {galleryFiltered.map((template) => (
              /*
                A grid row is as tall as its tallest card, so a card whose
                neighbour carries an extra tag row used to leave its "Updated ·
                actions" line stranded in the middle with dead space beneath.
                The column stretches and the meta row is pushed to the bottom
                (`mt-auto`), so that line sits on the same baseline across a row
                whatever each card holds above it.
              */
              <Card
                key={template.id}
                className="group flex flex-col overflow-hidden transition-colors duration-fast ease-out hover:border-border-strong"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/templates/${template.id}/edit`)}
                  className="block w-full text-left"
                  aria-label={`Edit ${template.name}`}
                >
                  <TemplateThumbnail template={template} />
                </button>
                <CardContent className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-body font-semibold text-text">
                        {template.name}
                      </h2>
                      <p className="mt-1 truncate text-ui text-text-secondary">
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
                        <Badge key={tag} variant="outline" className="font-normal">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-auto flex items-center justify-between pt-3">
                    <Hint label={formatFullDate(template.updatedAt)}>
                      <span className="cursor-help text-meta text-text-tertiary" data-numeric>
                        Updated {formatMailDate(template.updatedAt)}
                      </span>
                    </Hint>
                    <div className="flex gap-1">
                      <IconButton
                        label={`Edit ${template.name}`}
                        size="sm"
                        onClick={() =>
                          navigate(`/templates/${template.id}/edit`)
                        }
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label={`Make a copy of ${template.name}`}
                        size="sm"
                        disabled={duplicate.isPending}
                        onClick={() => duplicate.mutate(template)}
                      >
                        <Copy />
                      </IconButton>
                      <IconButton
                        label={`Delete ${template.name}`}
                        size="sm"
                        variant="destructive"
                        onClick={() => setDeleteTarget(template)}
                      >
                        <Trash2 />
                      </IconButton>
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
        onPick={(starterKey) => {
          setGalleryOpen(false);
          navigate(`/templates/new?starter=${encodeURIComponent(starterKey)}`);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this template?"
        description={`"${deleteTarget?.name}" will be removed permanently. Emails already sent with it are unaffected.`}
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </>
  );
}
