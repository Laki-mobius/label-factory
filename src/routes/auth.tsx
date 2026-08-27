import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/lib/auth";

const searchSchema = z.object({ next: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — LabelFactory" },
      { name: "description", content: "Sign in to your LabelFactory workspace to label documents." },
      { property: "og:title", content: "Sign in — LabelFactory" },
      {
        property: "og:description",
        content: "Sign in to your LabelFactory workspace to label documents.",
      },
    ],
  }),
  component: AuthPage,
});

function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && next !== "/auth" ? next : "/";
}

function AuthPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) {
      void navigate({ to: safeNext(next), replace: true });
    }
  }, [loading, session, navigate, next]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Account created. You can start working now.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setBusy(false);
      toast.error("Google sign-in failed. Please try again.");
      return;
    }
    if (result.redirected) return;
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="panel w-full max-w-sm p-6">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Layers className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight">LabelFactory</span>
        </div>

        <h1 className="mt-5 text-lg font-semibold tracking-tight">
          {mode === "signin" ? "Sign in" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "signin"
            ? "Access your labeling workspaces."
            : "Set up an account to start labeling documents."}
        </p>

        <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
          {mode === "signup" ? (
            <div className="space-y-1.5">
              <Label htmlFor="fullName" className="text-xs font-medium">
                Full name
              </Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="h-9 text-sm"
                autoComplete="name"
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs font-medium">
              Work email
            </Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-9 text-sm"
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs font-medium">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-9 text-sm"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </div>

          <Button type="submit" disabled={busy} className="h-9 w-full text-sm">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3 text-2xs uppercase tracking-wide text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-9 w-full text-sm"
          onClick={() => void handleGoogle()}
          disabled={busy}
        >
          Continue with Google
        </Button>

        <button
          type="button"
          className="mt-4 w-full rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        >
          {mode === "signin"
            ? "Don't have an account? Create one"
            : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
