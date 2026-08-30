<h1 align="center">dsh-capability-menu</h1>

<p align="center">
  <strong>为 DeepSeek Harness 提供统一的能力菜单管理 Tools 和 Skills 的暴露水平 (上下文占用大小) 和执行方式</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/v/@daweifu/capability-menu.svg?style=flat-square&color=0969DA&labelColor=161b22&logo=npm&logoColor=white" alt="npm version"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-2EA44F?style=flat-square&labelColor=161b22" alt="license"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu"><img src="https://img.shields.io/github/stars/PKUfudawei/dsh-capability-menu.svg?style=flat-square&color=dbab09&labelColor=161b22&logo=github&logoColor=white" alt="GitHub stars"/></a>
  <a href="https://github.com/cordiverse/cordis"><img src="https://img.shields.io/badge/stack-Cordis%20bundle-7FBDF1.svg?style=flat-square&labelColor=161b22&logo=cardano&logoColor=white" alt="Cordis bundle"/></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/engine-DeepSeek%20Harness-4D6BFE.svg?style=flat-square&labelColor=161b22&logo=deepseek&logoColor=white" alt="DeepSeek Harness"/></a>
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh"><img src="https://img.shields.io/badge/dsh-%5E0.1.1--rc.1-4D6BFE.svg?style=flat-square&labelColor=161b22" alt="dsh ^0.1.1-rc.1"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu/actions"><img src="https://img.shields.io/github/actions/workflow/status/PKUfudawei/dsh-capability-menu/ci.yml?branch=master&label=CI&style=flat-square&labelColor=161b22&logo=github&logoColor=white" alt="CI"/></a>
</p>

<br/>

## 目录

- [能力菜单](#能力菜单)
- [快速安装](#快速安装)
- [能力模型](#能力模型)
- [暴露策略](#暴露策略)
- [配置文件](#配置文件)

---

dsh-capability-menu 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的一个 Cordis 插件，为海量 MCP tools / skills 建立统一能力目录（`ctx.capability`），并以**常驻 / 按需 / 禁用**三档管理暴露程度和执行方式——随时调整 agent 的能力边界，避免海量 tools/skills 塞满一次请求、节省 token 和上下文：

- **统一能力目录**：编目所有 MCP 工具与 Skill，模型经 `meta_search` 检索、`meta_invoke` 执行。
- **三档能力策略**：常驻 = 高频能力随叫随到；按需 = 低频能力归档进目录、用到才翻出来；禁用 = 明确禁止。这是你配置的驻留策略，不是按使用次数自动统计的标签。
- **可视化配置**：「能力菜单」设置 tab（MCP tools / Skills 两栏，分类可点击循环切换），调整即时生效。
- **零侵入**：不改上游源码，经 Cordis 插件机制与 Harness 组合进同一运行时。

## 能力菜单

安装后，「设置 / 通用设置」下出现「能力菜单」tab（位于「模型」与「插件」之间），用于可视化查看和调整暴露策略，改动即时生效、无需重启：

- **两栏**：MCP 工具（按 server 分组、可折叠）与 Skills。
- **三态圆点 + 统计**：每个能力带一个分类圆点（实心 = 常驻、半实心 = 按需、空心 = 禁用），栏顶部显示各档数量统计。
- **点击循环切换**：点击能力旁的圆点或分类计数即可循环切换分类；MCP 工具还可以点击整行查看模型侧工具定义（name / description / parameters）。
- **Skills 目录浏览**：展开某个 skill 可浏览其文件目录，点击文件预览 SKILL.md 等正文内容。

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

## 能力模型

Capability 是本插件引入的上位概念：Tool / Skill 是不同类型的 capability。

| kind | 对 Agent 提供 | action | 备注 |
| --- | --- | --- | --- |
| `tool` | 执行一个动作（MCP 工具） | `execute` | 由 `ctx.tools` 索引 |
| `skill` | 某类任务的方法/流程/知识 | `load` | 由 `ctx.skills` 索引 |

模型获得两个元工具：

| 工具 | 作用 | 对应 entry |
| --- | --- | --- |
| `meta_search` | 检索能力目录（Tool / Skill），list/detail 双模式 | `@daweifu/capability-menu/search` |
| `meta_invoke` | 统一执行面：Tool 真执行（走完整 `ctx.tools` 管线）+ Skill 加载 | `@daweifu/capability-menu/invoke` |

## 暴露策略

所有能力（Tool 与 Skill）按 **暴露程度**（模型在上下文中看到什么）与 **执行方式** 分为三档：

### Tools / Skills 三档暴露与执行对照

| 档位 | 能力 | 暴露方式（模型视野） | 发现 | 执行方式 |
| --- | --- | --- | --- | --- |
| **常驻** | tool | 完整 schema 进 `assembly.tools` → 模型请求 `tools` payload，每步可见 | 无需发现（已常驻） | 模型直接调用，运行时走完整 `ctx.tools` 管线 |
| | skill | 名字+描述进 `<available_skills>` 目录（正文不在目录） | 无需发现（已常驻） | `skill` 工具按需加载正文（渐进加载） |
| **按需** | tool | 不进 payload（零上下文成本） | `meta_search` list 返回 name+summary | `meta_invoke` 执行（走 `ctx.tools.execute`，管线完整）；或 detail 拿 schema 后直接调 |
| | skill | 不进 `<available_skills>` 目录 | `meta_search` 检索（`progressiveSkillCatalog` 条目） | `meta_invoke` 按 `path` 加载 SKILL.md 正文 |
| **禁用** | tool | 不进 payload | `meta_search` 不返回 | `meta_invoke` 拒绝，直接调用被投影排除 |
| | skill | 不进目录 | `meta_search` 不返回 | `meta_invoke` 拒绝 |

> 上表的 tool 档位均指 `mcp__` 编目工具；原生工具不参与三档管理，只能以 `tools.exposed` 保活可见性（见下方配置文件示例）。

## 配置文件

规则写在 profile 的 `cordis.patch.yml` 里 `capability-menu-policy` 插件 entry 的 `config` 下（外层 `- insert:` / `id` / `name` 是 Cordis patch 的挂载样板，与规则无关）：

```yaml
config:
  tools:
    exposed: [execute_cmd, get_session_context, search_kb, 'mcp__gongfeng__*']   # 通配：该 server 下全部常驻
    progressive: ['mcp__*', 'server:km:*']                                        # 通配兜底 + 按 server 前缀批量按需
    blocked: ['mcp__secret__*']                                                   # 禁用优先级最高，压过常驻
  skills:
    exposed: [debugging, coding]
    progressive: [legacy_skill]          # 显式按需（未列出即默认常驻）
    blocked: [forbidden_skill]
  metaTools: [meta_search, meta_invoke]  # 恒常驻，不可被禁用
  progressiveSkillCatalog: ~/.dsh/progressive-skills.yaml
```

**规则优先级**（命中即停，同级内精确匹配先于通配）：`blocked` > `exposed` > `progressive`，未命中任何规则默认 Exposed；`blocked` 是最硬的控制（压过 `exposed`），meta 工具（`meta_search`/`meta_invoke`）恒为 Exposed 且不可被 blocked。`tools.exposed` 里列原生工具名（`execute_cmd` 等）是**保活**：原生工具不进能力编目、只受投影链裁剪可见性，列在这里保持模型可见可调——一旦被 progressive/blocked 覆盖，模型就看不到也调不到。

> 「能力菜单」tab 的改动只写入运行时内存、不落盘；要持久化（随 profile 生效、可版本管理/批量声明），编辑 profile 的 `cordis.patch.yml` 即可——这就是持久化入口，无需额外的导入/导出按钮。

### 渐进技能目录（`progressiveSkillCatalog`）

按需（Progressive）技能不进固定上下文，也可能根本没注册进 `ctx.skills`。为了让它们仍可被发现，用一份独立 YAML 存 name + description + path，由 registry 索引、`meta_search` 检索；完整 SKILL.md 由 `meta_invoke` 按需加载（`ctx.skills` 未注册时按 YAML 的 `path` 读取）：

```yaml
# ~/.dsh/progressive-skills.yaml
skills:
  - name: legacy_skill            # 对应 skills.progressive 里的规则名
    description: 旧版迁移技能，低频使用
    whenToUse: 处理旧工程时使用
    path: /path/to/legacy_skill   # 含 SKILL.md 的目录
```

### 默认（不配置 policy）

- 不挂 `capability-menu-policy` → 全部工具/技能照旧可见（不投影）。
- 挂了 policy 但没有任何规则 → 全部能力默认 Exposed（`classify` 兜底），不投影、不隐藏。需要把低频能力归档进目录时，显式配置 `progressive`（或 `blocked`）规则把它们从模型视野中移出。

## License

本项目遵循 [Apache License 2.0](LICENSE)。
