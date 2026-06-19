# AI Packet Sniffer

Windows 本地 AI 请求抓包工具。通过 MITM HTTP/HTTPS 代理捕获 OpenAI、Anthropic、Gemini、Hermes Agent、Claude Code 等 AI 客户端请求，并以会话和聊天消息形式展示。

## 功能概述

- 本地代理默认监听 `127.0.0.1:7890`，支持按 API 地址前缀过滤请求。
- 支持配置 Windows 系统代理、CLI 代理环境变量和 HTTPS CA 证书。
- 每个 HTTP AI 请求对应一条独立会话，展示模型、状态、Token 和消息内容。
- 支持 OpenAI、Anthropic、Gemini 兼容格式；Hermes 的终端、文件、补丁、网页、Skill 和数据库工具结果使用对应的结构化视图展示。
- 支持 Markdown、系统提示词折叠、模型思考摘要分段渲染并默认展开、工具调用与返回合并，并可在独立窗口查看原始请求和响应。
- 会话列表支持单条删除和按当前地址清空；会话列表和消息列表使用虚拟滚动，适用于大数据量场景。
- 数据保存在 `%APPDATA%\ai-packet-sniffer\store.json`，无需数据库服务。

## 开发调试

安装依赖并启动开发模式：

```bash
npm install
npm run dev
```

开发模式会自动修复 Electron 二进制、清理本项目残留进程，并启动 Vite 和 Electron。

## 测试

类型检查和全量测试统一执行：

```bash
npm test
```

该命令会依次执行 Vue 类型检查、Electron 类型检查和 Vitest。

## Windows 打包

生成 x64 NSIS 安装版、portable 免安装版和未压缩目录：

```bash
npm run build
```

打包流程会自动清理旧产物、修复 Electron 二进制并编译渲染进程和主进程。所有产物统一位于 `dist/`：

- `renderer/`：Vite 渲染进程产物。
- `electron/`：Electron 主进程和 preload 产物。
- `release/AI Packet Sniffer Setup <version>.exe`：Windows 安装版。
- `release/AI Packet Sniffer <version>.exe`：单文件免安装版。
- `release/win-unpacked/`：未压缩目录，用于排查打包后的运行问题。

当前未配置 Windows 代码签名证书，运行时可能出现 SmartScreen“未知发布者”提示。
