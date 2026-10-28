import { Rpc } from "@opencode/plugin/rpc"
import { z } from "zod"

export const usageSchema = z.object({
  providers: z.array(z.object({
    name: z.string(),
    account: z.string().optional(),
    id: z.string().optional(),
    integrationID: z.string().optional(),
    error: z.string().optional(),
    summaryPace: z.enum(["window", "worst"]).optional(),
    windows: z.array(z.object({
      label: z.string().optional(),
      usedPercent: z.number(),
      durationSeconds: z.number().optional(),
      resetsAt: z.number(),
      summary: z.boolean().optional(),
    })).optional(),
  })).optional(),
  error: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const Usage = Rpc.define({
  id: "usage-bars",
  methods: { get: { input: z.object({}), output: usageSchema } },
  events: {},
})
