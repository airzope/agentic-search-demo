# 设计文档：CJK 搜索工作台

> 第 1–9 节是第一版（分词、混合搜索、多模型问答）；第 10–16 节是第二版（大规模多分支知识库）。

> 一个可本地运行、对中日韩（CJK）友好的搜索工作台：管理分词、混合搜索、接入主流大模型做问答。

## 1. 目标与范围

| 需求          | 方案                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 简洁完整的 UI | 左侧导航 + 6 个页面（问答 / 搜索 / 分词 / 向量 / 数据 / 设置），所有页面共享一个「当前索引」                                |
| 兼容 CJK      | 中英双语界面；按内容自动设置 `lang` 以选择正确的中/日/韩字形；输入法（IME）组字期间不触发发送和搜索；高亮按 Unicode 处理    |
| 管理分词      | 可视化编辑自定义词典、同义词、停用词、分隔符、字段语言，并提供**基于引擎实测**的分词预览                                    |
| 混合搜索      | 关键词 / 混合 / 语义三种模式，`semanticRatio` 可调；在页面上管理向量模型（embedder）                                        |
| 本地运行      | `docker compose up -d` 启动 Meilisearch，`pnpm dev` 启动应用；可选 Ollama 提供本地 LLM 和本地向量                           |
| 接入主流 LLM  | OpenAI、Anthropic、Gemini、DeepSeek、通义千问、Kimi、智谱 GLM、豆包、硅基流动、OpenRouter、Ollama，以及任意 OpenAI 兼容接口 |

不在范围内：多用户和权限（定位为本地或内网工具）、文档编辑器、向量数据库以外的检索后端。

## 2. 总体架构

```
浏览器（Next.js 客户端页面）
   │  fetch /api/*            useChat → /api/chat (SSE)
   ▼
Next.js Route Handlers（服务端，持有所有密钥）
   ├── lib/meili.ts      → Meilisearch（分词、关键词、向量、混合检索）
   ├── lib/llm.ts        → Vercel AI SDK → 各家 LLM
   └── lib/settings.ts   → .data/settings.json（覆盖 .env 中的默认值）
```

- **搜索引擎：Meilisearch。** 它内置 charabia 分词器：中文用 jieba（关闭 HMM）并把长词再细分为二字/三字词；日文用 lindera（UniDic）；韩文用 lindera（ko-dic）。它原生支持 `dictionary`、`synonyms`、`stopWords`、`separatorTokens`、`nonSeparatorTokens` 和 `localizedAttributes`，也原生支持混合检索。
- **LLM：Vercel AI SDK。** 一个统一的 `streamText` 加上四类 provider（`openai`、`anthropic`、`google`、`openai-compatible`）。国内厂商和本地模型都走 OpenAI 兼容协议。
- **配置：** `.env` 提供默认值；在「设置」页保存的内容写入 `.data/settings.json`（已加入 gitignore），优先级高于 `.env`。API Key 只保存在服务端，返回给前端的只有「是否已配置」和末 4 位。

## 3. 页面设计

```
┌────────────────┬──────────────────────────────────────────────┐
│ ◆ CJK 搜索工作台 │  页面标题                         [操作按钮] │
│ [当前索引 ▾]    │ ─────────────────────────────────────────────│
│                │                                              │
│ 💬 问答         │                 页面内容                      │
│ 🔍 搜索         │                                              │
│ ✂️ 分词         │                                              │
│ 🧭 向量         │                                              │
│ 🗂 数据         │                                              │
│ ⚙️ 设置         │                                              │
│                │                                              │
│ ● Meili v1.x   │                                              │
│ 中 / EN   ☀/☾  │                                              │
└────────────────┴──────────────────────────────────────────────┘
```

移动端的侧栏会收起为顶部横向导航。

| 页面 | 路由            | 主要内容                                                                                                                                    |
| ---- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 问答 | `/`             | LLM 自动调用 `search_documents` / `get_document` 检索当前索引后回答；回答内的引用标记 `[1]` 可展开查看来源；顶部可切换模型和检索模式        |
| 搜索 | `/search`       | 输入即搜（IME 友好）；模式切换和语义比例滑块；选择 embedder 和查询语言；结果高亮、得分、语义命中数；分面筛选；点击结果查看完整文档          |
| 分词 | `/tokenization` | 左侧 5 个编辑器（词典、同义词、停用词、分隔符、字段语言），右侧实时分词预览；先预览草稿，确认后一次性保存                                   |
| 向量 | `/embedders`    | 管理 embedder：OpenAI、Ollama（本地）、OpenAI 兼容 REST（硅基流动、通义、智谱等）、HuggingFace（在 Meilisearch 内本地推理）；显示向量化进度 |
| 数据 | `/indexes`      | 索引列表，以及新建（可选语言预设）和删除；导入 JSON / NDJSON / CSV；一键导入中、日、韩示例数据；任务日志；高级 JSON 设置编辑                |
| 设置 | `/settings`     | Meilisearch 连接；各 LLM 供应商的 Key、Base URL 和模型（可在线拉取模型列表并测试连接）；默认供应商；界面语言和主题                          |

### 分词编辑器的格式（统一为「一行一条」文本，简洁且易于批量粘贴）

- 词典、停用词、分隔符、非分隔符：每行一个词。
- 同义词沿用 Solr/Elasticsearch 的写法：
  - `电脑, 计算机, PC`：互为同义（双向）。
  - `AI => 人工智能, 机器学习`：单向，搜 AI 时也匹配右侧的词。
- 字段语言：`title, content => cmn` 表示把这些字段强制按中文分词；可写多行，例如 `*_ja => jpn`。

## 4. 关键设计：CJK

1. **语言歧义。** 以汉字为主的短文本可能被识别成日文（反之亦然），导致索引时和查询时的切分不一致，召回率下降。因此：
   - 新建索引时可选择语言预设，自动写入 `localizedAttributes`。
   - 搜索和问答都可以指定查询语言（Meilisearch 的 `locales` 参数）；未指定时，后端按「当前索引的 `localizedAttributes`」推断。
2. **引擎实测的分词预览。** Meilisearch 没有提供 analyze 接口，而在 JS 中模拟 jieba 加 lindera 的结果并不可靠。所以预览的做法是：
   - 维护一个隐藏的临时索引 `__tokenizer_preview`，写入与草稿相同的分词设置，并关闭拼写容错和前缀匹配。
   - 把预览文本作为文档写入，再用该文本本身作为查询，读取 `_matchesPosition`。每个命中位置都是引擎真实的词边界。
   - Meilisearch 只处理查询的前 10 个词，因此从「第一个未覆盖的位置」开始反复查询，直到覆盖全文。jieba 的动态规划是后缀最优的，从词边界截断不会改变后续切分。
   - 返回的位置是 UTF-8 字节偏移，需要换算为字符下标。未命中的片段会被标注为「停用词」「分隔符」或「未匹配」。
   - 所有预览请求串行执行，避免相互覆盖。
3. **输入法。** 回车发送前检查 `isComposing` 和 `keyCode === 229`。输入即搜在 `compositionend` 之后才触发，避免把拼音字母当作关键词去搜索。
4. **高亮。** 使用 Unicode 私用区字符 `U+E000`/`U+E001` 作为高亮标签，前端据此切分并渲染 `<mark>`，不使用 `dangerouslySetInnerHTML`，既安全又不会截断多字节字符。
5. **字体。** 字体栈按 `:lang(zh|ja|ko)` 分别指定。搜索结果和对话内容按文字所属的书写系统推断 `lang`，汉字会显示为对应语言的正确字形。

## 5. 混合搜索

- 关键词模式不带 `hybrid`；混合模式使用 `hybrid: { embedder, semanticRatio }`，语义模式等于 `semanticRatio = 1`。
- 向量页提供 embedder 预设：

| 预设             | source        | 说明                                                                                                    |
| ---------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| OpenAI           | `openAi`      | `text-embedding-3-small`，多语言                                                                        |
| Ollama（本地）   | `ollama`      | 推荐 `bge-m3`，中日韩效果好；Meilisearch 跑在 Docker 中时，URL 用 `host.docker.internal`                |
| OpenAI 兼容 REST | `rest`        | 硅基流动 `BAAI/bge-m3`、通义 `text-embedding-v4`、智谱 `embedding-3` 等，自动生成 request/response 模板 |
| HuggingFace      | `huggingFace` | 在 Meilisearch 进程内本地推理，例如 `BAAI/bge-small-zh-v1.5`                                            |

- `documentTemplate` 按推断出的标题字段和正文字段自动生成：`{{doc.title}}\n{{doc.content}}`。
- `documentTemplateMaxBytes` 默认设为 2000。中日韩文字每个字约占 3 字节，Meilisearch 默认的 400 字节只够约 130 个汉字。
- Meilisearch 默认禁止 embedder 访问内网 IP（包括 localhost 和 `host.docker.internal`）。因此 `docker-compose.yml` 通过 `MEILI_EXPERIMENTAL_ALLOWED_IP_NETWORKS` 放行私有网段，否则本地的 Ollama 无法使用。
- 编辑已有 embedder 时，若未填写新 Key，则不发送 `apiKey`（Meilisearch 返回的是打码后的值）。

## 6. LLM 问答

- `POST /api/chat` 接收 `messages`、`indexUid`、`provider`、`model` 和检索偏好（模式、比例、embedder、locales）。
- 工具：
  - `search_documents({ query, filter?, limit? })`：使用当前的混合检索偏好，只返回精简字段（id、标题、摘要、得分），控制 token 消耗。
  - `get_document({ id })`：返回完整文档，长字段会被截断。
- 系统提示要求：先检索再回答；对 CJK 查询可尝试更短的关键词或同义词；只依据检索结果作答；用 `[n](#doc-<id>)` 标注引用；使用用户的语言回复。最多 6 步工具循环。
- 默认模型：Anthropic `claude-opus-5-5`、OpenAI `gpt-5-mini`、Gemini `gemini-2.5-flash`、DeepSeek `deepseek-chat`、通义 `qwen-plus` 等。模型名会随时间变化，因此设置页支持从供应商的 `/models` 接口拉取实时列表。

## 7. API 一览

| 方法和路径                                     | 说明                                                 |
| ---------------------------------------------- | ---------------------------------------------------- |
| `GET /api/status`                              | Meilisearch 连通性、版本，以及 LLM 是否已配置        |
| `GET/PUT /api/settings`                        | 读取/保存应用配置（密钥打码）                        |
| `GET /api/llm/models?provider=`                | 拉取供应商的模型列表                                 |
| `POST /api/llm/test`                           | 用一条极短的请求测试 LLM 连接                        |
| `GET/POST /api/indexes`                        | 列出/新建索引（可带语言预设）                        |
| `GET/DELETE /api/indexes/[uid]`                | 索引详情（统计、设置、字段、展示字段推断）/ 删除索引 |
| `GET/PATCH /api/indexes/[uid]/settings`        | 读取/更新索引设置                                    |
| `GET/POST/DELETE /api/indexes/[uid]/documents` | 浏览/导入（JSON、NDJSON、CSV 原样透传）/ 清空文档    |
| `GET /api/tasks`、`GET /api/tasks/[uid]`       | 任务日志和单个任务状态（前端轮询）                   |
| `POST /api/search`                             | 关键词/混合/语义搜索                                 |
| `POST /api/tokenize`                           | 引擎实测分词预览                                     |
| `POST /api/samples`                            | 导入中/日/韩示例数据集和推荐设置                     |
| `POST /api/chat`                               | 流式问答（AI SDK UI Message Stream）                 |

## 8. 本地运行

```bash
docker compose up -d          # Meilisearch :7700（可选：--profile ollama）
cp .env.example .env.local    # 填写 MEILISEARCH_API_KEY，以及至少一个 LLM Key（也可以之后在设置页填写）
pnpm install && pnpm dev      # http://localhost:3000
```

首次打开后，在「数据」页点击「导入示例数据」即可体验分词、搜索和问答。

`docker-compose.yml` 只把端口绑定在 `127.0.0.1`，Meilisearch 数据保存在命名卷 `meili_data` 中。

## 9. 安全说明

本应用默认面向本机或内网使用，没有登录鉴权。任何能访问该端口的人都可以修改索引并消耗你的 LLM 额度。若要公开部署，请在前面加反向代理鉴权，或只监听 `127.0.0.1`（`pnpm dev -H 127.0.0.1`）。

---

# 第二版：大规模多分支知识库

新增需求：内置 Qwen3-Embedding；用 anydoc 转换文档，用 PaddleOCR 识别图片；为大规模、多分支（树状目录）知识库优化；可同时搜索本地和云端的多个知识库；可把本地目录映射为知识库；为复杂问题优化。

## 10. 架构

```
                    ┌──────────────── Next.js 服务端 ───────────────────────────┐
本地目录 / 上传文件 → │ 扫描(增量) → 转换 → 切块 → 向量化 → 批量写入 → Meilisearch 连接 A（本地） │
                    │   anydoc   PaddleOCR  CJK切块  Qwen3-Embedding        连接 B（云端）…  │
                    │                                                                  │
浏览器 ── 搜索/问答 → │ 联邦检索：按连接分组 multi-search（federation）→ 跨连接按得分合并            │
                    └──────────────────────────────────────────────────────────────────┘
        PaddleOCR（进程内 ONNX Runtime，第三版起）    Qwen3-Embedding（进程内 llama.cpp，或外部 OpenAI 兼容服务）
```

- **连接（Connection）**：一个 Meilisearch 实例。`local` 来自原有配置；可以在设置页添加任意数量的云端或远程实例（Meilisearch Cloud、内网服务器）。
- **知识库（KB）**：某个连接上的一个索引，ID 为 `连接ID:索引名`。所有连接上的索引都会被自动发现。应用为知识库额外保存元数据（名称、来源目录、切块参数、向量维度等），存放在 `.data/kb.json`。
- 知识库的「结构」由索引设置自动识别：带 `doc_id`、`branch` 等字段的索引是**分块知识库**，带 `qwen3` 向量的知识库支持语义检索。因此在另一台机器上创建的云端知识库同样可用。

## 11. 数据模型：分块 + 分支

每个文件被切成若干块（chunk），每块是一条 Meilisearch 文档：

| 字段                                      | 说明                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`                                      | `{doc_id}_{chunk_index}`                                                                    |
| `doc_id`                                  | 文件相对路径的 SHA-1 前缀，同一文件的所有块共享                                             |
| `path` / `dir`                            | 相对路径 / 所在目录，例如 `产品/手册/安装.docx` / `产品/手册`                               |
| `branch`                                  | 所有祖先目录，例如 `["产品", "产品/手册"]`。一个等值过滤 `branch = "产品"` 就能选中整棵子树 |
| `title` / `heading`                       | 文档标题 / 块所在的标题路径（`第二章 > 2.1 安装`）                                          |
| `content`                                 | 块正文                                                                                      |
| `chunk_index` / `chunk_count`             | 块序号，用于读取上下文与文档计数                                                            |
| `file_type` / `source` / `mtime` / `size` | 文件类型、提取方式（text / anydoc / ocr）、修改时间、大小                                   |
| `_vectors.qwen3`                          | Qwen3 向量（`userProvided` embedder）                                                       |

- **目录树**：对 `chunk_index = 0` 的文档做 `branch` 分面统计，得到每个目录的**文件数**。树只需一次请求，不依赖本地清单，云端知识库同样可用。
- **结果去重**：检索时使用 `distinct: "doc_id"`，每个文件只返回最相关的一块，大库中的结果更多样。
- **增量更新**：删除文件时按 `doc_id IN [...]` 批量删除；文件变化时先删除旧块，再写入新块（同一索引内的任务按顺序执行）。

## 12. 导入流水线

1. **扫描**：遍历目录（默认排除隐藏文件、`node_modules`、`.git`、Office 临时文件，并限制文件大小），与清单（`.data/kb/<id>/manifest.json`，记录 size + mtime）对比，得到新增、修改、删除、未变化四类。
2. **转换**：
   - Office、PDF、EPUB、RTF、CSV 等格式交给 **anydoc**（`@firecrawl/anydoc`，Rust 原生模块，在本地运行，不阻塞事件循环），输出 Markdown。
   - 扫描版 PDF（anydoc 返回 `needsOcr`）和图片（png/jpg/webp/bmp/gif/tiff）交给 **内置 PaddleOCR**（见第 18 节）。可选：对 Word/PPT 中的嵌入图片也做 OCR。不使用 Firecrawl 的云端 OCR，私有文件不出本机。
   - 纯文本、Markdown、代码、HTML 直接读取，自动识别 UTF-8 / GB18030 / Big5 / Shift_JIS / EUC-KR 编码。
3. **切块**：按 Markdown 标题分节，再按段落、句子（`。！？；` 等中日韩标点）打包到目标长度（默认 800 字，重叠 100 字）。表格和代码块尽量保持完整，并记录标题路径。
4. **向量化**：用于嵌入的文本为「标题 + 标题路径 + 正文」，批量计算向量。
5. **写入**：每批约 500 块提交一次，任务异步排队，最后统一等待并收集失败的任务。清单每处理 100 个文件保存一次，中断后可继续。
6. **任务**：每个知识库同时只运行一个同步任务，可以取消；进度（扫描、处理、提交，以及各类文件数、错误列表）通过 `/api/jobs` 轮询获取。
7. **目录映射**：知识库来源可以是用户的本地目录（只读映射），也可以是托管目录 `.data/kb/<id>/files`（网页上传的文件保存在这里）。两者走同一条流水线。可选「监听变化」：用 `fs.watch` 递归监听目录，防抖 5 秒后自动增量同步。服务启动时由 `instrumentation.ts` 恢复监听。

## 13. 内置 Qwen3-Embedding

- **默认引擎：进程内 llama.cpp**（`node-llama-cpp`）加载 `Qwen3-Embedding-0.6B-Q8_0.gguf`（约 640MB），首次使用时自动下载到 `.data/models/`。下载源可选 HuggingFace、hf-mirror 或 ModelScope，也可以手动放入文件实现离线部署。无需 Python 或额外服务；在 Mac 上自动使用 Metal，有 CUDA/Vulkan 时自动使用 GPU。
- **外部引擎（适合大规模）**：任意 OpenAI 兼容的 `/embeddings` 服务，例如 Ollama 的 `qwen3-embedding`、llama.cpp server、TEI、vLLM、阿里云 DashScope `text-embedding-v4`、硅基流动的 `Qwen/Qwen3-Embedding-8B`。
- **非对称检索**：文档直接嵌入；查询加上 Qwen3 推荐的指令前缀 `Instruct: …\nQuery: …`。查询向量由应用计算，通过 `vector` 参数传给 Meilisearch。因此知识库使用 `userProvided` embedder，Meilisearch 不需要回调应用，本地和云端实例的用法完全一致。
- **MRL 降维**：Qwen3-Embedding 支持套娃表示（MRL）。知识库可选 1024 / 768 / 512 / 256 维，截断后重新归一化，在大规模场景下显著减少内存和磁盘占用。
- 每个知识库记录建库时的向量模型。如果与当前引擎不一致，该知识库会自动退回关键词检索，并给出提示，避免混用不同的向量空间。
- 额外提供 OpenAI 兼容的 `/api/embeddings` 接口，方便其他工具复用内置模型。

## 14. 多知识库检索（本地 + 云端）

1. 把选中的知识库按连接分组。每个连接只发一次 `multi-search`，使用 `federation`。每个知识库各自生成一条子查询（带分支过滤、`distinct`、`hybrid` 加查询向量，以及 locales）。
2. 各连接并行请求，按 `_federation.weightedRankingScore` 合并后分页。某个连接失败时，返回其余结果和错误信息，不会整体失败。
3. 查询向量只计算一次；各知识库按自己的维度截断。
4. 非分块的普通索引（例如示例数据）也能一起搜索，按推断的标题/正文字段展示。

## 15. 复杂问题

问答智能体的工具：

| 工具     | 作用                                                                        |
| -------- | --------------------------------------------------------------------------- |
| `search` | 一次提交 1–5 条子查询，并行执行跨知识库检索；可限定知识库与分支；跨查询去重 |
| `browse` | 浏览某个知识库的目录树（子分支和文件数，以及该分支下的文件）                |
| `read`   | 读取某个文件的全文，或命中块前后的若干块，补全表格、步骤等上下文            |

- 系统提示中列出所选知识库的名称、说明、文件数和一级分支，模型无需额外调用即可了解知识库的结构。
- **深度模式**：先拆解为子问题，再多查询检索、精读关键文档、检查信息缺口并补充检索，最后输出结构化答案并给出来源。普通模式最多 8 步，深度模式最多 20 步。
- 引用格式见第 17 节（第三版改为对话内统一编号的 `[n]`，一句话可同时引用多个来源）。

## 16. 大规模优化清单

| 项目     | 做法                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 索引设置 | 「大规模」预设：`proximityPrecision: byAttribute`（明显加快建索引），向量默认 512 维（MRL），`searchCutoffMs`，块更大（1200 字） |
| 写入     | 批量写入，任务异步排队；仅在结束时等待                                                                                           |
| 增量     | 根据清单的 size + mtime 跳过未变化的文件；删除和修改按 `doc_id` 定位                                                             |
| 结果     | `distinct: doc_id`；目录树基于分面统计                                                                                           |
| 资源     | 转换并发 3 路；OCR 与向量化串行排队，避免撑爆内存；大于上限的文件跳过                                                            |
| 可恢复   | 清单周期性落盘；失败的文件会被记录，可单独重试                                                                                   |

# 第三版：pi agent、内置 OCR、多来源引用与知识库管理

新增需求：融合 pi agent；进一步优化使用体验；回答可以有多个引用；PaddleOCR 内置，不再需要 Docker；完善知识库管理界面。

## 17. 问答智能体：pi agent

- **运行时**：问答的智能体循环改由 [pi](https://github.com/earendil-works/pi) 的 `@earendil-works/pi-agent-core`（`Agent`）驱动，模型调用走 `@earendil-works/pi-ai`。设置页里的 12 家模型服务都映射为 pi 的模型：OpenAI 走 `openai-responses`，Anthropic 走 `anthropic-messages`，Gemini 走 `google-generative-ai`，其余（DeepSeek、通义、Kimi、智谱、豆包、硅基流动、Ollama、自定义）走 `openai-completions`。pi 自带目录里有的模型（OpenAI、Anthropic、Gemini、OpenRouter、DeepSeek、Kimi）使用其上下文长度、推理能力和兼容参数；其余使用通用定义，并为各厂商设置 `compat`（例如通义的 `enable_thinking`、本地服务不用 `developer` 角色）。API Key 由应用设置注入，不读取 pi 的环境变量。
- **工具**：`search` / `browse` / `read` 定义为 pi 的 `AgentTool`（TypeBox 参数）。同一批工具调用并行执行。超过步数上限后，`beforeToolCall` 拒绝新的调用，让模型基于已有资料作答（普通模式 7 轮，深度模式 16 轮）。
- **流式桥接**：服务端把 pi 的事件（`message_update` 的文本、思考、工具调用增量，`tool_execution_end`，`turn_start/turn_end`）转换为 AI SDK 的 UI Message Stream。浏览器继续使用 `useChat`，思考过程显示为可折叠的「思考过程」。
- **对话历史**：浏览器保存的 UI 消息在每次请求时转换回 pi 的消息：每一步拆成「assistant（文本 + 工具调用）→ toolResult」。最近 3 轮保留完整的工具结果，更早的轮次只保留回答文本，控制上下文长度。
- **补充要求（steering）**：回答进行中，用户在输入框继续输入的内容通过 `POST /api/chat/steer` 交给仍在运行的 `Agent.steer()`。pi 在当前工具批次结束后注入这条消息，模型据此调整检索方向。界面上显示为「↳ 补充要求」。如果回答刚好结束，这条内容会作为下一个问题发送。

### 多来源引用

- 每条检索结果（以及 `read` 读取的段落）获得一个**对话内稳定的编号 `n`**。服务端从历史消息的工具结果中恢复已分配的编号，同一块内容在后续轮次中编号不变，新结果继续递增。
- 提示词要求模型在每个论断后标注编号，并在多处资料支持同一论断时同时引用，例如 `……需在 14 天内申请[2][5]。`，也接受 `[2, 5]`、`【3】`。
- 前端把 `[n]` 渲染为可点击的引用标记（跳过代码块），悬停显示来源摘要，点击可打开原文并定位到该块。每个回答下方列出「参考来源」，另列出「检索到但未引用」的结果。复制回答时会附上编号与来源列表。

### 使用体验

- 对话列表保存在浏览器（localStorage），可切换、新建、删除；刷新后恢复当前对话。保存时裁剪较大的工具输出。
- 回答支持复制、重新回答；底部显示模型、深度模式、token 用量与耗时。

## 18. 内置 PaddleOCR

- **引擎**：[ppu-paddle-ocr](https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr) 在 Node.js 进程内用 ONNX Runtime（`onnxruntime-node`）运行 PaddleOCR，不再需要 Python 或 Docker。识别调用串行排队，避免与向量化争抢 CPU。
- **模型**：默认 PP-OCRv6 标准版（一个模型覆盖简体、繁体中文、英文、日文，约 31 MB）；可选高精度、极速版，以及 PP-OCRv5 韩文模型。首次需要 OCR 时自动下载到 `.data/models/ocr/<模型>/`。
- **下载源**：「自动」依次尝试 Hugging Face、ModelScope（RapidOCR 的 ONNX 转换）、hf-mirror、PyPI（`rapidocr` 安装包内自带 PP-OCRv6 标准模型，可使用国内 PyPI 镜像）。ModelScope 和 PyPI 的模型把字典存放在 ONNX 元数据里，应用会直接从模型文件中读取字典。离线部署时，直接复制 `.data/models/ocr/` 即可。
- **扫描版 PDF**：anydoc 会报告哪些页面需要 OCR。应用用 pdf.js 只渲染这些页面（长边约 2200 像素）后再识别，其余页面直接使用 PDF 自带的文字层。多页 TIFF 逐帧解码（utif2）后识别。识别结果按行和段落间距排版，中日韩文字之间不插入空格。
- 同步任务会实时显示 OCR 进度，例如「扫描件.pdf · OCR 12/120」。

## 19. 知识库管理

| 位置       | 能力                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 知识库列表 | 按名称 / 说明筛选；按名称、最近同步、大小排序；卡片显示上次同步时间、文件数和失败数                                                                                                                    |
| 概览       | 统计、同步进度（可取消）、失败文件入口、最近 30 次同步记录（`.data/kb/<id>/history.json`）                                                                                                             |
| 文件       | 基于同步清单浏览**所有**文件，包括失败和跳过的文件：按目录逐级浏览，按名称搜索，按状态筛选；每个文件可查看转换后的内容、打开原文件、重新处理、删除（上传的知识库）或排除（映射目录）；支持多选批量操作 |
| 上传       | 文件或整个文件夹，显示上传进度，可指定子目录                                                                                                                                                           |
| 设置       | 名称、说明、包含 / 排除规则、OCR 选项、目录监听；以及语言、切块长度与重叠、向量开关与维度、规模。修改切块、向量或规模会自动重建索引；只修改语言则直接更新索引设置                                      |
| 高级       | 索引设置 JSON、任务记录、重建、删除                                                                                                                                                                    |

- 「重新处理」把文件加入下一次同步的重处理名单（即使文件没有变化）；同步进行中提交的请求会在当前任务结束后自动再跑一次。
- 「排除」把文件或目录的相对路径加入排除规则，下次同步时删除对应内容，原文件不受影响。
- 原文件下载接口只允许访问知识库来源目录内的文件。
