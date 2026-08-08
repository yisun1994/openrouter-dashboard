# OpenRouter 大盘收入看板

每日自动抓取 OpenRouter 日榜 Token 消耗量 + 全模型挂牌价，计算大盘总 token 费用，并提供趋势图表与模型明细。零运行时依赖，仅需 Node.js ≥ 18。

## 功能

- 每日 23:55 UTC 自动抓取，启动时也会立即抓一次
- 费用 = (输入−缓存)×输入价 + 缓存×缓存读价 + 输出×输出价 + 请求数×固定费
- 历史趋势图（总费用、Token、请求数）
- 任意日期模型明细（按费用降序）
- 一键手动抓取，JSON API
- 自动处理 batch 半价变体、缓存价、Claude 命名倒置、带日期版本后缀

## 快速开始

```bash
npm install   # 无依赖，可跳过
npm start
# 打开 http://localhost:3000
```

启动时立即抓取当天数据，之后每天 23:55 UTC 自动抓取。手动抓一次：`npm run scrape`。自定义端口：`PORT=8080 npm start`。

## 数据来源（已验证）

| 用途 | 接口 | 关键字段 |
|---|---|---|
| 各模型 Token / 请求量 | `https://openrouter.ai/api/frontend/v1/rankings/models?view=day` | `model_permaslug`, `variant`(standard/batch/free/thinking), `total_prompt_tokens`, `total_completion_tokens`, `total_native_tokens_cached`, `count` |
| 各模型单价（每 token USD） | `https://openrouter.ai/api/v1/models` | `pricing.prompt`, `pricing.completion`, `pricing.request`, `pricing.input_cache_read`；batch 为独立 id 加 `:batch` |

价格为每 token 美元。Rankings 的 permaslug 带日期后缀（如 `openai/gpt-5.4-nano-20260317`），models id 不带日期；Claude 还存在名称倒置（`claude-4.6-sonnet` → `claude-sonnet-4.6`）。脚本已做日期后缀剥离、Claude 重排、逐段回退等多策略匹配。

验证首日（2026-08-07）：483 行，**总费用 ≈ $7.30M**，token 覆盖率 99.29%。

## 目录结构

```
├── server.js          # HTTP 服务 + 定时调度
├── scraper.js         # 抓取 + 价格匹配 + 费用计算
├── store.js           # JSON 文件存储
├── public/index.html  # 看板前端
└── data/daily/        # 每日快照 (gitignored)
```

## API

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
