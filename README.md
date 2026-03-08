# Token-Free Gateway

> Multi-provider OpenAI-compatible AI gateway powered by web sessions

## Supported Providers

| Provider | Model ID Prefix |
|----------|-----------------|
| Claude (Anthropic) | `claude-web/` |
| ChatGPT (OpenAI) | `chatgpt-web/` |

## Quick Start

```bash
bun install
./start-chrome-debug.sh
bun run webauth
bun run start
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `GATEWAY_API_KEY` | — | Optional API key |
| `CDP_URL` | `http://127.0.0.1:9222` | Chrome debug URL |
