import { UserDetail } from "@/components/admin/user-detail";

export default async function AdminUserPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return (
    <main className="flex flex-1 flex-col p-4 md:p-6 lg:p-8">
      <UserDetail userId={userId} />
    </main>
  );
}

