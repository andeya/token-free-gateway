# Token-Free Gateway

> Multi-provider OpenAI-compatible AI gateway powered by web sessions

## Supported Providers (13 total)

| Provider | Model ID Prefix |
|----------|-----------------|
| Claude | `claude-web/` |
| ChatGPT | `chatgpt-web/` |
| DeepSeek | `deepseek-web/` |
| Doubao | `doubao-web/` |
| Gemini | `gemini-web/` |
| GLM | `glm-web/` |
| GLM Intl | `glm-intl-web/` |
| Grok | `grok-web/` |
| Kimi | `kimi-web/` |
| Perplexity | `perplexity-web/` |
| Qwen | `qwen-web/` |
| Qwen CN | `qwen-cn-web/` |
| Xiaomimo | `xiaomimo-web/` |

## Quick Start

```bash
bun install
token-free-gateway chrome
token-free-gateway webauth
token-free-gateway start
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `serve` | Start in foreground (default) |
| `start` | Start in background |
| `stop` | Stop background server |
| `restart` | Restart |
| `status` | Show status |
| `webauth` | Authorize providers |
| `chrome [start\|stop]` | Manage Chrome debug |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `GATEWAY_API_KEY` | — | Optional API key |
| `CDP_URL` | `http://127.0.0.1:9222` | Chrome debug URL |

## API Compatibility

- `POST /v1/chat/completions` — streaming and non-streaming
- `GET /v1/models` — list all authorized models
- `GET /v1/models/:id` — get model info
- `GET /health` — health check

## Model Format

```
claude-sonnet-4-20250514              # direct model ID
claude-web/claude-sonnet-4-20250514   # provider-id/model-id
```

## Troubleshooting

**Chrome not connecting**: Run `token-free-gateway chrome start`.
**Auth expired**: Run `token-free-gateway webauth`.
**Port in use**: Set `PORT=3457 token-free-gateway start`.

## Architecture

```
Client → Gateway → Chrome (CDP) → AI Provider Website
```

## Performance

- First request: 2-5s (browser init)
- Subsequent: fast (session reused)
- Streaming latency: ~1ms/chunk

## Security

`GATEWAY_API_KEY` enables Bearer token auth.
Credentials stored in `~/.config/token-free-gateway/`.

## Advanced

Run with custom port: `PORT=3457 token-free-gateway start`
Build binary: `bun run build`

## FAQ

**Q: Works with OpenAI SDKs?** A: Yes, set `base_url=http://localhost:3456/v1`.

## ChatGPT Notes

Falls back to DOM simulation on 403. Slower but more reliable.
