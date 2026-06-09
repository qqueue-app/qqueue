import { FormEvent, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { api, type Contact } from "../lib/api.js";
import { getCurrentOrganizationId } from "../lib/session.js";

export function Contacts() {
  const organizationId = getCurrentOrganizationId();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [status, setStatus] = useState<string>();

  async function load() {
    if (!organizationId) {
      return;
    }
    setContacts(await api.listContacts(organizationId));
  }

  useEffect(() => {
    load().catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : "Unable to load contacts")
    );
  }, [organizationId]);

  async function createContact(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) {
      return;
    }
    await api.createContact({ organizationId, email, firstName, lastName });
    setEmail("");
    setFirstName("");
    setLastName("");
    await load();
  }

  async function deleteContact(id: string) {
    await api.deleteContact(id);
    await load();
  }

  return (
    <>
      <PageHeader title="Contacts" description="Store contacts and list memberships." />
      <section className="grid gap-6 p-6 lg:grid-cols-[360px_1fr]">
        <form
          onSubmit={createContact}
          className="rounded-lg border border-slate-200 bg-white p-5"
        >
          <h2 className="text-base font-semibold text-ink">Add contact</h2>
          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">First name</span>
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="mt-4 block">
            <span className="text-sm font-medium text-slate-700">Last name</span>
            <input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <button className="mt-4 rounded-md bg-moss px-4 py-2 text-sm font-medium text-white">
            Save contact
          </button>
          {status ? <p className="mt-3 text-sm text-coral">{status}</p> : null}
        </form>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id} className="border-b border-slate-100">
                  <td className="px-4 py-3">{contact.email}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {[contact.firstName, contact.lastName].filter(Boolean).join(" ")}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{contact.status}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => deleteContact(contact.id)}
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
