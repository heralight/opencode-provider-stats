import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type ProviderStatEntry = {
  ts: string
  providerID: string
  modelID: string
  ttft_ms: number | null
  tps: number | null
  latency_ms: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  finish?: string
}

type Aggregate = {
  providerID: string
  modelID: string
  count: number
  avgTTFT: number | null
  minTTFT: number | null
  maxTTFT: number | null
  avgTPS: number | null
  minTPS: number | null
  maxTPS: number | null
  avgLatency: number | null
  minLatency: number | null
  maxLatency: number | null
  totalInputTokens: number
  totalOutputTokens: number
  totalReasoningTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  totalCost: number
}

function dataFile(): string {
  return (
    process.env.OPENCODE_PROVIDER_STATS_FILE ??
    path.join(os.homedir(), ".opencode", "provider-stats.jsonl")
  )
}

function ensureDataFile(): void {
  const file = dataFile()
  const dir = path.dirname(file)

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, "", { mode: 0o600 })
  }

  try {
    fs.chmodSync(file, 0o600)
  } catch {
    // Some filesystems do not support POSIX modes.
  }
}

function appendEntry(entry: ProviderStatEntry): void {
  ensureDataFile()

  fs.appendFileSync(
    dataFile(),
    `${JSON.stringify(entry)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  )
}

function readEntries(): ProviderStatEntry[] {
  const file = dataFile()

  if (!fs.existsSync(file)) return []

  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as ProviderStatEntry

        if (!value || typeof value !== "object") return []
        if (typeof value.providerID !== "string") return []
        if (typeof value.modelID !== "string") return []

        return [value]
      } catch {
        return []
      }
    })
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function minOrNull(values: number[]): number | null {
  return values.length > 0 ? Math.min(...values) : null
}

function maxOrNull(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null
}

function aggregateEntries(entries: ProviderStatEntry[]): Aggregate[] {
  const grouped = new Map<string, ProviderStatEntry[]>()

  for (const entry of entries) {
    const key = `${entry.providerID}\u0000${entry.modelID}`
    const bucket = grouped.get(key) ?? []
    bucket.push(entry)
    grouped.set(key, bucket)
  }

  return [...grouped.entries()]
    .map(([key, bucket]) => {
      const [providerID, modelID] = key.split("\u0000")

      const ttft = bucket
        .map((entry) => entry.ttft_ms)
        .filter((value): value is number => value != null && Number.isFinite(value))

      const tps = bucket
        .map((entry) => entry.tps)
        .filter((value): value is number => value != null && Number.isFinite(value))

      const latency = bucket
        .map((entry) => entry.latency_ms)
        .filter((value) => Number.isFinite(value))

      return {
        providerID,
        modelID,
        count: bucket.length,
        avgTTFT: average(ttft),
        minTTFT: minOrNull(ttft),
        maxTTFT: maxOrNull(ttft),
        avgTPS: average(tps),
        minTPS: minOrNull(tps),
        maxTPS: maxOrNull(tps),
        avgLatency: average(latency),
        minLatency: minOrNull(latency),
        maxLatency: maxOrNull(latency),
        totalInputTokens: bucket.reduce((sum, entry) => sum + entry.inputTokens, 0),
        totalOutputTokens: bucket.reduce((sum, entry) => sum + entry.outputTokens, 0),
        totalReasoningTokens: bucket.reduce((sum, entry) => sum + entry.reasoningTokens, 0),
        totalCacheReadTokens: bucket.reduce((sum, entry) => sum + entry.cacheReadTokens, 0),
        totalCacheWriteTokens: bucket.reduce((sum, entry) => sum + entry.cacheWriteTokens, 0),
        totalCost: bucket.reduce((sum, entry) => sum + entry.cost, 0),
      } satisfies Aggregate
    })
    .sort((a, b) => {
      const providerOrder = a.providerID.localeCompare(b.providerID)
      if (providerOrder !== 0) return providerOrder
      return a.modelID.localeCompare(b.modelID)
    })
}

function filterEntries(
  entries: ProviderStatEntry[],
  options: {
    provider?: string
    model?: string
    last?: number
  },
): ProviderStatEntry[] {
  const provider = options.provider?.trim().toLowerCase()
  const model = options.model?.trim().toLowerCase()

  let result = entries.filter((entry) => {
    if (provider && !entry.providerID.toLowerCase().includes(provider)) return false
    if (model && !entry.modelID.toLowerCase().includes(model)) return false
    return true
  })

  if (options.last && options.last > 0) {
    result = result.slice(-options.last)
  }

  return result
}

function formatNumber(value: number | null, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "-"
  return value.toFixed(digits)
}

function formatMs(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-"
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`
  return `${Math.round(value)}ms`
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

function renderAggregateTable(rows: Aggregate[]): string {
  if (rows.length === 0) {
    return "No provider statistics recorded yet."
  }

  const lines: string[] = []

  for (const row of rows) {
    lines.push(`## ${row.providerID}/${row.modelID}`)
    lines.push(`Requests: ${row.count}`)
    lines.push(
      `TPS: avg ${formatNumber(row.avgTPS)} | min ${formatNumber(row.minTPS)} | max ${formatNumber(row.maxTPS)}`,
    )
    lines.push(
      `TTFT: avg ${formatMs(row.avgTTFT)} | min ${formatMs(row.minTTFT)} | max ${formatMs(row.maxTTFT)}`,
    )
    lines.push(
      `Latency: avg ${formatMs(row.avgLatency)} | min ${formatMs(row.minLatency)} | max ${formatMs(row.maxLatency)}`,
    )
    lines.push(
      `Tokens: input ${formatTokens(row.totalInputTokens)} | output ${formatTokens(row.totalOutputTokens)} | reasoning ${formatTokens(row.totalReasoningTokens)}`,
    )
    lines.push(
      `Cache: read ${formatTokens(row.totalCacheReadTokens)} | write ${formatTokens(row.totalCacheWriteTokens)}`,
    )
    lines.push(`Cost: $${row.totalCost.toFixed(6)}`)
    lines.push("")
  }

  return lines.join("\n").trim()
}

const providerStatsTool = tool({
  description:
    "Query locally recorded LLM provider/model performance statistics. Returns aggregate TTFT, TPS, latency, token usage, cache usage, and cost. No prompts or responses are stored.",
  args: {
    provider: tool.schema
      .string()
      .optional()
      .describe("Optional partial provider match, for example 'baseten' or 'fireworks-ai'."),
    model: tool.schema
      .string()
      .optional()
      .describe("Optional partial model match."),
    last: tool.schema
      .number()
      .int()
      .positive()
      .optional()
      .describe("Only aggregate the last N matching requests."),
    raw: tool.schema
      .boolean()
      .optional()
      .describe("Return raw metric rows instead of aggregates."),
  },

  async execute(args) {
    const entries = filterEntries(readEntries(), {
      provider: args.provider,
      model: args.model,
      last: args.last,
    })

    if (args.raw) {
      return JSON.stringify(entries, null, 2)
    }

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

        if (
          (part.type === "text" || part.type === "reasoning") &&
          part.time?.start &&
          !firstPartTime.has(part.messageID)
        ) {
          firstPartTime.set(part.messageID, Number(part.time.start))
        }

        return
      }

      if (event.type === "message.removed") {
        const properties = event.properties as any
        const messageID = properties?.info?.id ?? properties?.messageID

        if (messageID) {
          firstPartTime.delete(String(messageID))
        }

        return
      }

      if (event.type === "session.error") {
        firstPartTime.clear()
        return
      }

      if (event.type !== "message.updated") return

      const info = event.properties.info as any

      if (info?.role !== "assistant") return
      if (!info.time?.completed) return

      const messageID = String(info.id ?? "")
      const created = Number(info.time.created)
      const completed = Number(info.time.completed)

      if (
        !messageID ||
        !Number.isFinite(created) ||
        !Number.isFinite(completed) ||
        completed < created
      ) {
        if (messageID) firstPartTime.delete(messageID)
        return
      }

      const firstPart = firstPartTime.get(messageID)
      const latencyMs = completed - created

      const ttftMs =
        firstPart != null && firstPart >= created
          ? firstPart - created
          : null

      const outputTokens = Number(info.tokens?.output ?? 0)

      const generationMs =
        firstPart != null && firstPart < completed
          ? completed - firstPart
          : latencyMs

      const tps =
        generationMs > 0 && outputTokens > 0
          ? (outputTokens / generationMs) * 1000
          : null

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
        finish:
          typeof info.finish === "string"
            ? info.finish
            : undefined,
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
              extra: {
                error:
                  error instanceof Error
                    ? error.message
                    : String(error),
              },
            },
          })
        } catch {
          // Metrics must never interfere with an OpenCode session.
        }
      } finally {
        firstPartTime.delete(messageID)
      }
    },
  }
}

export default ProviderStatsPlugin
