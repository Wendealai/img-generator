# img-generator

img-generator 是一个基于 React + TypeScript + Vite 的 AI 生图前端，集成 ChatGPT（`gpt-image-2` 工具流）与 Gemini（`nanobanana2`）双模型通道，支持文生图、图生图、批量提示词与抽卡连生。

支持两种后端模式：

- `直连 API`：前端直接请求 OpenAI/Gemini 兼容接口。
- `n8n 编排`：前端仅请求 n8n webhook，实际模型调用与凭据在 n8n 内部管理。

## 当前功能

- 三列看板：`想法池` / `开发中` / `已上线`
- 任务新增、推进、回退、删除
- 关键词搜索与优先级筛选（`P0/P1/P2`）
- 顶部统计卡与完成度进度环
- API 设置中心（`Base URL / Key / 路径 / 模型 / 超时 / 参数`）
- 一键生产（傻瓜模式）：拉取模型、选模型、填需求、直接发送
- 模型列表本地缓存（拉取一次后持久可用，仅在手动刷新时更新）
- 生图参数可视化（画幅比例、流式返回开关）
- 一键套用生图模板（`api.xas231.online` + `gemini-3.0-pro-image-2k`）
- 图生图输入（`text + image_url` 结构，可设置参考图 URL）
- 参考图 URL 预检（可达性探测 + 延迟反馈）
- 生成结果图片预览与下载（支持单张/全部下载）
- 历史记录图片回看与下载
- 发送链路分层超时（连接/首包/空闲/总超时）与超时诊断
- 生图请求自适应超时（慢首包自动放宽）与网关缺少 URL 的兼容自动重试
- 请求自动重试与手动取消（失败自动回退，支持中途停止）
- 单次诊断模式（非流式、无重试，一次测试快速定位失败原因）
- 开发里程碑进度（默认交付计划 100%，并兼容旧任务数据迁移）
- 模型列表拉取与过滤（支持 `/models` 返回结构自动解析）
- Gemini 模型识别提示（支持 `gemini-3.0-pro-image-2k` 别名与官方 ID 检测）
- 4K 能力提示（识别 4k 命名模型，或基于官方模型 ID 给出能力提示）
- 多套 API 配置档案（新建 / 切换 / 复制 / 删除 / 重命名）
- 配置导入/导出 JSON（导出时自动剔除明文 API Key）
- 导入前冲突处理（跳过冲突 / 自动重命名 / 覆盖同名）
- API Key 加密保险箱（口令加密、会话解锁、手动锁定）
- API 一键连接测试（状态码、耗时、响应预览）
- n8n webhook 连接测试（提示词优化 / 生图提交 / 状态轮询）
- API 调试台（页面内发请求、查看模型输出、原始响应、cURL 预览）
- 调试请求历史（回填 Prompt、快速复测）
- 请求历史导出 JSON（便于留档和回溯）
- 历史日志筛选（关键词 + 成功/失败状态）
- 历史单条操作（复制 Prompt、复制输出摘要、删除）
- 本地持久化（`localStorage`），刷新后数据不丢失

## 技术栈

- React 19
- TypeScript 5
- Vite 8
- Ant Design 6

## 本地启动

```bash
npm install
npm run dev
```

## n8n 工作流

- Workflow 模板目录：`n8n/workflows/`
- 接口契约：`n8n/contracts/webhook-contract.md`
- 快速说明：`n8n/README.md`
- 开发环境可使用 `/api-n8n`（Vite 默认代理到 `http://127.0.0.1:5678`）

## 常用命令

```bash
npm run lint
npm run build
npm run preview
```

## Dokploy 部署

- 仓库已包含 `Dockerfile` + `nginx.conf`，可直接选择 Dockerfile 构建部署。
- 前端为 SPA 路由，Nginx 已内置 `try_files ... /index.html` 回退规则。

## 目录结构

```text
src/
  App.tsx      # 任务看板核心逻辑和 UI
  App.css      # 页面与组件样式
  index.css    # 全局样式和主题
```

## 说明

- 当前构建可通过，但 `antd` chunk 体积较大（功能优先）。
- 如果后续进入性能优化阶段，建议按路由/模块进一步做动态分包。
