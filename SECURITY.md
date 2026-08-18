# Security

`opencode-provider-stats` is designed to remain local and narrow in scope.

- It performs no network requests.
- It executes no shell commands.
- It stores no prompts, responses, session IDs, message IDs, API keys, or authorization headers.
- It records only provider/model identifiers and performance/accounting metrics.
- The metrics file is `~/.opencode/provider-stats.jsonl` and is created with mode `0600` where supported.
- The `provider_stats` tool only reads that local metrics file.

The live TPS value shown while streaming is an estimate based on UTF-8 bytes. Completed TPS statistics use OpenCode's reported output-token count.
