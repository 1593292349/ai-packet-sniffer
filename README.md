# AI Packet Sniffer

抓包本机所有进程发起的 AI 请求，按地址聚合，按微信聊天模式回放。

> 覆盖 Claude Code CLI、hermes-agent、浏览器、桌面应用等所有发往 AI 服务（OpenAI / Anthropic / Gemini 等）的 HTTP/HTTPS 请求。

---

## 功能

- 🔍 **本地 MITM 代理**：HTTP 透明转发 + HTTPS 证书解密
- 📋 **监听地址管理**：支持 origin 或 origin + path 前缀匹配
- 💬 **微信聊天回放**：自动识别 OpenAI Chat / OpenAI Responses / Anthropic Messages / Gemini 协议，把一次请求的所有消息按用户/助手气泡渲染
- 🌊 **流式 SSE 重组**：自动拼接 `data: {...}` 流式事件，还原 assistant 完整回答
- 📊 **会话索引**：按模型、HTTP 状态、token 用量、消息数统计
- 💾 **本地持久化**：所有抓包数据保存到本地 JSON，无云端依赖

---

## 安装

```bash
cd D:\git\ai-packet-sniffer
npm install
```

> 如果 Electron 二进制下载慢，可以设国内镜像：
> ```bash
> # Windows (PowerShell)
> $env:ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"
> npm install
> ```
> 或在 bash：
> ```bash
> ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/" npm install
> ```

---

## 启动

### 开发模式

```bash
# 同时启动 vite dev server + electron 主进程
npm run dev
```

### 生产模式

```bash
# 构建 Vue + 主进程
npm run build

# 启动
npx electron .
```

或一步到位：

```bash
npm start
```

启动后默认监听 `127.0.0.1:7890`，窗口自动打开。

---

## 使用流程

### 第 1 步：添加监听地址

窗口打开后，点顶栏 `+ 新增监听地址`，输入：

- `https://api.minimaxi.com/anthropic`（匹配该 origin + path 前缀下所有请求）
- `https://api.openai.com`（匹配该 origin 下所有请求）

内置 4 个常用预设：minimax anthropic / openai / anthropic / gemini。

### 第 2 步：安装 CA 证书（HTTPS 必需）

抓 HTTPS 必须先信任本工具生成的 CA 证书：

1. 顶栏点 **「导出 CA」** → 在资源管理器中显示 `sniffer-ca.crt`
2. 双击 `.crt` 文件 → **安装证书** → **本地计算机**
3. 选择 **「将所有的证书都放入下列存储」** → **受信任的根证书颁发机构**
4. 完成

> ⚠️ CA 证书只在你自己的本机使用，不要分享给他人。

### 第 3 步：配置代理

有两种方式让本机请求走本工具：

#### 方式 A：系统代理（覆盖大部分进程）

顶栏点 **「开启系统代理」** → 自动调用 `netsh winhttp set proxy 127.0.0.1:7890`

适用：浏览器、桌面应用、PowerShell 等走 WinHTTP 的进程。

#### 方式 B：环境变量（覆盖 Node.js CLI）

顶栏点 **「复制 CLI 环境变量」** → 在新打开的终端粘贴：

```cmd
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890
set NODE_EXTRA_CA_CERTS=%USERPROFILE%\AppData\Roaming\ai-packet-sniffer\ca\ca.crt.pem
```

适用：Claude Code、hermes-agent、任何 Node.js CLI。

> ⚠️ `NODE_EXTRA_CA_CERTS` 让 Node.js 信任我们的 CA，避免 `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 错误。

### 第 4 步：发起请求并查看

让任意工具（Claude Code、hermes-agent 等）发一次 AI 请求，窗口中：

1. **左侧**：监听地址列表，自动累计 `命中次数` 和 `最近命中时间`
2. **中间**：每次请求自动聚合成一个会话（按时间倒序）
3. **右侧**：按微信聊天模式渲染该会话的所有消息气泡

---

## 自定义端口

默认 7890，可通过环境变量修改：

```bash
SNIFFER_PORT=8888 npx electron .
```

端口冲突时会自动 +1，最多尝试 20 个端口。

---

## 数据存储

```
%APPDATA%\ai-packet-sniffer\
├── store.json              ← 业务数据（addresses / conversations / messages / raw_requests）
├── ca\
│   ├── ca.crt.pem          ← 根证书 PEM
│   ├── ca.key.pem          ← 根证书私钥
│   └── sniffer-ca.crt      ← 导出的 DER（点「导出 CA」生成）
└── logs\
    └── sniffer-YYYY-MM-DD.log   ← 运行日志
```

| 操作 | 怎么做 |
|---|---|
| 备份数据 | 复制整个 `%APPDATA%\ai-packet-sniffer\` |
| 重置所有数据 | 删 `store.json` |
| 重置 CA | 删 `ca\` 目录，下次启动自动重新生成 |
| 完全卸载 | 删整个 `%APPDATA%\ai-packet-sniffer\` |

---

## 架构

```
┌────────────────────────────────────────────────────────────┐
│                  Electron 主进程 (Node)                    │
│                                                            │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐   │
│  │ MITM Proxy   │───▶│  Parser      │──▶│ Store        │   │
│  │ 127.0.0.1:7890│   │ OpenAI/      │   │ JSON files   │   │
│  │ HTTP + HTTPS │   │ Anthropic/   │   └──────────────┘   │
│  │ CONNECT MITM │   │ Gemini + SSE │          │            │
│  └──────────────┘    └──────────────┘          │            │
│         │                                       ▼            │
│         │          ┌──────────────────────────────┐        │
│         │          │   IPC Bridge (preload.ts)    │        │
│         └─────────▶│   contextBridge.exposeMain... │        │
│                    └──────────────────────────────┘        │
└─────────────────────────────┬──────────────────────────────┘
                              │ IPC
┌─────────────────────────────▼──────────────────────────────┐
│             渲染进程 (Vue 3 + Chromium)                     │
│  ┌────────┐  ┌──────────┐  ┌──────────────┐               │
│  │ 地址   │  │ 会话     │  │ 微信聊天     │               │
│  │ 列表   │  │ 列表     │  │ 面板         │               │
│  └────────┘  └──────────┘  └──────────────┘               │
└────────────────────────────────────────────────────────────┘
```

---

## 项目结构

```
ai-packet-sniffer/
├── package.json
├── tsconfig.json                 # Vue 端
├── electron/
│   ├── tsconfig.json             # 主进程
├── vite.config.ts
├── index.html
│
├── src/                          # 渲染进程（Vue 3）
│   ├── main.ts
│   ├── App.vue
│   ├── styles.css
│   ├── types.ts
│   ├── api/                      # IPC 封装层
│   └── components/
│       ├── AddressList.vue
│       ├── SessionList.vue
│       ├── ChatPanel.vue
│       └── AddAddressDialog.vue
│
├── electron/                     # 主进程（Node）
│   ├── main.ts                   # 入口
│   ├── preload.ts                # contextBridge
│   ├── proxy/                    # MITM 代理
│   │   ├── server.ts
│   │   ├── ca.ts
│   │   └── capture.ts
│   ├── parser/                   # 协议解析
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   ├── gemini.ts
│   │   ├── sse.ts
│   │   └── index.ts
│   ├── store/                    # 数据持久化
│   │   ├── types.ts
│   │   ├── jsonStore.ts
│   │   └── repos/
│   │       ├── address.repo.ts
│   │       ├── conversation.repo.ts
│   │       ├── message.repo.ts
│   │       └── raw.repo.ts
│   ├── ipc/                      # IPC handlers
│   │   ├── address.ipc.ts
│   │   ├── conversation.ipc.ts
│   │   ├── proxy.ipc.ts
│   │   ├── ca.ipc.ts
│   │   └── app.ipc.ts
│   ├── logger.ts                 # 日志
│   └── matcher.ts                # URL 匹配
│
├── test/                         # 测试（vitest）
│   └── parser.test.ts
│
├── dist/                         # Vite 产物（自动生成）
└── dist-electron/                # tsc 产物（自动生成）
```

---

## 测试

```bash
npm test
```

覆盖协议解析、URL 匹配、SSE 拆解等核心逻辑。

---

## 已知限制

| 限制 | 说明 |
|---|---|
| HTTPS 需信任 CA | 一次性配置，每个使用本工具的机器都要做 |
| Electron 内部请求 | Electron 应用内的 `fetch` 不走系统代理，需单独支持（暂未实现） |
| WebSocket | 当前只抓 HTTP/HTTPS，不抓 WebSocket（暂未实现） |
| 大请求体 | 单个请求/响应超过 50MB 会被截断 |

---

## License

MIT