"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Clock3Icon,
  FileClockIcon,
  HistoryIcon,
  PencilIcon,
  PercentIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  XIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  adminRequest,
  type AdminCatalogCurrency,
  type AdminPlatformFee,
  type AdminPlatformFeeAudit,
  type AdminFeeContext,
  type AdminFeeType,
} from "@/lib/admin-api";

interface FeeFormInput {
  currencyId: string;
  context: AdminFeeContext;
  type: AdminFeeType;
  amount: string;
  minimumFee?: string | null;
  maximumFee?: string | null;
  enabled: boolean;
}

const toUpdateInput = (input: FeeFormInput): Omit<FeeFormInput, "currencyId" | "context"> => ({
  type: input.type,
  amount: input.amount,
  minimumFee: input.minimumFee,
  maximumFee: input.maximumFee,
  enabled: input.enabled,
});

const contextLabel = (context: AdminFeeContext): string =>
  context === "swap" ? "Crypto → NGN swaps" : "NGN withdrawals";

const typeLabel = (type: AdminFeeType): string =>
  type === "flat" ? "Flat amount" : "Percentage";

const formatDate = (value: string): string => new Intl.DateTimeFormat("en-NG", {
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(value));

const formatAmount = (value: string, code: string): string => `${value} ${code.toUpperCase()}`;

function MutationError({ error }: { error: Error | null }) {
  if (!error) return null;
  return <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>Could not save the fee rule</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>;
}

function FeeRuleForm({
  currencies,
  fee,
  pending,
  onSubmit,
  onCancel,
}: {
  currencies: AdminCatalogCurrency[];
  fee?: AdminPlatformFee;
  pending: boolean;
  onSubmit: (input: FeeFormInput) => void;
  onCancel?: () => void;
}) {
  const [currencyId, setCurrencyId] = useState(fee?.currencyId ?? currencies[0]?.id ?? "");
  const [context, setContext] = useState<AdminFeeContext>(fee?.context ?? "swap");
  const [type, setType] = useState<AdminFeeType>(fee?.type ?? "flat");
  const [amount, setAmount] = useState(fee?.amount ?? "");
  const [minimumFee, setMinimumFee] = useState(fee?.minimumFee ?? "");
  const [maximumFee, setMaximumFee] = useState(fee?.maximumFee ?? "");
  const [enabled, setEnabled] = useState(fee?.enabled ?? true);
  const idSuffix = fee?.id ?? "new";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      currencyId,
      context,
      type,
      amount: amount.trim(),
      minimumFee: type === "percentage" && minimumFee.trim() ? minimumFee.trim() : null,
      maximumFee: type === "percentage" && maximumFee.trim() ? maximumFee.trim() : null,
      enabled,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      {!fee && (
        <FieldGroup className="gap-3 md:grid md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`fee-currency-${idSuffix}`}>Currency received / charged</FieldLabel>
            <Select
              id={`fee-currency-${idSuffix}`}
              name="currencyId"
              value={currencyId}
              placeholder="Select a currency"
              options={currencies.map((currency) => ({
                name: `${currency.name} (${currency.code.toUpperCase()})`,
                code: currency.id,
                value: currency.id,
              }))}
              onChange={(event) => setCurrencyId(event.target.value)}
              required
            />
            <FieldDescription>The amount charged or received today is NGN.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`fee-context-${idSuffix}`}>Applies to</FieldLabel>
            <Select
              id={`fee-context-${idSuffix}`}
              name="context"
              value={context}
              options={[
                { name: "Crypto → NGN swaps", code: "swap", value: "swap" },
                { name: "NGN withdrawals", code: "withdrawal", value: "withdrawal" },
              ]}
              onChange={(event) => setContext(event.target.value as AdminFeeContext)}
              required
            />
          </Field>
        </FieldGroup>
      )}

      {fee && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <Badge variant="outline">{fee.currency.code.toUpperCase()}</Badge>
          <span className="font-medium">{contextLabel(fee.context)}</span>
          <span className="text-muted-foreground">Identity is fixed after creation.</span>
        </div>
      )}

      <FieldGroup className="gap-3 md:grid md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`fee-type-${idSuffix}`}>Calculation</FieldLabel>
          <Select
            id={`fee-type-${idSuffix}`}
            name="type"
            value={type}
            options={[
              { name: "Flat amount", code: "flat", value: "flat" },
              { name: "Percentage of proceeds", code: "percentage", value: "percentage" },
            ]}
            onChange={(event) => {
              const nextType = event.target.value as AdminFeeType;
              setType(nextType);
              if (nextType === "flat") {
                setMinimumFee("");
                setMaximumFee("");
              }
            }}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`fee-amount-${idSuffix}`}>{type === "flat" ? "Fee amount" : "Rate (%)"}</FieldLabel>
          <Input
            id={`fee-amount-${idSuffix}`}
            inputMode="decimal"
            placeholder={type === "flat" ? "e.g. 100" : "e.g. 1.5"}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
          <FieldDescription>{type === "flat" ? "Stored as a currency amount." : "Percentage points: 1.5 means 1.5%. Maximum is 100%."}</FieldDescription>
        </Field>
      </FieldGroup>

      {type === "percentage" && (
        <FieldGroup className="gap-3 md:grid md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`fee-minimum-${idSuffix}`}>Minimum fee <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
            <Input id={`fee-minimum-${idSuffix}`} inputMode="decimal" placeholder="No minimum" value={minimumFee} onChange={(event) => setMinimumFee(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`fee-maximum-${idSuffix}`}>Maximum fee <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
            <Input id={`fee-maximum-${idSuffix}`} inputMode="decimal" placeholder="No maximum" value={maximumFee} onChange={(event) => setMaximumFee(event.target.value)} />
          </Field>
        </FieldGroup>
      )}

      <Field orientation="horizontal" className="items-start rounded-lg border bg-muted/20 p-3">
        <input
          id={`fee-enabled-${idSuffix}`}
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="mt-1 size-4 accent-[var(--primary)]"
        />
        <FieldContent>
          <FieldLabel htmlFor={`fee-enabled-${idSuffix}`}>Enabled for new transactions</FieldLabel>
          <FieldDescription>Disabled rules stay in the audit trail and resolve to zero.</FieldDescription>
        </FieldContent>
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !currencyId || !amount.trim()}>
          <CheckCircle2Icon data-icon="inline-start" />
          {pending ? "Saving…" : fee ? "Save changes" : "Create fee rule"}
        </Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={pending}><XIcon data-icon="inline-start" />Cancel</Button>}
      </div>
    </form>
  );
}

function AuditHistory({ feeId }: { feeId: string }) {
  const audit = useQuery({
    queryKey: ["admin-fee-audit", feeId],
    queryFn: () => adminRequest<{ audit: AdminPlatformFeeAudit[] }>(`/fees/${feeId}/audit`),
  });
  if (audit.isPending) return <Skeleton className="h-36" />;
  if (audit.isError) return <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>Audit history unavailable</AlertTitle><AlertDescription>{audit.error.message}</AlertDescription></Alert>;
  if (!audit.data.audit.length) return <p className="text-sm text-muted-foreground">No audit entries found.</p>;

  return (
    <ol className="flex flex-col gap-3" aria-label="Platform fee audit history">
      {audit.data.audit.map((entry) => (
        <li key={entry.id} className="rounded-lg border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2"><Badge variant="outline">{entry.action}</Badge><span className="text-sm font-medium">{entry.adminEmail}</span></div>
            <time className="font-mono text-[11px] text-muted-foreground">{formatDate(entry.createdAt)}</time>
          </div>
          <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
            <div><p className="mb-1 font-medium text-muted-foreground">Before</p><pre className="overflow-x-auto rounded-md bg-background p-2 leading-5">{entry.before ? JSON.stringify(entry.before, null, 2) : "—"}</pre></div>
            <div><p className="mb-1 font-medium text-muted-foreground">After</p><pre className="overflow-x-auto rounded-md bg-background p-2 leading-5">{entry.after ? JSON.stringify(entry.after, null, 2) : "—"}</pre></div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function FeeRuleCard({
  fee,
  editing,
  pending,
  onEdit,
  onToggle,
}: {
  fee: AdminPlatformFee;
  editing: boolean;
  pending: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const [showAudit, setShowAudit] = useState(false);

  return (
    <Card className={editing ? "overflow-hidden border-primary/50" : "overflow-hidden"}>
      <div className="h-1 bg-primary/70" />
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{fee.currency.code.toUpperCase()}</Badge><Badge variant={fee.context === "swap" ? "default" : "secondary"}>{fee.context === "swap" ? "Swap" : "Withdrawal"}</Badge></div>
            <CardTitle className="mt-3">{contextLabel(fee.context)}</CardTitle>
            <CardDescription className="mt-1">Currency received / charged: {fee.currency.name}</CardDescription>
          </div>
          <Badge variant={fee.enabled ? "success" : "secondary"}>{fee.enabled ? "Enabled" : "Disabled"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="rounded-lg border bg-muted/25 p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Calculation</p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{fee.type === "flat" ? formatAmount(fee.amount, fee.currency.code) : `${fee.amount}% of proceeds`}</p>
          <p className="mt-1 text-sm text-muted-foreground">{typeLabel(fee.type)} · exact NGN fees round to two decimals.</p>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div><p className="text-muted-foreground">Minimum cap</p><p className="mt-1 font-mono">{fee.minimumFee ? formatAmount(fee.minimumFee, fee.currency.code) : "None"}</p></div>
          <div><p className="text-muted-foreground">Maximum cap</p><p className="mt-1 font-mono">{fee.maximumFee ? formatAmount(fee.maximumFee, fee.currency.code) : "None"}</p></div>
        </div>
        <Separator />
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-2"><ShieldCheckIcon />Last updated by <span className="font-medium text-foreground">{fee.updatedBy.email}</span></p>
          <p className="flex items-center gap-2"><Clock3Icon />{formatDate(fee.updatedAt)}</p>
        </div>
        {showAudit && <AuditHistory feeId={fee.id} />}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t">
        <Button type="button" variant="outline" size="sm" onClick={onEdit} disabled={pending}><PencilIcon data-icon="inline-start" />Edit</Button>
        <Button type="button" variant="outline" size="sm" onClick={onToggle} disabled={pending}>{fee.enabled ? <ToggleLeftIcon data-icon="inline-start" /> : <ToggleRightIcon data-icon="inline-start" />}{fee.enabled ? "Disable" : "Enable"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowAudit((value) => !value)}><HistoryIcon data-icon="inline-start" />{showAudit ? "Hide audit" : "View audit"}</Button>
      </CardFooter>
    </Card>
  );
}

function FeesSkeleton() {
  return <div className="flex flex-col gap-5"><div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div><div className="grid gap-5 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.6fr)]"><Skeleton className="h-[30rem]" /><Skeleton className="h-[30rem]" /></div></div>;
}

export function FeesPage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const fees = useQuery({
    queryKey: ["admin-fees"],
    queryFn: () => adminRequest<{ fees: AdminPlatformFee[] }>("/fees"),
  });
  const catalog = useQuery({
    queryKey: ["admin-catalog"],
    queryFn: () => adminRequest<{ catalog: AdminCatalogCurrency[] }>("/catalog"),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-fees"] });
    toast.success("Platform fee configuration updated");
  };
  const createFee = useMutation({
    mutationFn: (input: FeeFormInput) => adminRequest<{ fee: AdminPlatformFee }>("/fees", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: refresh,
  });
  const updateFee = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<FeeFormInput> }) => adminRequest<{ fee: AdminPlatformFee }>(`/fees/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => { setEditingId(null); refresh(); },
  });

  if (fees.isPending || catalog.isPending) return <FeesSkeleton />;
  if (fees.isError) return <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>Fee configuration unavailable</AlertTitle><AlertDescription>{fees.error.message}</AlertDescription></Alert>;
  if (catalog.isError) return <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>Currency catalog unavailable</AlertTitle><AlertDescription>{catalog.error.message}</AlertDescription></Alert>;

  const entries = fees.data.fees;
  const currencies = catalog.data.catalog;
  const activeCount = entries.filter((fee) => fee.enabled).length;
  const swapCount = entries.filter((fee) => fee.context === "swap").length;
  const editingFee = entries.find((fee) => fee.id === editingId);
  const pending = createFee.isPending || updateFee.isPending;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-primary/30 bg-primary/5"><CardHeader><CardDescription>Current rules</CardDescription><CardTitle className="font-mono text-3xl">{entries.length}</CardTitle></CardHeader><CardContent><p className="flex items-center gap-2 text-xs text-muted-foreground"><ReceiptTextIcon />One identity per currency and flow</p></CardContent></Card>
        <Card><CardHeader><CardDescription>Enabled now</CardDescription><CardTitle className="font-mono text-3xl">{activeCount}</CardTitle></CardHeader><CardContent><Badge variant={activeCount ? "success" : "secondary"}>{activeCount ? "Charging configured fees" : "Zero-fee fallback"}</Badge></CardContent></Card>
        <Card><CardHeader><CardDescription>Swap coverage</CardDescription><CardTitle className="font-mono text-3xl">{swapCount}</CardTitle></CardHeader><CardContent><p className="flex items-center gap-2 text-xs text-muted-foreground"><PercentIcon />Rules use received currency</p></CardContent></Card>
      </div>

      <MutationError error={createFee.error ?? updateFee.error} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.6fr)]">
        <Card className="xl:sticky xl:top-20">
          <CardHeader><CardTitle>{editingFee ? "Edit fee rule" : "Create a fee rule"}</CardTitle><CardDescription>{editingFee ? "Change the current configuration. Every existing transaction keeps its snapshot." : "Choose the currency customers receive or are charged, then set the calculation."}</CardDescription></CardHeader>
          <CardContent>
            {editingFee ? (
              <FeeRuleForm key={editingFee.id} currencies={currencies} fee={editingFee} pending={pending} onSubmit={(input) => updateFee.mutate({ id: editingFee.id, input: toUpdateInput(input) })} onCancel={() => setEditingId(null)} />
            ) : currencies.length ? (
              <FeeRuleForm currencies={currencies} pending={pending} onSubmit={(input) => createFee.mutate(input)} />
            ) : (
              <Empty><EmptyHeader><EmptyMedia variant="icon"><ReceiptTextIcon /></EmptyMedia><EmptyTitle>No currencies available</EmptyTitle><EmptyDescription>Create a currency in the catalog before adding a fee rule.</EmptyDescription></EmptyHeader></Empty>
            )}
          </CardContent>
        </Card>

        <section className="flex flex-col gap-4" aria-labelledby="current-fees">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="current-fees" className="text-lg font-semibold tracking-tight">Current fee rules</h2><p className="text-sm text-muted-foreground">New quotes and withdrawal intents read these rules directly from the database.</p></div><Badge variant="outline"><FileClockIcon />Audit history retained</Badge></div>
          {entries.length ? (
            <div className="grid gap-4 2xl:grid-cols-2">
              {entries.map((fee) => (
                <FeeRuleCard
                  key={fee.id}
                  fee={fee}
                  editing={editingId === fee.id}
                  pending={pending}
                  onEdit={() => setEditingId(fee.id)}
                  onToggle={() => updateFee.mutate({ id: fee.id, input: { enabled: !fee.enabled } })}
                />
              ))}
            </div>
          ) : (
            <Empty className="min-h-64"><EmptyHeader><EmptyMedia variant="icon"><PercentIcon /></EmptyMedia><EmptyTitle>No platform fees configured</EmptyTitle><EmptyDescription>Create the first rule to start charging swaps or withdrawals. Without a rule, transactions continue with a zero fee.</EmptyDescription></EmptyHeader></Empty>
          )}
        </section>
      </div>
    </div>
  );
}
