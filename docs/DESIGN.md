# 设计文档：CJK 搜索工作台

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
