import { PageHeader } from "../components/PageHeader.js";

export function Dashboard() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Overview of sending activity, queues, and platform health."
      />
      <section className="grid gap-4 p-6 md:grid-cols-3">
        {["Queued emails", "Campaign drafts", "SMTP connections"].map((label) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-3 text-3xl font-semibold text-ink">0</div>
          </div>
        ))}
      </section>
    </>
  );
}
