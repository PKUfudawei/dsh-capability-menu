<h1 align="center">dsh-capability-menu</h1>

<p align="center">
  <strong>Manage DeepSeek Harness tools and skills, search efficiently, invoke on demand, and save context</strong>
</p>

<p align="center">
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.2-4D6BFE.svg?style=flat-square&labelColor=161b22&logo=deepseek&logoColor=white" alt="DeepSeek Harness 0.2.1-rc.2"/></a>
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/v/@daweifu/capability-menu.svg?style=flat-square&color=CB3837&labelColor=161b22&logo=npm&logoColor=white" alt="npm version"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu/actions"><img src="https://img.shields.io/github/actions/workflow/status/PKUfudawei/dsh-capability-menu/ci.yml?branch=master&label=CI&style=flat-square&labelColor=161b22&logo=github&logoColor=white" alt="CI"/></a>
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/d18m/@daweifu/capability-menu.svg?style=flat-square&color=CB3837&labelColor=161b22&logo=npm&logoColor=white" alt="downloads"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu"><img src="https://badgen.net/github/stars/PKUfudawei/dsh-capability-menu?icon=github&color=dbab09" alt="GitHub stars"/></a>
  <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"><img src="https://img.shields.io/badge/featured%20in-awesome--dsh--plugin-8250DF?style=flat-square&labelColor=161b22&logo=github&logoColor=white" alt="featured in awesome-dsh-plugin"/></a>
</p>

<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

## Table of Contents

- [Capability Overview](#capability-overview)
  - [Capability Model](#capability-model)
  - [Capability Menu](#capability-menu)
- [Installation and Uninstallation](#installation-and-uninstallation)
  - [Install from npm (recommended)](#install-from-npm-recommended)
  - [Install from source](#install-from-source)
  - [Verify the install](#verify-the-install)
  - [Uninstall](#uninstall)
- [Exposure Policy](#exposure-policy)
  - [Tools and Skills three-tier exposure and execution](#tools-and-skills-three-tier-exposure-and-execution)
- [Configuration](#configuration)
  - [On-demand search catalog (`catalogFile`)](#on-demand-search-catalog-catalogfile)

---

## Capability Overview

- Builds a unified capability catalog (`ctx.capability`) for DeepSeek Harness tools (including MCP and built-in tools) and skills.
- Provides three policy tiers — **Resident / On-demand / Disabled** — to manage capability exposure and invocation.
- Supplies on-demand capabilities only when needed, reducing the tool definitions sent with each request and saving tokens and context.

### Capability Model

*Capability* is the umbrella concept introduced by this plugin: a Tool and a Skill are different *kinds* of capability.

| kind | provides to the agent | action | notes |
| --- | --- | --- | --- |
| `tool` | executes an action (an MCP tool or a harness-native built-in tool) | `execute` | indexed by `ctx.tools` |
| `skill` | the method / flow / knowledge for a class of tasks | `load` | indexed by `ctx.skills` |

The model gets two meta tools:

| tool | role | corresponding entry |
| --- | --- | --- |
| `meta_search` | Search capabilities visible to the current session; list mode supports offset pagination and reports total, returned, and has-more values; detail returns descriptions and tool schemas | `@daweifu/capability-menu/search` |
| `meta_invoke` | Unified execution surface for Tools and Skills; pass `force: true` to reload updated Skill instructions | `@daweifu/capability-menu/invoke` |

### Capability Menu

<p align="center">
  <img src="assets/screenshot-tools_english.png" alt="Capability Menu Tools tab with exposure tiers and search descriptions grouped by server" width="48%"/>
  <img src="assets/screenshot-skills_english.png" alt="Capability Menu Skills tab with exposure tiers and search descriptions grouped by source" width="48%"/>
</p>

After installation, open **Settings** and select **Capability Menu** from the settings navigation to manage Tools and Skills.

| Task | How to do it |
| --- | --- |
| Change a tier | Click the dot beside a capability. Click a tier count at the top to change the whole group. |
| Find a capability | Use the filter below the tabs to search by name or group. Regex is supported and matching is case-insensitive. |
| View details | Click a Tool to see its definition. Click a Skill to expand its files and preview them; content is rendered as Markdown. |
| Register a capability | Click **Register** in the top right to add an MCP server or Skill directory; Skills accept local paths or public GitHub URLs. |
| Edit or remove | Click **Edit** on a server group in Tools or a Skill row in Skills. |
| View rules and catalog | Click **Policy &amp; catalog** on the right side of the page header. The catalog tab also sets the search description limit. |
| Edit search description | Set a Tool or Skill to **On-demand**, then click **Search description** beside it to edit a short version of the provider description. |

Notes:

- **MCP names**: Server groups omit the `mcp__server__` prefix. Hover for the full name; search and invocation still use the full ID.
- **Registration**: MCP servers write to the patch config (missing files and directories are created). Request headers and other credentials are stored there; keep it secure. Skills are linked or imported into the selected skill root.
- **GitHub Skills**: Public repositories support a default-branch root (with `SKILL.md`), a branch root `.../tree/{branch}`, or a Skill directory `.../tree/{branch}/{skill-directory}`. Local paths also work. Git is required on the machine running dsh; the plugin validates `SKILL.md` and copies only the selected directory.

## Installation and Uninstallation

Prerequisites: [Node.js](https://nodejs.org/en/download) and the [dsh CLI](https://github.com/deepseek-ai/deepseek-harness). Installing from npm needs no separate pnpm install; installing from source requires pnpm.

Compatibility: tested with DSH `0.2.0-rc.2` and `0.2.1-rc.2`; development and build dependencies now use `0.2.1-rc.2`.

### Install from npm (recommended)

```sh
dsh plugin --profile web add @daweifu/capability-menu
```

### Install from source

```sh
git clone https://github.com/PKUfudawei/dsh-capability-menu.git
cd dsh-capability-menu
pnpm install

dsh plugin --profile web add .
```

### Verify the install

```sh
cd "${DSH_HOME:-$HOME/.dsh}/profiles/web" && pnpm list @daweifu/capability-menu && dsh --profile web --dump-config | grep -m1 '== @daweifu/capability-menu'
```

### Uninstall

```sh
dsh plugin --profile web remove @daweifu/capability-menu
```

## Exposure Policy

All capabilities (Tool and Skill) fall into three tiers by their **exposure level** (what the model sees in the context) and their **execution mode**:

### Tools and Skills three-tier exposure and execution

| tier | capability | what the model sees | how to find it | how to use it |
| --- | --- | --- | --- | --- |
| **Resident** | tool | Tool definition is included with every request | No search needed | Call directly; it goes through the full `ctx.tools` pipeline |
| | skill | Name and summary appear in `<available_skills>` | No search needed | The `skill` tool loads the content when needed |
| **On-demand** | tool | Tool definition is not included with requests | Search candidates with `meta_search` or search the capability catalog YAML (`catalogFile`) | Inspect parameters by exact ID, then call with `meta_invoke` |
| | skill | Not shown in `<available_skills>` | Search with `meta_search` or search the capability catalog YAML (`catalogFile`) | Load `SKILL.md` with `meta_invoke` |
| **Disabled** | tool | Tool definition is not included with requests | Hidden from search results and the capability catalog | Calls are rejected |
| | skill | Not shown in `<available_skills>` | Hidden from search results and the capability catalog | Loads are rejected |

Scope and exceptions:

- MCP tools and cataloged DSH native tools support all three tiers; native tools appear in the `built-in` group. Do not name an MCP server `built-in`, which would collide with that group.
- `meta_search` and `meta_invoke` are Resident by default and cannot be disabled in the menu. Code Mode's entry tool `run_code` does not appear in this plugin's catalog or menu; handwritten wildcard rules can still match it, so do not set it to On-demand or Disabled.
- Keep frequently used tools Resident; use `meta_search` to find an On-demand tool's ID and inspect its schema before invocation.

## Configuration

Hand-written rules belong under `config` in the `capability-menu-policy` entry. This is a config fragment; see [cordis.patch.yml](./cordis.patch.yml) for the complete installation patch.

- The default patch is `${DSH_HOME:-~/.dsh}/cordis.patch.yml`. A profile can override the entry in its own patch.
- Tier changes in Capability Menu apply immediately and are written to a separate `stateFile` about 1.5 seconds after input stops. These writes do not reload the plugin. Patch rules remain the base; UI choices override exact rules for the same capability, while Disabled wildcards still take priority.
- By default, `stateFile` sits beside `patchFile`, so profiles share UI choices. Set a different `stateFile` per profile to isolate them. To clear UI choices, stop DSH and delete the state file; patch rules remain in effect.

```yaml
config:
  tools:
    on-demand: # On-demand
      - 'mcp__example__*'    # tools from one MCP server
    disabled: # Disabled
      - 'mcp__secret__*'
  skills:
    on-demand: # On-demand
      - example_skill        # unlisted capabilities default to Resident
```

Usually, you only need `tools` and `skills`. The optional file paths and debounce settings can keep their defaults. For every parameter, see the [policy config](./src/policy.ts) and [registry config](./src/registry.ts).

**Rule priority** (evaluated in order: Disabled always wins; between Resident and On-demand, exact rules beat wildcards):

| priority | rule | example | effect |
| --- | --- | --- | --- |
| 1 | `disabled` exact | `disabled: [forbidden_skill]` | hardest deny, overrides everything |
| 2 | `disabled` wildcard | `disabled: ['mcp__secret__*']` | block a whole group |
| 3 | `resident` exact | `resident: [bash]` | keep one capability resident |
| 4 | `on-demand` exact | `on-demand: [example_skill]` | one capability on-demand (what a Capability Menu click writes) |
| 5 | `resident` wildcard | `resident: ['mcp__gongfeng__*']` | keep a whole group resident |
| 6 | `on-demand` wildcard | `on-demand: ['mcp__*']` | bulk on-demand fallback |
| default | no rule matched | — | resident |

If a higher-priority rule overrides a selected tier, the UI reports that the classification did not apply.

### On-demand search catalog (`catalogFile`)

The plugin writes On-demand Tools and Skills to a YAML search catalog. Resident and Disabled capabilities are excluded.

- **Catalog file:** Defaults to `${DSH_HOME:-~/.dsh}/capability-catalog.yaml`; with no On-demand capabilities it contains `capabilities: []`. Set `catalogFile: ''` to disable generation. It updates when capabilities, tiers, or search descriptions change, so do not edit the generated file directly.
- **Search description:** An On-demand row opens an editor prefilled with the provider description shortened to `summaryMaxChars` characters (320 by default, preferring word or punctuation boundaries). Edits affect `meta_search` lists and keyword matching and are written to the catalog; the provider definition and exact detail stay unchanged. **Restore** resets the field, and **Save** applies it.
- **Description limit:** Set it in **Policy & catalog → On-demand search catalog** (minimum 20). The saved value in `searchMetadataFile` takes priority over `summaryMaxChars` in the patch. Shorten any custom descriptions above a proposed lower limit before saving.
- **Search and invoke:** Find a candidate with `meta_search({query})` or a catalog `id`, inspect the full parameter schema with `meta_search({id, kind})`, then call or load it with `meta_invoke({id, kind, args})`. The catalog contains search summaries, not parameter schemas. If the model can read the catalog path, it can also search the file with `grep` / `read`. `meta_search` returns 20 entries per page by default (50 maximum); the next `offset` is the current `offset + returned`. A Skill must be registered in `ctx.skills`; pass `force: true` to reload one already read in this session.

Generated file example:

```yaml
capabilities:
  - id: mcp__km__search
    kind: tool
    description: Search the knowledge base
    server: km
  - id: example_skill
    kind: skill
    description: A low-frequency skill for analyzing logs
    whenToUse: Use when investigating log issues
```

## License

This project is licensed under the [Apache License 2.0](LICENSE).
