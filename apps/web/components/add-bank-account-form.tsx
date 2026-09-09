import { cn, getErrorMessage } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { FieldValues, useForm } from "react-hook-form";
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ErrorMessage } from "@/components/ui/input-error"
import { useMutation } from "@tanstack/react-query";
import { useBankCatalog } from "@/hooks/use-bank-catalog";
import { addBankAccount } from "@/endpoints/api";
import { toast } from "sonner";
import { useTelegramWebApp } from "@/hooks/use-telegram";
import { Select } from "@/components/ui/select";

interface LoginFormProps extends React.ComponentProps<"div"> {
  slug: string;
}

export function AddBankAccountForm({
  className,
  slug,
  ...props
}: LoginFormProps) {

  const { register, handleSubmit, formState: { errors } } = useForm()
  const { closeMiniApp } = useTelegramWebApp();
  const bankCatalog = useBankCatalog();
  const banksByName = [...(bankCatalog.data ?? [])].sort((left, right) =>
    left.name.localeCompare(right.name, "en", { sensitivity: "base" })
  );
  const hasBanks = banksByName.length > 0;

  const onSubmit = async (data: FieldValues) => {
    const { bankCode, accountNumber } = data
    mutate({ bankCode, accountNumber, slug })
  };

  const { isPending, mutate } = useMutation({
    mutationFn: addBankAccount,
    onSuccess() {
      toast.success("Account created successfully!");
      closeMiniApp();
    },
    onError(error: unknown) {
      toast.error(getErrorMessage(error));
    },
  })

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">How far Chief</CardTitle>
          <CardDescription>
            Add your bank account account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="grid gap-6">
              <div className="grid gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="accountNumber">Account Number</Label>
                  <Input
                    id="accountNumber"
                    type="text"
                    placeholder="1234567890"
                    maxLength={10}
                    required
                    {...register('accountNumber', {
                      required: 'Account number is required',
                      pattern: {
                        value: /^[0-9]{10,11}$/,
                        message: 'Account number must be 10 digits only',
                      },
                      minLength: {
                        value: 10,
                        message: 'Account number must be at least 10 digits'
                      },
                      maxLength: {
                        value: 11,
                        message: 'Account number cannot exceed 10 digits'
                      },
                      validate: {
                        numbersOnly: (value) =>
                          /^[0-9]+$/.test(value) || 'Account number must contain only numbers',
                        notAllSame: (value) =>
                          !(/^(\d)\1+$/.test(value)) || 'Account number cannot be all the same digit'
                      }
                    })}
                  />
                  <ErrorMessage message={errors.accountNumber?.message} />
                </div>

                <Select
                  label="Bank"
                  placeholder={bankCatalog.isPending ? "Loading banks…" : "Select a bank"}
                  options={banksByName}
                  required
                  disabled={bankCatalog.isPending || bankCatalog.isError || !hasBanks}
                  {...register('bankCode', {
                    required: 'Select a bank',
                  })}
                />
                {bankCatalog.isError && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-destructive">Unable to load the bank list.</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void bankCatalog.refetch()}
                      disabled={bankCatalog.isFetching}
                    >
                      {bankCatalog.isFetching ? "Retrying…" : "Retry"}
                    </Button>
                  </div>
                )}
                {bankCatalog.isSuccess && !hasBanks && (
                  <p className="text-sm text-destructive">
                    No banks are available. The bank catalog has not been set up yet.
                  </p>
                )}
                <ErrorMessage message={errors.bankCode?.message} />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isPending || bankCatalog.isPending || bankCatalog.isError || !hasBanks}
                >
                  {isPending ? "Loading" : "Add Bank Account"}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
