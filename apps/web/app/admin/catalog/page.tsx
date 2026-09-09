import { CatalogPage } from "@/components/admin/catalog-page";

export default function AdminCatalogPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">
      <header>
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-primary">Operations / catalog</p>
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">Currency &amp; network catalog</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Inspect catalog identities, enabled status, and the network relationships used for wallet operations.</p>
      </header>
      <CatalogPage />
    </main>
  );
}
