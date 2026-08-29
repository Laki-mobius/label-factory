import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({});

/**
 * Read-only status of the currently active AI provider (BYOK: OpenAI
 * primary, Gemini fallback). Used to show a status indicator in place of a
 * per-profile model picker — this setup has no meaningful per-profile model
 * choice, only one active provider at a time.
 */
export const getActiveAiProvider = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async () => {
    const { activeProviderInfo } = await import("./ai-provider.server");
    return activeProviderInfo();
  });
