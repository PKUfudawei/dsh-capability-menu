# @daweifu/capability-menu-web — 能力菜单 前端

## 作用

为 DeepSeek Harness 的 Web 设置页新增一个 tab **「能力菜单」**，展示并管理 `@daweifu/capability-menu` 的 Exposed / Progressive / Blocked 能力策略。对应主 README「能力管理（server 侧 `ctx.capabilityPolicy`）」一节：

| 界面元素 | 调用的后端（`ctx.capabilityPolicy`） |
|---|---|
| **三档分类切换**（chips 点击循环 Exposed / Progressive / Blocked） | `getConfig()` / `updateConfig(partial)` |
| **只读分类列表**（每个 MCP/Skill 当前是 Exposed / Progressive / Blocked） | `classifyAll()` |
| **skill 目录浏览** | `listSkillDir()` / `readSkillFile()` |

数据通过 Host 端 Typert 网关（`src/server/remote.ts`，`CapabilityPolicyGateway`）暴露为 `capabilityPolicy` remote 命名空间，浏览器端 `ctx.remote.capabilityPolicy` 消费。网关由包根入口（`src/index.ts`）挂载，注册为独立的 `capabilityPolicyGateway` 服务（wire 命名空间仍为 `capabilityPolicy`，避免与 policy 插件的 `capabilityPolicy` 服务冲突），委托给 `ctx.capabilityPolicy`。

## 构建

依赖 `@deepseek-ai/dsh-client-*` / `@deepseek-ai/dsh-typert-protocol` / `@deepseek-ai/dsh-api-remotes` / `react`，它们不在本仓库镜像里，但从 dsh profile 的 hoisted 安装（`$DSH_HOME/profiles/node_modules`）可解析。`npm run build`（或 `prepare`）会先通过 `scripts/ensure-deps.mjs` 桥接 `node_modules`，再 `tsdown` 打浏览器 bundle、`tsc` 编译 host 网关：

```bash
cd web
npm run build        # ensure-deps + tsdown（client.js）+ tsc（index.js / server/remote.js）
```

构建产物（`lib/`，gitignored）：
- `lib/client.js` — 浏览器 bundle（`./client` export，dsh ModuleLoader 格式）
- `lib/index.js` — host 入口（`.` export，挂载 gateway）
- `lib/server/remote.js` — Typert 网关实现

## 文件

```
web/
├── package.json               # @daweifu/capability-menu-web（client + host 包）
├── tsconfig.build.json        # tsc 编译 host/server（web/src/index.ts + src/server）
├── tsdown.config.mjs          # tsdown 打浏览器 bundle
├── scripts/ensure-deps.mjs    # 构建期桥接 node_modules 到 profile hoisted 安装
├── README.md
└── src/
    ├── index.ts               # host 入口：挂载 CapabilityPolicyGateway
    ├── client/
    │   ├── index.ts           # 注册 settings.section（id: capability, order: 12）
    │   ├── CapabilitySection.tsx  # tab UI（开关 + 分类列表 + 配置表单）
    │   ├── remote.ts          # Typert remote 描述符（浏览器端）
    │   └── store.ts           # 读取/写入 Host remote 的轻量 store
    └── server/
        └── remote.ts          # CapabilityPolicyGateway（Typert 远程网关）
```

## 安装到 profile

两个包均已发布到 npm，直接按包名安装：

```bash
# 服务端包
dsh plugin --profile web add @daweifu/capability-menu
# 前端包（本目录）
dsh plugin --profile web add @daweifu/capability-menu-web
```

装完后「设置 / 通用设置」下出现「能力菜单」tab（`settings.section` id `capability`，order 12，位于「模型」与「插件」之间），列表数据来自 `capabilityPolicy/classifyAll` 网关。
