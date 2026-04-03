# Token-Free Gateway

**[English](README.md)**

免费使用 ChatGPT、Claude、Gemini、DeepSeek 等 13 个主流 AI 模型 —— **无需 API Key，只需浏览器登录**。

Token-Free Gateway 是一个轻量级 OpenAI 兼容 API 网关，将网页端 AI 会话转化为标准的 `/v1/chat/completions` 接口，完整支持 **Tools / Function Calling** 协议。任何 OpenAI SDK 客户端均可直接接入，无需任何修改。

## 为什么选择 Token-Free Gateway？

| 传统 API 用法    | Token-Free Gateway |
| ---------------- | ------------------ |
| 购买 API Token   | **完全免费**       |
| 按请求付费       | 无配额、无账单     |
| 需要绑定信用卡   | 仅需浏览器登录     |
| API Key 可能泄露 | 凭证仅存储在本地   |

## 核心特性

- **一个接口，13 个平台** — Claude、ChatGPT、DeepSeek、豆包、Gemini、智谱 GLM、GLM 国际版、Grok、Kimi、Perplexity、千问国际版、千问国内版、小米 MiMo
- **100% OpenAI 兼容** — `/v1/chat/completions`、`/v1/models`、流式输出、`tool_calls` —— 客户端零改造
- **完整 Function Calling** — 将 tools 定义注入提示词，解析模型回复为标准 `tool_calls` 格式
- **跨平台二进制** — macOS、Linux、Windows 单文件可执行
- **守护进程模式** — `start` / `stop` / `restart` / `status`，像正规服务一样管理

---

## 快速开始

### 1. 安装

**下载预编译二进制**（推荐）—— 从 [GitHub Releases](../../releases) 获取：

```bash
tar xzf token-free-gateway-<platform>.tar.gz
chmod +x token-free-gateway
```

**从源码构建：**

```bash
git clone <repo-url> && cd token-free-gateway
bun install
bun run build    # → ./token-free-gateway
```

### 2. 启动 Chrome 调试模式

```bash
./token-free-gateway chrome
```

一个独立的 Chrome 实例会打开，自动加载所有 13 个平台的登录页面。

### 3. 登录并授权

在浏览器标签页中登录你想使用的平台，然后运行授权向导：

```bash
./token-free-gateway webauth
```

选择要授权的平台。凭证保存在 `~/.token-free-gateway/auth-profiles.json`。

> **DeepSeek 特殊说明：** 运行 `webauth` 时需要保持 DeepSeek 聊天页面处于打开状态，向导会自动抓取 bearer token。
>
> **提示：** 授权完成后如果终端未返回提示符，按 **Ctrl+C** 即可 — 凭证已保存。

### 4. 启动网关

```bash
./token-free-gateway start      # 后台守护进程
./token-free-gateway serve      # 前台运行（调试用）
```

网关默认监听 `http://localhost:3456`。

### 5. 接入使用

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3456/v1",
    api_key="any-string",
)

response = client.chat.completions.create(
    model="claude-sonnet-4-20250514",
    messages=[{"role": "user", "content": "你好！"}],
)
```

---

## 支持的平台

| 平台       | 模型 ID 前缀   | 认证方式              | 客户端类型      |
| ---------- | -------------- | --------------------- | --------------- |
| Claude     | `claude-*`     | Session cookie        | Fetch           |
| ChatGPT    | `chatgpt-*`    | Access token + cookie | Playwright CDP  |
| DeepSeek   | `deepseek-*`   | Bearer token + cookie | Fetch（含 PoW） |
| 豆包       | `doubao-*`     | Session cookie        | Fetch           |
| Gemini     | `gemini-*`     | Google SID cookie     | Playwright CDP  |
| 智谱 GLM   | `glm-*`        | Refresh token cookie  | Playwright CDP  |
| GLM 国际版 | `glm-intl-*`   | Session cookie        | Playwright CDP  |
| Grok       | `grok-*`       | SSO cookie            | Playwright CDP  |
| Kimi       | `kimi-*`       | Access token          | Playwright CDP  |
| Perplexity | `perplexity-*` | Next-auth cookie      | Playwright CDP  |
| 千问国际版 | `qwen-*`       | Session cookie        | Playwright CDP  |
| 千问国内版 | `qwen-cn-*`    | XSRF + cookie         | Playwright CDP  |
| 小米 MiMo  | `xiaomimo-*`   | Bearer token          | Fetch           |

> Playwright CDP 类 provider 需要安装运行时依赖：`npm i -g playwright-core`

---

## CLI 命令参考

```
token-free-gateway [command] [options]

命令：
  serve               前台启动（默认）
  start               后台守护进程启动
  stop                停止守护进程
  restart             重启守护进程
  status              查看运行状态
  webauth             授权 Web AI 平台
  chrome [start|stop] 启动/停止 Chrome 调试模式

选项：
  --help, -h          显示帮助
  --version, -v       显示版本号
```

---

## 配置

| 环境变量          | 默认值                  | 说明                                    |
| ----------------- | ----------------------- | --------------------------------------- |
| `PORT`            | `3456`                  | 监听端口                                |
| `GATEWAY_API_KEY` | _（空）_                | 客户端鉴权 Bearer Token；为空则关闭鉴权 |
| `CDP_URL`         | `http://127.0.0.1:9222` | Chrome 远程调试协议地址                 |

在二进制同目录创建 `.env` 文件：

```bash
PORT=3456
GATEWAY_API_KEY=my-secret-key
```

---

## API 端点

| 方法   | 路径                   | 说明                         |
| ------ | ---------------------- | ---------------------------- |
| `POST` | `/v1/chat/completions` | 对话补全（支持流式与非流式） |
| `GET`  | `/v1/models`           | 列出已授权平台的模型         |
| `GET`  | `/v1/models/:id`       | 查询模型详情                 |
| `GET`  | `/health`              | 健康检查                     |

---

## 工作原理

```mermaid
sequenceDiagram
    participant C as 客户端（OpenAI SDK）
    participant G as Token-Free Gateway
    participant P as Web AI 平台

    C->>G: POST /v1/chat/completions<br/>（messages + tools）
    G->>G: tools → 提示词注入<br/>路由到对应平台
    G->>P: 通过 Web 会话发送提示词
    P-->>G: 自由文本响应
    G->>G: 解析文本 → tool_calls
    G-->>C: 返回 OpenAI 格式的 tool_calls

    Note over C: 客户端本地执行工具

    C->>G: POST /v1/chat/completions<br/>（messages + tool 结果）
    G->>P: 转发工具执行结果
    P-->>G: 最终文本响应
    G-->>C: 返回最终回答
```

网关将 OpenAI 的结构化 `tools` 定义转换为提示词注入指令，发送给 Web AI，再将模型的自由文本响应解析为标准 `tool_calls`。客户端完全感知不到后端并非 OpenAI。

---

## 平台兼容性

| 功能                           | macOS | Linux | Windows              |
| ------------------------------ | ----- | ----- | -------------------- |
| 网关（`serve`/`start`/`stop`） | ✅    | ✅    | ✅                   |
| `chrome` 命令                  | ✅    | ✅    | ✅                   |
| `start-chrome-debug.sh`        | ✅    | ✅    | ⚠️ 需要 WSL/Git Bash |
| 全部 provider                  | ✅    | ✅    | ✅                   |

---

## 开发脚本

```bash
bun run dev         # 开发模式（热重载）
bun run test        # 单元测试
bun run check       # Biome lint + 格式检查
bun run lint:fix    # 自动修复所有问题
bun run typecheck   # TypeScript 类型检查
bun run build       # 编译独立二进制
```

---

## 常见问题

| 问题                    | 解决方案                                           |
| ----------------------- | -------------------------------------------------- |
| `/v1/models` 返回空列表 | 执行 `token-free-gateway webauth` 授权平台         |
| webauth 卡住            | 按 **Ctrl+C** — 凭证已保存                         |
| Chrome 启动失败         | 检查 9222 端口：`lsof -i:9222`                     |
| Playwright 报错         | 安装 `playwright-core`：`npm i -g playwright-core` |
| DeepSeek 认证失败       | 运行 webauth 时保持 DeepSeek 页面打开              |

---

## 致谢

本项目从 [openclaw-zero-token](https://github.com/linuxhsj/openclaw-zero-token) 抽离并重新设计，提取其 Web AI provider 层和 OpenAI 兼容模块，构建为一个专注于协议转换的独立轻量网关。

## License

MIT
