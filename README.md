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

The live value is estimated from streamed UTF-8 bytes. Persisted completed-response TPS uses OpenCode's reported output-token count.

## Requirements

- OpenCode `>= 1.3.14`.
- Bun available in `PATH` for a source installation.
- OpenCode TUI for the live meter. The statistics tool itself does not depend on the TUI.

## Installation

### From GitHub source

Until the package is published to npm, this is the recommended installation method.

Clone the repository into a stable local directory and install its dependencies:

```bash
git clone https://github.com/heralight/opencode-provider-stats.git \
  ~/.local/share/opencode-provider-stats

cd ~/.local/share/opencode-provider-stats
bun install
```

Create the global OpenCode plugin directory if necessary:

```bash
mkdir -p ~/.config/opencode/plugins
```

Expose both plugin entry points to OpenCode:

```bash
ln -sf \
  ~/.local/share/opencode-provider-stats/src/index.ts \
  ~/.config/opencode/plugins/provider-stats.ts

ln -sf \
  ~/.local/share/opencode-provider-stats/src/tui.tsx \
  ~/.config/opencode/plugins/provider-stats-tui.tsx
```

OpenCode automatically loads JavaScript and TypeScript files located in `~/.config/opencode/plugins/` at startup.

Restart OpenCode after installation.

To update later:

```bash
cd ~/.local/share/opencode-provider-stats
git pull --ff-only
bun install
```

The symlinks do not need to be recreated.

### Project-local installation

To enable the plugin for one project only, use the project's `.opencode/plugins/` directory instead:

```bash
mkdir -p .opencode/plugins

ln -sf \
  ~/.local/share/opencode-provider-stats/src/index.ts \
  .opencode/plugins/provider-stats.ts

ln -sf \
  ~/.local/share/opencode-provider-stats/src/tui.tsx \
  .opencode/plugins/provider-stats-tui.tsx
```

### npm installation

Once `opencode-provider-stats` is published to npm, OpenCode can install it automatically from `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-provider-stats",
    "opencode-provider-stats/tui"
  ]
}
```

The package exposes these two entry points:

```text
opencode-provider-stats       # metrics collection + provider_stats tool
opencode-provider-stats/tui   # live TUI meter
```

Do not use this npm configuration before the package is actually published.

## Configuration

No plugin-specific configuration is required.

For a global source installation, the two files in this directory are enough:

```text
~/.config/opencode/plugins/
├── provider-stats.ts
└── provider-stats-tui.tsx
```

Your existing provider/model configuration remains unchanged.

For example, an existing global OpenCode configuration can continue to contain only your normal settings:

```json
{
  "$schema": "https://opencode.ai/config.json"
}
```

When using the source installation above, do **not** also add the future npm package to `plugin`. Otherwise OpenCode may load the plugin twice.

## Data storage

Metrics are appended locally to:

```text
~/.opencode/provider-stats.jsonl
```

Each record contains only:

```text
timestamp, providerID, modelID, TTFT, TPS, latency,
input/output/reasoning/cache tokens, cost, finish reason
```

No prompt, response body, session ID, message ID, API key, or authorization header is persisted.

On POSIX systems, the plugin attempts to keep the statistics file at mode `0600`.

## TUI display

During generation, the bottom-right area of the session prompt displays a rolling live estimate similar to:

```text
baseten/deepseek-v4 · TPS 82.4 · avg 79.6
```

- `TPS` is the current rolling streaming estimate.
- `avg` is calculated from persisted completed responses for the same `providerID/modelID`.
- The persisted average uses OpenCode's reported output-token count rather than the live byte-based estimate.

## Callable tool

The backend plugin registers the following OpenCode tool:

```text
provider_stats
```

The agent can call it like any other OpenCode tool. It is not a standalone MCP server.

Arguments:

- `provider`: optional partial, case-insensitive provider match.
- `model`: optional partial, case-insensitive model match.
- `last`: optional number of recent matching requests to aggregate.
- `raw`: return matching raw metric records instead of aggregates.

Example requests inside OpenCode:

```text
Use provider_stats and show all provider/model performance statistics.
```

```text
Use provider_stats for provider baseten.
```

```text
Use provider_stats for model deepseek-v4 using the last 20 requests.
```

```text
Compare average TPS, TTFT and latency between Baseten and OpenRouter using provider_stats.
```

## Testing the installation

### 1. Verify the local files

```bash
ls -l ~/.config/opencode/plugins/provider-stats.ts \
      ~/.config/opencode/plugins/provider-stats-tui.tsx
```

Both symlinks should resolve to the cloned repository.

### 2. Start OpenCode

```bash
opencode
```

Run a normal prompt that produces enough output to make throughput visible, for example:

```text
Explain the differences between TCP and QUIC in about 500 words.
```

During generation, the bottom-right TUI area should show a live `TPS` value.

After completion, the `avg` value should become available for that provider/model after at least one recorded response.

### 3. Verify persistence

```bash
tail -n 3 ~/.opencode/provider-stats.jsonl
```

You should see one JSON object per completed assistant response.

A record should contain metric fields such as:

```json
{
  "providerID": "baseten",
  "modelID": "deepseek-v4",
  "ttft_ms": 640,
  "tps": 81.7,
  "latency_ms": 8400,
  "inputTokens": 1250,
  "outputTokens": 634,
  "cost": 0.0123
}
```

Values above are illustrative only.

### 4. Verify the callable tool

Inside OpenCode, ask:

```text
Use provider_stats and show the statistics for the current provider and model.
```

A successful result confirms that the backend entry point is loaded and that the tool can read the local statistics file.

You can also test filtering:

```text
Use provider_stats with provider=baseten and last=10.
```

### 5. Run the repository tests

From the clone:

```bash
cd ~/.local/share/opencode-provider-stats
bun test
bun run typecheck
```

Both commands should complete successfully before publishing or modifying the plugin.

## Troubleshooting

### `provider_stats` is not available

Check that the backend entry point exists:

```bash
ls -l ~/.config/opencode/plugins/provider-stats.ts
```

Then restart OpenCode.

### Live TPS is not displayed

Check that the TUI entry point exists:

```bash
ls -l ~/.config/opencode/plugins/provider-stats-tui.tsx
```

The meter requires the OpenCode TUI and will not appear in interfaces that do not expose TUI plugin slots.

### No statistics file is created

The file is created only after a completed assistant response. Run at least one normal model request, then check:

```bash
ls -l ~/.opencode/provider-stats.jsonl
```

### OpenCode fails after enabling the plugin

Temporarily disable the source installation without deleting data:

```bash
mv ~/.config/opencode/plugins/provider-stats.ts \
   ~/.config/opencode/plugins/provider-stats.ts.disabled

mv ~/.config/opencode/plugins/provider-stats-tui.tsx \
   ~/.config/opencode/plugins/provider-stats-tui.tsx.disabled
```

Restart OpenCode. Your existing `~/.opencode/provider-stats.jsonl` file is not removed.

## Compatibility

Target: OpenCode `>= 1.3.14` using the plugin/TUI APIs used by the upstream projects. OpenCode plugin API changes may require updates.

## Security

See [SECURITY.md](./SECURITY.md). The implementation intentionally avoids telemetry and application-level network calls.

## Upstream sources and licenses

This project combines and adapts ideas and code from:

- [`williamcr01/opencode-tps`](https://github.com/williamcr01/opencode-tps) — live rolling TPS meter and TUI integration.
- [`Howardzhangdqs/opencode-throughput`](https://github.com/Howardzhangdqs/opencode-throughput) — completed-response metrics, JSONL persistence, aggregation, and callable benchmark-tool pattern.

Both upstream projects are MIT licensed. Their required copyright and license notices are preserved in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## License

MIT. See [LICENSE](./LICENSE).
