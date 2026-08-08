# OpenRouter 大盘收入看板

每日自动抓取 OpenRouter 日榜 Token 消耗量 + 全模型挂牌价，计算大盘总 token 费用，并提供趋势图表与模型明细。零运行时依赖，仅需 Node.js ≥ 18。

## 功能

- 每日 23:55 UTC 自动抓取，启动时也会立即抓一次
- 费用 = (输入−缓存)×输入价 + 缓存×缓存读价 + 输出×输出价 + 请求数×固定费
- 历史趋势图（总费用、Token、请求数）与任意日期模型明细
- 一键手动抓取，JSON API
- 自动处理 batch 半价变体、缓存价、Claude 命名倒置、带日期版本后缀
- 自带 GitHub Actions：每天自动抓取、提交数据、部署到 GitHub Pages（无需自己跑服务器）
- 自带 Dockerfile 与 docker-compose

## 快速开始

```bash
npm install   # 无依赖，可跳过
npm start
# 打开 http://localhost:3000
```

启动时立即抓取当天数据，之后每天 23:55 UTC 自动抓取。手动抓一次：`npm run scrape`。自定义端口：`PORT=8080 npm start`。

## Docker

```bash
docker compose up -d --build
# 打开 http://localhost:3000，数据持久化在 ./data
```

或直接 `docker build -t openrouter-dashboard . && docker run -p 3000:3000 -v ./data:/app/data openrouter-dashboard`。

## GitHub Pages 自动部署（推荐，免服务器）

仓库已自带 `.github/workflows/daily-scrape.yml`：每天 23:55 UTC 运行 `node scraper.js` 抓取数据，`node export.js` 导出为静态 JSON，提交到仓库，并把 `public/` 部署到 GitHub Pages。

首次启用：
1. 推送 workflow 文件后，到仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
2. 到 **Actions** 标签，手动触发一次 "Daily scrape & deploy"（Run workflow），它会抓当天数据并生成站点。
3. 之后每天自动运行，站点地址为 `https://<你的用户名>.github.io/openrouter-dashboard/`。

> 前端会自动探测：有 Node API（本地 `npm start` / Docker）时走 API；纯静态托管（Pages）时自动回退读 `public/data/*.json`。

## 数据来源（已验证）

| 用途 | 接口 | 关键字段 |
|---|---|---|
| 各模型 Token / 请求量 | `https://openrouter.ai/api/frontend/v1/rankings/models?view=day` | `model_permaslug`, `variant`(standard/batch/free/thinking), `total_prompt_tokens`, `total_completion_tokens`, `total_native_tokens_cached`, `count` |
| 各模型单价（每 token USD） | `https://openrouter.ai/api/v1/models` | `pricing.prompt`, `pricing.completion`, `pricing.request`, `pricing.input_cache_read`；batch 为独立 id 加 `:batch` |

价格为每 token 美元。Rankings 的 permaslug 带日期后缀（如 `openai/gpt-5.4-nano-20260317`），models id 不带日期；Claude 还存在名称倒置（`claude-4.6-sonnet` → `claude-sonnet-4.6`）。脚本已做日期后缀剥离、Claude 重排、逐段回退等多策略匹配。

验证首日（2026-08-07）：483 行，**总费用 ≈ $7.30M**，token 覆盖率 99.29%。

## 目录结构

```
├── server.js                 # HTTP 服务 + 定时调度 + API
├── scraper.js                # 抓取 + 价格匹配 + 费用计算
├── store.js                  # JSON 文件存储
├── export.js                 # 导出 public/data 供静态托管
├── public/index.html         # 看板前端
├── .github/workflows/        # 每日抓取 + Pages 部署
├── Dockerfile / docker-compose.yml
└── data/daily/               # 每日快照 (gitignored；CI 用 -f 提交)
```

## API（本地/Docker 模式）

- `GET /api/history?days=30` — 每日汇总序列
- `GET /api/latest` — 最新一天完整快照
- `GET /api/snapshot?date=2026-08-07` — 指定日期明细
- `GET /api/dates` — 可用日期列表
- `POST /api/scrape` — 手动触发抓取

## 口径与限制

1. **Token 费用口径**：统计文本模型 token 费用。embedding/rerank 不在 models 接口、视频/音频/图片按资产计费，均不计入。
2. **已处理 Batch 与缓存**：`variant=batch` 自动匹配 `:batch` 半价；缓存输入按 `input_cache_read` 计价。
3. **当日累计**：`view=day` 为 UTC 当日至今累计，23:55 抓取接近全天值；当天会被覆盖。
4. **无法回填**：OpenRouter 不提供历史日榜，历史从首次运行起逐日积累。
5. **免费模型**：`variant=free` 价为 0，计 token 不计费。

## License

MIT
