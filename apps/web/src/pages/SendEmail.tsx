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

export function SendEmail() {
  const { currentOrganizationId: organizationId } = useSession();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [smtpConnections, setSMTPConnections] = useState<SMTPConnection[]>([]);
  const [to, setTo] = useState("");
  const [templateId, setTemplateId] = useState(NO_TEMPLATE);
  const [smtpConnectionId, setSMTPConnectionId] = useState(DEFAULT_SMTP);
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [variables, setVariables] = useState('{\n  "firstName": "Riley"\n}');
  const [sending, setSending] = useState(false);

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
      return;
    }
    const template = templates.find((item) => item.id === value);
    if (template) {
      setSubject(template.subject);
      setHtml(template.html);
      setText(template.text ?? "");
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();

    if (!organizationId) {
      toast.error("Select an organization in Settings first.");
      return;
    }

    let parsedVariables: Record<string, unknown> | undefined;
    try {
      parsedVariables = variables.trim()
        ? (JSON.parse(variables) as Record<string, unknown>)
        : undefined;
    } catch {
      toast.error("Variables must be valid JSON.");
      return;
    }

    setSending(true);
    try {
      const result = await api.sendEmail({
        organizationId,
        to,
        templateId: templateId === NO_TEMPLATE ? undefined : templateId,
        smtpConnectionId:
          smtpConnectionId === DEFAULT_SMTP ? undefined : smtpConnectionId,
        subject: subject || undefined,
        html: html || undefined,
        text: text || undefined,
        variables: parsedVariables
      });
      toast.success(
        `Email queued — job ${result.emailJob.id} is ${result.emailJob.status}.`
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
                <div className="space-y-2">
                  <Label>Template</Label>
                  <Select value={templateId} onValueChange={selectTemplate}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TEMPLATE}>No template</SelectItem>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Selecting a template fills the subject and body below, which
                    you can still edit.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="variables">Variables JSON</Label>
                  <Textarea
                    id="variables"
                    rows={6}
                    className="font-mono text-xs"
                    value={variables}
                    onChange={(event) => setVariables(event.target.value)}
                  />
                </div>
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
                    placeholder="Welcome, {{firstName}}"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Body</Label>
                  <RichTextEditor
                    value={html}
                    onChange={setHtml}
                    placeholder="Write your email…"
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
              {sending ? "Sending…" : "Send email"}
            </Button>
          </div>
        </form>
      </section>
    </>
  );
}
