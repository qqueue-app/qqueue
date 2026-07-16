import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Send, X } from "lucide-react";
import { toast } from "sonner";
import { RichTextEditor } from "../components/editor/RichTextEditor.js";
import { TemplatePreview } from "../components/editor/TemplatePreview.js";
import { VariablesPanel } from "../components/editor/VariablesPanel.js";
import { extractVariables } from "../components/editor/variables.js";
import { STARTER_TEMPLATES } from "../components/editor/starters.js";
import { api, type TemplateVariable } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Textarea } from "../components/ui/textarea.js";
import { Label } from "../components/ui/label.js";
import { Badge } from "../components/ui/badge.js";
import { Spinner } from "../components/ui/spinner.js";

interface EditorState {
  name: string;
  description: string;
  category: string;
  tags: string[];
  subject: string;
  html: string;
  text: string;
}

const emptyState: EditorState = {
  name: "",
  description: "",
  category: "",
  tags: [],
  subject: "",
  html: "<p></p>",
  text: ""
};

function htmlIsEmpty(html: string) {
  const stripped = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return stripped === "" && !/<(img|hr|br|a)/i.test(html);
}

function TagInput({
  tags,
  onChange
}: {
  tags: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add(value: string) {
    const clean = value.trim();
    if (clean && !tags.includes(clean)) {
      onChange([...tags, clean]);
    }
    setDraft("");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1">
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(tags.filter((item) => item !== tag))}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add(draft);
          } else if (event.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        placeholder={tags.length ? "" : "Add tags…"}
        className="min-w-[80px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export function TemplateEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentOrganizationId: organizationId } = useSession();

  const editing = Boolean(id);
  const [state, setState] = useState<EditorState>(emptyState);
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [previewData, setPreviewData] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Load an existing template, or seed a starter when creating.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (id) {
        setLoading(true);
        try {
          const template = await api.getTemplate(id);
          if (cancelled) return;
          setState({
            name: template.name,
            description: template.description ?? "",
            category: template.category ?? "",
            tags: template.tags ?? [],
            subject: template.subject,
            html: template.html,
            text: template.text ?? ""
          });
          setVariables(template.variables ?? []);
          setPreviewData(template.previewData ?? {});
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Unable to load template"
          );
          navigate("/templates");
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      const starter = STARTER_TEMPLATES.find(
        (item) => item.key === searchParams.get("starter")
      );
      if (starter) {
        setState({
          ...emptyState,
          name: starter.key === "blank" ? "" : starter.name,
          category: starter.category,
          subject: starter.subject,
          html: starter.html
        });
        setVariables(starter.variables);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, searchParams, navigate]);

  const used = useMemo(
    () => extractVariables(state.subject, state.html),
    [state.subject, state.html]
  );

  /**
   * Images embedded in a template are hosted publicly so recipients' mail
   * clients can load them. Errors propagate to the image dialog, which shows
   * them inline.
   */
  async function uploadInlineImage(file: File) {
    if (!organizationId) {
      throw new Error("Select an organization in Settings first");
    }
    const image = await api.uploadImage(file, { organizationId });
    return image.url;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }
    if (!state.name.trim()) {
      toast.error("Give the template a name.");
      return;
    }
    if (!state.subject.trim()) {
      toast.error("Add a subject line.");
      return;
    }
    if (htmlIsEmpty(state.html)) {
      toast.error("The email body cannot be empty.");
      return;
    }

    // Only persist variable defs that are still referenced or carry a default.
    const cleanedVariables = variables.filter(
      (variable) =>
        used.includes(variable.name) ||
        (variable.defaultValue ?? "") !== "" ||
        variable.required
    );

    const payload = {
      organizationId,
      name: state.name.trim(),
      description: state.description.trim() || undefined,
      category: state.category.trim() || undefined,
      tags: state.tags,
      subject: state.subject,
      html: state.html,
      text: state.text || undefined,
      variables: cleanedVariables,
      previewData
    };

    setSaving(true);
    try {
      if (id) {
        await api.updateTemplate(id, payload);
        toast.success("Template updated.");
      } else {
        await api.createTemplate(payload);
        toast.success("Template created.");
      }
      navigate("/templates");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save template"
      );
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!id || !organizationId) return;
    setTesting(true);
    try {
      await api.testSendTemplate(id, { organizationId, data: previewData });
      toast.success("Test email sent to your address.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to send test"
      );
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <form onSubmit={save} className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => navigate("/templates")}
            aria-label="Back to templates"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="truncate text-lg font-semibold">
            {editing ? state.name || "Edit template" : "New template"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <Button
              type="button"
              variant="outline"
              onClick={sendTest}
              disabled={testing}
              title="Send a test to your account email"
            >
              {testing ? <Spinner /> : <Send className="h-4 w-4" />}
              Send test
            </Button>
          ) : null}
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner /> : null}
            {editing ? "Save changes" : "Create template"}
          </Button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        {/* Left: authoring */}
        <div className="space-y-5 overflow-auto p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={state.name}
                onChange={(event) =>
                  setState({ ...state, name: event.target.value })
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                list="template-categories"
                placeholder="e.g. Onboarding"
                value={state.category}
                onChange={(event) =>
                  setState({ ...state, category: event.target.value })
                }
              />
              <datalist id="template-categories">
                <option value="Onboarding" />
                <option value="Newsletter" />
                <option value="Transactional" />
                <option value="Marketing" />
                <option value="Basic" />
              </datalist>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              placeholder="Shown on the template card"
              value={state.description}
              onChange={(event) =>
                setState({ ...state, description: event.target.value })
              }
            />
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <TagInput
              tags={state.tags}
              onChange={(tags) => setState({ ...state, tags })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              placeholder="Welcome, {{firstName}}"
              value={state.subject}
              onChange={(event) =>
                setState({ ...state, subject: event.target.value })
              }
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Email body</Label>
            <RichTextEditor
              value={state.html}
              onChange={(html) => setState((prev) => ({ ...prev, html }))}
              variables={used.length ? used : undefined}
              placeholder="Write your email…"
              onUploadImage={uploadInlineImage}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="text">Plain text fallback (optional)</Label>
            <Textarea
              id="text"
              rows={3}
              value={state.text}
              onChange={(event) =>
                setState({ ...state, text: event.target.value })
              }
            />
          </div>

          <div className="space-y-2 border-t pt-5">
            <Label>Variables</Label>
            <VariablesPanel
              variables={variables}
              onVariablesChange={setVariables}
              previewData={previewData}
              onPreviewDataChange={setPreviewData}
              used={used}
            />
          </div>
        </div>

        {/* Right: live preview */}
        <div className="hidden border-l bg-muted/20 lg:block">
          <TemplatePreview
            subject={state.subject}
            html={state.html}
            variables={variables}
            sampleData={previewData}
          />
        </div>
      </div>
    </form>
  );
}
