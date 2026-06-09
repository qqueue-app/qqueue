import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { api } from "../lib/api.js";
import { getCurrentOrganizationId } from "../lib/session.js";

export function Dashboard() {
  const organizationId = getCurrentOrganizationId();
  const [counts, setCounts] = useState({
    smtpConnections: 0,
    contacts: 0,
    templates: 0
  });

  useEffect(() => {
    if (!organizationId) {
      return;
    }

    Promise.all([
      api.listSMTPConnections(organizationId),
      api.listContacts(organizationId),
      api.listTemplates(organizationId)
    ]).then(([smtpConnections, contacts, templates]) =>
      setCounts({
        smtpConnections: smtpConnections.length,
        contacts: contacts.length,
        templates: templates.length
      })
    );
  }, [organizationId]);

  const cards = [
    { label: "SMTP connections", value: counts.smtpConnections },
    { label: "Contacts", value: counts.contacts },
    { label: "Templates", value: counts.templates }
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of sending activity, queues, and platform health."
      />
      <section className="grid gap-4 p-6 md:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <div className="text-sm text-slate-500">{card.label}</div>
            <div className="mt-3 text-3xl font-semibold text-ink">{card.value}</div>
          </div>
        ))}
      </section>
    </>
  );
}
