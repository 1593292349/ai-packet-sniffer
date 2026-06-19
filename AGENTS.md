# AGENTS.md

优先级：用户当前要求 > 源码/配置/测试 > 本文件。

## 事实

- Windows 10 Electron 应用；Electron 32、Vue 3、TypeScript 5、Vite 5、ant-design-vue 4；终端为 Git Bash/MSYS。
- MITM HTTP/HTTPS 代理默认 `127.0.0.1:7890`，冲突时再试 19 个端口。
- 协议：OpenAI Chat/Responses、Anthropic Messages、Gemini generateContent/streamGenerateContent 及兼容接口。
- 数据流：Proxy → CaptureService → parser → JsonStore/Repository → IPC/preload → Vue。
- 用户目录：`%APPDATA%\ai-packet-sniffer\{store.json,logs/,ca/}`。
- Store 顶层：`addresses`、`conversations`、`messages`、`raw_requests`、`_nextIds`；raw 单条保存请求+响应，conversation 使用 `raw_request_id`，`raw_response_id` 仅兼容旧结构。
- JsonStore 整文件加载/序列化；Repository 主要数组扫描/排序；真实数据可达数十 MB、数千消息。
- `package.json` 仅允许 `dev/test/build`；生成目录仅 `dist/{renderer,electron,release}`；`package-lock.json` 当前被忽略。

## 影响面索引

- `主进程/抓包`：`electron/{main,proxy,ca,capture,matcher,logger}.ts`。
- `协议/消息`：`electron/parser/`、`test/{parser,capture}.test.ts`。
- `Store/DTO/IPC`：`electron/store/`、`electron/ipc/`、`electron/preload.ts`、`src/api/index.ts`、`src/types.ts`、调用组件。
- `Renderer`：`src/`、`index.html`。
- `系统配置`：`electron/systemProxy.ts`、`electron/ipc/proxy.ipc.ts`、`electron/preload.ts`、`src/App.vue`。
- `命令/构建`：`package.json`、`scripts/`、`vite.config.ts`、`vitest.config.ts`、`tsconfig.json`、`electron/tsconfig.json`、`test/scripts.test.ts`、README。

## 不变量

### 抓包与存储

- Address = 同 origin + path 前缀；不要假定支持通配符。
- Address `hit_count` 等于当前保留的 conversation 数量；删除或清空会话时同步重算并刷新地址列表。
- 仅命中地址且成功识别的 POST 对话请求入库；models、props、embeddings、moderations、count_tokens、TTS 等不得创建 conversation。
- 一请求一 conversation，禁止按地址/时间合并；`raw_request_id` 唯一关联本次 raw；全部 message 使用同一 `conversation_id`，按 `seq` 保序。
- 删除会话级联其 messages 和不再被引用的 raw；清空仅作用于当前地址并保留地址配置，同时关闭被删 raw 的独立窗口。
- 协议识别组合 URL、请求体语义、协议 header 或响应信号；不能仅凭 `input`、`messages` 或地址命中。
- 协议变更加入脱敏真实样本；测试只用临时目录/脱敏夹具。禁止输出/提交完整 header/body、凭据、Cookie、提示词、`ca.key.pem`。
- Schema 兼容旧数据；共享 DTO 字段名/枚举/可空性一致，重点检查 Raw 的 `req_headers`、`req_body`、`ended_at`、`protocol`。
- 避免重复全量复制/序列化、深度 watch、O(n²) Store 查询；用接近真实规模的数据验证。

### UI 与消息

- 保持现有 ant-design-vue 风格和紧凑顶栏；成功不提示；破坏性操作只确认一次。
- 主窗口初始大小为 1300×850；消息卡片及其全部后代文字统一为 12px，不影响顶栏、会话列表和原始数据窗口。
- system/developer/user/assistant/tool 按原始顺序；system/developer 不置顶、默认折叠，系统提示词使用中文标题并固定在滚动区外，正文滚动容器最大高度 550px。
- 除系统提示词外，用户、助手、思考和工具卡片统一使用 `88%` 宽度，不设最大宽度；系统提示词左对齐工具卡片、右对齐用户卡片。
- assistant：`markdown-it`、trim、`html:false`、Markdown 根容器 `white-space:normal`，禁止在 assistant 气泡恢复 `pre-wrap`；用户气泡限宽并换行。
- 模型可见思考摘要统一保存到 assistant `message.meta.reasoning`；正文与思考分离，各段使用 Markdown 独立渲染，思考默认展开且内容区限高滚动，收起时不显示内容摘要。
- 工具调用优先按 `call_id`、`tool_call_id`、`tool_use_id` 关联结果；缺少 ID 时仅在同一连续调用区间按名称或位置匹配。所有工具调用卡片使用蓝色 Tag 显示工具类型，不显示“工具调用：”前缀；主参数和中文补充参数完整换行且禁止省略，`search_files` 的实际参数按 `参数名：参数值` 每项独占一行，参数值使用项目统一灰色，返回区仅显示正文滚动容器；展开时保持摘要且不显示原始参数 JSON；Hermes 结果结构化：`web_search` 不显示结果标题，每条仅显示标题、可点击网址和“查看”按钮，描述在模态框展示；`browser_navigate` 标题/URL/snapshot；terminal 返回区仅以通用纯文本样式显示 output；patch 摘要；`read_file` 直接显示纯文本 content；`skill_view` 返回区仅显示“技能目录”和纯文本 content；工具返回的正文、列表和表格滚动容器统一限高 420px，正文不自动换行，超宽内容使用横向滚动条；不显示 JSON/XML 外壳。
- 会话列表：固定高度 `RecycleScroller`，66px + 8px = `item-size 74`。IPC 当前默认返回最近 500 条；不能以此替代分页/虚拟滚动。
- 消息列表：动态高度 `DynamicScroller`；禁止全量 DOM、最近 N 条、加载更多替代；`size-dependencies` 与展开 key 一致，展开/收起后在首次绘制前同步实测高度到尺寸缓存，避免 ResizeObserver 延迟导致其他卡片抖动。
- 系统提示词、思考过程和工具卡片仅允许点击右侧蓝色“展开/收起”按钮切换状态，标题和摘要区域不得触发。

### Electron 与系统

- `electron/main.ts` 只组装生命周期、Store、Proxy、IPC、窗口；业务放 capture/parser/store/IPC。
- 保持 `contextIsolation:true`、`nodeIntegration:false`、renderer sandbox、`webSecurity`；preload 仅暴露固定且在用的 API/channel。
- `ipcRenderer.invoke` 返回 `Promise<DTO>`；handler 校验 sender/参数；删除功能同步清理 handler/preload/renderer API/DTO。
- 不放宽 CSP 的 `'unsafe-inline'/'unsafe-eval'`；外部导航、新窗口、`shell.openExternal` 限制目标。
- 代理、环境变量、端口、证书、进程操作仅限本项目；不终止归属不明的进程。
- `HKCU:\Environment` 六项：`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NODE_EXTRA_CA_CERTS`、`REQUESTS_CA_BUNDLE`、`SSL_CERT_FILE`；验证前保存，结束后原样恢复。
- CodeMirror：`EditorView/basicSetup` 从 `codemirror` 导入；独立 `@codemirror/*` 仅 v6；禁止引入 `@codemirror/basic-setup@0.20.x`。
- 中间 npm 任务归 `scripts/project.js`；Windows 能力由 Node 调用 `powershell.exe/netstat.exe/taskkill.exe`；禁止手改 `dist/`。

## 门禁

- 默认：定向测试 → `npm test` → `npm run build`。
- parser/capture/store：验证真实格式、非对话过滤、一请求一会话、ID 关联、旧数据兼容。
- Vue/虚拟滚动：Chromium 验证 DOM 数量、顺序、展开重测、切换会话、滚动位置；源码字符串测试不算运行验证。
- Electron/IPC/proxy：`npm run dev` 验证 Store、端口、IPC、窗口；系统状态恢复原值。
- 打包：确认 NSIS、portable、win-unpacked；涉及启动路径/打包行为时启动目标产物。
- `npm test` 不对 `test/`、`vitest.config.ts` 做 TypeScript 语义检查。
- 依赖范围看 `package.json`，实际版本用 `npm ls --depth=0` 核对。
