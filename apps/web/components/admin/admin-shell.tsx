"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ActivityIcon, LayoutDashboardIcon, LogOutIcon, PercentIcon, UsersIcon, WalletCardsIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { adminRequest, AdminApiError, type AdminIdentity } from "@/lib/admin-api";
import { AdminThemeToggle } from "./admin-theme";

function AdminMark() {
  return (
    <div className="grid size-8 grid-cols-2 gap-0.5 rounded-md bg-primary p-1.5 text-primary-foreground" aria-hidden="true">
      <span className="rounded-[1px] bg-current opacity-100" />
      <span className="rounded-[1px] bg-current opacity-45" />
      <span className="rounded-[1px] bg-current opacity-45" />
      <span className="rounded-[1px] bg-current opacity-100" />
    </div>
  );
}

function AdminNavigation({ admin }: { admin: AdminIdentity }) {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useMutation({
    mutationFn: () => adminRequest<void>("/auth/logout", { method: "POST" }),
    onSettled: () => router.replace("/admin/login"),
  });

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Dammie operations">
              <Link href="/admin">
                <AdminMark />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">Dammie Ops</span>
                  <span className="truncate text-xs text-sidebar-foreground/60">Control ledger</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/admin"} tooltip="Overview">
                  <Link href="/admin">
                    <LayoutDashboardIcon />
                    <span>Overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/admin/users" || pathname.startsWith("/admin/users/")} tooltip="Users">
                  <Link href="/admin/users">
                    <UsersIcon />
                    <span>Users</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/admin/catalog"} tooltip="Catalog">
                  <Link href="/admin/catalog">
                    <WalletCardsIcon />
                    <span>Catalog</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/admin/fees"} tooltip="Platform fees">
                  <Link href="/admin/fees">
                    <PercentIcon />
                    <span>Platform fees</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip={admin.email}>
              <div className="flex size-8 items-center justify-center rounded-md bg-secondary font-mono text-xs font-semibold">
                {admin.email.slice(0, 2).toUpperCase()}
              </div>
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate text-sm font-medium">Administrator</span>
                <span className="truncate text-xs text-sidebar-foreground/60">{admin.email}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              tooltip="Log out"
            >
              <LogOutIcon />
              <span>{logout.isPending ? "Logging out…" : "Log out"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function LoadingShell() {
  return (
    <div className="admin-theme flex min-h-svh bg-background p-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        <Skeleton className="h-10 w-56" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}

export function AdminSessionBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/admin/login";
  const session = useQuery({
    queryKey: ["admin-session"],
    queryFn: () => adminRequest<{ admin: AdminIdentity }>(
      "/auth/me",
      {},
      { redirectOnUnauthorized: false },
    ),
    retry: false,
    enabled: !isLogin,
  });

  useEffect(() => {
    if (!isLogin && session.error instanceof AdminApiError && session.error.status === 401) {
      router.replace("/admin/login");
    }
  }, [isLogin, router, session.error]);

  if (isLogin) return <>{children}</>;
  if (session.isPending) return <LoadingShell />;
  if (session.isError) {
    if (session.error instanceof AdminApiError && session.error.status === 401) return <LoadingShell />;
    return (
      <main className="admin-theme flex min-h-svh items-center justify-center bg-background p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>Could not verify the admin session</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{session.error.message}</span>
            <Button variant="outline" size="sm" onClick={() => session.refetch()}>Try again</Button>
          </AlertDescription>
        </Alert>
      </main>
    );
  }
  if (!session.data) return <LoadingShell />;

  return (
    <div className="admin-theme min-h-svh bg-background">
      <SidebarProvider>
        <AdminNavigation admin={session.data.admin} />
        <SidebarInset>
          <header className="sticky top-0 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
            <SidebarTrigger />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ActivityIcon className="size-3.5 text-success" />
              <span>Operations console</span>
            </div>
            <div className="ml-auto"><AdminThemeToggle /></div>
          </header>
          {children}
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
}
