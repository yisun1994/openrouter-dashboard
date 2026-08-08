# OpenRouter 大盘收入看板

每日自动抓取 OpenRouter 日榜 Token 消耗量 + 全模型挂牌价，计算大盘总 token 费用，并提供趋势图表与模型明细。

## 功能

**投资人视角分析：**
- 各公司收入占比（环形图）+ Top 15 公司排行表（含主力模型、均价、份额）
- 价格分层收入结构：高端（≥$5/M）/ 中端（$1-5/M）/ 经济型（<$1/M）/ 免费
- 量价关系气泡图：token 份额 vs 每百万 token 均价（气泡=收入，识别统治级玩家 vs 走量薄利）
- 收入集中度指标：Top5/Top10 份额 + HHI 赫芬达尔指数
- 各公司每日收入堆叠趋势图（Top 8）
- Top 15 模型收入横向柱状图（按价格分层着色）

**数据与自动化：**
- 每日 23:55 UTC 自动抓取，启动时也会立即抓一次
- 费用 = 未缓存输入×输入价 + 缓存×缓存价 + 输出×输出价 + 请求×固定费
- 任意日期全模型明细（按费用降序，含价格档位标签）
- GitHub Actions 自动抓取 + 提交数据 + 部署 GitHub Pages
- 零运行时依赖（仅需 Node.js ≥ 18）

## 快速开始

```bash
cd or-dashboard
npm start
# 打开 http://localhost:3000
```

启动时会立即抓取一次当天数据，之后每天 23:55 UTC 自动抓取。

Windows 下若未装 Git Bash，可直接在 PowerShell/CMD 里运行 `node server.js`。

手动抓取一次（不开服务器）：

```bash
npm run scrape
```

自定义端口：

```bash
PORT=8080 npm start
```

## 数据来源（已验证）

| 用途 | 接口 | 关键字段 |
|---|---|---|
| 各模型 Token / 请求量 | `https://openrouter.ai/api/frontend/v1/rankings/models?view=day` | `model_permaslug`(带日期版本后缀), `variant`(standard/batch/free/thinking), `total_prompt_tokens`, `total_completion_tokens`, `total_native_tokens_cached`, `count` |
| 各模型单价（每 token USD） | `https://openrouter.ai/api/v1/models` | `pricing.prompt`, `pricing.completion`, `pricing.request`, `pricing.input_cache_read`；batch 为独立 id 加 `:batch` 后缀 |

价格为**每 token** 美元（字符串）。Rankings 的 permaslug 带日期后缀（如 `openai/gpt-5.4-nano-20260317`），而 models 接口 id 不带日期（如 `openai/gpt-5.4-nano`）；Claude 还存在名称倒置（rankings `claude-4.6-sonnet` → models `claude-sonnet-4.6`）。脚本已做日期后缀剥离、Claude 名称重排、逐段回退等多策略匹配。

### 费用公式

```
费用 = (输入token - 缓存token) × 输入价
     + 缓存token × 缓存读价(无则按输入价)
     + 输出token × 输出价
     + 请求数 × 每请求固定费
```

验证首日（2026-08-07）：483 行，**总费用 ≈ $7.30M**，token 覆盖率 99.29%。未计入部分主要是 embedding/rerank（不在 models 接口）与视频/音频/图片模型（按资产计费）。

## 目录结构

```
or-dashboard/
├── server.js          # HTTP 服务 + 定时调度
├── scraper.js         # 抓取 + 费用计算 + 公司/分层聚合
├── store.js           # JSON 文件存储
├── export.js          # 导出静态数据供 Pages 使用
├── public/index.html  # 看板前端
└── data/
    ├── daily/YYYY-MM-DD.json   # 每日快照
    └── raw/                    # 原始接口样例（排查字段用）
```

## API

- `GET /api/history?days=30` — 每日汇总序列
- `GET /api/latest` — 最新一天完整快照
- `GET /api/snapshot?date=2026-08-07` — 指定日期明细（含 authors / tiers / concentration）
- `GET /api/dates` — 可用日期列表
- `GET /api/author-history?top=8` — Top N 公司每日收入序列
- `POST /api/scrape` — 手动触发抓取

## GitHub Pages（零服务器）

仓库已配置 GitHub Actions（`.github/workflows/daily-scrape.yml`），每日自动抓取数据并部署到 Pages。

**首次启用：**
1. 推送代码后，进入仓库 **Settings → Pages**
2. **Build and deployment → Source** 选择 **GitHub Actions**
3. 进入 **Actions** 标签，手动触发一次 **Daily scrape & deploy** workflow
4. 完成后访问 `https://<user>.github.io/<repo>/`

Workflow 每日 23:55 UTC 自动运行：抓取 → 导出静态 JSON → 提交数据 → 部署 Pages。

## Docker 部署

```bash
docker build -t openrouter-dashboard .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --name or-dashboard openrouter-dashboard
```

或使用 docker-compose：

```bash
docker compose up -d
```

数据通过 volume 持久化到 `./data`。

## 口径与限制（重要）

1. **Token 费用口径（非全口径营收）**：本看板统计的是文本模型的 token 费用总和。embedding/rerank 不在 `/api/v1/models` 中、视频/音频/图片按资产（次/秒/张）计费，这些均不计入；视频/音频/图片模型虽会出现在榜单但 token 量为 0。
2. **已处理 Batch 与缓存**：`variant=batch` 自动匹配 `:batch` 半价变体；缓存输入按 `input_cache_read` 计价（榜单当日缓存 token 常为 0）。
3. **当日累计**：`view=day` 为 UTC 当日至今累计，23:55 抓取以接近全天完整值；当天会被覆盖更新。
4. **无法回填**：OpenRouter 不提供历史日榜查询，历史仅从首次运行起逐日积累。
5. **免费模型**：`variant=free` 价为 0，正常计入 Token 量但不产生费用。
6. **覆盖率**：首日验证 token 覆盖率 99.29%，未覆盖部分主要为 embedding/rerank（其单价极低，对总费用影响很小）。
7. **多 provider 同模型异价**：取 `/api/v1/models` 的 canonical 价；开源模型不同托管方实际价差可达 10×。

## License

MIT
