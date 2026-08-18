/** @jsxImportSource @opentui/solid */
// Live meter adapted from williamcr01/opencode-tps (MIT), with local provider/model averages.
import { createMemo, createSignal } from "solid-js"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { aggregateEntries, type ProviderStatEntry } from "./stats.js"

interface StreamSample {
  tokens: number
  timestamp: number
}

interface PartDeltaEvent {
  type: "message.part.delta"
  properties: {
    sessionID: string
    messageID: string
    partID: string
    field: string
    delta: string
  }
}

const DATA_FILE = path.join(os.homedir(), ".opencode", "provider-stats.jsonl")
const LIVE_STALE_MS = 1_500
const SAMPLE_WINDOW_MS = 5_000
const SINGLE_SAMPLE_MIN_MS = 250
const SINGLE_SAMPLE_MAX_MS = 1_000

function estimateTokens(text: string): number {
  const byteLength = new TextEncoder().encode(text).length
  return Math.max(1, Math.ceil(byteLength / 5))
}

function formatTps(value: number | null): string {
  if (value == null || value < 0) return "-"
  if (value < 10) return value.toFixed(2)
  if (value < 100) return value.toFixed(1)
  return Math.round(value).toString()
}

function readAverages(): Map<string, number> {
  if (!fs.existsSync(DATA_FILE)) return new Map()

  const entries = fs
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

  return new Map(
    aggregateEntries(entries)
      .filter((item) => item.avgTPS != null)
      .map((item) => [`${item.providerID}\u0000${item.modelID}`, item.avgTPS!]),
  )
}

const tui: TuiPlugin = async (api) => {
  const streamSamples = new Map<string, StreamSample[]>()
  const latestModelBySession = new Map<string, { providerID: string; modelID: string }>()
  const [version, setVersion] = createSignal(0)
  const [tick, setTick] = createSignal(0)
  const [averages, setAverages] = createSignal(readAverages())

  function clearLiveSamples(sessionID: string): void {
    if (!streamSamples.delete(sessionID)) return
    setVersion((value) => value + 1)
  }

  function activeDurationMs(samples: StreamSample[]): number {
    if (samples.length < 2) {
      const elapsed = Date.now() - samples[0].timestamp
      return Math.max(SINGLE_SAMPLE_MIN_MS, Math.min(elapsed, SINGLE_SAMPLE_MAX_MS))
    }

    let total = 0
    for (let index = 1; index < samples.length; index += 1) {
      total += Math.max(0, samples[index].timestamp - samples[index - 1].timestamp)
    }

    const tail = Date.now() - samples[samples.length - 1].timestamp
    total += Math.min(tail, 1_000)
    return Math.max(total, SINGLE_SAMPLE_MIN_MS)
  }

  function liveTps(sessionID: string): number | null {
    if (api.state.session.status(sessionID)?.type === "idle") return null

    const now = Date.now()
    const active = (streamSamples.get(sessionID) ?? []).filter(
      (sample) => sample.timestamp >= now - SAMPLE_WINDOW_MS,
    )
    if (active.length === 0) return null
    if (now - active[active.length - 1].timestamp > LIVE_STALE_MS) return null

    const durationMs = activeDurationMs(active)
    const tokens = active.reduce((sum, sample) => sum + sample.tokens, 0)
    return durationMs > 0 ? (tokens / durationMs) * 1_000 : null
  }

  function latestModel(sessionID: string): { providerID: string; modelID: string } | null {
    return latestModelBySession.get(sessionID) ?? null
  }

  const unsubDelta = api.event.on(
    "message.part.delta" as unknown as "message.part.delta",
    (event: PartDeltaEvent) => {
      if (event.properties.field !== "text") return
      const sessionID = event.properties.sessionID
      if (!sessionID || api.state.session.status(sessionID)?.type === "idle") return

      const delta = event.properties.delta
      if (!delta) return

      const samples = streamSamples.get(sessionID) ?? []
      samples.push({ tokens: estimateTokens(delta), timestamp: Date.now() })
      streamSamples.set(sessionID, samples)
      setVersion((value) => value + 1)
    },
  )

  const unsubUpdated = api.event.on("message.updated", (event) => {
    const info = event.properties.info as any
    if (info?.role !== "assistant") return

    if (info.sessionID) {
      latestModelBySession.set(info.sessionID, {
        providerID: String(info.providerID ?? "unknown"),
        modelID: String(info.modelID ?? "unknown"),
      })
    }

    if (!info.time?.completed) return
    clearLiveSamples(info.sessionID)
    setTimeout(() => setAverages(readAverages()), 25)
  })

  const unsubPartUpdated = api.event.on("message.part.updated", (event) => {
    const part = event.properties.part as any
    if (part?.type !== "tool") return
    if (["running", "completed", "error"].includes(part.state?.status)) clearLiveSamples(part.sessionID)
  })

  const interval = setInterval(() => {
    const cutoff = Date.now() - SAMPLE_WINDOW_MS
    for (const [sessionID, samples] of streamSamples) {
      streamSamples.set(
        sessionID,
        samples.filter((sample) => sample.timestamp >= cutoff),
      )
    }
    setTick((value) => value + 1)
  }, 1_000)

  api.lifecycle.onDispose(() => {
    unsubDelta()
    unsubUpdated()
    unsubPartUpdated()
    clearInterval(interval)
  })

  api.slots.register({
    slots: {
      session_prompt_right(ctx, props) {
        const sessionID = props.session_id
        const label = createMemo(() => {
          version()
          tick()
          const model = latestModel(sessionID)
          const live = liveTps(sessionID)
          if (!model) return `TPS ${formatTps(live)}`

          const average = averages().get(`${model.providerID}\u0000${model.modelID}`) ?? null
          const shortModel = model.modelID.length > 22 ? `${model.modelID.slice(0, 20)}..` : model.modelID
          return `${model.providerID}/${shortModel} · TPS ${formatTps(live)} · avg ${formatTps(average)}`
        })

        return <text fg={ctx.theme.current.textMuted}>{label()}</text>
      },
    },
  })
}

export default {
  id: "opencode-provider-stats",
  tui,
}
