"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, WalletCardsIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  adminRequest,
  type AdminOverview,
} from "@/lib/admin-api";
import { formatAmount } from "./format";
import { TransactionsTable } from "./transactions-table";

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" />
      </div>
      <Skeleton className="h-44" />
      <Skeleton className="h-80" />
    </div>
  );
}

export function OverviewDashboard() {
  const overview = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => adminRequest<AdminOverview>("/overview"),
  });

  if (overview.isPending) return <OverviewSkeleton />;
  if (overview.isError) return (
    <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>Overview unavailable</AlertTitle><AlertDescription>{overview.error.message}</AlertDescription></Alert>
  );

  const transactionTotal = Object.values(overview.data.transactions)
    .flatMap((group) => Object.values(group)).reduce((sum, value) => sum + (value ?? 0), 0);
  const pendingTotal = Object.values(overview.data.transactions)
    .reduce((sum, group) => sum + (group.pending ?? 0) + (group.processing ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader><CardDescription>Registered users</CardDescription><CardTitle className="font-mono text-3xl">{overview.data.users.total.toLocaleString()}</CardTitle></CardHeader>
          <CardContent className="flex gap-2"><Badge variant="success">{overview.data.users.active} active</Badge><Badge variant="secondary">{overview.data.users.inactive} inactive</Badge></CardContent>
        </Card>
        <Card>
          <CardHeader><CardDescription>Recorded transactions</CardDescription><CardTitle className="font-mono text-3xl">{transactionTotal.toLocaleString()}</CardTitle></CardHeader>
          <CardContent><span className="text-sm text-muted-foreground">Deposits, swaps, and withdrawals</span></CardContent>
        </Card>
        <Card>
          <CardHeader><CardDescription>In flight</CardDescription><CardTitle className="font-mono text-3xl">{pendingTotal.toLocaleString()}</CardTitle></CardHeader>
          <CardContent><Badge variant={pendingTotal > 0 ? "warning" : "success"}>{pendingTotal > 0 ? "Needs monitoring" : "Clear"}</Badge></CardContent>
        </Card>
      </div>

      {overview.data.reconciliation.count > 0 && (
        <Alert variant="warning">
          <AlertTriangleIcon />
          <AlertTitle>{overview.data.reconciliation.count} reconciliation {overview.data.reconciliation.count === 1 ? "warning" : "warnings"}</AlertTitle>
          <AlertDescription>These swaps are flagged for a separate operational review. This console does not alter them.</AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="currency-balances" className="flex flex-col gap-3">
        <div>
          <h2 id="currency-balances" className="text-lg font-semibold tracking-tight">Balances by currency</h2>
          <p className="text-sm text-muted-foreground">Each currency stays separate; no cross-currency total is inferred.</p>
        </div>
        {overview.data.balances.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {overview.data.balances.map((balance) => (
              <Card key={balance.currency}>
                <CardHeader>
                  <CardDescription>{balance.walletCount} {balance.walletCount === 1 ? "wallet" : "wallets"}</CardDescription>
                  <CardTitle className="font-mono text-xl">{formatAmount(balance.balance, balance.currency)}</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-xs text-muted-foreground">
                  <WalletCardsIcon className="size-4" />
                  {formatAmount(balance.lockedBalance, balance.currency)} locked
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Empty><EmptyHeader><EmptyMedia variant="icon"><WalletCardsIcon /></EmptyMedia><EmptyTitle>No wallet balances</EmptyTitle><EmptyDescription>Balances appear after wallets are provisioned.</EmptyDescription></EmptyHeader></Empty>
        )}
      </section>

      <Card>
        <CardHeader><CardTitle>Recent activity</CardTitle><CardDescription>The ten newest movements across all transaction types.</CardDescription></CardHeader>
        <CardContent><TransactionsTable transactions={overview.data.recentTransactions} /></CardContent>
      </Card>
    </div>
  );
}
