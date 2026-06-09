import { FormEvent, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { api, type Template } from "../lib/api.js";
import { getCurrentOrganizationId } from "../lib/session.js";

export function Templates() {
  const organizationId = getCurrentOrganizationId();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string>();

  async function load() {
    if (!organizationId) {
      return;
    }
    setTemplates(await api.listTemplates(organizationId));
  }

  useEffect(() => {
    load().catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : "Unable to load templates")
    );
  }, [organizationId]);

  async function createTemplate(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      return;
    }
    await api.createTemplate({ organizationId, name, subject, html, text });
    setName("");
    setSubject("");
    setHtml("");
    setText("");
    await load();
  }

  async function deleteTemplate(id: string) {
    await api.deleteTemplate(id);
    await load();
  }

  return (
    <>
      <PageHeader title="Templates" description="Create reusable email templates." />
      <section className="grid gap-6 p-6 lg:grid-cols-[420px_1fr]">
        <form
          onSubmit={createTemplate}
          className="rounded-lg border border-slate-200 bg-white p-5"
        >
          <h2 className="text-base font-semibold text-ink">New template</h2>
          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
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
              rows={4}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <button className="mt-4 rounded-md bg-moss px-4 py-2 text-sm font-medium text-white">
            Save template
          </button>
          {status ? <p className="mt-3 text-sm text-coral">{status}</p> : null}
        </form>

        <div className="space-y-3">
          {templates.map((template) => (
            <article
              key={template.id}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-ink">{template.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">{template.subject}</p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteTemplate(template.id)}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
                >
                  Delete
                </button>
              </div>
              <pre className="mt-4 max-h-48 overflow-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">
                {template.html}
              </pre>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
