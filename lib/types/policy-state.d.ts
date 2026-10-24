import type { CapabilityClass } from './policy.ts';
export interface TierState {
    readonly tool: Map<string, CapabilityClass>;
    readonly skill: Map<string, CapabilityClass>;
}
export interface SearchState {
    readonly summaryMaxChars?: number;
    readonly descriptions: Map<string, string>;
}
export interface MenuState {
    readonly tiers: TierState;
    readonly search: SearchState;
}
/** Missing files mean no UI choices; malformed files fail instead of losing edits. */
export declare function readMenuState(file: string): Promise<MenuState>;
export declare function readTierState(file: string): Promise<TierState>;
/** Merge the old search file once, then move it aside as a backup. */
export declare function migrateLegacySearchState(file: string, legacyFile: string): Promise<boolean>;
/** Merge only this instance's tier moves with the latest file. */
export declare function writeTierState(file: string, moves: TierState): Promise<boolean>;
/** Change one search field without replacing tier or unrelated search choices. */
export declare function writeSearchState(file: string, change: {
    readonly summaryMaxChars?: number;
    readonly description?: {
        readonly key: string;
        readonly value?: string;
    };
}): Promise<void>;
//# sourceMappingURL=policy-state.d.ts.map