import { OverviewDashboard } from "@/components/admin/overview-dashboard";

export default function AdminOverviewPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">
      <header>
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-primary">Operations / live ledger</p>
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">Operational overview</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Monitor customer activity, trace balance movement, and manage the supported asset catalog.</p>
      </header>
      <OverviewDashboard />
    </main>
  );
}
