"use client"

import { useMutation, useQuery } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSavedBankAccounts, removeSavedBankAccount } from "@/endpoints/api";
import { useBankCatalog } from "@/hooks/use-bank-catalog";
import { useTelegramWebApp } from "@/hooks/use-telegram";
import { cn, getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";

type ManageBankAccountsProps = React.ComponentProps<"div">;

export function ManageBankAccounts({ className, ...props }: ManageBankAccountsProps) {
  const { closeMiniApp } = useTelegramWebApp();
  const bankCatalog = useBankCatalog();
  const accounts = useQuery({
    queryKey: ["saved-bank-accounts"],
    queryFn: getSavedBankAccounts,
    retry: false,
  });
  const removal = useMutation({
    mutationFn: removeSavedBankAccount,
    onSuccess() {
      toast.success("Bank account removed successfully");
      closeMiniApp();
    },
    onError(error: unknown) {
      toast.error(getErrorMessage(error));
    },
  });

  const bankName = (code: string) =>
    bankCatalog.data?.find((bank) => bank.code === code)?.name ?? `Bank ${code}`;
  const confirmRemoval = (bankId: string, label: string) => {
    if (window.confirm(`Remove ${label}? Historical withdrawals will not be affected.`)) {
      removal.mutate(bankId);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Saved Bank Accounts</CardTitle>
          <CardDescription>
            Remove an account you no longer want to use for Naira withdrawals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.isPending ? (
            <p className="text-center text-sm text-muted-foreground">Loading accounts…</p>
          ) : accounts.isError ? (
            <p className="text-center text-sm text-destructive">{getErrorMessage(accounts.error)}</p>
          ) : !accounts.data.length ? (
            <p className="text-center text-sm text-muted-foreground">You have no saved bank accounts.</p>
          ) : (
            <div className="grid gap-3">
              {accounts.data.map((account) => {
                const label = `${bankName(account.bankCode)} ${account.accountNumberMasked}`;
                return (
                  <div key={account.id} className="flex items-center gap-3 rounded-md border p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{bankName(account.bankCode)}</p>
                        {account.isDefault && (
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                            Default
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{account.accountNumberMasked}</p>
                      <p className="truncate text-xs text-muted-foreground">{account.accountName}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${label}`}
                      title={`Remove ${label}`}
                      disabled={removal.isPending}
                      onClick={() => confirmRemoval(account.id, label)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
