<h1 align="center">dsh-capability-menu</h1>

<p align="center">
  <strong>Manage DeepSeek Harness tools and skills, search efficiently, invoke on demand, and save context</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@deepseek-ai/dsh"><img src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.2--rc.5-4D6BFE.svg?style=flat-square&labelColor=161b22&logo=deepseek&logoColor=white" alt="DeepSeek Harness 0.2.2-rc.5"/></a>
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/v/@daweifu/capability-menu.svg?style=flat-square&color=CB3837&labelColor=161b22&logo=npm&logoColor=white" alt="npm version"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu/actions"><img src="https://img.shields.io/github/actions/workflow/status/PKUfudawei/dsh-capability-menu/ci.yml?branch=master&label=CI&style=flat-square&labelColor=161b22&logo=github&logoColor=white" alt="CI"/></a>
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/d18m/@daweifu/capability-menu.svg?style=flat-square&color=CB3837&labelColor=161b22&logo=npm&logoColor=white" alt="downloads"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu"><img src="https://img.shields.io/github/stars/PKUfudawei/dsh-capability-menu?style=flat-square&color=dbab09&labelColor=161b22&logo=github&logoColor=white" alt="GitHub stars"/></a>
  <a href="https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"><img src="https://img.shields.io/badge/featured%20in-awesome--dsh--plugin-8250DF?style=flat-square&labelColor=161b22&logo=github&logoColor=white" alt="featured in awesome-dsh-plugin"/></a>
</p>

<p align="center">
  <a href="./README.md">中文</a> · <strong>English</strong>
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
- [Policy & catalog](#policy--catalog)
  - [Exposure rules](#exposure-rules)
  - [On-demand search catalog](#on-demand-search-catalog)
- [Contributing](#contributing)

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
| `meta_search` | Search On-demand capabilities available to the current session; list mode reports total, returned, and whether results were truncated; detail returns descriptions and tool schemas | `@daweifu/capability-menu/search` |
| `meta_invoke` | Unified execution surface for Tools and Skills; pass `force: true` to reload updated Skill instructions | `@daweifu/capability-menu/invoke` |

### Capability Menu

<p align="center">
  <img src="assets/screenshot-tools_english.png" alt="Capability Menu Tools tab with exposure tiers and search descriptions grouped by server" width="48%"/>
  <img src="assets/screenshot-skills_english.png" alt="Capability Menu Skills tab with exposure tiers and search descriptions grouped by source" width="48%"/>
</p>

After installation, open **Settings** and select **Capability Menu** from the settings navigation to manage Tools and Skills.

Capability Menu follows the current main conversation's **mode (Agent preset)**. Each mode saves its own Tool and Skill tiers; new modes start with Resident capabilities. Switching conversations updates the displayed mode. Until the current mode is known, the menu waits and does not save changes.

Click a capability's tier button to cycle through Resident, On-demand, and Disabled. Click a server's tier-count button to change the currently displayed tools in that tier together. Changes save automatically and apply to subsequent requests.

| Task | How to do it |
| --- | --- |
| Change a tier | Click the capability's tier button to cycle its tier. The tier-count buttons beside a server cycle the currently displayed tools in the corresponding tier. |
| Find a capability | Use the filter below the tabs to search by name or group. Regex is supported and matching is case-insensitive. |
| View details | Click a Tool to see its definition. Click a Skill to expand its files and preview them; content is rendered as Markdown. |
| Register a capability | Click **Register** in the top right to add an MCP server or Skill directory; Skills accept local paths or public GitHub URLs. |
| Edit or remove | Click **Edit** on a server group in Tools or a Skill row in Skills. |
| View rules and on-demand catalog | Click **Policy &amp; catalog** on the right side of the page header. The catalog tab also sets the search description limit. |
| Edit search description | Set a Tool or Skill to **On-demand**, then click **Search description** beside it to edit a short version of the provider description. |

- **MCP names**: Server groups omit the `mcp__server__` prefix. Hover for the full name; search and invocation still use the full ID.
- **Registration**: Add MCP servers, local Skill directories, or public GitHub Skills. GitHub imports require Git on the machine running dsh. Request headers and other MCP credentials are stored in the patch file; keep it secure.
- **Skill updates**: Click **Check for updates** to review status and diffs, then update one or several Skills. Checks and updates follow the current search filter; local changes prevent replacement. Locally linked Skills must be updated through their original installation method; Mode Skills do not support automatic updates.
- **Source association**: Link a local Skill directory to a matching GitHub version. You can edit or unlink the source without removing the Skill files.

## Installation and Uninstallation

Prerequisites: [Node.js](https://nodejs.org/en/download) `>=24.9.0` and an installed [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with the `dsh` command available in your terminal. Installing from source also requires pnpm.

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
dsh --profile web --dump-config | grep -m1 '== @daweifu/capability-menu'
```

### Uninstall

```sh
dsh plugin --profile web remove @daweifu/capability-menu
```

## Policy & catalog

This chapter follows the **Policy & catalog** dialog in Capability Menu.

### Exposure rules

All capabilities (Tool and Skill) fall into three tiers by their **exposure level** (what the model sees in the context) and their **execution mode**:

| tier | capability | what the model sees | how to find it | how to use it |
| --- | --- | --- | --- | --- |
| **Resident** | tool | Tool definition is included with every request | No search needed | Call directly; it goes through the full `ctx.tools` pipeline |
| | skill | Name and summary appear in `<available_skills>` | No search needed | The `skill` tool loads the content when needed |
| **On-demand** | tool | Tool definition is not included with requests | Search candidates with `meta_search` | Inspect parameters by exact ID, then call with `meta_invoke` |
| | skill | Not shown in `<available_skills>` | Search with `meta_search` | Load `SKILL.md` with `meta_invoke` |
| **Disabled** | tool | Tool definition is not included with requests | Hidden from `meta_search` | Calls are rejected |
| | skill | Not shown in `<available_skills>` | Hidden from `meta_search` | Loads are rejected |

Scope and exceptions:

- MCP tools and cataloged DSH native tools support all three tiers; native tools appear in the `built-in` group. Do not name an MCP server `built-in`, which would collide with that group.
- When an MCP server has tools in the current scope and all of them are Disabled, its shared instructions (DSH's `mcp:<server>` section) are no longer injected automatically. Partial disabling removes the disabled tools' definitions but keeps shared instructions; On-demand tools also keep them. Re-enabling restores the instructions without disconnecting the server or deleting chat history. An empty tool inventory is not treated as all Disabled. If the host also contributes an MCP resource catalog and resource tools remain available, server instructions are conservatively retained because the host does not expose per-server resource instruction ownership.
- `meta_search` and `meta_invoke` remain Resident and cannot be disabled in the menu. Code Mode's entry tool `run_code` does not appear in this plugin's catalog or menu.
- Keep frequently used tools Resident; use `meta_search` to find an On-demand tool's ID and inspect its schema before invocation.

#### Rule configuration and persistence

The policy dialog lists the current mode's effective tool and skill tiers for inspection, not as a separate editable YAML file.

- Menu choices and search metadata are saved in `stateFile` without reloading DSH configuration.
- The default is `${DSH_HOME:-~/.dsh}/capability-menu-policy.json`, shared across profiles. Set the same custom `stateFile` on policy and registry entries to isolate a profile.
- Use the menu for routine changes. Deleting the state file discards every mode's policy and search descriptions.

### On-demand search catalog

`meta_search` is the Agent's only search entry for On-demand Tools and Skills. **Policy & catalog → On-demand search catalog** shows summaries from the same in-memory index without generating a separate YAML file. Agent results are also filtered to capabilities available in the current session.

- **Search description:** On-demand capabilities use a short provider description (up to 320 characters) by default; you can edit it in the menu. `meta_search` uses this summary for its list and keyword matching. Editing it does not change the provider definition.
- **Description limit:** Set it under **Policy & catalog → On-demand search catalog** (minimum 20 characters). Shorten custom descriptions that exceed a lower limit before saving it.
- **Search and invoke:** Use `meta_search({query})` to find a capability, `meta_search({id, kind})` to inspect its parameters, and `meta_invoke({id, kind, args})` to call or load it. Pass `force: true` to reload a Skill already loaded in the current session.

## Contributing

Bug reports, documentation fixes, and code contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow and merge criteria. Issues and pull requests may be written in English or Chinese.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
