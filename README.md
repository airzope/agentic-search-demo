# CJK 搜索工作台 · CJK Search Studio

一个可本地运行、对中日韩（CJK）友好的知识库搜索与问答工作台，基于 [Meilisearch](https://www.meilisearch.com/)、[pi agent](https://github.com/earendil-works/pi)、[Palantir OSDK](https://github.com/palantir/osdk-ts) 与 [Vercel AI SDK](https://ai-sdk.dev/)：

- **本地目录即知识库**：把任意文件夹映射为知识库，增量同步（按大小与修改时间比对），可监听目录变化自动同步；也可以在浏览器里上传文件或整个文件夹。
- **文档转换与内置 OCR**：Office（docx/xlsx/pptx）、PDF、EPUB、HTML、Markdown、文本、代码等由 [anydoc](https://github.com/firecrawl/anydoc) 转为 Markdown；图片、扫描版 PDF（只识别需要的页面）和多页 TIFF 由**内置的 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)**（PP-OCRv6，ONNX Runtime 进程内运行，无需 Docker 或 Python）识别，模型首次使用时自动下载。GBK / Big5 / Shift_JIS / EUC-KR 编码的文本会自动识别。
- **自带 Qwen3-Embedding**：内置 Qwen3-Embedding-0.6B（GGUF，llama.cpp 进程内运行，CPU / Metal / CUDA / Vulkan），首次使用自动下载（Hugging Face、hf-mirror、ModelScope 可选），支持 MRL 降维；也可切换到 Ollama、TEI、vLLM、百炼、硅基流动等 OpenAI 兼容服务。
- **大规模、多分支**：文件按标题结构切块，每块记录所在目录及全部上级目录，目录树（含各分支文件数）由 facet 实时统计；可按目录分支筛选搜索；「大规模」预设使用更低向量维度与更省资源的索引设置。
- **多知识库、本地 + 云端**：可添加多个 Meilisearch 实例（本机、Meilisearch Cloud、团队服务器），任意组合的知识库一起检索，按相关度统一排序（federated search）。
- **pi agent 问答，多来源引用**：问答由 pi agent（`@earendil-works/pi-agent-core`）驱动，可以一次发出多个查询、浏览目录结构、精读原文；「深度模式」先拆解子问题、多轮检索、阅读 2–5 篇文档后再综合作答。每条资料有对话内统一的编号，一句话可以同时引用多个来源，例如 `[2][5]`；回答下方列出参考来源，点击可打开原文并定位到命中的段落。回答过程中还可以继续输入「补充要求」，智能体会在当前检索完成后调整方向。对话历史保存在浏览器中。
- **接入 Palantir Foundry 本体，可信推理与问答**：用 [osdk-ts](https://github.com/palantir/osdk-ts)（`@osdk/client`、`@osdk/oauth`）连接一个或多个 Foundry 本体，无需生成 SDK。问答助手可以查询对象、沿链接追溯关系，统计数字由 Foundry 聚合计算，业务规则交给 Foundry 函数；每个对象、统计和函数结果都有引用编号，并保留产生它的 OSDK 调用，可以复现。引用的对象可以与 Foundry 当前数据比对，回答后可**逐条核验**：每句陈述的引用是否存在、其中的数字能否在来源中找到，再由模型判断是否有依据。写操作只能以「动作提议」出现，经 Foundry 校验并由你批准后才执行，并写入审计日志。
- **知识库管理**：文件浏览器列出每个文件的处理状态（已索引 / 失败及原因 / 跳过），支持搜索、筛选、查看转换后的内容、打开原文件、重新处理、删除或排除、批量操作；同步记录；在线修改语言、切块、向量维度和规模（自动重建）。
- **分词管理**：可视化编辑自定义词典、同义词、停用词、分隔符与字段语言，并提供**由引擎实测的分词预览**。
- **主流 LLM 接入**：OpenAI、Anthropic Claude、Google Gemini、OpenRouter、DeepSeek、通义千问、Kimi、智谱 GLM、豆包、硅基流动、Ollama，以及任意 OpenAI 兼容接口。
- **CJK 体验**：中英双语界面；按内容自动选择中、日、韩字体；输入法组字时按 Enter 不会误发送或误搜索。

设计说明见 [docs/DESIGN.md](docs/DESIGN.md)。

## 快速开始

需要 Node.js 22.19+、pnpm 和 Docker（只用于运行 Meilisearch）。

```bash
cp .env.example .env               # 按需填写 LLM Key（也可以稍后在「设置」页填写）
docker compose up -d               # Meilisearch：http://127.0.0.1:7700
pnpm install
pnpm dev                           # 打开 http://localhost:3000
```

1. 打开「设置 → 向量引擎」，点击「下载模型」（约 640 MB）。离线环境可把 `Qwen3-Embedding-0.6B-Q8_0.gguf` 直接放进 `.data/models/`。
2. OCR 无需配置：第一次遇到图片或扫描件时自动下载 PaddleOCR 模型（约 31 MB，依次尝试 Hugging Face、ModelScope、hf-mirror、PyPI）。也可以在「设置 → PaddleOCR」中提前下载、切换模型或测试。
3. 到「知识库 → 新建知识库」，选择「映射本地目录」并浏览选择文件夹，或选择「上传文件」。创建后自动开始同步，进度、失败文件和目录树都在知识库详情页查看。
4. 在「搜索」或「问答」顶部选择检索范围（可多选、可跨实例）。复杂问题打开「深度模式」。

也可以在「知识库」页导入中、日、韩示例数据，快速体验分词预览、搜索和问答。

### 使用本地模型（可选）

```bash
docker compose --profile ollama up -d
docker compose exec ollama ollama pull qwen3:8b              # 对话模型（需支持工具调用）
docker compose exec ollama ollama pull qwen3-embedding:0.6b  # 可选：用 Ollama 生成向量（GPU 更快）
```

- 对话：在「设置 → 大模型 → Ollama」中保存一次即可启用（默认地址 `http://127.0.0.1:11434/v1`）。
- 向量：在「设置 → 向量引擎」切换到「外部服务」并选择 Ollama 预设。更换向量模型后，已有知识库会在下次同步时自动重建。
- 「向量」页仍可为普通索引配置 Meilisearch 自带的 embedder（Ollama、OpenAI、REST、HuggingFace）。

> Meilisearch 默认禁止 embedder 访问内网 IP（包括 localhost）。`docker-compose.yml` 已通过 `MEILI_EXPERIMENTAL_ALLOWED_IP_NETWORKS` 放行私有网段。如果你用其他方式运行 Meilisearch，请自行设置这个变量。知识库的 Qwen3 向量由应用生成后写入（userProvided），不受此限制。

### 接入 Palantir Foundry 本体

1. 打开「本体 → 连接本体」，填写 Foundry 地址（如 `https://example.palantirfoundry.com`）和认证方式：用户 / 服务用户令牌，或 OAuth 客户端（Client ID + Secret，client credentials）。点「检测」从列表中选择本体，或直接填写本体 RID / API 名称，再「测试连接」。
2. 按需勾选「允许运行 Foundry 函数」「允许助手提议动作」；在连接详情的「设置」中可以限定助手能使用的对象类型。
3. 在「问答」顶部的检索范围里勾选本体（可以与知识库一起选），提问即可。回答下方点「核验」可逐条检查。

也可以用环境变量配置一个只读连接：`FOUNDRY_URL`、`FOUNDRY_ONTOLOGY`、`FOUNDRY_TOKEN`（或 `FOUNDRY_CLIENT_ID` / `FOUNDRY_CLIENT_SECRET`），见 `.env.example`。

没有 Foundry 环境时，可以运行本地模拟本体体验（一个中日韩数据的供应链本体，含链接、函数和动作；仅用于开发与测试）：

```bash
pnpm mock:foundry   # http://127.0.0.1:4020，本体 supply-chain，令牌 dev-token
```

### 云端知识库

在「设置 → Meilisearch 实例」中添加实例（例如 Meilisearch Cloud 的地址与 Admin Key）。之后可以在新建知识库时把索引存放到该实例，内容仍由本机转换和生成向量；该实例上已有的索引也会作为知识库出现，可以与本地知识库一起检索。

## 配置

| 位置     | 说明                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env`   | 默认值：Meilisearch、各家 LLM 的 `*_API_KEY` / `*_MODEL` / `*_BASE_URL`、`EMBEDDING_*`、`OCR_*`、`FOUNDRY_*` 等，完整列表见 `.env.example`                                                                                            |
| 设置页   | 在界面中修改的配置保存到 `.data/settings.json`，优先级高于 `.env`。API Key 只保存在服务端，不会返回给浏览器                                                                                                                           |
| `.data/` | 应用数据（已加入 gitignore）：`settings.json`、知识库登记 `kb.json`、本体连接 `ontologies.json`、动作审计日志 `ontology-audit.jsonl`、每个知识库的同步清单与上传文件 `kb/<id>/`、模型文件 `models/`。可用 `APP_DATA_DIR` 指定其他位置 |

设置页可以从供应商的 `/models` 接口拉取实时模型列表，并一键测试连接。

## CJK 使用建议

- **声明字段语言**：以汉字为主的短文本可能被识别成日文，导致切分不一致。新建索引时选择语言预设，或在「分词 → 字段语言」中填写，例如 `title, content => cmn`。
- **自定义词典**：专有名词、产品名不想被切开时加入词典。也可以在分词预览中选中文字，点击「加入词典」。
- **繁简互通**：Meilisearch 不会自动在繁体和简体之间转换，请用同义词配置，例如 `台湾, 臺灣`。
- **向量模板长度**：中日韩文字每个字约占 3 字节。Meilisearch 默认的 `documentTemplateMaxBytes` 只有 400，本应用默认设为 2000（仅影响 Meilisearch 自带 embedder）。
- **切块长度**：知识库默认每块约 800 字、重叠 100 字，表格与代码块不会被重叠截断。问答助手会按需读取相邻块或整篇文档。
- **扫描件与图片**：识别结果按页写入 Markdown；部分扫描的 PDF 只对扫描页做 OCR，其余页面使用 PDF 自带文字。Word / PPT 中的内嵌图片默认不识别，可在知识库选项中打开（较慢）。韩文图片请在「设置 → PaddleOCR」中切换为韩文模型。

## 项目结构

```
src/app/                    页面与 API（Next.js App Router）
  api/kb/…                  知识库：创建 / 同步 / 文件管理 / 原文件 / 同步记录 / 设置
  api/search                多知识库联合检索（关键词 / 混合 / 语义）
  api/chat, chat/steer      pi agent 流式问答（知识库工具 + 本体工具）与补充要求
  api/chat/verify           答案逐条核验
  api/ontology/…            本体连接、元数据、对象浏览、动作校验与执行、审计日志
  api/embedding, ocr, fs    向量引擎、内置 OCR 的状态与下载，目录浏览
  api/tokenize              引擎实测分词预览
src/lib/agent/              pi agent：模型适配（pi-ai）、知识库与本体工具、历史转换、引用编号、核验
src/lib/ontology/           Palantir OSDK：连接与认证、元数据缓存、对象 / 链接 / 聚合 / 函数 / 动作
src/lib/ocr/                内置 PaddleOCR：模型下载（多源）、图片 / PDF / TIFF 识别
src/lib/kb/                 知识库：转换（anydoc + OCR）、切块、同步任务、目录监听、检索、文件清单
src/lib/embedding/          内置 Qwen3-Embedding（node-llama-cpp）与外部向量服务
src/components/views/       问答、搜索、知识库、分词、向量、设置页面
scripts/mock-foundry.mjs    本地模拟的 Foundry 本体 API（开发与测试用）
docker-compose.yml          Meilisearch，以及可选的 Ollama
```

常用脚本：`pnpm dev`、`pnpm build`、`pnpm lint`、`pnpm format`、`pnpm mock:foundry`。

## 安全提示

本应用面向本机或内网使用，没有登录鉴权。能访问该端口的人可以修改索引、浏览本机目录结构、把本机目录映射为知识库（从而读取其中的文件内容），消耗你的 LLM 额度，并以你配置的 Foundry 凭证读取本体（若开启了动作，还可以批准执行动作）。Foundry 令牌请使用权限尽量小的服务用户。如需对外提供服务，请在前面加一层鉴权（例如反向代理），或只监听本机：`pnpm dev -H 127.0.0.1`。

---

## English

A local-first knowledge-base search and Q&A workbench for Chinese, Japanese and Korean, built on Meilisearch, the pi agent, the Palantir OSDK and the Vercel AI SDK:

- **Folders as knowledge bases**: map any local directory (incremental sync, optional file watching) or upload files and folders in the browser.
- **Conversion and built-in OCR**: Office, PDF, EPUB, HTML, Markdown, text and code are converted with anydoc; images, scanned PDF pages and multi-page TIFFs are recognized by PaddleOCR (PP-OCRv6) running in-process on ONNX Runtime, with no Docker or Python. Models download on first use (Hugging Face, ModelScope, hf-mirror or PyPI). Legacy CJK encodings are detected.
- **Built-in Qwen3-Embedding**: Qwen3-Embedding-0.6B (GGUF) runs in-process via llama.cpp, downloaded on first use from Hugging Face, hf-mirror or ModelScope; or use any OpenAI-compatible embedding service.
- **Large, deeply nested trees**: heading-aware chunks carry their folder ancestry, so the folder tree, per-branch counts and branch-scoped search come straight from Meilisearch facets and filters.
- **Many knowledge bases, local and cloud**: add several Meilisearch instances and search any combination with federated, score-merged results.
- **pi agent Q&A with multiple citations**: a pi agent (`@earendil-works/pi-agent-core` + `pi-ai`, covering all 12 configured LLM vendors) searches with several queries, browses folders and reads documents; deep mode plans sub-questions first. Sources get conversation-wide numbers, so one claim can cite several sources ([2][5]); each answer lists its sources. You can steer a running answer with follow-up guidance, and conversations are kept in the browser.
- **Palantir Foundry ontologies with verifiable answers**: connect one or more ontologies through [osdk-ts](https://github.com/palantir/osdk-ts) (`@osdk/client`, `@osdk/oauth`; token or OAuth client credentials, no generated SDK needed). The assistant queries objects, follows links, lets Foundry compute aggregations and run functions; every object, aggregation and function result is a numbered citation that keeps the OSDK call behind it. Cited objects can be compared with current Foundry data, and answers can be checked claim by claim (citations exist, numbers appear in the cited sources, plus a model judge). Writes only appear as action proposals that Foundry validates and you approve; applied actions are logged. `pnpm mock:foundry` starts a local mock ontology for trying it out.
- **Knowledge base management**: a file browser with per-file status (indexed / failed with reason / skipped), search and filters, content preview, original file, reprocess, delete or exclude, bulk actions, sync history, and editable language, chunking, vector size and scale (with automatic rebuild).
- Tokenization management with an engine-accurate preview, 12 LLM providers, and a bilingual, IME-safe UI.

Quick start (Node.js 22.19+): `cp .env.example .env && docker compose up -d && pnpm install && pnpm dev`, download the embedding model under Settings → Embedding engine, then create a knowledge base on the Knowledge page. See [docs/DESIGN.md](docs/DESIGN.md) for the design (in Chinese).
