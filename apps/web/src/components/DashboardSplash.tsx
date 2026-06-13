import { BrandWordmark } from "./BrandWordmark.js";

const queueItems = ["Accepted", "Queued", "Sending", "Delivered"];

export function DashboardSplash() {
  return (
    <div
      aria-label="Loading QQueue dashboard"
      className="fixed inset-0 z-[100] flex min-h-screen items-center justify-center overflow-hidden bg-background text-foreground"
      role="status"
    >
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/10 dashboard-splash-pulse" />
      <div className="relative flex w-full max-w-sm flex-col items-center px-8">
        <div className="dashboard-splash-mark">
          <BrandWordmark className="h-10" />
        </div>

        <div className="mt-10 flex w-full items-center justify-between gap-2">
          {queueItems.map((item, index) => (
            <div className="flex min-w-0 flex-1 flex-col items-center" key={item}>
              <div
                className="dashboard-splash-node flex h-9 w-9 items-center justify-center rounded-full border border-primary/25 bg-card shadow-sm"
                style={{ animationDelay: `${index * 160}ms` }}
              >
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              </div>
              <span className="mt-2 max-w-full truncate text-[0.65rem] font-medium text-muted-foreground">
                {item}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-8 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 rounded-full bg-primary dashboard-splash-progress" />
        </div>
      </div>
    </div>
  );
}
