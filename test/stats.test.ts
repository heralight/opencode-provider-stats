import assert from "node:assert/strict"
import test from "node:test"
import { aggregateEntries, filterEntries, type ProviderStatEntry } from "../src/stats.ts"

const entries: ProviderStatEntry[] = [
  {
    ts: "2026-08-18T10:00:00.000Z",
    providerID: "baseten",
    modelID: "deepseek-v4",
    ttft_ms: 500,
    tps: 80,
    latency_ms: 2_000,
    inputTokens: 100,
    outputTokens: 120,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0.01,
  },
  {
    ts: "2026-08-18T11:00:00.000Z",
    providerID: "baseten",
    modelID: "deepseek-v4",
    ttft_ms: 700,
    tps: 100,
    latency_ms: 2_500,
    inputTokens: 200,
    outputTokens: 180,
    reasoningTokens: 20,
    cacheReadTokens: 50,
    cacheWriteTokens: 0,
    cost: 0.02,
  },
]

test("aggregates provider/model statistics", () => {
  const [stats] = aggregateEntries(entries)
  assert.equal(stats.requests, 2)
  assert.equal(stats.avgTTFT, 600)
  assert.equal(stats.avgTPS, 90)
  assert.equal(stats.totalOutputTokens, 300)
  assert.equal(stats.totalCost, 0.03)
})

test("filters provider/model and last N requests", () => {
  assert.equal(filterEntries(entries, { provider: "BASE", model: "v4" }).length, 2)
  assert.deepEqual(filterEntries(entries, { last: 1 }), [entries[1]])
})
