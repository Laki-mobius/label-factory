import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Drop a JPEG at public/login-background.jpg to replace the brand-gradient
 *  panel on the login screen with a photo. Missing file (404) silently falls
 *  back to the default gradient — see the onError/onLoad probe below. */
const LOGIN_BACKGROUND_SRC = "/login-background.jpg";

const searchSchema = z.object({ next: z.string().optional() });

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Label Factory | AI Data Labelling & Feedback Platform" },
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
  const [showPassword, setShowPassword] = useState(false);
  const [hasCustomBg, setHasCustomBg] = useState(false);

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
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Account created. You can start working now.");
        } else {
          toast.success("Account created. Check your email to confirm before signing in.");
          setMode("signin");
        }
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
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-primary-soft p-10 lg:flex">
        {/* Custom background photo (public/login-background.jpg), if present.
            Hidden until it loads so a missing file never flashes a broken
            image; onError leaves hasCustomBg false and the gradient below
            (still in the DOM) shows through untouched. */}
        <img
          src={LOGIN_BACKGROUND_SRC}
          alt=""
          aria-hidden="true"
          onLoad={() => setHasCustomBg(true)}
          onError={() => setHasCustomBg(false)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover",
            !hasCustomBg && "hidden",
          )}
        />
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0",
            hasCustomBg
              ? "bg-gradient-to-b from-black/10 via-black/25 to-black/60"
              : "bg-gradient-to-br from-primary/20 via-transparent to-primary/5",
          )}
        />
        <div className="relative flex items-center gap-3">
          <img
            src="/logo.png"
            alt="LabelFactory"
            className="size-10 shrink-0 rounded-md object-contain"
          />
          <div>
            <div
              className={cn(
                "text-base font-semibold tracking-tight",
                hasCustomBg ? "text-white" : "text-primary-soft-foreground",
              )}
            >
              LabelFactory
            </div>
            <div className={cn("text-xs", hasCustomBg ? "text-white/70" : "text-primary-soft-foreground/70")}>
              Platform
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2
            className={cn(
              "text-3xl font-semibold leading-tight tracking-tight",
              hasCustomBg ? "text-white" : "text-primary-soft-foreground",
            )}
          >
            Turning raw documents into structured, trustworthy data
          </h2>
          <p className={cn("mt-4 text-sm", hasCustomBg ? "text-white/80" : "text-primary-soft-foreground/80")}>
            AI-assisted labelling, human review, and RLHF feedback in one workspace.
          </p>
        </div>

        <div className={cn("relative text-xs", hasCustomBg ? "text-white/70" : "text-primary-soft-foreground/70")}>
          LabelFactory Platform
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 lg:hidden">
            <img
              src="/logo.png"
              alt="LabelFactory"
              className="size-7 shrink-0 rounded-md object-contain"
            />
            <span className="text-sm font-semibold tracking-tight">LabelFactory</span>
          </div>

          <h1 className="mt-5 text-2xl font-semibold tracking-tight lg:mt-0">
            {mode === "signin" ? "Login" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Sign in to your LabelFactory workspace."
              : "Set up an account to start labeling documents."}
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            {mode === "signup" ? (
              <div className="space-y-1.5">
                <Label htmlFor="fullName" className="text-xs font-medium">
                  Full name
                </Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="h-10 text-sm"
                  autoComplete="name"
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                required
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-10 bg-surface text-sm"
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-10 bg-surface pr-10 text-sm"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" disabled={busy} className="h-10 w-full text-sm">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {mode === "signin" ? "Login" : "Create account"}
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
            className="h-10 w-full text-sm"
            onClick={() => void handleGoogle()}
            disabled={busy}
          >
            Continue with Google
          </Button>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Don't have access? Contact your workspace administrator.
          </p>

          <button
            type="button"
            className="mt-3 w-full rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin"
              ? "Don't have an account? Create one"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
