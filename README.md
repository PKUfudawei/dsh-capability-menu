<h1 align="center">dsh-capability-menu</h1>

<p align="center">
  <strong>为 DeepSeek Harness 提供统一的能力菜单管理 Tools 和 Skills 的暴露水平 (上下文占用大小) 和执行方式</strong><br>
  海量tools/skills也不会塞满一次请求, 节省token和上下文<br>
  MCP 工具与 Skill 按 exposed/progressive/blocked 三级管理暴露程度和执行方式
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/v/@daweifu/capability-menu.svg?style=flat-square&color=0969DA&labelColor=161b22&logo=npm&logoColor=white" alt="npm version"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-2EA44F?style=flat-square&labelColor=161b22" alt="license"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu"><img src="https://img.shields.io/github/stars/PKUfudawei/dsh-capability-menu.svg?style=flat-square&color=dbab09&labelColor=161b22&logo=github&logoColor=white" alt="GitHub stars"/></a>
  <a href="https://github.com/cordiverse/cordis"><img src="https://img.shields.io/badge/stack-Cordis%20bundle-7FBDF1.svg?style=flat-square&labelColor=161b22&logo=cardano&logoColor=white" alt="Cordis bundle"/></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/engine-DeepSeek%20Harness-4D6BFE.svg?style=flat-square&labelColor=161b22&logo=deepseek&logoColor=white" alt="DeepSeek Harness"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu/actions"><img src="https://img.shields.io/github/actions/workflow/status/PKUfudawei/dsh-capability-menu/ci.yml?branch=master&label=CI&style=flat-square&labelColor=161b22&logo=github&logoColor=white" alt="CI"/></a>
</p>

<br/>

dsh-capability-menu 是一个可独立安装的 Cordis 插件（`@daweifu/capability-menu`，前端配套 `@daweifu/capability-menu-web`），为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供统一的能力目录（`ctx.meta`）、两个元工具（`meta_search` / `meta_invoke`）、以及 Exposed / Progressive / Blocked 三档能力策略，并配套前端「能力菜单」管理 tab（MCP tools / Skills 两栏，分类可点击循环切换）。它不修改上游源码，完全通过 Cordis 插件机制与 Harness 组合进同一个运行时。

## 快速安装

### 通过 npm 安装

服务端与前端两个包均已发布到 npm（`@daweifu/capability-menu` 与 `@daweifu/capability-menu-web`）。安装 `Node.js` 与 dsh 后，运行：

```sh
dsh plugin --profile web add @daweifu/capability-menu
dsh plugin --profile web add @daweifu/capability-menu-web
```

第一条安装服务端插件（registry / search / invoke / policy 四个 entry），第二条安装前端「能力菜单」tab。装完后在「设置 / 通用设置」下即可看到「能力菜单」。

验证（应看到本包自己的 patch 层）：

```sh
dsh --profile web --dump-config | grep -E 'capability-menu'
```

```
# == @daweifu/capability-menu
- id: capability-menu-registry
  name: '@daweifu/capability-menu/registry'
- id: capability-menu-search
  name: '@daweifu/capability-menu/search'
- id: capability-menu-invoke
  name: '@daweifu/capability-menu/invoke'
- id: capability-menu-policy
  name: '@daweifu/capability-menu/policy'
```

卸载：

```sh
dsh plugin --profile web remove @daweifu/capability-menu
dsh plugin --profile web remove @daweifu/capability-menu-web
```

### 从源码安装

本地开发时从仓库以 `link:` 方式安装（改动即时生效，无需重新打包）：

```sh
git clone https://github.com/PKUfudawei/dsh-capability-menu.git
cd dsh-capability-menu
pnpm install
pnpm run build
```

前端 bundle 依赖 dsh profile 的 hoisted 安装，需在 `web/` 下单独构建后再以目录方式安装两个包：

```sh
cd web
npm run build        # ensure-deps + tsdown + tsc，产出 lib/client.js
cd ..
dsh plugin --profile web add .            # 服务端 @daweifu/capability-menu
dsh plugin --profile web add ./web        # 前端 @daweifu/capability-menu-web
```

> `dsh plugin add` 一个**目录**会以 `link:` 方式安装，`lib/` 需要已构建。

## 能力模型

Capability 是上位概念，Tool / Skill 是不同类型的 capability，不是「两种工具」：

| kind | 对 Agent 提供 | action | 备注 |
| --- | --- | --- | --- |
| `tool` | 执行一个动作（MCP 工具） | `execute` | 由 `ctx.tools` 索引 |
| `skill` | 某类任务的方法/流程/知识 | `load` | 由 `ctx.skills` 索引 |

> `execute` / `load` 是 capability 对外声明的**规范 action**（`CapabilityAction = 'execute' | 'load'`）。tool 的 `execute` 在底层由 `ctx.tools.execute` 走完整工具管线执行；skill 的 `load` 加载方法/流程正文。当前版本（`0.1.0`）只有这两种 kind 与两种 action。

模型获得两个元工具：

| 工具 | 作用 | 对应 entry |
| --- | --- | --- |
| `meta_search` | 检索能力目录（Tool / Skill），list/detail 双模式 | `@daweifu/capability-menu/search` |
| `meta_invoke` | 统一执行面：Tool 真执行（走完整 `ctx.tools` 管线）+ Skill 加载 | `@daweifu/capability-menu/invoke` |

> 边界：Command / Prompt / Memory 不是可发现可调用的能力，不进 registry。需要查知识/文档时直接用底层检索类 MCP 工具（如 `mcp__km__search`），它们和其他 MCP 工具一样被 `meta_search` 编目、被 `meta_invoke` 转发。
>
> 边界：非 `mcp__` 前缀的原生工具（`bash` / `read` / `write` / `edit` / `read_image` / `glob` / `grep` 等）**不进 registry**——不被 `meta_search` 编目、不被 `meta_invoke` 派发、也不在能力管理（`classifyAll`）枚举中。它们只受投影链（`system-prompt/assemble` 对 `assembly.tools` 的裁剪）影响可见性；且因不可 `meta_invoke`，一旦被投影掉就真的不可调用，所以请保留在 `tools.exposed` 保活（见下方配置示例；默认即 Exposed，但若被 `progressive`/`blocked` 通配规则覆盖则不可调用）。

## 核心：Exposed / Progressive / Blocked 三档能力策略

所有能力（Tool 与 Skill）按 **暴露程度**（模型在上下文中看到什么）与 **执行方式** 分为三档：

### Tools / Skills 三档暴露与执行对照

| 档位 | 能力 | 暴露方式（模型视野） | 发现 | 执行方式 |
| --- | --- | --- | --- | --- |
| **Exposed** | tool | 完整 schema 进 `assembly.tools` → 模型请求 `tools` payload，每步可见 | 无需发现（已常驻） | 模型直接调用，运行时走完整 `ctx.tools` 管线 |
| | skill | 名字+描述进 `<available_skills>` 目录（正文不在目录） | 无需发现（已常驻） | `skill` 工具按需加载正文（渐进加载） |
| **Progressive** | tool | 不进 payload（零上下文成本） | `meta_search` list 返回 name+summary | `meta_invoke` 执行（走 `ctx.tools.execute`，管线完整）；或 detail 拿 schema 后直接调 |
| | skill | 不进 `<available_skills>` 目录 | `meta_search` 检索（`progressiveSkillCatalog` 条目） | `meta_invoke` 按 `path` 加载 SKILL.md 正文 |
| **Blocked** | tool | 不进 payload | `meta_search` 不返回 | `meta_invoke` 拒绝，直接调用被投影排除 |
| | skill | 不进目录 | `meta_search` 不返回 | `meta_invoke` 拒绝 |

> **Exposed / Progressive 就是「高频 vs 低频」的具象化。** Exposed = 常驻、随叫随到的高频能力（拿 payload/目录体积换单跳可靠）；Progressive = 归档进目录、用到才翻出来的低频能力（省 token、按需取用）；Blocked = 明确禁止使用。它是**由你配置的驻留策略**（`tools.exposed`/`tools.progressive`/`tools.blocked` 规则），而不是按使用次数自动统计的标签。
>
> 上表的 tool 档位均指 `mcp__` 编目工具；原生工具不参与三档管理，只能以 `tools.exposed` 保活可见性（见"能力模型"边界说明）。

## 配置（在 `@daweifu/capability-menu/policy` 上）

```yaml
- insert:
    - id: capability-menu-policy
      name: '@daweifu/capability-menu/policy'
      config:
        tools:
          exposed:
            - execute_cmd
            - get_session_context
            - search_kb
            - 'mcp__gongfeng__*'   # 通配：该 server 下全部 Exposed
          progressive:
            - 'mcp__*'             # 该规则覆盖所有未显式列出的 MCP 工具
            - 'server:km:*'        # 按 server 前缀批量 Progressive
          blocked:
            - 'mcp__secret__*'     # 明确禁用（优先级最高，压过 Exposed）
        skills:
          exposed:
            - debugging
            - coding
          progressive:
            - legacy_skill         # 显式 Progressive（未列出即默认 Exposed）
          blocked:
            - forbidden_skill
        metaTools:
          - meta_search            # 恒 Exposed，不可被 Blocked
          - meta_invoke
        progressiveSkillCatalog: ~/.dsh/progressive-skills.yaml  # Progressive skill 的 name+description+path 目录
```

**规则优先级**（命中即停）：`blocked` 精确 > `blocked` 通配 > `exposed` 精确 > `exposed` 通配 > `progressive` 精确 > `progressive` 通配 > 默认 Exposed。**blocked 压过 exposed**（控制语义）。meta 工具（`meta_search`/`meta_invoke`）恒为 Exposed，出现在 `blocked` 里会 fail loud。

> `tools.exposed` 里列原生工具名（`execute_cmd` 等）是**保活**语义：原生工具不进能力管理编目（`classifyAll` 列表里看不到它们），但投影链会裁剪其可见性，列在这里保持模型直接可见可调。不要因为"它不在能力管理里"就把它从 exposed 移除——一旦被 `progressive`/`blocked` 规则覆盖，模型既看不到也调不到。

### 默认（不配置 policy）

- 不挂 `capability-menu-policy` → 全部工具/技能照旧可见（不投影）。
- 挂了 policy 但没有任何规则 → 全部能力默认 Exposed（`classify` 兜底），不投影、不隐藏。需要把低频能力归档进目录时，显式配置 `progressive`（或 `blocked`）规则把它们从模型视野中移出。

### Progressive skill

Progressive skill 的 name + description + path 汇总进独立 YAML（`progressiveSkillCatalog`），由 registry 索引、`meta_search` 检索；完整 SKILL.md 由 `meta_invoke` 按需加载（`ctx.skills` 未注册时按 YAML 的 `path` 读取）。Progressive skill 不进固定上下文。

> 关于 `<available_skills>`：Exposed skill 走渐进加载（名字表 → load）；Progressive/Blocked skill 不进入 `dsh-tool-skill` 注入的目录。目录级裁剪需要上游 `dsh-tool-skill` 提供 filter 钩子（超出本 bundle 范围）；当前 Exposed skill = 会话 registry 中所有 model-invocable skill，Progressive skill = `progressiveSkillCatalog` 条目。

## 机制设计

**核心第一性原则**：模型可见性（投影）与能力注册（registry 索引 + 执行能力）**必须解耦**。`ctx.tools.restrict` 会把工具从 `view.visible` 移除、连 `execute` 一起挡住（`UNKNOWN_TOOL`），因此本策略**不用 restrict 隐藏 Progressive**，而是在投影链 `system-prompt/assemble` 裁剪 `assembly.tools`，让 Progressive 工具保持全局注册、可检索、可执行。

Progressive 的**发现层（catalog）与执行层（`ctx.tools` 管线）分离**：catalog 只存元数据（name + description），完整 schema 从 `ctx.tools` 实时解析；无论哪一档，工具执行都落在 `ctx.tools` 管线上——审批/guard/沙箱/会话日志/取消齐全，不绕过。skill 无"执行"，只有正文加载。Blocked 能力保留在 catalog 中（供管理面展示），但 `meta_search` 不返回、`meta_invoke` 拒绝。

## 能力管理（server 侧 `ctx.capabilityPolicy`）

> 后端能力管理面，前端「能力菜单」tab 正是消费它。前端 React 包 `@daweifu/capability-menu-web`（本仓库 `web/`）的浏览器 bundle 与 host Typert 网关由 `web/` 的构建产出（见 `web/README.md`）；`capabilityPolicy/*` remote 由网关托管，浏览器端 `ctx.remote.capabilityPolicy` 消费。

`@daweifu/capability-menu/policy` 注册 `ctx.capabilityPolicy` 服务，同时支撑运行期投影与前端管理：

| 方法 | 用途 |
| --- | --- |
| `getConfig()` / `updateConfig(partial)` | 读取/热更新策略配置（`tools`/`skills`/`metaTools` 等），改动立即重编译规则、无需重启。 |
| `classifyAll()` | 枚举 `ctx.meta` 目录中每个能力及其当前分类，返回 `{ id, kind, name, server?, class: 'exposed'\|'progressive'\|'blocked', classLabel, mandatory }`；`classLabel` 为「Exposed · 常驻（直接调用）/ Progressive · 按需（目录渐进加载）/ Blocked · 禁用」，供前端只读分类列表展示。 |
| `classifyTool`/`classifySkill`/`classifyCapability` | 单个能力的分类判定。 |
| `isExposedTool`/`isExposedSkill`/`isBlockedCapability`/`metaTools`/`toolRules`/`skillRules` | 投影链与执行面消费的判定与规则视图。 |

这些方法全部是纯 server 方法（可单测），前端通过 harness 的 remote/RPC 层调用。

## 仓库结构

```
dsh-capability-menu/           # 单包 = @daweifu/capability-menu
├── package.json               # exports 子路径 + dsh.bundle → ./cordis.patch.yml
├── cordis.patch.yml           # insert registry/search/invoke/policy 四个子路径 entry
├── tsconfig.json / vitest.config.ts
├── src/
│   ├── registry.ts            # （P0）能力目录 + ctx.meta 服务（不注册工具）
│   ├── search.ts              # （P1）注册 meta_search
│   ├── invoke.ts              # （P2）注册 meta_invoke
│   ├── policy.ts              # （P3）Exposed/Progressive/Blocked 投影策略 + ctx.capabilityPolicy 能力管理
│   ├── invariant.ts
│   └── index.ts               # re-export 全部
├── tests/                     # registry / search / invoke / policy 四套用例
└── web/                       # 前端「能力菜单」tab（client bundle + host Typert 网关，见 web/README.md）
```

## 开发

- `src/` 为 TypeScript 源码，`lib/` 为预构建产物（`npm run build` 产出，本仓库直接分发 `lib/`）。`package.json` 的 `exports` 声明 `/registry` `/search` `/invoke` `/policy` `/invariant` 五个子路径，`cordis.patch.yml` 挂载前四个为 entry。
- `@deepseek-ai/*` 依赖为 peer 依赖（运行时从 dsh 安装闭包解析）；`@deepseek-ai/schemastery` 与 `js-yaml` 为运行时依赖（后者解析 `progressiveSkillCatalog`）。
- 安装时自动构建：本包 `prepare` 脚本会在支持 lifecycle 的安装路径（git / 打包安装）下自动执行 `npm run build` 产出 `lib/`；前端包 `web/` 的 `prepare` 同样自动执行 `npm run bundle` 产出客户端 bundle（需 dsh-client 环境）。
- 测试：`pnpm install && npx vitest run`（33 个用例，覆盖 registry / search / invoke / policy，含能力管理面用例）。

## 环境前置

- 已安装 dsh CLI 和 pnpm（`dsh plugin` 内部会转发给 pnpm）。

## License

本项目遵循 [Apache License 2.0](LICENSE)。

> 一个可独立安装的 Cordis 插件，为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供能力发现、按需执行与 Exposed/Progressive/Blocked 投影策略。核心的智能体、模型、工具、会话、Web UI 与插件生态都来自上游项目。
