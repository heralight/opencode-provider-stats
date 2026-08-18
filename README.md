# opencode-provider-stats

Local provider/model performance statistics for OpenCode, with a compact live TUI meter and an agent-callable `provider_stats` tool.

## Features

- Live rolling TPS estimate while the model is streaming.
- Exact completed-response TPS based on OpenCode's reported output-token count.
- TTFT, total latency, token usage, cache usage, finish reason, and cost tracking.
- Persistent aggregation by `providerID/modelID`.
- Compact TUI history for the current provider/model:
  - `5×` — average TPS over the last 5 completed requests.
  - `D` — average TPS for the current local day.
  - `Σ` — all-time average TPS.
  - `F` — TTFT of the latest completed request.
- Agent-callable `provider_stats` tool.
- Local JSONL persistence only.
- No prompts, responses, session IDs, message IDs, secrets, network calls, or shell execution.

The live `T/s` value is an estimate derived from streamed UTF-8 deltas. Persisted TPS uses OpenCode's completed-response output-token count.

## TUI

The session prompt's right-hand side displays:

```text
T/s 9 · 5×76 · D75 · Σ71 · F0.4
T/s42 · 5×76 · D75 · Σ71 · F9.9
T/s128 · 5×76 · D75 · Σ71 · F10.0
```

Meaning:

| Field | Meaning |
|---|---|
| `T/s` | Live estimated tokens/second for the current response |
| `5×` | Average completed-response TPS over the last 5 requests for the current provider/model |
| `D` | Average completed-response TPS since local midnight |
| `Σ` | All-time average completed-response TPS |
| `F` | TTFT of the latest completed request, in seconds |

TPS values reserve a minimum width of two characters, so values from `0` to `99` do not shift the following fields unnecessarily. Values above `99` expand naturally and are never truncated or saturated.

`F` is displayed with one decimal place and a minimum width of three characters. Values above `9.9s`, for example `10.0`, also expand naturally.

When no live generation is running:

```text
T/s - · 5×76 · D75 · Σ71 · F0.4
```

## Requirements

- OpenCode `>= 1.3.14`.
- Bun available for OpenCode config dependencies.
- Node.js for the repository test command.
- OpenCode TUI for the live display.

## Installation from GitHub

Clone the repository into a stable directory:

```bash
git clone https://github.com/heralight/opencode-provider-stats.git \
  ~/.local/share/opencode-provider-stats

cd ~/.local/share/opencode-provider-stats
npm install
```

Create the global OpenCode plugin directory:

```bash
mkdir -p ~/.config/opencode/plugins
```

### Backend plugin

For the backend plugin, copy the monolithic entry point into the OpenCode config directory:

```bash
cp ~/.local/share/opencode-provider-stats/src/index.ts \
  ~/.config/opencode/plugins/provider-stats.ts
```
or
```sh
cp src/index.ts   ~/.config/opencode/plugins/provider-stats.ts   
```

A real copy is recommended for the backend instead of a symlink. This avoids module-resolution issues seen with some OpenCode/Bun local-plugin setups.

The backend file is automatically loaded by OpenCode from:

```text
~/.config/opencode/plugins/provider-stats.ts
```

Install its OpenCode plugin dependency in the global config directory:

```bash
cd ~/.config/opencode
bun add @opencode-ai/plugin
```

OpenCode documents global local plugins under `~/.config/opencode/plugins/`; local plugin dependencies must be available from the config directory.

### TUI plugin

The TUI plugin is a separate target and must be explicitly listed in `tui.json`.

A symlink is convenient during development:

```bash
ln -sf \
  ~/.local/share/opencode-provider-stats/src/tui.tsx \
  ~/.config/opencode/plugins/provider-stats-tui.tsx
```

Merge the following entry into `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "./plugins/provider-stats-tui.tsx"
  ]
}
```

If you already have a `tui.json`, keep your existing settings and only add `"./plugins/provider-stats-tui.tsx"` to its `plugin` array.

TUI plugins are not auto-discovered; OpenCode requires them to be declared in `tui.json`.

### Resulting global layout

```text
~/.config/opencode/
├── package.json
├── bun.lock
├── node_modules/
├── tui.json
└── plugins/
    ├── provider-stats.ts
    └── provider-stats-tui.tsx -> .../src/tui.tsx
```

Restart OpenCode after changing plugin files or dependencies:

```bash
opencode
```

## Updating a source installation

Update the clone:

```bash
cd ~/.local/share/opencode-provider-stats
git pull --ff-only
npm install
```

Refresh the backend copy:

```bash
cp src/index.ts ~/.config/opencode/plugins/provider-stats.ts
```

The TUI symlink already points to `src/tui.tsx`, so it does not need to be recreated.

Restart OpenCode.

## Project-local installation

OpenCode also auto-loads backend plugins from:

```text
<project>/.opencode/plugins/
```

Copy `src/index.ts` there for a project-only backend installation.

For a project-local TUI plugin, place or link `src/tui.tsx` under the project's `.opencode/` area and reference that file from the project's `.opencode/tui.json`.

## npm installation

The package is not assumed to be published yet.

When it is published, the package exposes:

```text
opencode-provider-stats
opencode-provider-stats/tui
```

Package-based installation should use the OpenCode plugin configuration appropriate to the server/backend target and the TUI plugin configuration for the TUI target.

Until an npm release is published and verified, the GitHub source installation above is the supported path documented here.

## Data storage

Completed-response metrics are appended to:

```text
~/.opencode/provider-stats.jsonl
```

Each JSONL record contains:

```text
timestamp
providerID
modelID
TTFT
TPS
latency
input/output/reasoning tokens
cache read/write tokens
cost
finish reason
```

No prompt, response content, session ID, message ID, API key, authorization header, or other request payload is persisted.

On POSIX systems, the backend attempts to keep the statistics file at mode `0600`.

## `provider_stats` tool

The backend registers:

```text
provider_stats
```

This is an OpenCode plugin tool callable by the agent. It is not a standalone MCP server.

Current arguments:

| Argument | Type | Meaning |
|---|---|---|
| `provider` | string, optional | Case-insensitive partial provider match |
| `model` | string, optional | Case-insensitive partial model match |
| `last` | positive integer, optional | Aggregate only the last N matching records |
| `raw` | boolean, optional | Return matching JSON metric rows instead of aggregates |

Examples inside OpenCode:

```text
Use provider_stats and show all available statistics.
```

```text
Use provider_stats for provider fireworks-ai.
```

```text
Use provider_stats for model deepseek-v4-flash-0731 using the last 20 requests.
```

```text
Compare average TPS, TTFT and latency between Fireworks and Baseten using provider_stats.
```

The aggregate tool currently reports request count, average/min/max TPS, average/min/max TTFT, average/min/max latency, token totals, cache totals, and cost.

### Reset status

The current repository backend does **not** expose a targeted reset action through `provider_stats`.

To clear all history manually:

```bash
rm -f ~/.opencode/provider-stats.jsonl
```

A provider/model-targeted reset should only be documented once it exists in `src/index.ts`.

## Testing the installation

### 1. Verify the backend file

```bash
ls -l ~/.config/opencode/plugins/provider-stats.ts
```

### 2. Verify the TUI file and config

```bash
ls -l ~/.config/opencode/plugins/provider-stats-tui.tsx
cat ~/.config/opencode/tui.json
```

The `plugin` array must contain:

```text
./plugins/provider-stats-tui.tsx
```

### 3. Start OpenCode with logs when debugging

```bash
opencode --print-logs
```

To focus on plugin-loading errors:

```bash
opencode --print-logs 2>&1 | grep -Ei 'provider-stats|plugin|cannot find|error'
```

### 4. Generate a normal response

Use a prompt long enough for live throughput to stabilize, for example:

```text
Explain TCP versus QUIC in about 500 words.
```

During generation, `T/s` should change:

```text
T/s74 · 5×76 · D75 · Σ71 · F0.4
```

After completion, live TPS returns to `-` while persisted statistics remain:

```text
T/s - · 5×75 · D74 · Σ71 · F0.8
```

### 5. Verify persistence

```bash
ls -l ~/.opencode/provider-stats.jsonl
tail -n 3 ~/.opencode/provider-stats.jsonl
```

There should be one JSON object per completed assistant response.

### 6. Verify the callable tool

Inside OpenCode:

```text
Use provider_stats and show all available statistics.
```

If the tool runs and returns provider/model metrics, the backend plugin is loaded correctly.

### 7. Run repository tests

From the repository:

```bash
npm test
npm run typecheck
```

The test suite isolates `HOME` in a temporary directory and does not touch your real `~/.opencode/provider-stats.jsonl`.

## Troubleshooting

### Live `T/s` works but `5×`, `D`, `Σ`, and `F` stay `-`

The TUI plugin is loaded, but the backend is not persisting completed-response metrics.

Check:

```bash
ls -l ~/.opencode/provider-stats.jsonl
```

Then start with:

```bash
opencode --print-logs 2>&1 | grep -Ei 'provider-stats|plugin|cannot find|error'
```

Ensure the backend is a real file:

```bash
file ~/.config/opencode/plugins/provider-stats.ts
```

and that `@opencode-ai/plugin` is installed under `~/.config/opencode`.

### `provider_stats` is unavailable

The backend plugin did not load.

Check:

```bash
ls -l ~/.config/opencode/plugins/provider-stats.ts
cd ~/.config/opencode
bun install
```

Then restart OpenCode.

### TUI metrics do not appear

The TUI plugin must be explicitly referenced in `tui.json`.

Check:

```bash
cat ~/.config/opencode/tui.json
```

and verify the file exists:

```bash
ls -l ~/.config/opencode/plugins/provider-stats-tui.tsx
```

### No statistics file exists

The file is created after a completed assistant response, not merely when OpenCode starts.

### Disable the plugin without deleting statistics

Backend:

```bash
mv ~/.config/opencode/plugins/provider-stats.ts \
   ~/.config/opencode/plugins/provider-stats.ts.disabled
```

For the TUI, remove or comment out its entry from `tui.json`.

The existing `~/.opencode/provider-stats.jsonl` file is not removed.

## Compatibility

The package currently declares:

```text
OpenCode >= 1.3.14
```

The TUI plugin system is evolving; changes in OpenCode's plugin/TUI APIs may require updates.

## Security

See [SECURITY.md](./SECURITY.md).

The implementation intentionally avoids telemetry and application-level network calls. Statistics remain local unless another process or tool explicitly reads or transmits the JSONL file.

## Upstream sources and licenses

This project combines and adapts ideas and code from:

- [`williamcr01/opencode-tps`](https://github.com/williamcr01/opencode-tps) — live rolling TPS meter and TUI integration.
- [`Howardzhangdqs/opencode-throughput`](https://github.com/Howardzhangdqs/opencode-throughput) — completed-response metrics, JSONL persistence, aggregation, and callable benchmark-tool pattern.

Both upstream projects are MIT licensed. Their required copyright and license notices are preserved in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## License

MIT. See [LICENSE](./LICENSE).
