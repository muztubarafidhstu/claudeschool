export default function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'ACTIVE' ? 'bg-emerald-50 text-[#10B981]' : status === 'SUSPENDED' ? 'bg-red-50 text-[#EF4444]' : 'bg-amber-50 text-[#F59E0B]';
  return <span className={`badge ${cls}`}>{status}</span>;
}
