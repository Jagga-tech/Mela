import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { z } from "zod";
import type { Store } from "@/lib/store";

// Read-only tools: agents can query vendors but never write.
export function makeDbTools(store: Store): BetaRunnableTool<any>[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  return [
    betaZodTool({
      name: "search_vendors",
      description: "List vendors in a category. If minCapacity is given, keeps vendors whose capacity is unknown (null) or at least minCapacity.",
      inputSchema: z.object({ category: z.enum(["venue", "catering", "decor"]), minCapacity: z.number().optional() }),
      run: async ({ category, minCapacity }) =>
        JSON.stringify((await store.listVendors(category)).filter((v) => minCapacity === undefined || v.capacity === null || v.capacity >= minCapacity)),
    }),
    betaZodTool({
      name: "get_vendor",
      description: "Get one vendor by id.",
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => {
        const v = await store.getVendor(id);
        return v ? JSON.stringify(v) : "not found";
      },
    }),
  ];
}
