# Strategy Sandbox

面向宠物险肠胃炎理赔策略的离线仿真工作台。它覆盖材料审核、跨平台本体图谱、事实快照、自然语言策略解析、规则检查、历史回放仿真及案例下钻；前端为原生 HTML/CSS/JavaScript，业务服务由 FastAPI 与 SQLite 提供。

## 快速开始

```powershell
python -m pip install -r requirements.txt
npm start
```

打开 <http://127.0.0.1:4173/>。默认数据库会在首次启动时按固定种子生成 320 笔演示案件；Hash 路由无需额外配置。

## 演示数据与安全说明

仓库有意保留两类作品集演示数据：

- `data/strategy_sandbox.db`：固定种子生成的 SQLite 演示数据库；
- `outputs/019ff16f-ef70-7373-a459-28fcb41e1ec5/信贷策略仿真模拟数据.xlsx`：信贷场景演示数据。

两者均为离线生成的模拟数据，不包含真实客户、宠物、医疗记录或个人身份信息。仓库不会提交上传材料、模型密钥、`.env`、缓存、检查产物或其他数据库文件。删除 `data/strategy_sandbox.db` 后，服务会在下一次启动时重新创建固定的演示数据。

## 常用命令

```powershell
npm run migrate
npm run check
npm test
```

## 可选模型配置

复制 `.env.example` 后可设置 `DATABASE_URL`、`MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY` 和 `MODEL_TIMEOUT_MS`。页面输入的模型密钥只保存在当前 FastAPI 进程内存，不会写入浏览器、本地数据库或仓库。

## 项目结构

- `backend/`：FastAPI 服务、规则内核、数据模型、迁移及测试。
- `app-v4.js`、`styles-v4.css`：当前工作台前端。
- `assets/`：低保真宠物险演示素材。
- `data/strategy_sandbox.db`：可直接运行的 SQLite 演示状态。
- `PRODUCT_MVP.md`、`PRODUCT_INTRO.md`：MVP 说明和简历 STAR 产品介绍。
