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

## DeepSeek Notes

Handles Proof-of-Work challenge automatically via embedded WASM.

## Gemini Notes

Uses Playwright for page interaction (no direct API endpoint).

## Known Limitations

- Requires local Chrome
- Sessions expire (re-run webauth)
- Not for high-volume production

## Release Notes

### v0.5.0 (upcoming)
- 13 providers
- Streaming support
- Background daemon
- Tool calling

## Multi-Provider

Run multiple instances on different ports for load balancing.

## Cancellation

Requests can be cancelled by closing the client connection.

## Perplexity Notes

Citation markers are stripped from responses.

## Grok Notes

Uses grok.x.com API. Re-authorize if site changes.

## Kimi Notes

Uses refresh tokens for session management.

## Qwen Notes

Supports both domestic and international Qwen endpoints.

## GLM Notes

GLM and GLM-intl are separate providers with separate auth.

## Docker

Docker image not yet provided. Use binary or Bun directly.

## Provider Integration

All providers use CDP-based session capture except Gemini (Playwright).

## Contributing

PRs welcome. Run `bun run check` before submitting.

## OpenAI SDK Integration

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3456/v1", api_key="none")
```

## API Examples

```bash
# Chat
curl http://localhost:3456/v1/chat/completions -d '{...}'
# Models
curl http://localhost:3456/v1/models
# Health
curl http://localhost:3456/health
```

## Provider Comparison

| Provider | Auth Method | Streaming | Notes |
|----------|------------|-----------|-------|
| Claude | Cookie | SSE | Fastest |
| ChatGPT | Session | SSE/DOM | DOM fallback |
| DeepSeek | Cookie+PoW | SSE | WASM solver |
