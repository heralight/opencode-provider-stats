import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  aggregateEntries,
  filterEntries,
  renderAggregateTable,
  type ProviderStatEntry,
} from "./stats.js"

const DATA_DIR = path.join(os.homedir(), ".opencode")
const DATA_FILE = path.join(DATA_DIR, "provider-stats.jsonl")

function ensureDataFile(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "", { mode: 0o600 })
  try {
    fs.chmodSync(DATA_FILE, 0o600)
  } catch {
    // Some filesystems do not support POSIX modes. Logging still remains local.
  }
}

function appendEntry(entry: ProviderStatEntry): void {
  ensureDataFile()
  fs.appendFileSync(DATA_FILE, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 })
}

function readEntries(): ProviderStatEntry[] {
  if (!fs.existsSync(DATA_FILE)) return []

  return fs
    .readFileSync(DATA_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as ProviderStatEntry]
      } catch {
        return []
      }
    })
}

const providerStatsTool = tool({
  description:
    "Query locally recorded LLM provider/model performance statistics. Returns aggregate TTFT, TPS, latency, token usage, and cost. No prompts or responses are stored.",
  args: {
    provider: tool.schema.string().optional().describe("Provider filter, for example 'baseten' or 'openrouter'."),
    model: tool.schema.string().optional().describe("Model filter, using a partial case-insensitive match."),
    last: tool.schema.number().int().positive().optional().describe("Only aggregate the last N matching requests."),
    raw: tool.schema.boolean().optional().describe("Return matching raw metric records instead of aggregates."),
  },
  async execute(args) {
    const entries = filterEntries(readEntries(), {
      provider: args.provider,
      model: args.model,
      last: args.last,
    })

    if (args.raw) return JSON.stringify(entries, null, 2)
    return renderAggregateTable(aggregateEntries(entries))
  },
})

export const ProviderStatsPlugin: Plugin = async ({ client }) => {
  const firstPartTime = new Map<string, number>()

  return {
    tool: {
      provider_stats: providerStatsTool,
    },

    event: async ({ event }) => {
      if (event.type === "message.part.updated") {
        const part = (event.properties as any).part as any
        if (!part?.messageID) return

        if ((part.type === "text" || part.type === "reasoning") && part.time?.start && !firstPartTime.has(part.messageID)) {
          firstPartTime.set(part.messageID, part.time.start)
        }
        return
      }

      if (event.type === "message.removed") {
        const properties = event.properties as any
        const messageID = properties?.info?.id ?? properties?.messageID
        if (messageID) firstPartTime.delete(messageID)
        return
      }

      if (event.type === "session.error") {
        firstPartTime.clear()
        return
      }

      if (event.type !== "message.updated") return
      const info = event.properties.info as any
      if (info?.role !== "assistant" || !info.time?.completed) return

      const messageID = info.id as string
      const created = info.time.created as number | undefined
      const completed = info.time.completed as number | undefined
      if (!created || !completed || completed < created) {
        firstPartTime.delete(messageID)
        return
      }

      const firstPart = firstPartTime.get(messageID)
      const latencyMs = completed - created
      const ttftMs = firstPart && firstPart >= created ? firstPart - created : null
      const outputTokens = Number(info.tokens?.output ?? 0)
      const generationMs = firstPart && firstPart < completed ? completed - firstPart : latencyMs
      const tps = generationMs > 0 && outputTokens > 0 ? (outputTokens / generationMs) * 1000 : null

      const entry: ProviderStatEntry = {
        ts: new Date(completed).toISOString(),
        providerID: String(info.providerID ?? "unknown"),
        modelID: String(info.modelID ?? "unknown"),
        ttft_ms: ttftMs,
        tps,
        latency_ms: latencyMs,
        inputTokens: Number(info.tokens?.input ?? 0),
        outputTokens,
        reasoningTokens: Number(info.tokens?.reasoning ?? 0),
        cacheReadTokens: Number(info.tokens?.cache?.read ?? 0),
        cacheWriteTokens: Number(info.tokens?.cache?.write ?? 0),
        cost: Number(info.cost ?? 0),
        finish: typeof info.finish === "string" ? info.finish : undefined,
      }

      try {
        appendEntry(entry)
      } catch (error) {
        try {
          await client.app.log({
            body: {
              service: "opencode-provider-stats",
              level: "warn",
              message: "Failed to persist provider statistics",
              extra: { error: error instanceof Error ? error.message : String(error) },
            },
          })
        } catch {
          // Statistics must never interfere with an OpenCode session.
        }
      } finally {
        firstPartTime.delete(messageID)
      }
    },
  }
}

export default ProviderStatsPlugin
