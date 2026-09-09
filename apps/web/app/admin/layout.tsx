import type { ReactNode } from "react";
import { AdminSessionBoundary } from "@/components/admin/admin-shell";
import { AdminThemeProvider } from "@/components/admin/admin-theme";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminThemeProvider><AdminSessionBoundary>{children}</AdminSessionBoundary></AdminThemeProvider>;
}
