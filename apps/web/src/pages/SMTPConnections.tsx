import { PageHeader } from "../components/PageHeader.js";

export function SMTPConnections() {
  return (
    <>
      <PageHeader
        title="SMTP Connections"
        description="Manage SMTP credentials for Mailcow-compatible and generic SMTP sending."
      />
      <section className="p-6">
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          SMTP connection setup placeholder.
        </div>
      </section>
    </>
  );
}
