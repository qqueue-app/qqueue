import { FormEvent, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { api, type SMTPConnection } from "../lib/api.js";
import { getCurrentOrganizationId } from "../lib/session.js";

export function SMTPConnections() {
  const organizationId = getCurrentOrganizationId();
  const [connections, setConnections] = useState<SMTPConnection[]>([]);
  const [form, setForm] = useState({
    name: "Default SMTP",
    host: "",
    port: "587",
    secure: false,
    username: "",
    password: "",
    fromEmail: "",
    fromName: "",
    isDefault: true
  });
  const [status, setStatus] = useState<string>();

  async function load() {
    if (!organizationId) {
      return;
    }
    setConnections(await api.listSMTPConnections(organizationId));
  }

  useEffect(() => {
    load().catch((error: unknown) =>
      setStatus(
        error instanceof Error ? error.message : "Unable to load SMTP connections"
      )
    );
  }, [organizationId]);

  async function createConnection(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      return;
    }
    try {
      await api.createSMTPConnection({
        ...form,
        organizationId,
        port: Number(form.port)
      });
      setStatus("SMTP connection saved.");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save SMTP.");
    }
  }

  async function testConnection(id: string) {
    setStatus("Testing SMTP connection...");
    try {
      await api.testSMTPConnection(id);
      setStatus("SMTP connection verified.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "SMTP test failed.");
    }
  }

  async function deleteConnection(id: string) {
    await api.deleteSMTPConnection(id);
    await load();
  }

  return (
    <>
      <PageHeader
        title="SMTP Connections"
        description="Manage SMTP credentials for Mailcow-compatible and generic SMTP sending."
      />
      <section className="grid gap-6 p-6 lg:grid-cols-[420px_1fr]">
        <form
          onSubmit={createConnection}
          className="rounded-lg border border-slate-200 bg-white p-5"
        >
          <h2 className="text-base font-semibold text-ink">Add SMTP connection</h2>
          {(["name", "host", "username", "password", "fromEmail", "fromName"] as const).map(
            (field) => (
              <label key={field} className="mt-4 block">
                <span className="text-sm font-medium text-slate-700">{field}</span>
                <input
                  type={field === "password" ? "password" : "text"}
                  value={String(form[field])}
                  onChange={(event) =>
                    setForm({ ...form, [field]: event.target.value })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
            )
          )}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">port</span>
              <input
                value={form.port}
                onChange={(event) => setForm({ ...form, port: event.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={form.secure}
                onChange={(event) =>
                  setForm({ ...form, secure: event.target.checked })
                }
              />
              Secure TLS
            </label>
          </div>
          <label className="mt-3 flex gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(event) =>
                setForm({ ...form, isDefault: event.target.checked })
              }
            />
            Use as default sender
          </label>
          <button className="mt-4 rounded-md bg-moss px-4 py-2 text-sm font-medium text-white">
            Save SMTP
          </button>
          {status ? <p className="mt-3 text-sm text-slate-600">{status}</p> : null}
        </form>

        <div className="space-y-3">
          {connections.map((connection) => (
            <article
              key={connection.id}
              className="rounded-lg border border-slate-200 bg-white p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-ink">{connection.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {connection.host}:{connection.port} from {connection.fromEmail}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {connection.secure ? "TLS" : "STARTTLS/plain"}{" "}
                    {connection.isDefault ? "Default" : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => testConnection(connection.id)}
                    className="rounded-md bg-moss px-3 py-1 text-xs font-medium text-white"
                  >
                    Test
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteConnection(connection.id)}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
