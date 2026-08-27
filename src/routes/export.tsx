import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SectionPage } from "@/components/app-shell/SectionPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useProjectDashboard } from "@/lib/dashboard-data";
import {
  EXPORT_FORMATS,
  downloadText,
  serializeDocuments,
  useApprovedDocuments,
  type ExportFormatId,
} from "@/lib/export-data";
import { sendWebhook } from "@/lib/webhooks.functions";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/export")({
  head: () => ({
    meta: [
      { title: "Export & Integrations — LabelFactory" },
      {
        name: "description",
        content:
          "Download approved extractions as JSON, CSV or COCO-style datasets and stream them to your own systems with outbound webhooks.",
      },
      { property: "og:title", content: "Export & Integrations — LabelFactory" },
      {
        property: "og:description",
        content:
          "Preview and export reviewed document data, then configure webhooks with test payloads and delivery history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <SectionPage
      title="Export & Integrations"
      description="Ship reviewed, structured data out of LabelFactory — as a file download, or pushed to your systems over webhooks."
    >
      <ExportBody />
    </SectionPage>
  ),
});

/** Shared input sizing so secondary-screen fields match the rest of the app. */
const inputClass = "mt-1 h-8 text-sm";

function ExportBody() {
  return (
    <Tabs defaultValue="export" className="space-y-4">
      <TabsList className="h-8">
        <TabsTrigger value="export" className="h-6 px-3 text-xs">
          Export
        </TabsTrigger>
        <TabsTrigger value="integrations" className="h-6 px-3 text-xs">
          Integrations
        </TabsTrigger>
      </TabsList>
      <TabsContent value="export" className="space-y-4">
        <ExportPanel />
      </TabsContent>
      <TabsContent value="integrations" className="space-y-4">
        <IntegrationsPanel />
      </TabsContent>
    </Tabs>
  );
}

function ExportPanel() {
  const { projectId } = useWorkspace();
  const dashboard = useProjectDashboard(projectId);
  const [batchId, setBatchId] = useState("all");
  const [format, setFormat] = useState<ExportFormatId>("json");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [exportName, setExportName] = useState("");

  const documentsQuery = useApprovedDocuments(projectId, batchId);
  const documents = useMemo(() => documentsQuery.data ?? [], [documentsQuery.data]);
  const chosen = useMemo(() => {
    const anySelected = Object.values(selected).some(Boolean);
    return anySelected ? documents.filter((doc) => selected[doc.id]) : documents;
  }, [documents, selected]);

  const preview = useMemo(
    () => serializeDocuments(chosen.slice(0, 1), format),
    [chosen, format],
  );

  const webhooksQuery = useQuery({
    queryKey: ["webhooks", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhooks")
        .select("id, name, enabled, events")
        .eq("project_id", projectId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const send = useServerFn(sendWebhook);
  const sendExport = useMutation({
    mutationFn: async () => {
      const targets = (webhooksQuery.data ?? []).filter(
        (hook) => hook.enabled && hook.events.includes("export.completed"),
      );
      if (targets.length === 0) throw new Error("No enabled webhook listens for export.completed.");
      const results = await Promise.all(
        targets.map((hook) =>
          send({
            data: {
              webhookId: hook.id,
              event: "export.completed",
              isTest: false,
              payload: {
                format,
                document_count: chosen.length,
                documents: chosen.slice(0, 50).map((doc) => ({
                  id: doc.id,
                  filename: doc.filename,
                  batch: doc.batchName,
                  fields: Object.fromEntries(doc.fields.map((f) => [f.key, f.value])),
                })),
              },
            },
          }),
        ),
      );
      return results.filter((result) => result.success).length;
    },
    onSuccess: (ok) => toast.success(`Export payload delivered to ${ok} endpoint(s)`),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Send failed"),
  });

  const batches = dashboard.data?.batches ?? [];

  return (
    <>
      <div className="panel flex flex-wrap items-end gap-3 p-3">
        <div>
          <Label htmlFor="export-batch" className="text-xs">
            Batch
          </Label>
          <Select value={batchId} onValueChange={(value) => { setBatchId(value); setSelected({}); }}>
            <SelectTrigger id="export-batch" className="mt-1 h-8 w-56 text-sm">
              <SelectValue placeholder="All batches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-sm">
                All batches
              </SelectItem>
              {batches.map((batch) => (
                <SelectItem key={batch.id} value={batch.id} className="text-sm">
                  {batch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="export-format" className="text-xs">
            Format
          </Label>
          <Select value={format} onValueChange={(value) => setFormat(value as ExportFormatId)}>
            <SelectTrigger id="export-format" className="mt-1 h-8 w-56 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPORT_FORMATS.map((entry) => (
                <SelectItem key={entry.id} value={entry.id} className="text-sm">
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="export-name" className="text-xs">
            File name
          </Label>
          <Input
            id="export-name"
            value={exportName}
            onChange={(event) => setExportName(event.target.value)}
            placeholder="approved-records"
            className={`${inputClass} w-56`}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={chosen.length === 0 || sendExport.isPending}
            onClick={() => sendExport.mutate()}
          >
            {sendExport.isPending ? (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 size-3.5" />
            )}
            Send to webhooks
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={chosen.length === 0}
            onClick={() => {
              downloadText(
                serializeDocuments(chosen, format),
                exportName.trim() || "approved-records",
                format,
              );
              toast.success(`Exported ${chosen.length} document(s) as ${format.toUpperCase()}`);
            }}
          >
            <Download className="mr-1.5 size-3.5" />
            Download export
          </Button>
        </div>
        <p className="w-full text-xs text-muted-foreground">
          {EXPORT_FORMATS.find((entry) => entry.id === format)?.hint} ·{" "}
          {chosen.length} approved document(s) in scope.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel">
          <div className="border-b border-border/60 px-4 py-3">
            <h2 className="text-sm font-semibold tracking-tight">Approved documents</h2>
            <p className="text-xs text-muted-foreground">
              Select rows to narrow the export, or leave all unchecked to export everything in scope.
            </p>
          </div>
          {documentsQuery.isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No approved documents yet. Approve documents in Annotate &amp; Label to export them.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="text-xs">Document</TableHead>
                  <TableHead className="text-xs">Batch</TableHead>
                  <TableHead className="text-xs">Fields</TableHead>
                  <TableHead className="text-xs">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell className="py-2">
                      <input
                        type="checkbox"
                        aria-label={`Include ${doc.filename}`}
                        checked={Boolean(selected[doc.id])}
                        onChange={(event) =>
                          setSelected((prev) => ({ ...prev, [doc.id]: event.target.checked }))
                        }
                        className="size-3.5 accent-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate py-2 text-xs">
                      {doc.filename}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-muted-foreground">
                      {doc.batchName}
                    </TableCell>
                    <TableCell className="py-2 text-xs tabular-nums">{doc.fields.length}</TableCell>
                    <TableCell className="py-2">
                      <Badge variant={doc.isSynthetic ? "secondary" : "outline"} className="text-[10px]">
                        {doc.isSynthetic ? "Synthetic" : "Uploaded"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="panel">
          <div className="border-b border-border/60 px-4 py-3">
            <h2 className="text-sm font-semibold tracking-tight">Sample record preview</h2>
            <p className="text-xs text-muted-foreground">
              First record as it will appear in the {format.toUpperCase()} output.
            </p>
          </div>
          <pre className="max-h-[26rem] overflow-auto px-4 py-3 text-[11px] leading-relaxed">
            {chosen.length === 0 ? "Nothing in scope yet." : preview}
          </pre>
        </div>
      </div>
    </>
  );
}

type HeaderPair = { key: string; value: string };

function IntegrationsPanel() {
  const { projectId } = useWorkspace();
  const queryClient = useQueryClient();
  const send = useServerFn(sendWebhook);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [authHeader, setAuthHeader] = useState("Authorization");
  const [headers, setHeaders] = useState<HeaderPair[]>([{ key: "", value: "" }]);
  const [onApproved, setOnApproved] = useState(true);
  const [onExported, setOnExported] = useState(true);
  const [testResult, setTestResult] = useState<null | {
    name: string;
    request: string;
    requestHeaders: Record<string, string>;
    status: number | null;
    success: boolean;
    response: string;
    error: string | null;
    durationMs: number;
  }>(null);

  const webhooksQuery = useQuery({
    queryKey: ["webhooks", projectId],
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhooks")
        .select("id, name, url, enabled, events, created_at")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const deliveriesQuery = useQuery({
    queryKey: ["webhook-deliveries", projectId],
    enabled: Boolean(projectId),
    refetchInterval: 20000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("webhook_deliveries")
        .select("id, webhook_id, event, is_test, success, response_status, error_message, duration_ms, created_at")
        .eq("project_id", projectId!)
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });

  const resetForm = () => {
    setName("");
    setUrl("");
    setToken("");
    setAuthHeader("Authorization");
    setHeaders([{ key: "", value: "" }]);
    setOnApproved(true);
    setOnExported(true);
  };

  const createWebhook = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("No active project.");
      if (!name.trim()) throw new Error("Give the webhook a name.");
      let parsed: URL;
      try {
        parsed = new URL(url.trim());
      } catch {
        throw new Error("Enter a valid absolute URL (https://…).");
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("Webhook URLs must use http or https.");
      }
      const events = [
        ...(onApproved ? ["document.approved"] : []),
        ...(onExported ? ["export.completed"] : []),
      ];
      if (events.length === 0) throw new Error("Pick at least one trigger event.");
      const custom = Object.fromEntries(
        headers.filter((pair) => pair.key.trim()).map((pair) => [pair.key.trim(), pair.value]),
      );
      const { error } = await supabase.from("webhooks").insert({
        project_id: projectId,
        name: name.trim(),
        url: parsed.toString(),
        auth_token: token.trim() || null,
        auth_header: authHeader.trim() || "Authorization",
        custom_headers: custom as unknown as never,
        events,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setOpen(false);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["webhooks", projectId] });
      toast.success("Webhook saved");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save webhook"),
  });

  const toggleWebhook = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from("webhooks").update({ enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhooks", projectId] }),
  });

  const deleteWebhook = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("webhooks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["webhooks", projectId] });
      toast.success("Webhook removed");
    },
  });

  const testWebhook = useMutation({
    mutationFn: async (hook: { id: string; name: string }) => {
      const result = await send({
        data: {
          webhookId: hook.id,
          event: "webhook.test",
          isTest: true,
          payload: {
            message: "Test payload from LabelFactory",
            project_id: projectId,
            sample_document: {
              filename: "sample-document.pdf",
              fields: { document_number: "DOC-1024", total_amount: "1,240.00" },
            },
          },
        },
      });
      return { hook, result };
    },
    onSuccess: async ({ hook, result }) => {
      setTestResult({
        name: hook.name,
        request: result.requestBody,
        requestHeaders: result.requestHeaders,
        status: result.status,
        success: result.success,
        response: result.responseBody,
        error: result.errorMessage,
        durationMs: result.durationMs,
      });
      await queryClient.invalidateQueries({ queryKey: ["webhook-deliveries", projectId] });
      if (result.success) toast.success("Test payload delivered");
      else toast.error(result.errorMessage ?? "Test delivery failed");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Test failed"),
  });

  const webhooks = webhooksQuery.data ?? [];
  const webhookNames = new Map(webhooks.map((hook) => [hook.id, hook.name]));

  return (
    <>
      <div className="panel flex items-center justify-between px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Outbound webhooks</h2>
          <p className="text-xs text-muted-foreground">
            Fire a signed JSON POST to your systems when documents are approved or an export completes.
          </p>
        </div>
        <Button size="sm" className="h-8 text-xs" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-3.5" />
          New webhook
        </Button>
      </div>

      <div className="panel">
        {webhooksQuery.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : webhooks.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No endpoints configured yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">URL</TableHead>
                <TableHead className="text-xs">Events</TableHead>
                <TableHead className="text-xs">Enabled</TableHead>
                <TableHead className="text-right text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.map((hook) => (
                <TableRow key={hook.id}>
                  <TableCell className="py-2 text-xs font-medium">{hook.name}</TableCell>
                  <TableCell className="max-w-[18rem] truncate py-2 text-xs text-muted-foreground">
                    {hook.url}
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {hook.events.map((event) => (
                        <Badge key={event} variant="outline" className="text-[10px]">
                          {event}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="py-2">
                    <Switch
                      checked={hook.enabled}
                      aria-label={`Enable ${hook.name}`}
                      onCheckedChange={(checked) =>
                        toggleWebhook.mutate({ id: hook.id, enabled: checked })
                      }
                    />
                  </TableCell>
                  <TableCell className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      className="mr-2 h-7 text-xs"
                      disabled={testWebhook.isPending}
                      onClick={() => testWebhook.mutate({ id: hook.id, name: hook.name })}
                    >
                      {testWebhook.isPending ? (
                        <Loader2 className="mr-1.5 size-3 animate-spin" />
                      ) : (
                        <Send className="mr-1.5 size-3" />
                      )}
                      Send test payload
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      aria-label={`Delete ${hook.name}`}
                      onClick={() => deleteWebhook.mutate(hook.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="panel">
        <div className="border-b border-border/60 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">Recent deliveries</h2>
          <p className="text-xs text-muted-foreground">Last 25 attempts, newest first.</p>
        </div>
        {(deliveriesQuery.data ?? []).length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No deliveries recorded yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">When</TableHead>
                <TableHead className="text-xs">Endpoint</TableHead>
                <TableHead className="text-xs">Event</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Duration</TableHead>
                <TableHead className="text-xs">Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(deliveriesQuery.data ?? []).map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell className="py-2 text-xs text-muted-foreground">
                    {new Date(delivery.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="py-2 text-xs">
                    {webhookNames.get(delivery.webhook_id) ?? "Deleted endpoint"}
                  </TableCell>
                  <TableCell className="py-2 text-xs">
                    {delivery.event}
                    {delivery.is_test ? (
                      <Badge variant="secondary" className="ml-1.5 text-[10px]">
                        test
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="py-2">
                    <Badge
                      variant={delivery.success ? "default" : "destructive"}
                      className="rounded-full text-[10px]"
                    >
                      {delivery.success ? `OK ${delivery.response_status ?? ""}` : "Failed"}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-2 text-xs tabular-nums">
                    {delivery.duration_ms ?? 0} ms
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate py-2 text-xs text-muted-foreground">
                    {delivery.error_message ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">New outbound webhook</DialogTitle>
            <DialogDescription className="text-xs">
              LabelFactory will POST JSON to this endpoint for the events you select. Credentials are
              redacted in delivery history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="hook-name" className="text-xs">
                Name
              </Label>
              <Input
                id="hook-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Claims warehouse"
                className={inputClass}
              />
            </div>
            <div>
              <Label htmlFor="hook-url" className="text-xs">
                Endpoint URL
              </Label>
              <Input
                id="hook-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://api.example.com/labelfactory"
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="hook-auth-header" className="text-xs">
                  Auth header
                </Label>
                <Input
                  id="hook-auth-header"
                  value={authHeader}
                  onChange={(event) => setAuthHeader(event.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <Label htmlFor="hook-token" className="text-xs">
                  Auth token
                </Label>
                <Input
                  id="hook-token"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="sk_live_…"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Custom headers</Label>
              <div className="mt-1 space-y-2">
                {headers.map((pair, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={pair.key}
                      aria-label={`Header ${index + 1} key`}
                      placeholder="X-Tenant-Id"
                      onChange={(event) =>
                        setHeaders((prev) =>
                          prev.map((item, i) =>
                            i === index ? { ...item, key: event.target.value } : item,
                          ),
                        )
                      }
                      className="h-8 text-sm"
                    />
                    <Input
                      value={pair.value}
                      aria-label={`Header ${index + 1} value`}
                      placeholder="acme"
                      onChange={(event) =>
                        setHeaders((prev) =>
                          prev.map((item, i) =>
                            i === index ? { ...item, value: event.target.value } : item,
                          ),
                        )
                      }
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setHeaders((prev) => [...prev, { key: "", value: "" }])}
                >
                  <Plus className="mr-1.5 size-3" />
                  Add header
                </Button>
              </div>
            </div>
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <p className="text-xs font-medium">Trigger events</p>
              <label className="flex items-center justify-between text-xs">
                Document approved
                <Switch
                  checked={onApproved}
                  onCheckedChange={setOnApproved}
                  aria-label="Fire on document approved"
                />
              </label>
              <label className="flex items-center justify-between text-xs">
                Export completed
                <Switch
                  checked={onExported}
                  onCheckedChange={setOnExported}
                  aria-label="Fire on export completed"
                />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={createWebhook.isPending}
              onClick={() => createWebhook.mutate()}
            >
              {createWebhook.isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              Save webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(testResult)} onOpenChange={(next) => !next && setTestResult(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Test delivery — {testResult?.name}</DialogTitle>
            <DialogDescription className="text-xs">
              The exact request LabelFactory sent and the response your endpoint returned.
            </DialogDescription>
          </DialogHeader>
          {testResult ? (
            <div className="space-y-3 text-xs">
              <div className="flex items-center gap-2">
                <Badge
                  variant={testResult.success ? "default" : "destructive"}
                  className="rounded-full text-[10px]"
                >
                  {testResult.success ? `HTTP ${testResult.status}` : "Failed"}
                </Badge>
                <span className="text-muted-foreground">{testResult.durationMs} ms</span>
                {testResult.error ? (
                  <span className="text-destructive">{testResult.error}</span>
                ) : null}
              </div>
              <div>
                <p className="mb-1 font-medium">Request headers</p>
                <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-[11px]">
                  {JSON.stringify(testResult.requestHeaders, null, 2)}
                </pre>
              </div>
              <div>
                <p className="mb-1 font-medium">Request body</p>
                <pre className="max-h-48 overflow-auto rounded-md bg-muted p-2 text-[11px]">
                  {testResult.request}
                </pre>
              </div>
              <div>
                <p className="mb-1 font-medium">Response body</p>
                <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-[11px]">
                  {testResult.response || "(empty)"}
                </pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
