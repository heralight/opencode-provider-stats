# opencode-provider-stats

Local provider/model performance statistics for OpenCode, with a live TPS meter in the TUI and an agent-callable statistics tool.

## Features

- Live rolling TPS meter in the bottom-right session prompt area.
- Exact completed-response TPS based on OpenCode's output-token count.
- TTFT, total latency, token usage, cache usage, and cost tracking.
- Aggregation by `providerID/modelID` with average/min/max statistics.
- Agent-callable `provider_stats` tool for querying local benchmarks.
- Local JSONL persistence only.
- No prompts, responses, session IDs, message IDs, secrets, network calls, or shell execution.

The live value is marked by its nature: it is estimated from streamed UTF-8 bytes. Persisted completed-response TPS uses OpenCode's reported token count.

## Data

Metrics are appended to:

```text
~/.opencode/provider-stats.jsonl
```

Each record contains only:

```text
timestamp, providerID, modelID, TTFT, TPS, latency,
input/output/reasoning/cache tokens, cost, finish reason
```

## Callable tool

The backend plugin registers:

```text
provider_stats
```

Arguments:

- `provider`: optional partial provider match.
- `model`: optional partial model match.
- `last`: optional number of recent matching requests.
- `raw`: return raw metric rows instead of aggregates.

Examples an OpenCode agent can request:

```text
Compare average TPS and TTFT for Baseten and OpenRouter.
Show provider_stats for model deepseek-v4 using the last 20 requests.
```

This is an OpenCode plugin tool. It is callable by the agent like the `benchmark` tool from `opencode-throughput`; it is not a standalone MCP server.

## Installation

This repository exposes two OpenCode entry points:

```text
opencode-provider-stats       # metrics + provider_stats tool
opencode-provider-stats/tui   # live TUI meter
```

When published to npm, add both to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-provider-stats",
    "opencode-provider-stats/tui"
  ]
}
```

For development, install or link the package in your OpenCode configuration directory, then use the same package entry points.

## Compatibility

Target: OpenCode `>= 1.3.14` using the current plugin/TUI APIs used by the upstream projects. OpenCode plugin API changes may require updates.

## Security

See [SECURITY.md](./SECURITY.md). The implementation intentionally avoids telemetry and remote dependencies at runtime beyond OpenCode's plugin peer APIs.

## Upstream sources and licenses

This project combines and adapts ideas and code from:

- [`williamcr01/opencode-tps`](https://github.com/williamcr01/opencode-tps) — live rolling TPS meter and TUI integration.
- [`Howardzhangdqs/opencode-throughput`](https://github.com/Howardzhangdqs/opencode-throughput) — completed-response metrics, JSONL persistence, aggregation, and callable benchmark-tool pattern.

Both upstream projects are MIT licensed. Their required copyright and license notices are preserved in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## License

MIT. See [LICENSE](./LICENSE).
