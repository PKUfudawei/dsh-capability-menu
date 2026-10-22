<h1 align="center">dsh-capability-menu</h1>

<p align="center">
  <strong>统一管理 DeepSeek Harness 工具与技能，高效检索、按需调用，节省上下文</strong>
</p>

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.0--rc.2-4D6BFE.svg?style=flat-square&labelColor=161b22&logo=deepseek&logoColor=white" alt="DeepSeek Harness 0.2.0-rc.2"/></a>
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/v/@daweifu/capability-menu.svg?style=flat-square&color=CB3837&labelColor=161b22&logo=npm&logoColor=white" alt="npm version"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu/actions"><img src="https://img.shields.io/github/actions/workflow/status/PKUfudawei/dsh-capability-menu/ci.yml?branch=master&label=CI&style=flat-square&labelColor=161b22&logo=github&logoColor=white" alt="CI"/></a>
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/d18m/@daweifu/capability-menu.svg?style=flat-square&color=CB3837&labelColor=161b22&logo=npm&logoColor=white" alt="downloads"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu"><img src="https://badgen.net/github/stars/PKUfudawei/dsh-capability-menu?icon=github&color=dbab09" alt="GitHub stars"/></a>
  <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"><img src="https://img.shields.io/badge/featured%20in-awesome--dsh--plugin-8250DF?style=flat-square&labelColor=161b22&logo=github&logoColor=white" alt="featured in awesome-dsh-plugin"/></a>
</p>

<p align="center">
  <strong>简体中文</strong> · <a href="./README.en.md">English</a>
</p>

## 目录

- [能力总览](#能力总览)
  - [能力模型](#能力模型)
  - [能力菜单](#能力菜单)
- [安装与卸载](#安装与卸载)
  - [从 npm 安装（推荐）](#从-npm-安装推荐)
  - [从源码安装](#从源码安装)
  - [验证安装](#验证安装)
  - [卸载](#卸载)
- [暴露策略](#暴露策略)
  - [Tools 和 Skills 三档暴露与执行对照](#tools-和-skills-三档暴露与执行对照)
- [配置](#配置)
  - [全部配置项](#全部配置项)
  - [按需能力检索目录（`catalogFile`）](#按需能力检索目录catalogfile)

---

## 能力总览

- 为 DeepSeek Harness 的 tools（包括 MCP 工具和内置工具）与 skills 建立统一能力目录：`ctx.capability`。
- 提供**常驻 / 按需 / 禁用**三档策略，管理能力的暴露与调用。
- 按需能力只在需要时提供给 Agent，减少单次请求携带的工具定义，节省 token 和上下文。

### 能力模型

Capability 是本插件引入的上位概念：Tool / Skill 是不同类型的 capability。

| kind | 对 Agent 提供 | action | 备注 |
| --- | --- | --- | --- |
| `tool` | 执行一个动作（MCP 工具或内置原生工具） | `execute` | 由 `ctx.tools` 索引 |
| `skill` | 某类任务的方法/流程/知识 | `load` | 由 `ctx.skills` 索引 |

模型获得两个元工具：

| 工具 | 作用 | 对应 entry |
| --- | --- | --- |
| `meta_search` | 在当前会话可见能力中搜索；列表支持 offset 分页并返回总数、已返回数和是否还有下一页；详情返回说明及工具参数 schema | `@daweifu/capability-menu/search` |
| `meta_invoke` | 统一执行面：Tool 真执行（走完整 `ctx.tools` 管线）+ Skill 加载；`force: true` 可重载已更新的 Skill | `@daweifu/capability-menu/invoke` |

### 能力菜单

<p align="center">
  <img src="assets/screenshot-tools_chinese.png" alt="能力菜单的 Tools 页面：按服务器管理工具的暴露档位与检索描述" width="48%"/>
  <img src="assets/screenshot-skills_chinese.png" alt="能力菜单的 Skills 页面：按来源管理技能的暴露档位与检索描述" width="48%"/>
</p>

安装后，在「设置」导航中选择「能力菜单」，即可管理 Tools 和 Skills。

| 操作 | 用法 |
| --- | --- |
| 更改档位 | 点击能力旁的圆点；也可以点击顶部档位计数，批量切换该组能力 |
| 查找能力 | 使用页签下方的过滤框搜索名称或分组；支持正则表达式，不区分大小写 |
| 查看能力详情 | 点击 Tool 查看定义；点击 Skill 展开文件列表并预览文件，内容按 Markdown 渲染 |
| 注册能力 | 点击右上角「注册能力」，添加 MCP 服务器或 Skill 目录；Skill 支持本机目录或公开 GitHub 链接 |
| 编辑或移除 | 在 Tools 的服务器分组或 Skills 的技能项中点击「编辑」 |
| 查看规则和检索目录 | 点击页头右侧的「策略与目录」，查看生效规则及自动生成的按需能力检索目录；可在目录页调整检索描述上限 |
| 编辑检索描述 | 将 Tool 或 Skill 设为「按需」后，点击旁边的「检索描述」，在来源描述的简短版本上修改 |

MCP 工具在服务器分组内省略重复的 `mcp__服务器名__` 显示前缀；悬停可查看完整名称，检索和调用仍使用完整 ID。

注册 MCP 会写入 patch 配置；文件或父目录缺失时会自动创建。MCP 请求头等凭据保存在配置中，请妥善保管。注册 Skill 则会在所选技能根目录创建链接或导入目录。

GitHub Skill 支持默认分支根目录链接（需含 `SKILL.md`）、指定分支根目录 `https://github.com/{owner}/{repo}/tree/{branch}`，以及指定分支下的技能目录 `https://github.com/{owner}/{repo}/tree/{branch}/{skill-directory}`。也可输入本机目录。仅支持公开仓库；导入需要运行 dsh 的机器安装 Git，插件会校验 `SKILL.md` 并只复制所选目录。

## 安装与卸载

前置：[Node.js](https://nodejs.org/en/download) 与 [dsh CLI](https://github.com/deepseek-ai/deepseek-harness)。从 npm 安装无需单独安装 pnpm；从源码安装需要 pnpm。

### 从 npm 安装（推荐）

在 Web Profile 安装：

```sh
dsh plugin --profile web add @daweifu/capability-menu
```

### 从源码安装

```sh
git clone https://github.com/PKUfudawei/dsh-capability-menu.git
cd dsh-capability-menu
pnpm install                   # prepare 脚本自动构建 lib/（服务端）与 lib/client.js（前端）

dsh plugin --profile web add .
```

### 验证安装

```sh
cd "${DSH_HOME:-$HOME/.dsh}/profiles/web" && pnpm list @daweifu/capability-menu && dsh --profile web --dump-config | grep -m1 '== @daweifu/capability-menu'
```

### 卸载

```sh
dsh plugin --profile web remove @daweifu/capability-menu
```

## 暴露策略

所有能力（Tool 与 Skill）按 **暴露程度**（模型在上下文中看到什么）与 **执行方式** 分为三档：

### Tools 和 Skills 三档暴露与执行对照

| 档位 | 能力 | 模型能看到什么 | 如何找到 | 如何使用 |
| --- | --- | --- | --- | --- |
| **常驻** | tool | 工具定义始终随请求提供 | 无需查找 | 直接调用；运行时经过完整 `ctx.tools` 管线 |
| | skill | 名称和简介显示在 `<available_skills>` 中 | 无需查找 | `skill` 工具按需加载正文 |
| **按需** | tool | 不随请求提供工具定义 | 用 `meta_search` 搜索候选项，或搜索能力目录 YAML（`catalogFile`） | 按精确 ID 查看参数后，用 `meta_invoke` 调用 |
| | skill | 不显示在 `<available_skills>` 中 | 用 `meta_search` 搜索，或搜索能力目录 YAML（`catalogFile`） | 用 `meta_invoke` 加载 `SKILL.md` |
| **禁用** | tool | 不随请求提供工具定义 | 搜索结果和能力目录中均不可见 | 调用会被拒绝 |
| | skill | 不显示在 `<available_skills>` 中 | 搜索结果和能力目录中均不可见 | 加载会被拒绝 |

> **覆盖与保留**：
> - 三档策略同时覆盖 MCP 与内置原生工具；内置工具归入保留组 `built-in`。**请勿把 MCP server 命名为 `built-in`。**
> - `meta_search` 和 `meta_invoke` 固定常驻且不可禁用。`run_code` 是 Code Mode 保留工具，不进目录或菜单，也无需配置档位。
> - **高频核心工具建议设为常驻**：按需内置工具先用 `meta_search({query})` 找 ID，再用精确 ID 查看 schema，最后通过 `meta_invoke` 调用。

## 配置

手写规则位于 `capability-menu-policy` entry 的 `config` 下。以下是配置片段；完整安装补丁见 [cordis.patch.yml](./cordis.patch.yml)。

- 默认 patch 是 `${DSH_HOME:-~/.dsh}/cordis.patch.yml`；Profile 也可在自己的 patch 中覆盖该 entry。
- 菜单中的档位调整立即生效，停手约 1.5 秒后写入独立的 `stateFile`，不会因档位写入而重载插件。手写规则仍是基础；界面选择覆盖同一能力的精确规则，禁用通配规则仍优先。
- `stateFile` 默认与 `patchFile` 同目录，各 Profile 共用；需要隔离时，分别指定 `stateFile`。要清除界面选择，停止 DSH 后删除该状态文件；原有 patch 规则仍会生效。

```yaml
config:
  tools:
    on-demand: # 按需
      - 'mcp__example__*'    # 某个 MCP 服务器下的工具
    disabled: # 禁用
      - 'mcp__secret__*'
  skills:
    on-demand: # 按需
      - example_skill        # 未列出的能力默认常驻
```

### 全部配置项

| 配置项 | 归属 entry | 默认值 | 说明 |
| --- | --- | --- | --- |
| `tools` / `skills` / `metaTools` | `capability-menu-policy` | 见随包补丁 | patch 中的基础分类规则；界面档位改动保存在独立状态文件 |
| `catalogFile` | `capability-menu-registry` | `${DSH_HOME:-~/.dsh}/capability-catalog.yaml` | 按需能力目录物化路径，置空禁用 |
| `searchMetadataFile` | `capability-menu-registry` | `${DSH_HOME:-~/.dsh}/capability-menu-search-metadata.json` | 检索描述与前端上限设置的状态文件；置空后无法保存修改 |
| `summaryMaxChars` | `capability-menu-registry` | `320` | 检索描述、`meta_search` 列表摘要及目录描述的初始字符上限；最小为 20；前端保存的值优先 |
| `refreshDebounceMs` | `capability-menu-registry` | `200` | 变更事件的重建防抖窗口（ms）；`0` 关闭防抖 |
| `patchFile` | `capability-menu-policy` | `~/.dsh/cordis.patch.yml`（`$DSH_HOME` 优先） | 注册 MCP 服务器写入的 patch 文件 |
| `stateFile` | `capability-menu-policy` | 与 `patchFile` 同目录的 `capability-menu-policy.json` | 界面档位改动的状态文件，置空禁用持久化 |
| `skillsDir` | `capability-menu-policy` | `~/.dsh/skills` | 注册 Skill 目录的技能根 |
| `persistDebounceMs` | `capability-menu-policy` | `1500` | 点选改动写入状态文件前的防抖窗口（ms）|

这些配置项分别属于对应的插件 entry，通常都写在同一份 `cordis.patch.yml` 里。`stateFile` 和 `searchMetadataFile` 由插件自动创建；`catalogFile` 是供模型检索的生成文件，`skillsDir` 是 Skill 存放目录。

**规则优先级**（按序匹配：禁用始终优先；在常驻与按需之间，精确规则优先于通配）：

| 优先级 | 规则 | 示例 | 效果 |
| --- | --- | --- | --- |
| 1 | `disabled` 精确 | `disabled: [forbidden_skill]` | 最硬禁用，压过一切 |
| 2 | `disabled` 通配 | `disabled: ['mcp__secret__*']` | 整组禁用 |
| 3 | `resident` 精确 | `resident: [bash]` | 单个能力显式常驻 |
| 4 | `on-demand` 精确 | `on-demand: [example_skill]` | 单个能力显式按需（能力菜单点击写入的就是这类） |
| 5 | `resident` 通配 | `resident: ['mcp__gongfeng__*']` | 整组常驻 |
| 6 | `on-demand` 通配 | `on-demand: ['mcp__*']` | 兜底批量按需 |
| 默认 | 未命中任何规则 | — | 常驻 |

若更高优先级规则覆盖了所选档位，界面会提示「分类未生效」。

### 按需能力检索目录（`catalogFile`）

插件将按需 Tool 和 Skill 写入 YAML 检索目录；常驻与禁用能力不写入。

- **目录文件：** 默认为 `${DSH_HOME:-~/.dsh}/capability-catalog.yaml`；无按需能力时内容是 `capabilities: []`。设置 `catalogFile: ''` 可关闭生成。目录随能力、档位和检索描述变化自动更新，请勿直接编辑生成文件。
- **检索描述：** 按需能力旁可打开编辑框。它预填最多 `summaryMaxChars` 个字符的来源描述（默认 320，截断时优先保留完整词句）；修改后用于 `meta_search` 列表与关键词匹配，并同步到目录，不改变来源定义或精确详情。「还原」仅重置输入框，仍需「保存」。
- **描述上限：** 在「策略与目录 → 按需能力检索目录」修改，最小 20 字符。设置保存在 `searchMetadataFile`，优先于 patch 中的 `summaryMaxChars`；降低上限前需先缩短超限的自定义描述。
- **检索与调用：** 使用 `meta_search({query})` 或目录中的 `id` 查找候选项，再用 `meta_search({id, kind})` 查看完整参数 schema，最后用 `meta_invoke({id, kind, args})` 调用或加载。目录只保存检索摘要，不包含参数 schema。模型能读取目录路径时，也可用 `grep` / `read` 检索。`meta_search` 默认每页 20 项、最多 50 项；下一页的 `offset` 等于当前 `offset + returned`。Skill 须先注册到 `ctx.skills`；若要重新加载会话中已读取的 Skill，传 `force: true`。

生成文件示例：

```yaml
capabilities:
  - id: mcp__km__search
    kind: tool
    description: 搜索知识库
    server: km
  - id: example_skill
    kind: skill
    description: 处理日志的低频技能
    whenToUse: 排查日志问题时使用
```

## License

本项目遵循 [Apache License 2.0](LICENSE)。
