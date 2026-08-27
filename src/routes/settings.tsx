import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, PlugZap, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell/AppShell";
import { workspaceTypeLabel } from "@/components/app-shell/nav-items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { saveConnector, testConnector } from "@/lib/connector.functions";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useWorkspace } from "@/lib/workspace";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — LabelFactory" },
      {
        name: "description",
        content:
          "Configure this project's AI model connector, review your account and workspace, and check backend status.",
      },
      { property: "og:title", content: "Settings — LabelFactory" },
      {
        property: "og:description",
        content: "Plug in a model provider, review workspace access and monitor backend health.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

const PROVIDERS = [
  { value: "openai", label: "OpenAI", kind: "hosted", auth: "bearer", base: "https://api.openai.com/v1" },
  {
    value: "anthropic",
    label: "Anthropic",
    kind: "hosted",
    auth: "x-api-key",
    base: "https://api.anthropic.com/v1",
  },
  { value: "azure", label: "Azure OpenAI", kind: "hosted", auth: "api-key", base: "" },
  {
    value: "google",
    label: "Google AI",
    kind: "hosted",
    auth: "bearer",
    base: "https://generativelanguage.googleapis.com/v1beta",
  },
  {
    value: "lovable",
    label: "Lovable AI Gateway",
    kind: "hosted",
    auth: "bearer",
    base: "https://ai.gateway.lovable.dev/v1",
  },
  { value: "self_hosted", label: "Self-hosted / local", kind: "self_hosted", auth: "bearer", base: "" },
] as const;

const AUTH_TYPES = [
  { value: "bearer", label: "Bearer token" },
  { value: "x-api-key", label: "x-api-key header" },
  { value: "api-key", label: "api-key header" },
  { value: "none", label: "No auth" },
];

type ConnectorRow = {
  id: string;
  name: string;
  kind: "hosted" | "self_hosted";
  provider: string;
  model_name: string;
  base_url: string | null;
  auth_type: string;
  custom_headers: unknown;
  api_key_hint: string | null;
  updated_at: string;
};

const FIELD = "h-8 text-xs";

function useBackendStatus() {
  return useQuery({
    queryKey: ["backend-status"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const started = Date.now();
      const { error } = await supabase.from("field_library").select("id").limit(1);
      if (error) throw error;
      return { latencyMs: Date.now() - started };
    },
  });
}

function SettingsPage() {
  const { user, isAdmin, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { projectId, activeProject } = useWorkspace();
  const queryClient = useQueryClient();
  const status = useBackendStatus();

  const connectorQuery = useQuery({
    queryKey: ["model-connector", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("model_connectors")
        .select(
          "id,name,kind,provider,model_name,base_url,auth_type,custom_headers,api_key_hint,updated_at",
        )
        .eq("project_id", projectId!)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as ConnectorRow | null) ?? null;
    },
  });

  const connector = connectorQuery.data ?? null;

  const [name, setName] = useState("Project model");
  const [provider, setProvider] = useState<string>("openai");
  const [modelName, setModelName] = useState("gpt-4o-mini");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [authType, setAuthType] = useState("bearer");
  const [headersText, setHeadersText] = useState("{}");
  const [probe, setProbe] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!connector) return;
    setName(connector.name);
    setProvider(connector.provider);
    setModelName(connector.model_name);
    setBaseUrl(connector.base_url ?? "");
    setAuthType(connector.auth_type);
    setHeadersText(JSON.stringify(connector.custom_headers ?? {}, null, 2));
    setApiKey("");
  }, [connector]);

  const headerParse = useMemo(() => {
    try {
      const parsed = JSON.parse(headersText || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: "Must be a JSON object of header name/value pairs.", value: {} };
      }
      const value: Record<string, string> = {};
      for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
        value[key] = String(entry);
      }
      return { error: null as string | null, value };
    } catch {
      return { error: "Invalid JSON.", value: {} as Record<string, string> };
    }
  }, [headersText]);

  const payload = () => ({
    projectId: projectId!,
    connectorId: connector?.id ?? null,
    name: name.trim() || "Project model",
    kind: (PROVIDERS.find((item) => item.value === provider)?.kind ?? "hosted") as
      | "hosted"
      | "self_hosted",
    provider,
    modelName: modelName.trim(),
    baseUrl: baseUrl.trim() || null,
    authType,
    apiKey: apiKey.trim() ? apiKey.trim() : null,
    customHeaders: headerParse.value,
  });

  const runTest = useServerFn(testConnector);
  const runSave = useServerFn(saveConnector);

  const testMutation = useMutation({
    mutationFn: async () => runTest({ data: payload() }),
    onSuccess: (result) => {
      setProbe({
        ok: true,
        message: `Reached ${result.endpoint} in ${result.latencyMs} ms${
          result.modelSeen === false ? ` — but "${modelName}" was not listed by the provider.` : "."
        }`,
      });
    },
    onError: (error) => {
      setProbe({ ok: false, message: error instanceof Error ? error.message : "Connection failed." });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => runSave({ data: payload() }),
    onSuccess: async () => {
      setApiKey("");
      await queryClient.invalidateQueries({ queryKey: ["model-connector", projectId] });
      toast.success("Connector saved", { description: "The API key is stored encrypted." });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save"),
  });

  const disabled = !projectId || !modelName.trim() || Boolean(headerParse.error);

  return (
    <AppShell title="Settings" showProjectSwitcher>
      <div className="grid max-w-4xl gap-3">
        <section className="panel p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
                <PlugZap className="size-4 text-primary" aria-hidden="true" />
                Plug in Model
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Configure the AI provider this project uses for prelabeling, suggestions and
                synthetic data.
              </p>
            </div>
          </div>

          {!projectId ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Select a project from the top bar to configure its connector.
            </p>
          ) : (
            <>
              {connectorQuery.isLoading ? (
                <div className="mt-4 flex justify-center py-6">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
                </div>
              ) : connector ? (
                <dl className="mt-4 grid gap-x-6 gap-y-2 rounded-md border border-border p-3 text-xs sm:grid-cols-2">
                  <Summary label="Provider" value={providerLabel(connector.provider)} />
                  <Summary label="Model" value={connector.model_name} />
                  <Summary label="API key" value={connector.api_key_hint ?? "Not set"} mono />
                  <Summary label="Auth type" value={authLabel(connector.auth_type)} />
                  <Summary label="Base URL" value={connector.base_url || "Provider default"} mono />
                  <Summary
                    label="Last updated"
                    value={new Date(connector.updated_at).toLocaleString()}
                  />
                </dl>
              ) : (
                <div className="mt-4 rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
                  No connector configured yet for{" "}
                  <span className="font-medium text-foreground">{activeProject?.name ?? "this project"}</span>
                  . Fill in the form below and test the connection before saving.
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Connector name" htmlFor="connector-name">
                  <Input
                    id="connector-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={FIELD}
                  />
                </Field>

                <Field label="Provider" htmlFor="connector-provider">
                  <Select
                    value={provider}
                    onValueChange={(value) => {
                      setProvider(value);
                      const preset = PROVIDERS.find((item) => item.value === value);
                      if (preset) {
                        setAuthType(preset.auth);
                        setBaseUrl(preset.base);
                      }
                    }}
                  >
                    <SelectTrigger id="connector-provider" className={cn(FIELD, "w-full")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map((item) => (
                        <SelectItem key={item.value} value={item.value} className="text-xs">
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Model name" htmlFor="connector-model">
                  <Input
                    id="connector-model"
                    value={modelName}
                    onChange={(event) => setModelName(event.target.value)}
                    placeholder="gpt-4o-mini"
                    className={FIELD}
                  />
                </Field>

                <Field label="Auth type" htmlFor="connector-auth">
                  <Select value={authType} onValueChange={setAuthType}>
                    <SelectTrigger id="connector-auth" className={cn(FIELD, "w-full")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTH_TYPES.map((item) => (
                        <SelectItem key={item.value} value={item.value} className="text-xs">
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field
                  label="API key"
                  htmlFor="connector-key"
                  hint={connector ? "Leave blank to keep the stored key" : "Stored encrypted, never shown again"}
                >
                  <Input
                    id="connector-key"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={connector?.api_key_hint ?? "sk-…"}
                    autoComplete="off"
                    className={FIELD}
                  />
                </Field>

                <Field label="Base URL" htmlFor="connector-base" hint="Blank uses the provider default">
                  <Input
                    id="connector-base"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://…"
                    className={FIELD}
                  />
                </Field>

                <div className="sm:col-span-2">
                  <Field
                    label="Headers / template config (JSON)"
                    htmlFor="connector-headers"
                    hint={headerParse.error ?? undefined}
                    invalid={Boolean(headerParse.error)}
                  >
                    <Textarea
                      id="connector-headers"
                      value={headersText}
                      onChange={(event) => setHeadersText(event.target.value)}
                      rows={5}
                      spellCheck={false}
                      className="min-h-24 font-mono text-xs"
                    />
                  </Field>
                </div>
              </div>

              {probe ? (
                <div
                  className={cn(
                    "mt-3 flex items-start gap-2 rounded-md border p-2.5 text-xs",
                    probe.ok
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-destructive/40 bg-destructive/10 text-destructive",
                  )}
                  role="status"
                >
                  {probe.ok ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="break-words">{probe.message}</span>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  disabled={disabled || testMutation.isPending}
                  onClick={() => {
                    setProbe(null);
                    testMutation.mutate();
                  }}
                >
                  {testMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : null}
                  Test connection
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  disabled={disabled || saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : null}
                  Save connector
                </Button>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-2xs text-muted-foreground">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                API keys are encrypted with the platform vault key before storage and are never sent
                back to the browser.
              </p>
            </>
          )}
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          <section className="panel p-5">
            <h2 className="text-base font-semibold tracking-tight">Account</h2>
            <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-y-2 text-xs">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate">{user?.email}</dd>
              <dt className="text-muted-foreground">Role</dt>
              <dd>{isAdmin ? "Administrator" : "Member"}</dd>
            </dl>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 h-8 text-xs"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </section>

          <section className="panel p-5">
            <h2 className="text-base font-semibold tracking-tight">Workspace</h2>
            <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-y-2 text-xs">
              <dt className="text-muted-foreground">Project</dt>
              <dd className="truncate">{activeProject?.name ?? "No project selected"}</dd>
              <dt className="text-muted-foreground">Industry</dt>
              <dd>{activeProject ? workspaceTypeLabel(activeProject.workspace_type) : "—"}</dd>
              <dt className="text-muted-foreground">Data access</dt>
              <dd>
                <Badge
                  variant="outline"
                  className="rounded-full px-2 py-0 text-2xs font-medium text-muted-foreground"
                >
                  {isAdmin ? "Admin-wide (all projects)" : "Personal workspace scope"}
                </Badge>
              </dd>
            </dl>
            <p className="mt-3 text-2xs text-muted-foreground">
              {isAdmin
                ? "Your admin role lets you read and manage every project on the platform."
                : "You only see projects you own or have been added to."}
            </p>
          </section>

          <section className="panel p-5">
            <h2 className="text-base font-semibold tracking-tight">System Status</h2>
            <div className="mt-3 flex items-center gap-2 text-xs">
              {status.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">Checking backend…</span>
                </>
              ) : status.isError ? (
                <>
                  <span className="size-2 rounded-full bg-destructive" aria-hidden="true" />
                  <span className="font-medium text-destructive">Unavailable</span>
                </>
              ) : (
                <>
                  <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                  <span className="font-medium text-primary">Connected</span>
                  <span className="text-muted-foreground">· {status.data?.latencyMs} ms</span>
                </>
              )}
            </div>
            <p className="mt-2 text-2xs text-muted-foreground">
              {status.isError
                ? String((status.error as Error)?.message ?? "The backend API did not respond.")
                : "Re-checked automatically every 30 seconds."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 h-8 text-xs"
              onClick={() => void status.refetch()}
            >
              Re-check now
            </Button>
          </section>

          <section className="panel p-5">
            <h2 className="text-base font-semibold tracking-tight">Appearance</h2>
            <p className="mt-1 text-xs text-muted-foreground">Currently using the {theme} theme.</p>
            <Button variant="outline" size="sm" className="mt-4 h-8 text-xs" onClick={toggleTheme}>
              Switch to {theme === "dark" ? "light" : "dark"} theme
            </Button>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function providerLabel(value: string) {
  return PROVIDERS.find((item) => item.value === value)?.label ?? value;
}

function authLabel(value: string) {
  return AUTH_TYPES.find((item) => item.value === value)?.label ?? value;
}

function Summary({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  invalid,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {hint ? (
        <p className={cn("text-2xs", invalid ? "text-destructive" : "text-muted-foreground")}>{hint}</p>
      ) : null}
    </div>
  );
}
