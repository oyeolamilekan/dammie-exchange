"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangleIcon, PencilIcon, PlusIcon, Trash2Icon, WalletCardsIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
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
import {
  adminRequest,
  type AdminCatalogCurrency,
  type AdminCatalogNetwork,
} from "@/lib/admin-api";

type CurrencyCreateInput = { name: string; code: string; enabled: boolean; isCrypto: boolean };
type CurrencyUpdateInput = { name: string; enabled: boolean; isCrypto: boolean };
type NetworkCreateInput = { name: string; code: string };
type NetworkUpdateInput = { name: string };
type RelationshipInput = { currencyId: string; networkId: string };

function CatalogSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

function MutationError({ error }: { error: Error | null | undefined }) {
  if (!error) return null;
  return (
    <Alert variant="destructive" className="mt-4">
      <AlertTriangleIcon />
      <AlertTitle>Catalog change failed</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
}

function CurrencyForm({
  currency,
  onSubmit,
  onCancel,
  pending,
}: {
  currency?: AdminCatalogCurrency;
  onSubmit: (input: CurrencyCreateInput | CurrencyUpdateInput) => void;
  onCancel?: () => void;
  pending: boolean;
}) {
  const [name, setName] = useState(currency?.name ?? "");
  const [code, setCode] = useState(currency?.code ?? "");
  const [enabled, setEnabled] = useState(currency?.enabled ?? true);
  const [isCrypto, setIsCrypto] = useState(currency?.isCrypto ?? true);
  const idSuffix = currency?.id ?? "new";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(currency ? { name, enabled, isCrypto } : { name, code, enabled, isCrypto });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={`currency-name-${idSuffix}`}>Name</FieldLabel>
          <Input id={`currency-name-${idSuffix}`} value={name} onChange={(event) => setName(event.target.value)} maxLength={250} required />
        </Field>
        <Field>
          <FieldLabel htmlFor={`currency-code-${idSuffix}`}>Code</FieldLabel>
          <Input id={`currency-code-${idSuffix}`} value={code} onChange={(event) => setCode(event.target.value)} maxLength={16} disabled={Boolean(currency)} required={!currency} />
          {currency ? <p className="text-xs text-muted-foreground">Codes are immutable and stored lowercase.</p> : <p className="text-xs text-muted-foreground">Whitespace is trimmed and the code is stored lowercase.</p>}
        </Field>
      </FieldGroup>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Enabled for new wallet operations
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isCrypto} onChange={(event) => setIsCrypto(event.target.checked)} />
        Cryptocurrency (disable for fiat)
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : currency ? "Save currency" : "Add currency"}</Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={pending}><XIcon />Cancel</Button>}
      </div>
    </form>
  );
}

function NetworkForm({
  network,
  onSubmit,
  onCancel,
  pending,
}: {
  network?: AdminCatalogNetwork;
  onSubmit: (input: NetworkCreateInput | NetworkUpdateInput) => void;
  onCancel?: () => void;
  pending: boolean;
}) {
  const [name, setName] = useState(network?.name ?? "");
  const [code, setCode] = useState(network?.code ?? "");
  const idSuffix = network?.id ?? "new";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(network ? { name } : { name, code });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FieldGroup className="gap-3">
        <Field>
          <FieldLabel htmlFor={`network-name-${idSuffix}`}>Name</FieldLabel>
          <Input id={`network-name-${idSuffix}`} value={name} onChange={(event) => setName(event.target.value)} maxLength={250} required />
        </Field>
        <Field>
          <FieldLabel htmlFor={`network-code-${idSuffix}`}>Code</FieldLabel>
          <Input id={`network-code-${idSuffix}`} value={code} onChange={(event) => setCode(event.target.value)} maxLength={64} disabled={Boolean(network)} required={!network} />
          {network ? <p className="text-xs text-muted-foreground">Codes are immutable and stored lowercase.</p> : <p className="text-xs text-muted-foreground">Whitespace is trimmed and the code is stored lowercase.</p>}
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : network ? "Save network" : "Add network"}</Button>
        {onCancel && <Button type="button" variant="outline" onClick={onCancel} disabled={pending}><XIcon />Cancel</Button>}
      </div>
    </form>
  );
}

function RelationshipForm({
  currencies,
  networks,
  onSubmit,
  pending,
}: {
  currencies: AdminCatalogCurrency[];
  networks: AdminCatalogNetwork[];
  onSubmit: (input: RelationshipInput) => void;
  pending: boolean;
}) {
  const [currencyId, setCurrencyId] = useState("");
  const [networkId, setNetworkId] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({ currencyId, networkId });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FieldGroup className="gap-3 md:grid md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="relationship-currency">Currency</FieldLabel>
          <Select id="relationship-currency" name="currencyId" value={currencyId} placeholder="Select a currency" options={currencies.map((currency) => ({ name: `${currency.name} (${currency.code})`, code: currency.id, value: currency.id }))} onChange={(event) => setCurrencyId(event.target.value)} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="relationship-network">Network</FieldLabel>
          <Select id="relationship-network" name="networkId" value={networkId} placeholder="Select a network" options={networks.map((network) => ({ name: `${network.name} (${network.code})`, code: network.id, value: network.id }))} onChange={(event) => setNetworkId(event.target.value)} required />
        </Field>
      </FieldGroup>
      <Button type="submit" disabled={pending || !currencies.length || !networks.length}><PlusIcon />{pending ? "Adding relationship…" : "Add relationship"}</Button>
    </form>
  );
}

function CurrencyEntry({
  currency,
  pending,
  onEdit,
  onDelete,
  onDeleteRelationship,
}: {
  currency: AdminCatalogCurrency;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDeleteRelationship: (network: AdminCatalogNetwork) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="truncate">{currency.name}</CardTitle>
            <CardDescription className="mt-1 font-mono">{currency.code}</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="outline">{currency.isCrypto ? "Crypto" : "Fiat"}</Badge>
            <Badge variant={currency.enabled ? "success" : "secondary"}>{currency.enabled ? "Enabled" : "Disabled"}</Badge>
            <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${currency.code}`} title={`Edit ${currency.code}`} onClick={onEdit} disabled={pending}><PencilIcon /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${currency.code}`} title={`Delete ${currency.code}`} onClick={onDelete} disabled={pending}><Trash2Icon /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div><p className="text-xs text-muted-foreground">Currency ID</p><code className="mt-1 block break-all text-xs">{currency.id}</code></div>
        <Separator />
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">Networks</p><Badge variant="outline">{currency.networks.length}</Badge></div>
          {currency.networks.length ? currency.networks.map((network) => (
            <div key={network.id} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{network.code}</Badge><span className="text-sm">{network.name}</span></div><code className="mt-2 block break-all text-xs text-muted-foreground">{network.id}</code></div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${currency.code} on ${network.code}`} title={`Remove ${currency.code} on ${network.code}`} onClick={() => onDeleteRelationship(network)} disabled={pending}><Trash2Icon /></Button>
            </div>
          )) : <p className="text-sm text-muted-foreground">No network relationship configured.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function NetworkEntry({
  network,
  pending,
  onEdit,
  onDelete,
}: {
  network: AdminCatalogNetwork;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{network.code}</Badge><span className="font-medium">{network.name}</span></div><code className="mt-2 block break-all text-xs text-muted-foreground">{network.id}</code></div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${network.code}`} title={`Edit ${network.code}`} onClick={onEdit} disabled={pending}><PencilIcon /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${network.code}`} title={`Delete ${network.code}`} onClick={onDelete} disabled={pending}><Trash2Icon /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CatalogPage() {
  const queryClient = useQueryClient();
  const [editingCurrencyId, setEditingCurrencyId] = useState<string | null>(null);
  const [editingNetworkId, setEditingNetworkId] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ["admin-catalog"],
    queryFn: () => adminRequest<{ catalog: AdminCatalogCurrency[] }>("/catalog"),
  });
  const networks = useQuery({
    queryKey: ["admin-networks"],
    queryFn: () => adminRequest<{ networks: AdminCatalogNetwork[] }>("/catalog/networks"),
  });
  const refreshCatalog = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-catalog"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-networks"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-currency-networks"] });
  };
  const createCurrency = useMutation({
    mutationFn: (input: CurrencyCreateInput) => adminRequest<{ currency: AdminCatalogCurrency }>("/catalog/currencies", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: refreshCatalog,
  });
  const updateCurrency = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CurrencyUpdateInput }) => adminRequest<{ currency: AdminCatalogCurrency }>(`/catalog/currencies/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => { setEditingCurrencyId(null); refreshCatalog(); },
  });
  const deleteCurrency = useMutation({
    mutationFn: (id: string) => adminRequest<void>(`/catalog/currencies/${id}`, { method: "DELETE" }),
    onSuccess: refreshCatalog,
  });
  const createNetwork = useMutation({
    mutationFn: (input: NetworkCreateInput) => adminRequest<{ network: AdminCatalogNetwork }>("/catalog/networks", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: refreshCatalog,
  });
  const updateNetwork = useMutation({
    mutationFn: ({ id, input }: { id: string; input: NetworkUpdateInput }) => adminRequest<{ network: AdminCatalogNetwork }>(`/catalog/networks/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => { setEditingNetworkId(null); refreshCatalog(); },
  });
  const deleteNetwork = useMutation({
    mutationFn: (id: string) => adminRequest<void>(`/catalog/networks/${id}`, { method: "DELETE" }),
    onSuccess: refreshCatalog,
  });
  const createRelationship = useMutation({
    mutationFn: (input: RelationshipInput) => adminRequest("/catalog/currency-networks", { method: "POST", body: JSON.stringify(input) }),
    onSuccess: refreshCatalog,
  });
  const deleteRelationship = useMutation({
    mutationFn: ({ currencyId, networkId }: RelationshipInput) => adminRequest<void>(`/catalog/currency-networks/${currencyId}/${networkId}`, { method: "DELETE" }),
    onSuccess: refreshCatalog,
  });

  if (catalog.isPending || networks.isPending) return <CatalogSkeleton />;
  if (catalog.isError) return (
    <Alert variant="destructive">
      <AlertTriangleIcon /><AlertTitle>Catalog unavailable</AlertTitle><AlertDescription>{catalog.error.message}</AlertDescription>
    </Alert>
  );
  if (networks.isError) return (
    <Alert variant="destructive">
      <AlertTriangleIcon /><AlertTitle>Networks unavailable</AlertTitle><AlertDescription>{networks.error.message}</AlertDescription>
    </Alert>
  );

  const currencies = catalog.data.catalog;
  const networkEntries = networks.data.networks;
  const enabledCount = currencies.filter((currency) => currency.enabled).length;
  const relationshipCount = currencies.reduce((count, currency) => count + currency.networks.length, 0);
  const pending = createCurrency.isPending || updateCurrency.isPending || deleteCurrency.isPending
    || createNetwork.isPending || updateNetwork.isPending || deleteNetwork.isPending
    || createRelationship.isPending || deleteRelationship.isPending;

  const removeCurrency = (currency: AdminCatalogCurrency) => {
    if (window.confirm(`Delete ${currency.name} (${currency.code})? This only succeeds when no wallets or relationships reference it.`)) deleteCurrency.mutate(currency.id);
  };
  const removeNetwork = (network: AdminCatalogNetwork) => {
    if (window.confirm(`Delete ${network.name} (${network.code})? This only succeeds when no wallet addresses or relationships reference it.`)) deleteNetwork.mutate(network.id);
  };
  const removeRelationship = (currency: AdminCatalogCurrency, network: AdminCatalogNetwork) => {
    if (window.confirm(`Remove ${currency.code} on ${network.code}?`)) deleteRelationship.mutate({ currencyId: currency.id, networkId: network.id });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader><CardDescription>Currencies</CardDescription><CardTitle className="font-mono text-3xl">{currencies.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Enabled currencies</CardDescription><CardTitle className="font-mono text-3xl">{enabledCount}</CardTitle></CardHeader></Card>
        <Card><CardHeader><CardDescription>Relationships</CardDescription><CardTitle className="font-mono text-3xl">{relationshipCount}</CardTitle></CardHeader></Card>
      </div>
      <MutationError error={deleteCurrency.error ?? deleteNetwork.error} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Add currency</CardTitle><CardDescription>Create a catalog currency before attaching networks.</CardDescription></CardHeader>
          <CardContent><CurrencyForm onSubmit={(input) => createCurrency.mutate(input as CurrencyCreateInput)} pending={pending} /><MutationError error={createCurrency.error} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Add network</CardTitle><CardDescription>Create a network that can be attached to currencies.</CardDescription></CardHeader>
          <CardContent><NetworkForm onSubmit={(input) => createNetwork.mutate(input as NetworkCreateInput)} pending={pending} /><MutationError error={createNetwork.error} /></CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="currency-definitions">
        <div><h2 id="currency-definitions" className="text-lg font-semibold tracking-tight">Currency definitions</h2><p className="text-sm text-muted-foreground">Disable currencies to remove them from new wallet and AI operations without affecting existing financial records.</p></div>
        {currencies.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {currencies.map((currency) => editingCurrencyId === currency.id ? (
              <Card key={currency.id}>
                <CardHeader><CardTitle>Edit {currency.code}</CardTitle><CardDescription>Update display metadata or provisioning status.</CardDescription></CardHeader>
                <CardContent><CurrencyForm currency={currency} onSubmit={(input) => updateCurrency.mutate({ id: currency.id, input: input as CurrencyUpdateInput })} onCancel={() => setEditingCurrencyId(null)} pending={pending} /><MutationError error={updateCurrency.error} /></CardContent>
              </Card>
            ) : (
              <CurrencyEntry key={currency.id} currency={currency} pending={pending} onEdit={() => setEditingCurrencyId(currency.id)} onDelete={() => removeCurrency(currency)} onDeleteRelationship={(network) => removeRelationship(currency, network)} />
            ))}
          </div>
        ) : (
          <Empty><EmptyHeader><EmptyMedia variant="icon"><WalletCardsIcon /></EmptyMedia><EmptyTitle>No currencies</EmptyTitle><EmptyDescription>Create the first currency definition above.</EmptyDescription></EmptyHeader></Empty>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="network-definitions">
        <div><h2 id="network-definitions" className="text-lg font-semibold tracking-tight">Network definitions</h2><p className="text-sm text-muted-foreground">Network codes are immutable because they are used in provider and financial records.</p></div>
        {networkEntries.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {networkEntries.map((network) => editingNetworkId === network.id ? (
              <Card key={network.id}>
                <CardHeader><CardTitle>Edit {network.code}</CardTitle><CardDescription>Update network display metadata.</CardDescription></CardHeader>
                <CardContent><NetworkForm network={network} onSubmit={(input) => updateNetwork.mutate({ id: network.id, input: input as NetworkUpdateInput })} onCancel={() => setEditingNetworkId(null)} pending={pending} /><MutationError error={updateNetwork.error} /></CardContent>
              </Card>
            ) : (
              <NetworkEntry key={network.id} network={network} pending={pending} onEdit={() => setEditingNetworkId(network.id)} onDelete={() => removeNetwork(network)} />
            ))}
          </div>
        ) : (
          <Empty><EmptyHeader><EmptyMedia variant="icon"><WalletCardsIcon /></EmptyMedia><EmptyTitle>No networks</EmptyTitle><EmptyDescription>Create the first network definition above.</EmptyDescription></EmptyHeader></Empty>
        )}
      </section>

      <Card>
        <CardHeader><CardTitle>Currency/network relationships</CardTitle><CardDescription>Choose an existing currency and network to add an allowed pairing. Existing pairings can be removed from the currency cards above.</CardDescription></CardHeader>
        <CardContent><RelationshipForm currencies={currencies} networks={networkEntries} onSubmit={(input) => createRelationship.mutate(input)} pending={pending} /><MutationError error={createRelationship.error ?? deleteRelationship.error} /></CardContent>
      </Card>
    </div>
  );
}
