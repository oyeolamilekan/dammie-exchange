import { UsersPage } from "@/components/admin/users-page";

export default function AdminUsersPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-4 md:p-6 lg:p-8">
      <header>
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-primary">Operations / customer access</p>
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">Users</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Search customers, inspect account status, and open a user’s full operational history.</p>
      </header>
      <UsersPage />
    </main>
  );
}
