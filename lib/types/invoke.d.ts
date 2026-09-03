/**
 * Model-facing `meta_invoke` tool: unified execution/loading of capabilities.
 *
 * @module @daweifu/capability-menu (invoke plugin)
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type SkillResourceBase } from '@deepseek-ai/dsh-skill';
export declare const name = "capability-menu-invoke";
export declare const inject: string[];
/** Forwarding mode for the MCP branch. */
export type MetaForwardMode = 'direct' | 'resolve';
/** Model-facing `meta_invoke` configuration. */
export interface Config {
    /** How to forward MCP calls: `direct` executes via the tool pipeline; `resolve` returns the schema for the model to call directly. */
    forwardMode?: MetaForwardMode;
}
/** Validate and default the tool configuration. */
export declare const Config: z<Config>;
/** Canonical MCP result shape. */
export interface MetaInvokeMcpDetail {
    readonly forwarded: true;
    readonly target: string;
    readonly content: ContentBlock[];
}
/** Canonical skill result shape (matches the `skill` tool output). */
export interface MetaInvokeSkillDetail {
    readonly name: string;
    readonly provider: string;
    readonly resourceBase?: SkillResourceBase;
    readonly content: string;
}
/** Canonical resolve-mode result shape (forwardMode: 'resolve'). */
export interface MetaInvokeResolveDetail {
    readonly target: string;
    readonly kind: string;
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
}
/** Discriminated canonical result. */
export type MetaInvokeResult = {
    ok: true;
    kind: 'mcp';
    id: string;
    detail: MetaInvokeMcpDetail;
} | {
    ok: true;
    kind: 'skill';
    id: string;
    detail: MetaInvokeSkillDetail;
} | {
    ok: true;
    kind: 'resolve';
    id: string;
    detail: MetaInvokeResolveDetail;
};
/**
 * Register the `meta_invoke` tool.
 *
 * Dispatch is by `capability.kind`, not by id prefix.
 *
 * - Tools (`kind: 'tool'`, e.g. `mcp__gongfeng__create_issue` or a harness-native
 *   tool such as `bash`): forwards to the underlying tool call via the official
 *   `ctx.tools.execute` pipeline, preserving `agent`/`signal`/parent lineage.
 *   `forwardMode: 'resolve'` instead returns the target schema so the model can
 *   call the tool directly.
 * - Skills (`kind: 'skill'`, id `skill:<name>`): loads the full skill
 *   instructions and returns them as `<skill_content>` — no args, no script
 *   execution (matches the existing `skill` tool semantics).
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=invoke.d.ts.map