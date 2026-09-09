"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenTextIcon,
  CopyIcon,
  MessageSquareTextIcon,
  WalletCardsIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  adminRequest,
  queryString,
  type AccountVersion,
  type AdminTransaction,
  type AdminUserDetail,
  type ConversationTurn,
  type CursorPage,
} from "@/lib/admin-api";
import { CursorPagination } from "./cursor-pagination";
import { formatAmount, formatDateTime } from "./format";
import { TransactionsTable } from "./transactions-table";
import { cn } from "@/lib/utils";

type DetailTab = "balances" | "transactions" | "account-versions" | "conversations";

function QueryError({ title, error }: { title: string; error: Error }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}

function CopyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <code className="min-w-0 flex-1 select-all break-all text-sm">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            toast.success(`${label} copied`);
          } catch {
            toast.error("Could not copy. Select the value and copy it manually.");
          }
        }}
      >
        <CopyIcon />
      </Button>
    </div>
  );
}

function BalancesPanel({ user }: { user: AdminUserDetail }) {
  if (!user.wallets.length) return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon"><WalletCardsIcon /></EmptyMedia>
        <EmptyTitle>No wallets provisioned</EmptyTitle>
        <EmptyDescription>This user does not have a wallet balance to review.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {user.wallets.map((wallet) => (
        <Card key={wallet.id} className="min-w-0">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <Badge variant="outline">{wallet.currency}</Badge>
              <span className="font-mono text-xs text-muted-foreground">Updated {formatDateTime(wallet.updatedAt)}</span>
            </div>
            <CardTitle className="font-mono text-2xl">{formatAmount(wallet.balance, wallet.currency)}</CardTitle>
            <CardDescription>Available balance</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Locked</span>
              <span className="font-mono font-medium">{formatAmount(wallet.lockedBalance, wallet.currency)}</span>
            </div>
            <Separator />
            {wallet.addresses.length ? (
              <div className="flex flex-col gap-4">
                {wallet.addresses.map((address) => (
                  <section key={address.id} aria-label={`${wallet.currency} ${address.network} address`} className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Network</span>
                      <Badge variant="secondary">{address.network}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Wallet address</p>
                    <CopyValue label={`${wallet.currency} ${address.network} address`} value={address.address} />
                    {address.destinationTag !== null && address.destinationTag !== "" && (
                      <>
                        <p className="text-xs text-muted-foreground">Destination tag / memo</p>
                        <CopyValue label="Destination tag / memo" value={address.destinationTag} />
                      </>
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {wallet.isCrypto ? "No wallet addresses provisioned yet." : "Network addresses do not apply to this fiat wallet."}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TransactionsPanel({ userId, active }: { userId: string; active: boolean }) {
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const resetCursor = () => { setCursor(undefined); setHistory([]); };
  const transactions = useQuery({
    queryKey: ["admin-user-transactions", userId, type, status, from, to, cursor],
    queryFn: () => adminRequest<CursorPage<AdminTransaction>>(
      `/users/${userId}/transactions${queryString({
        type: type || undefined,
        status: status || undefined,
        from: from ? `${from}T00:00:00+01:00` : undefined,
        to: to ? `${to}T23:59:59+01:00` : undefined,
        cursor,
        limit: "20",
      })}`,
    ),
    enabled: active,
  });

  return (
    <Card>
      <CardHeader><CardTitle>Transactions</CardTitle><CardDescription>Deposits, swaps, and withdrawals in one ordered record.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-5">
        <FieldGroup className="gap-3 md:grid md:grid-cols-4">
          <Field><FieldLabel htmlFor="type-filter">Type</FieldLabel><Select id="type-filter" name="type" value={type} placeholder="All types" options={["deposit", "swap", "withdrawal"]} onChange={(event) => { setType(event.target.value); resetCursor(); }} /></Field>
          <Field><FieldLabel htmlFor="status-filter">Status</FieldLabel><Select id="status-filter" name="status" value={status} placeholder="All statuses" options={["pending", "processing", "success", "failed"]} onChange={(event) => { setStatus(event.target.value); resetCursor(); }} /></Field>
          <Field><FieldLabel htmlFor="from-filter">From</FieldLabel><Input id="from-filter" type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); resetCursor(); }} /></Field>
          <Field><FieldLabel htmlFor="to-filter">To</FieldLabel><Input id="to-filter" type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); resetCursor(); }} /></Field>
        </FieldGroup>
        {transactions.isPending ? <Skeleton className="h-80" /> : transactions.isError ? (
          <QueryError title="Could not load transactions" error={transactions.error} />
        ) : (
          <>
            <TransactionsTable transactions={transactions.data.items} />
            <CursorPagination
              canGoBack={history.length > 0}
              canGoForward={Boolean(transactions.data.nextCursor)}
              onBack={() => { setCursor(history[history.length - 1]); setHistory(history.slice(0, -1)); }}
              onForward={() => { setHistory([...history, cursor]); setCursor(transactions.data.nextCursor); }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

const actionLabel = (action: string): string => action
  .split("_")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

function AccountVersionsPanel({ userId, active }: { userId: string; active: boolean }) {
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const versions = useQuery({
    queryKey: ["admin-account-versions", userId, cursor],
    queryFn: () => adminRequest<CursorPage<AccountVersion>>(`/users/${userId}/account-versions${queryString({ cursor, limit: "20" })}`),
    enabled: active,
  });
  if (versions.isPending) return <Skeleton className="h-[32rem]" />;
  if (versions.isError) return <QueryError title="Could not load account versions" error={versions.error} />;
  if (!versions.data.items.length) return (
    <Empty><EmptyHeader><EmptyMedia variant="icon"><BookOpenTextIcon /></EmptyMedia><EmptyTitle>No balance versions</EmptyTitle><EmptyDescription>Ledger mutations will appear here as an immutable audit trail.</EmptyDescription></EmptyHeader></Empty>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Balance spine</CardTitle>
        <CardDescription>Every recorded mutation shows its amount and the balance before and immediately after its action.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <ol className="relative flex flex-col gap-0 before:absolute before:bottom-5 before:left-[15px] before:top-5 before:w-px before:bg-primary/25">
          {versions.data.items.map((version) => (
            <li key={version.id} className="relative grid grid-cols-[2rem_1fr] gap-3 pb-7 last:pb-0">
              <div className="relative mt-1 flex size-8 items-center justify-center rounded-full border bg-background">
                <span className="size-2 rounded-full bg-primary" />
              </div>
              <div className="min-w-0 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{version.currency}</Badge>
                      <Badge variant="secondary">{actionLabel(version.action)}</Badge>
                    </div>
                    <p className="mt-2 max-w-96 truncate font-mono text-xs text-muted-foreground" title={version.transactionReference}>{version.transactionReference}</p>
                  </div>
                  <time className="font-mono text-xs text-muted-foreground">{formatDateTime(version.createdAt)}</time>
                </div>
                <div className="mt-4 grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
                  <div>
                    <p className="text-xs text-muted-foreground">Previous</p>
                    <p className="mt-1 font-mono text-sm font-semibold">{formatAmount(version.previousBalance, version.currency)}</p>
                  </div>
                  <ArrowRightIcon className="hidden size-4 text-primary sm:block" />
                  <div>
                    <p className="text-xs text-muted-foreground">Resulting</p>
                    <p className="mt-1 font-mono text-sm font-semibold text-primary">{formatAmount(version.balance, version.currency)}</p>
                  </div>
                  <Separator orientation="vertical" className="hidden h-8 sm:block" />
                  <div>
                    <p className="text-xs text-muted-foreground">Amount</p>
                    <p className="mt-1 font-mono text-sm font-semibold">{formatAmount(version.amount, version.currency)}</p>
                  </div>
                  <Separator orientation="vertical" className="hidden h-8 sm:block" />
                  <div>
                    <p className="text-xs text-muted-foreground">Locked after</p>
                    <p className="mt-1 font-mono text-sm font-semibold">{formatAmount(version.lockedBalance, version.currency)}</p>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <CursorPagination
          canGoBack={history.length > 0}
          canGoForward={Boolean(versions.data.nextCursor)}
          onBack={() => { setCursor(history[history.length - 1]); setHistory(history.slice(0, -1)); }}
          onForward={() => { setHistory([...history, cursor]); setCursor(versions.data.nextCursor); }}
        />
      </CardContent>
    </Card>
  );
}

function ConversationsPanel({ userId, active }: { userId: string; active: boolean }) {
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const conversations = useQuery({
    queryKey: ["admin-conversations", userId, cursor],
    queryFn: () => adminRequest<CursorPage<ConversationTurn> & { truncated: boolean }>(`/users/${userId}/conversations${queryString({ cursor, limit: "10" })}`),
    enabled: active,
  });
  if (conversations.isPending) return <Skeleton className="h-[28rem]" />;
  if (conversations.isError) return <QueryError title="Could not load conversations" error={conversations.error} />;
  if (!conversations.data.items.length) return (
    <Empty><EmptyHeader><EmptyMedia variant="icon"><MessageSquareTextIcon /></EmptyMedia><EmptyTitle>No saved conversations</EmptyTitle><EmptyDescription>Telegram turns appear here after message history is recorded.</EmptyDescription></EmptyHeader></Empty>
  );
  return (
    <Card>
      <CardHeader><CardTitle>Telegram conversations</CardTitle><CardDescription>Newest turns first; messages remain chronological within each turn.</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-5">
        {conversations.data.truncated && <Alert variant="warning"><AlertTriangleIcon /><AlertTitle>Long history truncated</AlertTitle><AlertDescription>This page reached its bounded message limit.</AlertDescription></Alert>}
        <div className="flex flex-col gap-6">
          {conversations.data.items.map((turn) => (
            <section key={turn.turnId} aria-label={`Conversation turn ${turn.turnId}`} className="rounded-lg border bg-muted/30 p-4">
              <div className="mb-4 flex flex-wrap justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                <span>TURN {turn.turnId}</span><time>{formatDateTime(turn.createdAt)}</time>
              </div>
              <div className="flex flex-col gap-3">
                {turn.messages.map((message) => (
                  <div key={message.id} className={cn("flex", message.role === "user" ? "justify-start" : "justify-end")}>
                    <div className={cn("max-w-[85%] rounded-lg px-4 py-3 text-sm leading-6", message.role === "user" ? "bg-card" : "bg-primary text-primary-foreground")}>
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                      <p className={cn("mt-2 font-mono text-[10px]", message.role === "user" ? "text-muted-foreground" : "text-primary-foreground/65")}>
                        {message.role} · {formatDateTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <CursorPagination
          canGoBack={history.length > 0}
          canGoForward={Boolean(conversations.data.nextCursor)}
          onBack={() => { setCursor(history[history.length - 1]); setHistory(history.slice(0, -1)); }}
          onForward={() => { setHistory([...history, cursor]); setCursor(conversations.data.nextCursor); }}
        />
      </CardContent>
    </Card>
  );
}

export function UserDetail({ userId }: { userId: string }) {
  const [tab, setTab] = useState<DetailTab>("balances");
  const user = useQuery({
    queryKey: ["admin-user", userId],
    queryFn: () => adminRequest<{ user: AdminUserDetail }>(`/users/${userId}`),
  });
  if (user.isPending) return <div className="flex flex-col gap-5"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>;
  if (user.isError) return <QueryError title="Could not load user" error={user.error} />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button variant="ghost" size="sm" asChild><Link href="/admin#users"><ArrowLeftIcon data-icon="inline-start" />Back to users</Link></Button>
      </div>
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2"><Badge variant={user.data.user.isActive ? "success" : "secondary"}>{user.data.user.isActive ? "Active" : "Inactive"}</Badge><span className="font-mono text-xs text-muted-foreground">TG {user.data.user.telegramId}</span></div>
          <h1 className="text-3xl font-semibold tracking-[-0.03em]">{user.data.user.firstName} {user.data.user.lastName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{user.data.user.email} · joined {formatDateTime(user.data.user.createdAt)}</p>
        </div>
        <p className="font-mono text-xs text-muted-foreground">USER {user.data.user.id}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Subaccount ID (Sub User ID)</CardTitle>
          <CardDescription>The user’s provider subaccount ID.</CardDescription>
        </CardHeader>
        <CardContent>
          {user.data.user.subUserId ? (
            <CopyValue label="Subaccount ID" value={user.data.user.subUserId} />
          ) : <p className="text-sm text-muted-foreground">Subaccount ID unavailable.</p>}
        </CardContent>
      </Card>
      <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)}>
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="balances">Wallets & balances</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="account-versions">Account versions</TabsTrigger>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
        </TabsList>
        <TabsContent value="balances"><BalancesPanel user={user.data.user} /></TabsContent>
        <TabsContent value="transactions"><TransactionsPanel userId={userId} active={tab === "transactions"} /></TabsContent>
        <TabsContent value="account-versions"><AccountVersionsPanel userId={userId} active={tab === "account-versions"} /></TabsContent>
        <TabsContent value="conversations"><ConversationsPanel userId={userId} active={tab === "conversations"} /></TabsContent>
      </Tabs>
    </div>
  );
}
