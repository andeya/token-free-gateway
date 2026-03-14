# Token-Free Gateway

> Multi-provider OpenAI-compatible AI gateway powered by web sessions

## Supported Providers (7 so far)

| Provider | Model ID Prefix |
|----------|-----------------|
| Claude | `claude-web/` |
| ChatGPT | `chatgpt-web/` |
| DeepSeek | `deepseek-web/` |
| Doubao | `doubao-web/` |
| Gemini | `gemini-web/` |
| GLM | `glm-web/` |
| GLM Intl | `glm-intl-web/` |

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
