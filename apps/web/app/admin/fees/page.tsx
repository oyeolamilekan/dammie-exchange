import { FeesPage } from "@/components/admin/fees-page";

export default function AdminFeesPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">
      <header>
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-primary">Operations / revenue controls</p>
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">Platform fees</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Configure what customers pay on swaps and withdrawals. Each transaction keeps the exact rule that priced it.</p>
      </header>
      <FeesPage />
    </main>
  );
}
