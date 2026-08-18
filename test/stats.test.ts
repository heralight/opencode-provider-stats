import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test, { after, beforeEach } from "node:test"

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-provider-stats-"))
const dataFile = path.join(testRoot, "provider-stats.jsonl")

process.env.OPENCODE_PROVIDER_STATS_FILE = dataFile

const { ProviderStatsPlugin } = await import("../src/index.ts")

const hooks = await ProviderStatsPlugin({
  client: {
    app: {
      log: async () => undefined,
    },
  },
} as never)

const providerStats = (hooks as any).tool.provider_stats
const handleEvent = (hooks as any).event

const entries = [
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

function writeEntries(values: unknown[]): void {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true })
  fs.writeFileSync(
    dataFile,
    `${values.map((value) => JSON.stringify(value)).join("\n")}\n`,
    "utf8",
  )
}

beforeEach(() => {
  writeEntries(entries)
})

after(() => {
  delete process.env.OPENCODE_PROVIDER_STATS_FILE
  fs.rmSync(testRoot, { recursive: true, force: true })
})

test("provider_stats aggregates provider/model statistics", async () => {
  const output = await providerStats.execute({ provider: "BASE", model: "v4" })

  assert.match(output, /## baseten\/deepseek-v4/)
  assert.match(output, /Requests: 2/)
  assert.match(output, /TPS: avg 90\.0 \| min 80\.0 \| max 100\.0/)
  assert.match(output, /TTFT: avg 600ms \| min 500ms \| max 700ms/)
  assert.match(output, /Tokens: input 300 \| output 300 \| reasoning 20/)
  assert.match(output, /Cost: \$0\.030000/)
})

test("provider_stats filters provider/model and limits to last N", async () => {
  const output = await providerStats.execute({
    provider: "BASE",
    model: "V4",
    last: 1,
  })

  assert.match(output, /## baseten\/deepseek-v4/)
  assert.match(output, /Requests: 1/)
  assert.match(output, /TPS: avg 100\.0 \| min 100\.0 \| max 100\.0/)
  assert.match(output, /TTFT: avg 700ms \| min 700ms \| max 700ms/)
})

test("provider_stats returns raw matching rows", async () => {
  const output = await providerStats.execute({ provider: "baseten", raw: true })
  const rows = JSON.parse(output)

  assert.equal(rows.length, 2)
  assert.equal(rows[0].providerID, "baseten")
  assert.equal(rows[1].modelID, "deepseek-v4")
})

test("completed assistant events persist TTFT, TPS, latency and tokens", async () => {
  fs.rmSync(dataFile, { force: true })

  await handleEvent({
    event: {
      type: "message.part.updated",
      properties: {
        part: {
          messageID: "message-1",
          type: "text",
          time: { start: 1_500 },
        },
      },
    },
  })

  await handleEvent({
    event: {
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          role: "assistant",
          providerID: "fireworks-ai",
          modelID: "deepseek-v4-flash-0731",
          time: { created: 1_000, completed: 2_500 },
          tokens: {
            input: 40,
            output: 100,
            reasoning: 10,
            cache: { read: 5, write: 2 },
          },
          cost: 0.001,
          finish: "stop",
        },
      },
    },
  })

  const rows = fs
    .readFileSync(dataFile, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))

  assert.equal(rows.length, 1)
  assert.equal(rows[0].providerID, "fireworks-ai")
  assert.equal(rows[0].modelID, "deepseek-v4-flash-0731")
  assert.equal(rows[0].ttft_ms, 500)
  assert.equal(rows[0].latency_ms, 1_500)
  assert.equal(rows[0].tps, 100)
  assert.equal(rows[0].inputTokens, 40)
  assert.equal(rows[0].outputTokens, 100)
  assert.equal(rows[0].reasoningTokens, 10)
  assert.equal(rows[0].cacheReadTokens, 5)
  assert.equal(rows[0].cacheWriteTokens, 2)
  assert.equal(rows[0].cost, 0.001)
  assert.equal(rows[0].finish, "stop")
})
