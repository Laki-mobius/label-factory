import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({ documentId: z.string().uuid() });

export const prelabelDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data, context }) => {
    const { runPrelabel } = await import("./prelabel.run.server");
    return runPrelabel(context.supabase, data.documentId);
  });
