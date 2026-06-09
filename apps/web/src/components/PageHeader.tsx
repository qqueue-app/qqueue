interface PageHeaderProps {
  title: string;
  description: string;
}

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <div className="border-b border-slate-200 bg-white px-6 py-5">
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
    </div>
  );
}
