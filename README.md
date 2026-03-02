# Token-Free Gateway

> Multi-provider OpenAI-compatible AI gateway powered by web sessions

## Overview

Proxies AI provider web interfaces as an OpenAI-compatible API with no API keys required.
Uses browser sessions captured via Chrome DevTools Protocol (CDP).

## Requirements

- [Bun](https://bun.sh/) runtime
- Google Chrome

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
