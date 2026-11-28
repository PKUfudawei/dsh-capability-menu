# Contributing

Thanks for helping improve `dsh-capability-menu`. Bug reports, documentation fixes, and code contributions are welcome. You can write issues and pull requests in English or Chinese.

If you already have a fix or implementation in mind, we also welcome a pull request linked to the issue. For larger changes, discuss the approach in an issue first to avoid duplicate work. A PR is not required to open an issue: a clear report and reproducible steps are valuable contributions too.

欢迎提交 Issue 报告问题或提出建议。如果你已有修复或实现方案，也欢迎提交 PR，并关联对应 Issue。较大的改动建议先通过 Issue 讨论方向，减少重复工作。暂时无法提供代码也没关系，清晰的问题描述和复现步骤同样是有价值的贡献。

## Before you start

- Check existing issues and pull requests for related work. An issue is helpful for a large change or a change to the public behavior, but it is not required for a small fix.
- For a bug, include the plugin version, DeepSeek Harness (DSH) version, operating system, steps to reproduce, expected behavior, and actual behavior. Include the error message or a minimal log when available. Remove tokens, credentials, and private data before posting.
- For a feature, describe the user problem and the proposed behavior. If it changes tool visibility, invocation, or compatibility with DSH, explain those effects explicitly.

## Work locally

CI uses Node.js 24.9.0 and pnpm 9. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
npm pack --dry-run
```

With a locally installed DSH rc.5 runtime and matching shared host packages, run the real AgentLoop/catalog regression without a network model:

```sh
DSH_RUNTIME_MODULES="$(npm root -g)/@deepseek-ai/dsh/node_modules" node scripts/check-rc5.mjs
```

This checks committed first-turn catalogs, the actual model request, subsequent-turn deduplication, `meta_search`, and tier-change updates. It does not replace Web UI or Windows verification.

Run the relevant commands before opening a pull request. If a command fails for a reason unrelated to your change, report the failure and your environment in the PR. CI runs all of these checks on Linux. Its Windows job runs type checking and `tests/self-update.spec.ts`; changes specific to Windows or the DSH desktop app need relevant Windows or desktop verification when possible.

## Make a focused change

- Keep the PR focused on one problem. Explain any work left for a follow-up.
- For a bug fix, add or update a test that would have caught the bug when a practical automated test exists. Prefer tests of behavior over tests that repeat the implementation.
- For a DSH integration change, state which host versions you tested and what still works on older supported versions. Do not claim full compatibility based only on a type check or a crash fix.
- Update both `README.md` and `README.en.md` when user-facing behavior, installation, or compatibility guidance changes. Update other documentation when it describes the affected behavior.
- Commit the regenerated `lib/` output when source changes; this repository tracks build artifacts. Do not include local configuration or credentials. Maintainers handle package version changes, release tags, and publication; a routine PR needs no changeset or version bump.

## Open a pull request

Use the PR template to summarize the problem and change, link a related issue if there is one, list the checks you ran, and describe any compatibility or behavior that remains unresolved. A partial fix is welcome when its scope is clear. The related issue can remain open until the full problem is resolved.

Maintainers review the behavior and compatibility claims as well as the code. The Linux and Windows CI jobs should pass before merge. If a check cannot pass because of an unrelated existing failure, explain that failure in the PR so the maintainer can assess it.
