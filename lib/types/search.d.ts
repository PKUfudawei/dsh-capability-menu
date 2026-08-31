/**
 * Model-facing `meta_search` tool: capability catalog search + detail.
 *
 * @module @daweifu/capability-menu (search plugin)
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { CapabilityDetail, CapabilitySummary } from './registry.ts';
export declare const name = "capability-menu-search";
export declare const inject: string[];
/** Model-facing `meta_search` configuration. */
export interface Config {
    /** Maximum results returned in list mode (default 20). */
    maxResults?: number;
}
/** Validate and default the tool configuration. */
export declare const Config: z<Config>;
/** Canonical list-mode result. */
export interface MetaSearchListResult {
    readonly mode: 'list';
    readonly total: number;
    readonly results: CapabilitySummary[];
    readonly hint: string;
}
/** Canonical detail-mode result. */
export interface MetaSearchDetailResult {
    readonly mode: 'detail';
    readonly result: CapabilityDetail;
}
/** Canonical tool result: one of the two modes. */
export type MetaSearchResult = MetaSearchListResult | MetaSearchDetailResult;
/**
 * Register the `meta_search` tool.
 *
 * - Mode A (list, default): query by keyword/tag/server, returns id + short summary.
 * - Mode B (detail): pass an exact id (optionally `detail: true`) to get the full schema.
 *
 * Validation rules enforced here:
 * - `query` and `id` are mutually exclusive.
 * - `detail: true` with a fuzzy query (no exact id) is rejected.
 */
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=search.d.ts.map