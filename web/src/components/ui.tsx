export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {sub && <p className="text-sm text-stone-500">{sub}</p>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-stone-200 bg-white p-4 ${className}`}>{children}</div>;
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold">{value}</div>
    </Card>
  );
}

const stageStyle: Record<string, string> = {
  new: "bg-stone-100 text-stone-700",
  engaged: "bg-sky-100 text-sky-800",
  qualified: "bg-amber-100 text-amber-800",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-rose-100 text-rose-800",
};

export function StageBadge({ stage }: { stage: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stageStyle[stage] ?? stageStyle.new}`}>
      {stage}
    </span>
  );
}

export function timeAgo(d: Date) {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
