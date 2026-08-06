import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}

/**
 * Page header — 20px title over a 13px description.
 *
 * Deliberately not larger: a 32px headline reads as a landing page, and this is
 * a tool someone opens forty times a day.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-border px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-title font-semibold text-text">{title}</h1>
        <p className="mt-1 max-w-[45rem] text-ui leading-6 text-text-secondary">
          {description}
        </p>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
