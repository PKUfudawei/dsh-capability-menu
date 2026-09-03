<h1 align="center">dsh-capability-menu</h1>

<p align="center">
  <strong>为 DeepSeek Harness 提供统一的能力菜单管理 Tools 和 Skills 的暴露水平 (上下文占用大小) 和执行方式</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/v/@daweifu/capability-menu.svg?style=flat-square&color=0969DA&labelColor=161b22&logo=npm&logoColor=white" alt="npm version"/></a>
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/dt/@daweifu/capability-menu.svg?style=flat-square&color=0969DA&labelColor=161b22" alt="downloads"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-2EA44F?style=flat-square&labelColor=161b22" alt="license"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu"><img src="https://img.shields.io/github/stars/PKUfudawei/dsh-capability-menu.svg?style=flat-square&color=dbab09&labelColor=161b22&logo=github&logoColor=white" alt="GitHub stars"/></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-0.1.1--rc.1-4D6BFE.svg?style=flat-square&labelColor=161b22&logo=deepseek&logoColor=white" alt="DeepSeek Harness 0.1.1-rc.1"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu/actions"><img src="https://img.shields.io/github/actions/workflow/status/PKUfudawei/dsh-capability-menu/ci.yml?branch=master&label=CI&style=flat-square&labelColor=161b22&logo=github&logoColor=white" alt="CI"/></a>
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="./README.en.md">English</a>
</p>

<br/>

## 目录

- [能力总览](#能力总览)
- [快速安装](#快速安装)
- [暴露策略](#暴露策略)
- [配置文件](#配置文件)

---

## 能力总览

dsh-capability-menu 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的一个 Cordis 插件，为海量 tools / skills（MCP 工具与内置原生工具）建立统一能力目录（`ctx.capability`），并以**常驻 / 按需 / 禁用**三档管理暴露程度和执行方式——随时调整 agent 的能力边界，避免海量 tools/skills 塞满一次请求、节省 token 和上下文。调整即时生效、无需重启，纯插件机制组合进 Harness 运行时，不改上游源码。**不挂载本插件（policy）时一切照旧、全量可见；挂载但未配置任何规则时，所有能力默认常驻。**

### 能力模型

Capability 是本插件引入的上位概念：Tool / Skill 是不同类型的 capability。

| kind | 对 Agent 提供 | action | 备注 |
| --- | --- | --- | --- |
| `tool` | 执行一个动作（MCP 工具或内置原生工具） | `execute` | 由 `ctx.tools` 索引 |
| `skill` | 某类任务的方法/流程/知识 | `load` | 由 `ctx.skills` 索引 |

模型获得两个元工具：

| 工具 | 作用 | 对应 entry |
| --- | --- | --- |
| `meta_search` | 检索能力目录（Tool / Skill），list/detail 双模式 | `@daweifu/capability-menu/search` |
| `meta_invoke` | 统一执行面：Tool 真执行（走完整 `ctx.tools` 管线）+ Skill 加载 | `@daweifu/capability-menu/invoke` |

### 能力菜单

<p align="center">
  <img src="assets/screenshot-mcp-tools.png" alt="工具 tab" width="45%"/>
  <img src="assets/screenshot-skills.png" alt="Skills tab" width="45%"/>
</p>

安装后，「设置 / 通用设置」下出现「能力菜单」tab（位于「模型」与「插件」之间），用于可视化查看和调整暴露策略，改动即时生效、无需重启：

- **工具**：全部工具按 server 分组、可折叠。MCP 工具挂在各自 server（`gongfeng`/`km`…）下；内置原生工具（`bash`/`read`/`write`/`glob`/`grep`…）统一挂在保留的「系统内置工具」组（server 键 `built-in`）。点击某行查看模型侧工具定义 name / description / parameters。
- **Skills**：点击某行展开目录树，点文件预览 SKILL.md 等正文；按来源分成「项目技能」（工作区 `.dsh/skills`、`.agents/skills`）与「全局技能」（`~/.dsh`、`~/.agents` 等）两组，无项目技能时整组隐藏。
- **三态圆点与循环切换**：每个能力带一个分类圆点（实心 = 常驻、半实心 = 按需、空心 = 禁用），栏顶部显示各档数量统计；点击能力旁的圆点或分类计数即可循环切换分类（内置原生工具与 MCP 工具同等可管），若被更高优先级规则（如通配）覆盖，界面会提示「分类未生效」。

## 快速安装

前置：已安装 Node.js 与 dsh CLI（`dsh plugin` 内部会转发给 pnpm）。

### 从 npm 安装（推荐）

单包同时提供服务端插件与前端「能力菜单」tab，装完即可在「设置 / 通用设置」下看到：

```sh
dsh plugin --profile web add @daweifu/capability-menu
```

### 从源码安装

```sh
git clone https://github.com/PKUfudawei/dsh-capability-menu.git
cd dsh-capability-menu
pnpm install                   # prepare 脚本自动构建 lib/（服务端）与 lib/client.js（前端）

dsh plugin --profile web add ./dsh-capability-menu
```

### 验证安装

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
- id: capability-menu
  name: '@daweifu/capability-menu'
```

### 卸载

```sh
dsh plugin --profile web remove @daweifu/capability-menu
```

## 暴露策略

所有能力（Tool 与 Skill）按 **暴露程度**（模型在上下文中看到什么）与 **执行方式** 分为三档：

### Tools / Skills 三档暴露与执行对照

| 档位 | 能力 | 暴露方式（模型视野） | 发现 | 执行方式 |
| --- | --- | --- | --- | --- |
| **常驻** | tool | 完整 schema 进 `assembly.tools` → 模型请求 `tools` payload，每步可见 | 无需发现（已常驻） | 模型直接调用，运行时走完整 `ctx.tools` 管线 |
| | skill | 名字+描述进 `<available_skills>` 目录（正文不在目录） | 无需发现（已常驻） | `skill` 工具按需加载正文（渐进加载） |
| **按需** | tool | 不进 payload（零上下文成本） | `meta_search` list / `grep` 检索物化目录 YAML（`catalogFile`） | `meta_invoke` 执行（走 `ctx.tools.execute`，管线完整）；或 detail 拿 schema 后直接调 |
| | skill | 不进 `<available_skills>` 目录 | `meta_search` 检索 / `grep` 检索物化目录 YAML（`catalogFile`） | `meta_invoke` 加载 SKILL.md 正文（经 `ctx.skills`） |
| **禁用** | tool | 不进 payload | `meta_search` 不返回、目录 YAML 不写入 | `meta_invoke` 拒绝；模型幻觉直调也在 `tools/pre-execute` 被硬拒绝 |
| | skill | 不进 `<available_skills>` 目录 | `meta_search` 不返回、目录 YAML 不写入 | `meta_invoke` 拒绝；`skill` 工具在 `tools/pre-execute` 硬拒绝 |

> tool 档位同时覆盖 `mcp__` 编目工具与内置原生工具（原生工具统一以 `built-in` 为 server 归组、同样三档可管）。**On-demand 的内置工具会退出模型常驻视野**，需要时经 `meta_search` 发现、`meta_invoke` 派发（两跳调用）——因此不建议把高频核心工具设为按需。`meta_search`/`meta_invoke` 自身与 Code Mode 保留传输层 `run_code` 不进能力目录，恒常驻、不可在「能力菜单」切换。

## 配置文件

规则写在 profile 的 `cordis.patch.yml` 里 `capability-menu-policy` 插件 entry 的 `config` 下（外层 `- insert:` / `id` / `name` 是 Cordis patch 的挂载样板，与规则无关）：

```yaml
config:
  tools:
    resident:
      - execute_cmd
      - get_session_context
      - search_kb
      - 'mcp__gongfeng__*'    # 通配：该 server 下全部常驻
    on-demand:
      - 'mcp__*'              # 通配兜底
      - 'server:km:*'         # 按 server 前缀批量按需
    blocked:
      - 'mcp__secret__*'      # 禁用优先级最高，压过常驻
  skills:
    resident:
      - debugging
      - coding
    on-demand:
      - legacy_skill          # 显式按需（未列出即默认常驻）
    blocked:
      - forbidden_skill
  metaTools:
    - meta_search             # 恒常驻，不可被禁用
    - meta_invoke
```

> 配置键即档位英文词：`resident`（常驻）/ `on-demand`（按需）/ `blocked`（禁用）。

**规则优先级**（从上到下命中即停；同档内精确规则优先于通配）：

| 优先级 | 规则 | 示例 | 效果 |
| --- | --- | --- | --- |
| 1 | `blocked` 精确 | `blocked: [forbidden_skill]` | 最硬禁用，压过一切 |
| 2 | `blocked` 通配 | `blocked: ['mcp__secret__*']` | 整组禁用 |
| 3 | `resident` 精确 | `resident: [bash]` | 单个能力显式常驻 |
| 4 | `on-demand` 精确 | `on-demand: [legacy_skill]` | 单个能力显式按需（能力菜单点击写入的就是这类） |
| 5 | `resident` 通配 | `resident: ['mcp__gongfeng__*']` | 整组常驻 |
| 6 | `on-demand` 通配 | `on-demand: ['mcp__*']` | 兜底批量按需 |
| 默认 | 未命中任何规则 | — | 常驻 |

要点：
- `meta_search`/`meta_invoke` 恒常驻，不可被 blocked。
- **精确规则优先于通配（跨档也成立）**：例如存在 `resident: ['mcp__gongfeng__*']` 时，在「能力菜单」把某工具点成按需会写入精确 `on-demand` 规则并生效，不会被通配压回；若仍被更高优先级覆盖，界面提示「分类未生效」。
- 原生工具与 MCP 工具一样进编目（归 `built-in` server），未列出默认常驻；被 `on-demand`/`blocked` 覆盖后退出常驻视野，按需时仍可 `meta_search` → `meta_invoke` 两跳调用。**勿把真实 MCP server 命名为 `built-in`。**
- 已部署 profile 若仍用旧键 `exposed`/`progressive`，启动时会自动映射为 `resident`/`on-demand` 并告警提示；可用 `node scripts/migrate-capability-keys.mjs <cordis.patch.yml>` 一次性改写为持久化新键。

> 「能力菜单」tab 的改动只写入运行时内存、不落盘；要持久化（随 profile 生效、可版本管理/批量声明），编辑 profile 的 `cordis.patch.yml` 即可——这就是持久化入口，无需额外的导入/导出按钮。

### 按需能力目录（`catalogFile`，唯一物化目录，grep 可检索）

On-demand 能力自动物化成**一个 YAML 文件**给模型检索，链路：

**工具/技能变更或分类调整 → registry 自动重写 `catalogFile` → 模型 `grep`/`read`（或 `meta_search`）找到 id → `meta_invoke(id)` 执行/加载**

- 默认 `~/.dsh/capability-catalog.yaml`（`catalogFile` 可改，置空禁用）；没有任何按需能力时不注入目录指引，省上下文。
- 技能必须**已注册进 `ctx.skills`**（SKILL.md 放用户/项目技能根或挂 `customSkillDirs`）再切按需，即自动出现；无独立手写输入清单。
- 模型侧两路发现：`grep` 目录文件 / `meta_search`（结构化 schema）；`meta_invoke` 加载正文——工具经 `ctx.tools.execute`，技能经 `ctx.skills`。

```yaml
# ~/.dsh/capability-catalog.yaml（自动生成；仅含 On-demand 能力，
# Resident 已常驻、Blocked 不可发现，均不写入；列表以 `-` 每项一行的 block 序列写出）
capabilities:
  - id: mcp__km__search
    kind: tool
    name: mcp__km__search
    description: 搜索知识库
    server: km
  - id: skill:legacy_skill
    kind: skill
    name: legacy_skill
    description: 旧版迁移技能，低频使用
    whenToUse: 处理旧工程时使用
```

> 目录文件默认写在宿主 `~/.dsh`，需要模型侧 `bash`/`read` 工具的沙箱能访问该路径；若沙箱隔离宿主目录，请把 `catalogFile` 显式配置到沙箱可见的路径。默认路径在多个 dsh 实例间共享（last-write-wins），多实例部署时请为每个实例配置独立的 `catalogFile`。

## License

本项目遵循 [Apache License 2.0](LICENSE)。
