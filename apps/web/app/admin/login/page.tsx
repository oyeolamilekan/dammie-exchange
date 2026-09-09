"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockKeyholeIcon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { adminRequest, type AdminIdentity } from "@/lib/admin-api";
import { AdminThemeToggle } from "@/components/admin/admin-theme";

export default function AdminLoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).get("expired") === "1");
  }, []);
  const login = useMutation({
    mutationFn: () => adminRequest<{ admin: AdminIdentity; expiresAt: string }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
      { redirectOnUnauthorized: false },
    ),
    onSuccess: async (data) => {
      queryClient.setQueryData(["admin-session"], { admin: data.admin });
      router.replace("/admin");
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };

  return (
    <main className="admin-theme grid min-h-svh bg-background lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-9 grid-cols-2 gap-0.5 rounded-md bg-primary-foreground/15 p-2" aria-hidden="true">
            <span className="rounded-[1px] bg-current" /><span className="rounded-[1px] bg-current opacity-40" />
            <span className="rounded-[1px] bg-current opacity-40" /><span className="rounded-[1px] bg-current" />
          </div>
          <span className="font-semibold tracking-tight">Dammie operations</span>
        </div>
        <div className="max-w-lg">
          <p className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-primary-foreground/65">Control ledger / 01</p>
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-[-0.04em]">Every balance has a before and an after.</h1>
          <p className="mt-6 max-w-md text-base leading-7 text-primary-foreground/70">
            Inspect account movement, transaction health, customer conversations, and supported asset configuration.
          </p>
        </div>
        <p className="font-mono text-xs text-primary-foreground/55">SESSION WINDOW · 12 HOURS</p>
      </section>
      <section className="relative flex items-center justify-center px-6 pb-6 pt-20 md:px-10 md:pb-10">
        <div className="absolute right-6 top-6"><AdminThemeToggle /></div>
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-secondary text-primary">
              <ShieldCheckIcon className="size-5" />
            </div>
            <CardTitle className="text-2xl tracking-tight">Operations sign in</CardTitle>
            <CardDescription>Use your administrator credentials to open the operations console.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit}>
              <FieldGroup>
                {expired && (
                  <Alert>
                    <LockKeyholeIcon />
                    <AlertTitle>Session ended</AlertTitle>
                    <AlertDescription>Sign in again to continue reviewing operations.</AlertDescription>
                  </Alert>
                )}
                <Field>
                  <FieldLabel htmlFor="admin-email">Email</FieldLabel>
                  <Input
                    id="admin-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    aria-invalid={login.isError}
                    placeholder="admin@dammie.ai"
                  />
                </Field>
                <Field data-invalid={login.isError || undefined}>
                  <FieldLabel htmlFor="admin-password">Password</FieldLabel>
                  <Input
                    id="admin-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    aria-invalid={login.isError}
                  />
                  {login.isError && <FieldError>{login.error.message}</FieldError>}
                </Field>
                <Button type="submit" disabled={login.isPending} className="w-full">
                  {login.isPending && <Spinner data-icon="inline-start" />}
                  {login.isPending ? "Signing in…" : "Sign in"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
