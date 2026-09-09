"use client"

import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { approveNgnWithdrawal, getNgnWithdrawalReview } from "@/endpoints/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorMessage } from "@/components/ui/input-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useTelegramWebApp } from "@/hooks/use-telegram";
import { useBankCatalog } from "@/hooks/use-bank-catalog";
import { cn, getErrorMessage } from "@/lib/utils";
import { toast } from "sonner";
import { formatFinancialAmount } from "@/lib/financial-format";

interface FormValues {
  bankId: string;
  code: string;
}

interface ApproveWithdrawalFormProps extends React.ComponentProps<"div"> {
  slug: string;
}

export function ApproveWithdrawalForm({ slug, className, ...props }: ApproveWithdrawalFormProps) {
  const { closeMiniApp } = useTelegramWebApp();
  const bankCatalog = useBankCatalog();
  const review = useQuery({
    queryKey: ["ngn-withdrawal", slug],
    queryFn: () => getNgnWithdrawalReview(slug),
    retry: false,
  });
  const { register, handleSubmit, formState: { errors } } = useForm<FormValues>();
  const approval = useMutation({
    mutationFn: approveNgnWithdrawal,
    onSuccess() {
      toast.success("Withdrawal approved and processing");
      closeMiniApp();
    },
    onError(error: unknown) {
      toast.error(getErrorMessage(error));
    },
  });

  if (review.isPending) {
    return <div className={cn("text-center text-sm text-muted-foreground", className)}>Loading withdrawal…</div>;
  }
  if (review.isError || !review.data) {
    return <div className={cn("text-center text-sm text-destructive", className)}>{getErrorMessage(review.error)}</div>;
  }

  const withdrawal = review.data;
  const bankName = (code: string) => bankCatalog.data?.find((bank) => bank.code === code)?.name ?? `Bank ${code}`;
  const bankOptions = withdrawal.bankAccounts
    .map((bank) => ({
      code: bank.id,
      name: `${bankName(bank.bankCode)} — ${bank.accountNumberMasked} (${bank.accountName})`,
      isDefault: bank.isDefault,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));
  const defaultBankId = withdrawal.bankAccounts.find((bank) => bank.isDefault)?.id;
  const canApprove = withdrawal.status === "pending";

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Approve NGN Withdrawal</CardTitle>
          <CardDescription>Review the total, choose your bank, and enter your transaction PIN.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 grid gap-2 rounded-md border p-4 text-sm">
            <div className="flex justify-between"><span>Bank receives</span><strong>₦{formatFinancialAmount(withdrawal.amount)}</strong></div>
            <div className="flex justify-between"><span>Withdrawal fee</span><strong>₦{formatFinancialAmount(withdrawal.fee)}</strong></div>
            <div className="flex justify-between border-t pt-2"><span>Total wallet debit</span><strong>₦{formatFinancialAmount(withdrawal.total)}</strong></div>
            <div className="flex justify-between text-muted-foreground"><span>Available balance</span><span>₦{formatFinancialAmount(withdrawal.balance)}</span></div>
          </div>

          {!canApprove ? (
            <p className="text-center text-sm text-muted-foreground">This withdrawal is {withdrawal.status}.</p>
          ) : (
            <form onSubmit={handleSubmit(({ bankId, code }) => approval.mutate({ bankId, code, slug }))}>
              <div className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="bankId">Destination bank account</Label>
                  <Select
                    id="bankId"
                    options={bankOptions}
                    placeholder="Select a verified bank account"
                    defaultValue={defaultBankId}
                    {...register("bankId", { required: "Select a bank account" })}
                  />
                  <ErrorMessage message={errors.bankId?.message} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="withdrawalPin">Transaction PIN</Label>
                  <Input
                    id="withdrawalPin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                    placeholder="••••"
                    className="text-center"
                    {...register("code", {
                      required: "Transaction PIN is required",
                      pattern: { value: /^\d{4}$/, message: "Enter your four-digit PIN" },
                    })}
                  />
                  <ErrorMessage message={errors.code?.message} />
                </div>
                <Button type="submit" disabled={approval.isPending || !bankOptions.length}>
                  {approval.isPending ? "Approving…" : `Withdraw ₦${formatFinancialAmount(withdrawal.amount)}`}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
