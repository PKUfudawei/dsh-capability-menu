<h1 align="center">dsh-capability-menu</h1>

<p align="center">
  <strong>One unified capability management surface for DeepSeek Harness: control the exposure level (context footprint) and execution of Tools and Skills</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/v/@daweifu/capability-menu.svg?style=flat-square&color=0969DA&labelColor=161b22&logo=npm&logoColor=white" alt="npm version"/></a>
  <a href="https://www.npmjs.com/package/@daweifu/capability-menu"><img src="https://img.shields.io/npm/dt/@daweifu/capability-menu.svg?style=flat-square&color=0969DA&labelColor=161b22" alt="downloads"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-2EA44F?style=flat-square&labelColor=161b22" alt="license"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu"><img src="https://img.shields.io/github/stars/PKUfudawei/dsh-capability-menu.svg?style=flat-square&color=dbab09&labelColor=161b22&logo=github&logoColor=white" alt="GitHub stars"/></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek%20Harness-0.1.2--rc.1-4D6BFE.svg?style=flat-square&labelColor=161b22&logo=deepseek&logoColor=white" alt="DeepSeek Harness 0.1.2-rc.1"/></a>
  <a href="https://github.com/PKUfudawei/dsh-capability-menu/actions"><img src="https://img.shields.io/github/actions/workflow/status/PKUfudawei/dsh-capability-menu/ci.yml?branch=master&label=CI&style=flat-square&labelColor=161b22&logo=github&logoColor=white" alt="CI"/></a>
</p>

<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

<br/>

## Table of Contents

- [Capability Overview](#capability-overview)
- [Quick Install](#quick-install)
- [Exposure Policy](#exposure-policy)
- [Configuration](#configuration)

---

## Capability Overview

dsh-capability-menu is a Cordis plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It builds a unified capability catalog (`ctx.capability`) over a large number of tools / skills (MCP tools and harness-native built-in tools) and manages their **exposure level and execution** in three tiers — **Resident / On-demand / Disabled** — so you can adjust the agent's capability boundary at any time, keep a flood of tools/skills out of a single request, and save tokens and context. Changes apply immediately without restarting, and the plugin composes into the Harness runtime purely through the Cordis plugin mechanism — no upstream source is modified. **Without this plugin (policy) mounted, everything stays visible as before; mounted with no rules at all, every capability defaults to Resident.**

### Capability Model

*Capability* is the umbrella concept introduced by this plugin: a Tool and a Skill are different *kinds* of capability.

| kind | provides to the agent | action | notes |
| --- | --- | --- | --- |
| `tool` | executes an action (an MCP tool or a harness-native built-in tool) | `execute` | indexed by `ctx.tools` |
| `skill` | the method / flow / knowledge for a class of tasks | `load` | indexed by `ctx.skills` |

The model gets two meta tools:

| tool | role | corresponding entry |
| --- | --- | --- |
| `meta_search` | search the capability catalog (Tool / Skill), list/detail dual mode | `@daweifu/capability-menu/search` |
| `meta_invoke` | unified execution surface: really executes Tools (full `ctx.tools` pipeline) + loads Skills | `@daweifu/capability-menu/invoke` |

### Capability Management

<p align="center">
  <img src="assets/screenshot-mcp-tools.png" alt="Tools tab" width="45%"/>
  <img src="assets/screenshot-skills.png" alt="Skills tab" width="45%"/>
</p>

Once installed, a Capability Management tab appears under Settings → General Settings (between "Model" and "Plugins"). It lets you visualize and adjust the exposure policy; changes apply immediately, no restart needed:

- **Tools / Skills tabs**: the top tab bar shows `Tools` and `Skills`; its right side holds the per-class counts and the "View capability catalog" button. The Tools tab groups every tool by server (collapsible). MCP tools hang under their own server (`gongfeng`/`km`…); harness-native tools from the agent presets (`bash`/`read`/`write`/`glob`/`grep`…) hang under the reserved "System built-in" group (server key `built-in`). Click a row to view the model-facing tool definition — name / description / parameters.
- **Skills tab**: split into "Global skills" / "Project skills" sub-tabs (both always visible; the empty side shows an empty-state hint), and the per-class counts at the top follow the active sub-tab. Click a skill row to expand its directory tree; click a file to preview its content (e.g. the SKILL.md).
- **Three-state dot & click-to-cycle**: every capability carries a classification dot — solid = Resident, top-half-filled ring = On-demand, ring with a slash (no-entry sign) = Disabled — with per-class counts at the top of the pane; click a capability's dot or a class count to cycle its classification (built-in tools are manageable exactly like MCP tools), and if a higher-priority rule (e.g. a wildcard) overrides it, the UI reports that the classification did not apply.
- **View capability catalog**: the top-right button opens a read-only modal with the effective policy in a semantic view — every capability defaults to Resident, so `tools.resident` lists each server as `'*'`, exceptions appear only under `on-demand`/`disabled` grouped by server → tool name (skills have no server dimension, so `skills.resident` is just `'*'`) — plus the materialized On-demand catalog file (`catalogFile`) path and content. Persistence remains via the profile's `cordis.patch.yml`.

## Quick Install

Prerequisites: Node.js and the dsh CLI installed (`dsh plugin` forwards to pnpm internally).

### Install from npm (recommended)

A single package ships both the server-side plugin and the front-end Capability Management tab; once installed it shows up under Settings → General Settings:

```sh
dsh plugin --profile web add @daweifu/capability-menu
```

### Install from source

```sh
git clone https://github.com/PKUfudawei/dsh-capability-menu.git
cd dsh-capability-menu
pnpm install                   # the prepare script builds lib/ (server) and lib/client.js (front-end)

dsh plugin --profile web add ./dsh-capability-menu
```

### Verify the install

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

### Uninstall

```sh
dsh plugin --profile web remove @daweifu/capability-menu
```

## Exposure Policy

All capabilities (Tool and Skill) fall into three tiers by their **exposure level** (what the model sees in the context) and their **execution mode**:

### Tools / Skills three-tier exposure and execution

| tier | capability | exposure (model view) | discovery | execution |
| --- | --- | --- | --- | --- |
| **Resident** | tool | full schema in `assembly.tools` → the model's `tools` request payload, visible at every step | none (already resident) | model calls it directly; at runtime it goes through the full `ctx.tools` pipeline |
| | skill | name + description in the `<available_skills>` catalog (body not in the catalog) | none (already resident) | the `skill` tool loads the body on demand (on-demand loading) |
| **On-demand** | tool | not in the payload (zero context cost) | `meta_search` list / `grep` the materialized catalog YAML (`catalogFile`) | executed by `meta_invoke` (via `ctx.tools.execute`, full pipeline); or fetch the schema through detail and call it directly |
| | skill | not in the `<available_skills>` catalog | `meta_search`, or `grep` the materialized catalog YAML (`catalogFile`) | `meta_invoke` loads the SKILL.md body (via `ctx.skills`) |
| **Disabled** | tool | not in the payload | not returned by `meta_search`, not written to the catalog YAML | refused by `meta_invoke`; hallucinated direct calls are also hard-rejected in `tools/pre-execute` |
| | skill | not in the `<available_skills>` catalog | not returned by `meta_search`, not written to the catalog YAML | refused by `meta_invoke`; the `skill` tool is hard-rejected in `tools/pre-execute` |

> The tool tiers in the table above cover both `mcp__` cataloged tools and harness-native built-in tools (native tools are grouped under the reserved `built-in` server and are managed in all three tiers just like MCP tools). **An On-demand built-in tool leaves the model's resident view**: the model reaches it via `meta_search` and executes it with `meta_invoke` (a two-hop call) — so keep high-frequency core tools Resident. The `meta_search`/`meta_invoke` tools themselves and the reserved Code Mode transport `run_code` never enter the capability catalog; they are always Resident and cannot be cycled in the Capability Management.

## Configuration

Rules are declared under the `config` of the `capability-menu-policy` plugin entry in the profile's `cordis.patch.yml` (the outer `- insert:` / `id` / `name` is Cordis patch boilerplate and has nothing to do with the rules):

```yaml
config:
  tools:
    resident:
      - execute_cmd
      - get_session_context
      - search_kb
      - 'mcp__gongfeng__*'    # wildcard: everything under this server is resident
    on-demand:
      - 'mcp__*'              # wildcard fallback
      - 'server:km:*'         # bulk on-demand by server prefix
    disabled:
      - 'mcp__secret__*'      # disabled outranks everything, even resident
  skills:
    resident:
      - debugging
      - coding
    on-demand:
      - legacy_skill          # explicit on-demand (unlisted skills default to resident)
    disabled:
      - forbidden_skill
  metaTools:
    - meta_search             # always resident; cannot be disabled
    - meta_invoke
```

> Config keys are the tier words themselves: `resident` (常驻) / `on-demand` (按需) / `disabled` (禁用).

**Rule priority** (first match wins; within one tier, an exact rule beats a wildcard):

| priority | rule | example | effect |
| --- | --- | --- | --- |
| 1 | `disabled` exact | `disabled: [forbidden_skill]` | hardest deny, overrides everything |
| 2 | `disabled` wildcard | `disabled: ['mcp__secret__*']` | block a whole group |
| 3 | `resident` exact | `resident: [bash]` | keep one capability resident |
| 4 | `on-demand` exact | `on-demand: [legacy_skill]` | one capability on-demand (what a Capability Management click writes) |
| 5 | `resident` wildcard | `resident: ['mcp__gongfeng__*']` | keep a whole group resident |
| 6 | `on-demand` wildcard | `on-demand: ['mcp__*']` | bulk on-demand fallback |
| default | no rule matched | — | resident |

Key points:
- `meta_search`/`meta_invoke` are always resident and cannot be disabled.
- **Exact rules win over wildcards (even across tiers)**: e.g. with `resident: ['mcp__gongfeng__*']` in place, clicking a tool to On-demand in the Capability Management writes an exact `on-demand` rule that takes effect instead of being pushed back by the wildcard (if a higher-priority rule still overrides it, the UI reports that the classification did not apply).
- Native tools are cataloged exactly like MCP tools (under the `built-in` server); unlisted native tools default to Resident. Once overridden by `on-demand`/`disabled` a native tool leaves the model's resident view — when On-demand it stays reachable via `meta_search` → `meta_invoke`. **Do not name a real MCP server `built-in`.**
- Profiles still declaring the legacy keys `exposed`/`progressive`/`blocked` are auto-mapped to `resident`/`on-demand`/`disabled` at startup (with a warning); run `node scripts/migrate-capability-keys.mjs <cordis.patch.yml>` to persist the new spelling.

> Changes made in the Capability Management tab only write to in-memory runtime state and are not persisted. To persist them (apply with the profile, version-controllable / batch-declarable), edit the profile's `cordis.patch.yml` — that is the persistence entry point; no extra import/export buttons are needed.

### On-demand capability catalog (`catalogFile`, the single materialized catalog, searchable with `grep`)

On-demand capabilities are materialized into **one auto-generated YAML file** the model can browse:

**tools/skills change or classification change → the registry rewrites `catalogFile` → the model `grep`s/`read`s it (or calls `meta_search`) for an id + kind → `meta_invoke(id, kind)` runs/loads it**

- Defaults to `~/.dsh/capability-catalog.yaml` (`catalogFile` configurable; empty string disables). When nothing is On-demand, the catalog pointer is not injected (saving context).
- A skill must first be **registered in `ctx.skills`** (a skill provider — e.g. its SKILL.md under a user/project skills root or `customSkillDirs`) and then switched to On-demand; there is **no separate user-maintained input file**.
- Two discovery paths for the model: `grep` the catalog file / `meta_search` (structured schema); then call `meta_invoke` with the **`kind` reported by the same entry** to load/run it — skill ids are the bare name (e.g. `frontend-design`) with no `skill:` prefix, and `kind` distinguishes tools from skills. Bodies load via `ctx.skills` for skills and `ctx.tools.execute` for tools.

```yaml
# ~/.dsh/capability-catalog.yaml (auto-generated; contains only On-demand
# capabilities — Resident ones are already resident and Disabled ones must not
# be discoverable, so neither is written. Lists are emitted as `-` block
# sequences, one item per line.)
capabilities:
  - id: mcp__km__search
    kind: tool
    name: mcp__km__search
    description: Search the knowledge base
    server: km
  - id: legacy_skill
    kind: skill
    name: legacy_skill
    description: A legacy migration skill, used infrequently
    whenToUse: Use when working on legacy projects
```

> The catalog file is written under the host's `~/.dsh` by default, so the sandbox of the model-side `bash`/`read` tools must be able to reach that path. If the sandbox isolates the host directory, explicitly configure `catalogFile` to a path the sandbox can see. The default path is shared across multiple dsh instances (last-write-wins); in multi-instance deployments, give each instance its own `catalogFile`.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
