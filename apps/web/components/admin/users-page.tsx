"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, SearchIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminRequest, queryString, type AdminUserListItem, type CursorPage } from "@/lib/admin-api";
import { CursorPagination } from "./cursor-pagination";
import { formatDateTime } from "./format";

export function UsersPage() {
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<Array<string | undefined>>([]);
  const users = useQuery({
    queryKey: ["admin-users", search, active, cursor],
    queryFn: () => adminRequest<CursorPage<AdminUserListItem>>(`/users${queryString({
      search: search || undefined,
      active: active || undefined,
      cursor,
      limit: "20",
    })}`),
  });
  const resetCursor = () => {
    setCursor(undefined);
    setHistory([]);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSearch(draftSearch.trim());
    resetCursor();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>User directory</CardTitle>
        <CardDescription>Search by name, email address, or Telegram ID.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={submit}>
          <FieldGroup className="gap-3 md:flex-row md:items-end">
            <Field>
              <FieldLabel htmlFor="user-search">Search users</FieldLabel>
              <InputGroup>
                <InputGroupAddon><SearchIcon /></InputGroupAddon>
                <InputGroupInput
                  id="user-search"
                  value={draftSearch}
                  onChange={(event) => setDraftSearch(event.target.value)}
                  placeholder="Name, email, or Telegram ID"
                />
              </InputGroup>
            </Field>
            <Field className="md:max-w-48">
              <FieldLabel htmlFor="active-filter">Account status</FieldLabel>
              <Select
                id="active-filter"
                name="active"
                value={active}
                placeholder="All statuses"
                options={[
                  { name: "Active", code: "true", value: "true" },
                  { name: "Inactive", code: "false", value: "false" },
                ]}
                onChange={(event) => {
                  setActive(event.target.value);
                  resetCursor();
                }}
              />
            </Field>
            <Button type="submit">Search</Button>
          </FieldGroup>
        </form>
        {users.isPending ? (
          <Skeleton className="h-72" />
        ) : users.isError ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Could not load users</AlertTitle>
            <AlertDescription>{users.error.message}</AlertDescription>
          </Alert>
        ) : users.data.items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><UsersIcon /></EmptyMedia>
              <EmptyTitle>No matching users</EmptyTitle>
              <EmptyDescription>Change the search text or account status.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead><TableHead>Telegram ID</TableHead>
                  <TableHead>Status</TableHead><TableHead>Wallets</TableHead><TableHead className="text-right">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.items.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <Link href={`/admin/users/${user.id}`} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {user.firstName} {user.lastName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{user.telegramId}</TableCell>
                    <TableCell><Badge variant={user.isActive ? "success" : "secondary"}>{user.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="font-mono">{user.walletCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-xs text-muted-foreground">{formatDateTime(user.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <CursorPagination
              canGoBack={history.length > 0}
              canGoForward={Boolean(users.data.nextCursor)}
              onBack={() => {
                const nextHistory = history.slice(0, -1);
                setCursor(history[history.length - 1]);
                setHistory(nextHistory);
              }}
              onForward={() => {
                setHistory([...history, cursor]);
                setCursor(users.data.nextCursor);
              }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
