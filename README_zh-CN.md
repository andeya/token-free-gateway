# Token-Free Gateway（免 Token 网关）

> 基于网页会话的多提供商 OpenAI 兼容 AI 网关

## 支持的提供商

| 提供商 | 模型 ID 前缀 |
|--------|-------------|
| Claude (Anthropic) | `claude-web/` |
| ChatGPT (OpenAI) | `chatgpt-web/` |
| DeepSeek | `deepseek-web/` |
| 豆包 (字节跳动) | `doubao-web/` |

## 快速开始

```bash
bun install
./start-chrome-debug.sh
bun run webauth
bun run start
```
