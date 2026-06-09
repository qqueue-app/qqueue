import { FormEvent, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { api, type SMTPConnection, type Template } from "../lib/api.js";
import { getCurrentOrganizationId } from "../lib/session.js";

export function SendEmail() {
  const organizationId = getCurrentOrganizationId();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [smtpConnections, setSMTPConnections] = useState<SMTPConnection[]>([]);
  const [to, setTo] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [smtpConnectionId, setSMTPConnectionId] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [variables, setVariables] = useState('{\n  "firstName": "Riley"\n}');
  const [status, setStatus] = useState<string>();

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
        setStatus(error instanceof Error ? error.message : "Unable to load data")
      );
  }, [organizationId]);

  async function send(event: FormEvent) {
    event.preventDefault();

    if (!organizationId) {
      setStatus("Select an organization in Settings first.");
      return;
    }

    try {
      const parsedVariables = variables.trim()
        ? (JSON.parse(variables) as Record<string, unknown>)
        : undefined;
      const result = await api.sendEmail({
        organizationId,
        to,
        templateId: templateId || undefined,
        smtpConnectionId: smtpConnectionId || undefined,
        subject: subject || undefined,
        html: html || undefined,
        text: text || undefined,
        variables: parsedVariables
      });
      setStatus(`Email job ${result.emailJob.id} is ${result.emailJob.status}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to send email");
    }
  }

  return (
    <>
      <PageHeader
        title="Send Email"
        description="Send one email through a saved SMTP connection."
      />
      <section className="p-6">
        <form
          onSubmit={send}
          className="grid gap-6 rounded-lg border border-slate-200 bg-white p-5 lg:grid-cols-2"
        >
          <div>
            <h2 className="text-base font-semibold text-ink">Recipient and source</h2>
            <label className="mt-4 block">
              <span className="text-sm font-medium text-slate-700">To</span>
              <input
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="mt-4 block">
              <span className="text-sm font-medium text-slate-700">SMTP</span>
              <select
                value={smtpConnectionId}
                onChange={(event) => setSMTPConnectionId(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">Default SMTP connection</option>
                {smtpConnections.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-4 block">
              <span className="text-sm font-medium text-slate-700">Template</span>
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">No template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-4 block">
              <span className="text-sm font-medium text-slate-700">Variables JSON</span>
              <textarea
                value={variables}
                onChange={(event) => setVariables(event.target.value)}
                rows={6}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </label>
          </div>

          <div>
            <h2 className="text-base font-semibold text-ink">Direct content</h2>
            <label className="mt-4 block">
              <span className="text-sm font-medium text-slate-700">Subject</span>
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="mt-4 block">
              <span className="text-sm font-medium text-slate-700">HTML</span>
              <textarea
                value={html}
                onChange={(event) => setHtml(event.target.value)}
                rows={7}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </label>
            <label className="mt-4 block">
              <span className="text-sm font-medium text-slate-700">Text</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={5}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <button className="mt-4 rounded-md bg-moss px-4 py-2 text-sm font-medium text-white">
              Send email
            </button>
            {status ? <p className="mt-3 text-sm text-slate-600">{status}</p> : null}
          </div>
        </form>
      </section>
    </>
  );
}
