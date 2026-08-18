export interface ProviderStatEntry {
  ts: string
  providerID: string
  modelID: string
  ttft_ms: number | null
  tps: number | null
  latency_ms: number | null
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  finish?: string
}

export interface AggregateStats {
  providerID: string
  modelID: string
  requests: number
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
  lastUpdated: string
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function min(values: number[]): number | null {
  return values.length === 0 ? null : Math.min(...values)
}

function max(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values)
}

export function aggregateEntries(entries: ProviderStatEntry[]): AggregateStats[] {
  const groups = new Map<string, ProviderStatEntry[]>()

  for (const entry of entries) {
    const key = `${entry.providerID}\u0000${entry.modelID}`
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => {
      const latest = group.reduce((a, b) => (a.ts > b.ts ? a : b))
      const ttfts = group.map((entry) => entry.ttft_ms).filter(finite)
      const tpsValues = group.map((entry) => entry.tps).filter(finite)
      const latencies = group.map((entry) => entry.latency_ms).filter(finite)

      return {
        providerID: latest.providerID,
        modelID: latest.modelID,
        requests: group.length,
        avgTTFT: mean(ttfts),
        minTTFT: min(ttfts),
        maxTTFT: max(ttfts),
        avgTPS: mean(tpsValues),
        minTPS: min(tpsValues),
        maxTPS: max(tpsValues),
        avgLatency: mean(latencies),
        minLatency: min(latencies),
        maxLatency: max(latencies),
        totalInputTokens: group.reduce((sum, entry) => sum + entry.inputTokens, 0),
        totalOutputTokens: group.reduce((sum, entry) => sum + entry.outputTokens, 0),
        totalReasoningTokens: group.reduce((sum, entry) => sum + entry.reasoningTokens, 0),
        totalCacheReadTokens: group.reduce((sum, entry) => sum + entry.cacheReadTokens, 0),
        totalCacheWriteTokens: group.reduce((sum, entry) => sum + entry.cacheWriteTokens, 0),
        totalCost: group.reduce((sum, entry) => sum + entry.cost, 0),
        lastUpdated: latest.ts,
      }
    })
    .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated))
}

export function filterEntries(
  entries: ProviderStatEntry[],
  options: { provider?: string; model?: string; last?: number } = {},
): ProviderStatEntry[] {
  const provider = options.provider?.toLowerCase()
  const model = options.model?.toLowerCase()

  const filtered = entries.filter((entry) => {
    if (provider && !entry.providerID.toLowerCase().includes(provider)) return false
    if (model && !entry.modelID.toLowerCase().includes(model)) return false
    return true
  })

  if (!options.last || options.last <= 0) return filtered
  return filtered.slice(-Math.floor(options.last))
}

export function formatNumber(value: number | null): string {
  if (value == null) return "N/A"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toFixed(value >= 100 ? 0 : 1)
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "N/A"
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`
  return `${ms.toFixed(0)}ms`
}

export function renderAggregateTable(stats: AggregateStats[]): string {
  if (stats.length === 0) return "No provider statistics match the requested filters."

  const lines = [
    "| Provider | Model | Requests | Avg TTFT | Avg TPS | Avg latency | Output tokens | Cost |",
    "|---|---|---:|---:|---:|---:|---:|---:|",
  ]

  for (const item of stats) {
    lines.push(
      `| ${item.providerID} | ${item.modelID} | ${item.requests} | ${formatDuration(item.avgTTFT)} | ${formatNumber(item.avgTPS)} | ${formatDuration(item.avgLatency)} | ${formatNumber(item.totalOutputTokens)} | $${item.totalCost.toFixed(4)} |`,
    )
  }

  return lines.join("\n")
}
