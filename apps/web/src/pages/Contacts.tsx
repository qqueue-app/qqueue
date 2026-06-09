import { PageHeader } from "../components/PageHeader.js";

export function Contacts() {
  return (
    <>
      <PageHeader title="Contacts" description="Store contacts and list memberships." />
      <section className="p-6">
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          Contact table placeholder.
        </div>
      </section>
    </>
  );
}
