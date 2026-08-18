/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal } from "solid-js"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

type ProviderStatEntry = {
  ts: string
  providerID: string
  modelID: string
  ttft_ms: number | null
  tps: number | null
}

type WindowStats = {
  avg5: number | null
  avgDay: number | null
  avgAll: number | null
  lastTTFT: number | null
}

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

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function fmtTps(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return " -"
  return Math.round(value).toString().padStart(2)
}

function fmtFirst(valueMs: number | null): string {
  if (valueMs == null || !Number.isFinite(valueMs)) return "-.-"
  return (valueMs / 1000).toFixed(1).padStart(3)
}

function readEntries(): ProviderStatEntry[] {
  if (!fs.existsSync(DATA_FILE)) return []
  return fs.readFileSync(DATA_FILE, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try {
      const value = JSON.parse(line) as ProviderStatEntry
      return value && typeof value.providerID === "string" && typeof value.modelID === "string" ? [value] : []
    } catch {
      return []
    }
  })
}

function localDayStartMs(now = Date.now()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function readWindowStats(): Map<string, WindowStats> {
  const grouped = new Map<string, ProviderStatEntry[]>()

  for (const entry of readEntries()) {
    const key = `${entry.providerID}\u0000${entry.modelID}`
    const bucket = grouped.get(key) ?? []
    bucket.push(entry)
    grouped.set(key, bucket)
  }

  const dayStart = localDayStartMs()
  const result = new Map<string, WindowStats>()

  for (const [key, bucket] of grouped) {
    const sorted = [...bucket].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    const last5 = sorted.slice(-5)
    const today = sorted.filter((e) => Date.parse(e.ts) >= dayStart)

    const tps5 = last5.map((e) => e.tps).filter((v): v is number => v != null && Number.isFinite(v))
    const tpsDay = today.map((e) => e.tps).filter((v): v is number => v != null && Number.isFinite(v))
    const tpsAll = sorted.map((e) => e.tps).filter((v): v is number => v != null && Number.isFinite(v))
    const last = sorted.at(-1)

    result.set(key, {
      avg5: mean(tps5),
      avgDay: mean(tpsDay),
      avgAll: mean(tpsAll),
      lastTTFT: last?.ttft_ms ?? null,
    })
  }

  return result
}

const tui: TuiPlugin = async (api) => {
  const streamSamples = new Map<string, StreamSample[]>()
  const latestModelBySession = new Map<string, { providerID: string; modelID: string }>()
  const [version, setVersion] = createSignal(0)
  const [tick, setTick] = createSignal(0)
  const [stats, setStats] = createSignal(readWindowStats())

  function refreshStats(): void {
    setStats(readWindowStats())
  }

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
    for (let i = 1; i < samples.length; i += 1) {
      total += Math.max(0, samples[i].timestamp - samples[i - 1].timestamp)
    }

    const tail = Date.now() - samples[samples.length - 1].timestamp
    total += Math.min(tail, 1_000)
    return Math.max(total, SINGLE_SAMPLE_MIN_MS)
  }

  function liveTps(sessionID: string): number | null {
    if (api.state.session.status(sessionID)?.type === "idle") return null

    const now = Date.now()
    const active = (streamSamples.get(sessionID) ?? []).filter((sample) => sample.timestamp >= now - SAMPLE_WINDOW_MS)
    if (!active.length) return null
    if (now - active[active.length - 1].timestamp > LIVE_STALE_MS) return null

    const durationMs = activeDurationMs(active)
    const tokens = active.reduce((sum, sample) => sum + sample.tokens, 0)
    return durationMs > 0 ? (tokens / durationMs) * 1_000 : null
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

    setTimeout(refreshStats, 100)
    setTimeout(refreshStats, 500)
    setTimeout(refreshStats, 1_000)
  })

  const unsubPartUpdated = api.event.on("message.part.updated", (event) => {
    const part = event.properties.part as any
    if (part?.type !== "tool") return
    if (["running", "completed", "error"].includes(part.state?.status)) clearLiveSamples(part.sessionID)
  })

  const interval = setInterval(() => {
    const cutoff = Date.now() - SAMPLE_WINDOW_MS
    for (const [sessionID, samples] of streamSamples) {
      streamSamples.set(sessionID, samples.filter((sample) => sample.timestamp >= cutoff))
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

          const model = latestModelBySession.get(sessionID)
          const live = liveTps(sessionID)

          if (!model) {
            return `T/s${fmtTps(live)} · 5×${fmtTps(null)} · D${fmtTps(null)} · Σ${fmtTps(null)} · F${fmtFirst(null)}`
          }

          const current = stats().get(`${model.providerID}\u0000${model.modelID}`)

          return `T/s${fmtTps(live)} · 5×${fmtTps(current?.avg5 ?? null)} · D${fmtTps(current?.avgDay ?? null)} · Σ${fmtTps(current?.avgAll ?? null)} · F${fmtFirst(current?.lastTTFT ?? null)}`
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
