import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Pencil, Server } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { RichTextEditor } from "../components/editor/RichTextEditor.js";
import { api, type SMTPConnection, type Template } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { cn } from "../lib/utils.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Textarea } from "../components/ui/textarea.js";
import { Label } from "../components/ui/label.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Spinner } from "../components/ui/spinner.js";
import {
  Alert,
  AlertDescription,
  AlertTitle
} from "../components/ui/alert.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "../components/ui/card.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select.js";

const DEFAULT_SMTP = "__default__";
const NO_TEMPLATE = "__none__";

function extractVariables(...values: Array<string | null | undefined>) {
  const names = new Set<string>();
  const pattern = /\{\{\s*([\w.-]+)\s*\}\}/g;

  for (const value of values) {
    if (!value) continue;
    for (const match of value.matchAll(pattern)) {
      names.add(match[1]);
    }
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/** Substitute {{variable}} tokens with their values for the preview. */
function applyVariables(content: string, values: Record<string, string>) {
  return content.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, name: string) =>
    values[name] ? values[name] : `{{${name}}}`
  );
}

export function SendEmail() {
  const { currentOrganizationId: organizationId } = useSession();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [smtpConnections, setSMTPConnections] = useState<SMTPConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState("");
  const [useTemplate, setUseTemplate] = useState(false);
  const [templateId, setTemplateId] = useState(NO_TEMPLATE);
  const [smtpConnectionId, setSMTPConnectionId] = useState(DEFAULT_SMTP);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {}
  );
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [scheduleForLater, setScheduleForLater] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");

  const selectedTemplate =
    templateId === NO_TEMPLATE
      ? null
      : templates.find((item) => item.id === templateId) ?? null;
  const templateVariableNames = selectedTemplate
    ? extractVariables(
        selectedTemplate.subject,
        selectedTemplate.html,
        selectedTemplate.text
      )
    : [];

  const noSmtp = !loading && smtpConnections.length === 0;

  useEffect(() => {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all([
      api.listTemplates(organizationId),
      api.listSMTPConnections(organizationId)
    ])
      .then(([templateData, smtpData]) => {
        setTemplates(templateData);
        setSMTPConnections(smtpData);
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Unable to load data")
      )
      .finally(() => setLoading(false));
  }, [organizationId]);

  function selectTemplate(value: string) {
    setTemplateId(value);
    if (value === NO_TEMPLATE) {
      setVariableValues({});
      return;
    }

    const template = templates.find((item) => item.id === value);
    if (!template) {
      return;
    }

    setSubject(template.subject);
    setHtml(template.html);
    setText(template.text ?? "");

    const names = extractVariables(template.subject, template.html, template.text);
    setVariableValues((current) =>
      Object.fromEntries(names.map((name) => [name, current[name] ?? ""]))
    );
  }

  function toggleTemplateMode(enabled: boolean) {
    setUseTemplate(enabled);
    if (!enabled) {
      setTemplateId(NO_TEMPLATE);
      setVariableValues({});
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();

    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }

    const variables =
      useTemplate && templateVariableNames.length > 0
        ? Object.fromEntries(
            templateVariableNames.map((name) => [
              name,
              variableValues[name] ?? ""
            ])
          )
        : undefined;

    let scheduledAtIso: string | undefined;
    if (scheduleForLater) {
      if (!scheduledAt) {
        toast.error("Pick a date and time to schedule the email.");
        return;
      }
      const when = new Date(scheduledAt);
      if (when.getTime() <= Date.now()) {
        toast.error("Scheduled time must be in the future.");
        return;
      }
      scheduledAtIso = when.toISOString();
    }

    setSending(true);
    try {
      const result = await api.sendEmail({
        organizationId,
        to,
        templateId:
          useTemplate && templateId !== NO_TEMPLATE ? templateId : undefined,
        smtpConnectionId:
          smtpConnectionId === DEFAULT_SMTP ? undefined : smtpConnectionId,
        subject: subject || undefined,
        html: html || undefined,
        text: text || undefined,
        variables,
        scheduledAt: scheduledAtIso
      });
      toast.success(
        scheduledAtIso
          ? `Email scheduled for ${new Date(scheduledAtIso).toLocaleString()}.`
          : `Email queued - job ${result.id} is ${result.status}.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to send email"
      );
    } finally {
      setSending(false);
    }
  }

  const previewSubject = applyVariables(subject, variableValues);
  const previewHtml = applyVariables(html, variableValues);

  return (
    <>
      <PageHeader
        title="Send Email"
        description="Send one email through a saved SMTP connection."
      />
      <section className="space-y-6 p-6">
        {noSmtp ? (
          <Alert variant="warning">
            <Server />
            <AlertTitle>No SMTP connection yet</AlertTitle>
            <AlertDescription>
              You need at least one SMTP connection before you can send.{" "}
              <Link
                to="/smtp-connections"
                className="font-medium underline underline-offset-4"
              >
                Add a connection
              </Link>{" "}
              to get started.
            </AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={send}>
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Recipient and source</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="to">To</Label>
                  <Input
                    id="to"
                    type="email"
                    placeholder="recipient@example.com"
                    value={to}
                    onChange={(event) => setTo(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>SMTP connection</Label>
                  <Select
                    value={smtpConnectionId}
                    onValueChange={setSMTPConnectionId}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_SMTP}>
                        Default SMTP connection
                      </SelectItem>
                      {smtpConnections.map((connection) => (
                        <SelectItem key={connection.id} value={connection.id}>
                          {connection.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-3 rounded-md border p-3">
                  <label
                    htmlFor="schedule-later"
                    className="flex items-center gap-2.5 text-sm font-medium"
                  >
                    <Checkbox
                      id="schedule-later"
                      checked={scheduleForLater}
                      onCheckedChange={(value) =>
                        setScheduleForLater(value === true)
                      }
                    />
                    Schedule for later
                  </label>

                  {scheduleForLater ? (
                    <div className="space-y-2">
                      <Label htmlFor="scheduledAt">Send at</Label>
                      <Input
                        id="scheduledAt"
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(event) => setScheduledAt(event.target.value)}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3 rounded-md border p-3">
                  <label
                    htmlFor="use-template"
                    className="flex items-center gap-2.5 text-sm font-medium"
                  >
                    <Checkbox
                      id="use-template"
                      checked={useTemplate}
                      onCheckedChange={toggleTemplateMode}
                    />
                    Use a saved template
                  </label>

                  {useTemplate ? (
                    <div className="space-y-2">
                      <Label>Template</Label>
                      <Select value={templateId} onValueChange={selectTemplate}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_TEMPLATE}>
                            Select a template
                          </SelectItem>
                          {templates.map((template) => (
                            <SelectItem key={template.id} value={template.id}>
                              {template.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        The selected template fills the subject and body.
                      </p>
                    </div>
                  ) : null}
                </div>

                {useTemplate && selectedTemplate ? (
                  <div className="space-y-3">
                    <div>
                      <Label>Template variables</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Fill in the values this template needs before sending.
                      </p>
                    </div>
                    {templateVariableNames.length > 0 ? (
                      <div className="space-y-3">
                        {templateVariableNames.map((name) => (
                          <div key={name} className="space-y-2">
                            <Label htmlFor={`variable-${name}`}>{name}</Label>
                            <Input
                              id={`variable-${name}`}
                              value={variableValues[name] ?? ""}
                              onChange={(event) =>
                                setVariableValues({
                                  ...variableValues,
                                  [name]: event.target.value
                                })
                              }
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                        This template does not define any variables.
                      </div>
                    )}
                  </div>
                ) : null}
                {useTemplate && !selectedTemplate ? (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    Select a template to see its variables.
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle>Message</CardTitle>
                <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => setShowPreview(false)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      !showPreview
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Compose
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPreview(true)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      showPreview
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {showPreview ? (
                  <div className="space-y-3">
                    <div className="rounded-md border bg-muted/30 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Subject
                      </div>
                      <div className="mt-1 font-medium">
                        {previewSubject || (
                          <span className="text-muted-foreground">
                            No subject
                          </span>
                        )}
                      </div>
                    </div>
                    {previewHtml.trim() ? (
                      <div
                        className="prose prose-sm min-h-[200px] max-w-none rounded-md border p-4 dark:prose-invert"
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                      />
                    ) : (
                      <div className="flex min-h-[200px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                        Nothing to preview yet.
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="subject">Subject</Label>
                      <Input
                        id="subject"
                        placeholder={
                          useTemplate
                            ? "Template subject appears here"
                            : "Welcome to QQueue"
                        }
                        value={subject}
                        onChange={(event) => setSubject(event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Body</Label>
                      <RichTextEditor
                        value={html}
                        onChange={setHtml}
                        placeholder="Write your email..."
                        showVariables={useTemplate}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="text">Plain text fallback (optional)</Label>
                      <Textarea
                        id="text"
                        rows={4}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 flex justify-end">
            <Button type="submit" disabled={sending || noSmtp}>
              {sending ? <Spinner /> : null}
              {sending
                ? scheduleForLater
                  ? "Scheduling..."
                  : "Sending..."
                : scheduleForLater
                  ? "Schedule email"
                  : "Send email"}
            </Button>
          </div>
        </form>
      </section>
    </>
  );
}
