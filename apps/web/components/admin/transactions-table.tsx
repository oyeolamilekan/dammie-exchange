import { ArrowRightIcon, ReceiptTextIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminTransaction } from "@/lib/admin-api";
import { formatAmount, formatDateTime, StatusBadge } from "./format";

const providerStages = (response: unknown): string[] => (
  response && typeof response === "object" && !Array.isArray(response)
    ? Object.keys(response)
    : []
);

export function TransactionsTable({ transactions }: { transactions: AdminTransaction[] }) {
  if (!transactions.length) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon"><ReceiptTextIcon /></EmptyMedia>
          <EmptyTitle>No transactions found</EmptyTitle>
          <EmptyDescription>Try a broader status, type, or date filter.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Movement</TableHead>
          <TableHead>Network</TableHead>
          <TableHead>Provider response</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead className="text-right">Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((transaction) => (
          <TableRow key={`${transaction.type}-${transaction.id}`}>
            <TableCell className="capitalize">{transaction.type}</TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-2 font-mono text-xs font-medium">
                <span className="flex flex-col gap-1">
                  <span>{formatAmount(transaction.sourceAmount, transaction.sourceCurrency)}</span>
                  {!transaction.destinationAmount && transaction.platformFeeAmount && transaction.platformFeeAmount !== "0" && (
                    <span className="font-normal text-warning">Fee {formatAmount(transaction.platformFeeAmount, transaction.sourceCurrency)}</span>
                  )}
                </span>
                {transaction.destinationAmount && transaction.destinationCurrency && (
                  <>
                    <ArrowRightIcon className="size-3.5 text-muted-foreground" />
                    <span className="flex flex-col gap-1">
                      <span>{transaction.grossAmount ? formatAmount(transaction.grossAmount, transaction.destinationCurrency) : formatAmount(transaction.destinationAmount, transaction.destinationCurrency)} gross</span>
                      {transaction.grossAmount && transaction.grossAmount !== transaction.destinationAmount && (
                        <span className="font-normal text-muted-foreground">{formatAmount(transaction.destinationAmount, transaction.destinationCurrency)} net</span>
                      )}
                      {transaction.platformFeeAmount && transaction.platformFeeAmount !== "0" && (
                        <span className="font-normal text-warning">Fee {formatAmount(transaction.platformFeeAmount, transaction.destinationCurrency)}</span>
                      )}
                    </span>
                  </>
                )}
              </span>
            </TableCell>
            <TableCell className="font-mono text-xs uppercase text-muted-foreground">
              {transaction.network ?? "—"}
            </TableCell>
            <TableCell>
              {transaction.providerResponse ? (
                <details className="max-w-72">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-xs font-medium text-primary underline-offset-4 hover:underline">
                    <Badge variant="success">Captured</Badge>
                    <span>{providerStages(transaction.providerResponse).length || "Provider"} {providerStages(transaction.providerResponse).length === 1 ? "stage" : "stages"}</span>
                  </summary>
                  {providerStages(transaction.providerResponse).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {providerStages(transaction.providerResponse).map((stage) => <Badge key={stage} variant="outline">{stage}</Badge>)}
                    </div>
                  )}
                  <pre className="mt-2 max-h-64 overflow-auto rounded-md border bg-muted/30 p-2 text-[11px] leading-5">
                    {JSON.stringify(transaction.providerResponse, null, 2)}
                  </pre>
                </details>
              ) : <span className="text-xs text-muted-foreground">Not captured</span>}
            </TableCell>
            <TableCell><StatusBadge status={transaction.status} /></TableCell>
            <TableCell className="max-w-48 truncate font-mono text-xs" title={transaction.reference}>
              {transaction.reference}
            </TableCell>
            <TableCell className="whitespace-nowrap text-right font-mono text-xs text-muted-foreground">
              {formatDateTime(transaction.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
