import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader.js";
import { RichTextEditor } from "../components/editor/RichTextEditor.js";
import { api, type SMTPConnection, type Template } from "../lib/api.js";
import { useSession } from "../lib/session-context.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Textarea } from "../components/ui/textarea.js";
import { Label } from "../components/ui/label.js";
import { Spinner } from "../components/ui/spinner.js";
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

export function SendEmail() {
  const { currentOrganizationId: organizationId } = useSession();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [smtpConnections, setSMTPConnections] = useState<SMTPConnection[]>([]);
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
  const [sending, setSending] = useState(false);

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

  useEffect(() => {
    if (!organizationId) {
      return;
    }

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
      );
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
        variables
      });
      toast.success(
        `Email queued - job ${result.emailJob.id} is ${result.emailJob.status}.`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to send email"
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Send Email"
        description="Send one email through a saved SMTP connection."
      />
      <section className="p-6">
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
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input accent-primary"
                      checked={useTemplate}
                      onChange={(event) =>
                        toggleTemplateMode(event.target.checked)
                      }
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
                {!useTemplate ? (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    Write a one-off subject and body, or enable template mode to
                    load a saved template.
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="h-fit">
              <CardHeader>
                <CardTitle>Message</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
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
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 flex justify-end">
            <Button type="submit" disabled={sending}>
              {sending ? <Spinner /> : null}
              {sending ? "Sending..." : "Send email"}
            </Button>
          </div>
        </form>
      </section>
    </>
  );
}
