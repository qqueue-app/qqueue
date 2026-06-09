import { FormEvent, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { api, type Organization } from "../lib/api.js";
import { clearSession, getSession, saveSession } from "../lib/session.js";

export function Settings() {
  const [session, setSession] = useState(getSession);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string>();

  async function load() {
    const data = await api.listOrganizations();
    setOrganizations(data);
  }

  useEffect(() => {
    load().catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : "Unable to load settings")
    );
  }, []);

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    const organization = await api.createOrganization({ name });
    const nextSession = {
      ...session,
      currentOrganizationId: organization.id,
      organizations: [
        ...session.organizations,
        { id: organization.id, name: organization.name }
      ]
    };
    saveSession(nextSession);
    setSession(nextSession);
    setName("");
    await load();
  }

  function selectOrganization(organizationId: string) {
    const nextSession = { ...session, currentOrganizationId: organizationId };
    saveSession(nextSession);
    setSession(nextSession);
  }

  function signOut() {
    clearSession();
    window.location.href = "/login";
  }

  return (
    <>
      <PageHeader title="Settings" description="Organization and developer settings." />
      <section className="grid gap-6 p-6 lg:grid-cols-2">
        <form
          onSubmit={createOrganization}
          className="rounded-lg border border-slate-200 bg-white p-5"
        >
          <h2 className="text-base font-semibold text-ink">Current organization</h2>
          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">Organization</span>
            <select
              value={session.currentOrganizationId ?? ""}
              onChange={(event) => selectOrganization(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">Select organization</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">
              New organization
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <button className="mt-4 rounded-md bg-moss px-4 py-2 text-sm font-medium text-white">
            Create organization
          </button>
          {status ? <p className="mt-3 text-sm text-coral">{status}</p> : null}
        </form>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-ink">Account</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="font-medium text-slate-700">Email</dt>
              <dd className="mt-1 text-slate-600">{session.user?.email ?? "Not signed in"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">API base URL</dt>
              <dd className="mt-1 text-slate-600">http://localhost:4000</dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={signOut}
            className="mt-5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            Sign out
          </button>
        </section>
      </section>
    </>
  );
}
