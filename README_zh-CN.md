# Token-Free Gateway（免 Token 网关）

> 基于网页会话的多提供商 OpenAI 兼容 AI 网关

## 支持的提供商（共 13 个）

| 提供商 | 模型 ID 前缀 |
|--------|-------------|
| Claude (Anthropic) | `claude-web/` |
| ChatGPT (OpenAI) | `chatgpt-web/` |
| DeepSeek | `deepseek-web/` |
| 豆包 (字节跳动) | `doubao-web/` |
| Gemini (Google) | `gemini-web/` |
| 智谱 GLM | `glm-web/` |
| GLM 国际版 | `glm-intl-web/` |
| Grok (xAI) | `grok-web/` |
| Kimi (月之暗面) | `kimi-web/` |
| Perplexity | `perplexity-web/` |
| 通义千问 (阿里) | `qwen-web/` |
| 通义千问国内版 | `qwen-cn-web/` |
| 小米 MiMo | `xiaomimo-web/` |

## 快速开始

```bash
bun install
token-free-gateway chrome
token-free-gateway webauth
token-free-gateway start
```

## 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3456` | 服务器端口 |
| `GATEWAY_API_KEY` | — | 可选 API 密钥 |
| `CDP_URL` | `http://127.0.0.1:9222` | Chrome 调试地址 |

## 常见问题

**Chrome 无法连接**：运行 `token-free-gateway chrome start`。
**认证过期**：重新运行 `token-free-gateway webauth`。
