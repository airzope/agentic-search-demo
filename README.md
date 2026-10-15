# CJK 搜索工作台 · CJK Search Studio

一个可本地运行、对中日韩（CJK）友好的搜索工作台，基于 [Meilisearch](https://www.meilisearch.com/) 与 [Vercel AI SDK](https://ai-sdk.dev/)：

- **分词管理**：可视化编辑自定义词典、同义词、停用词、分隔符与字段语言，并提供**由引擎实测的分词预览**（与索引时的切分结果完全一致）。
- **混合搜索**：关键词、混合、语义三种模式，语义比例可调；可在页面中配置向量模型（Ollama、OpenAI、OpenAI 兼容接口、HuggingFace）。
- **AI 问答**：大模型先检索当前索引，再依据检索结果作答并标注来源。
- **主流 LLM 接入**：OpenAI、Anthropic Claude、Google Gemini、OpenRouter、DeepSeek、通义千问、Kimi、智谱 GLM、豆包、硅基流动、Ollama，以及任意 OpenAI 兼容接口。
- **CJK 体验**：中英双语界面；按内容自动选择中、日、韩字体；输入法组字时按 Enter 不会误发送或误搜索；内置中、日、韩示例数据。

设计说明见 [docs/DESIGN.md](docs/DESIGN.md)。

## 快速开始

需要 Node.js 20.9+、pnpm 和 Docker。

```bash
cp .env.example .env          # 按需填写 LLM Key（也可以稍后在“设置”页填写）
docker compose up -d          # 启动 Meilisearch：http://127.0.0.1:7700
pnpm install
pnpm dev                      # 打开 http://localhost:3000
```

打开后进入「数据」页，点击「示例数据 → 导入」，即可体验分词预览、搜索和问答。

### 使用本地模型（可选）

```bash
docker compose --profile ollama up -d
docker compose exec ollama ollama pull qwen3:8b   # 对话模型（需支持工具调用）
docker compose exec ollama ollama pull bge-m3     # 向量模型，中日韩效果好
```

- 对话：在「设置 → 大模型 → Ollama」中保存一次即可启用（默认地址 `http://127.0.0.1:11434/v1`）。
- 向量：在「向量 → 添加向量模型」中选择 Ollama 预设。Meilisearch 和 Ollama 都在 Compose 中运行时，地址填 `http://ollama:11434/api/embed`；Ollama 直接装在本机时，填 `http://host.docker.internal:11434/api/embed`。

> Meilisearch 默认禁止 embedder 访问内网 IP（包括 localhost）。`docker-compose.yml` 已通过 `MEILI_EXPERIMENTAL_ALLOWED_IP_NETWORKS` 放行私有网段。如果你用其他方式运行 Meilisearch，请自行设置这个变量。

## 配置

| 位置   | 说明                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `.env` | 默认值：`MEILISEARCH_HOST`、`MEILISEARCH_API_KEY`、各家 `*_API_KEY`、`*_MODEL`、`*_BASE_URL`、`LLM_PROVIDER`，完整列表见 `.env.example` |
| 设置页 | 在界面中修改的配置保存到 `.data/settings.json`（已加入 gitignore），优先级高于 `.env`。API Key 只保存在服务端，不会返回给浏览器         |

设置页可以从供应商的 `/models` 接口拉取实时模型列表，并一键测试连接。

## CJK 使用建议

- **声明字段语言**：以汉字为主的短文本可能被识别成日文，导致切分不一致。新建索引时选择语言预设，或在「分词 → 字段语言」中填写，例如 `title, content => cmn`。
- **自定义词典**：专有名词、产品名不想被切开时加入词典。也可以在分词预览中选中文字，点击「加入词典」。
- **繁简互通**：Meilisearch 不会自动在繁体和简体之间转换，请用同义词配置，例如 `台湾, 臺灣`。
- **向量模板长度**：中日韩文字每个字约占 3 字节。Meilisearch 默认的 `documentTemplateMaxBytes` 只有 400，本应用默认设为 2000。

## 项目结构

```
src/app/                 页面与 API（Next.js App Router）
  api/chat               流式问答（AI SDK，工具：search_documents / get_document）
  api/tokenize           引擎实测分词预览
  api/search             关键词 / 混合 / 语义搜索
  api/indexes, tasks …   索引、文档、设置、任务管理
src/components/views/    问答、搜索、分词、向量、数据、设置六个页面
src/lib/                 Meilisearch 客户端、LLM 供应商、设置存储、CJK 工具、示例数据
docker-compose.yml       Meilisearch（以及可选的 Ollama）
```

常用脚本：`pnpm dev`、`pnpm build`、`pnpm lint`、`pnpm format`。

## 安全提示

本应用面向本机或内网使用，没有登录鉴权。能访问该端口的人可以修改索引并消耗你的 LLM 额度。如需对外提供服务，请在前面加一层鉴权（例如反向代理），或只监听本机：`pnpm dev -H 127.0.0.1`。

---

## English

A local-first search workbench for Chinese, Japanese and Korean, built on Meilisearch and the Vercel AI SDK. It covers:

- **Tokenization management**: dictionary, synonyms, stop words, separators and per-field languages, with a live token preview segmented by Meilisearch itself.
- **Search**: keyword, hybrid and semantic search with an adjustable semantic ratio and embedder management (Ollama, OpenAI, OpenAI-compatible REST, HuggingFace).
- **RAG chat with citations** over the current index.
- **LLM providers**: OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, Qwen, Kimi, GLM, Doubao, SiliconFlow, Ollama, or any OpenAI-compatible API.

Quick start: `cp .env.example .env && docker compose up -d && pnpm install && pnpm dev`, then open the Data page and import a sample dataset. See [docs/DESIGN.md](docs/DESIGN.md) for the design (in Chinese).
