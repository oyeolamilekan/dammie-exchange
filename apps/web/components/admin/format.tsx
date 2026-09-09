import { Badge } from "@/components/ui/badge";
import type { AdminTransaction } from "@/lib/admin-api";

export const formatDateTime = (value: string): string => new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(value));

export const formatAmount = (value: string, currency: string): string => {
  const number = Number(value);
  if (!Number.isFinite(number)) return `${value} ${currency}`;
  return `${new Intl.NumberFormat("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  }).format(number)} ${currency}`;
};

export function StatusBadge({ status }: { status: AdminTransaction["status"] | string }) {
  const variant = status === "success"
    ? "success"
    : status === "failed"
      ? "destructive"
      : status === "processing"
        ? "warning"
        : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}

