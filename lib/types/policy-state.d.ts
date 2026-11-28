import { type PolicyOverrides } from './preset-policy.ts';
import type { CapabilityClass, CapabilitySetConfig } from './policy.ts';
/** Independent mode policy. Rules are a frozen legacy migration snapshot. */
export interface ModePolicy {
    tools?: CapabilitySetConfig;
    skills?: CapabilitySetConfig;
    choices: PolicyOverrides;
}
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
    readonly overrides?: Record<string, PolicyOverrides>;
    readonly modes?: Record<string, ModePolicy>;
}
/** Missing files mean no UI choices; malformed files fail instead of losing edits. */
export declare function readMenuState(file: string): Promise<MenuState>;
export declare function readTierState(file: string): Promise<TierState>;
/** Migrate once under the same lock used for menu writes. */
export declare function initializeModePolicies(file: string, modes: Record<string, ModePolicy>): Promise<Record<string, ModePolicy>>;
export declare function writeModeChoices(file: string, preset: string, changes: {
    kind: 'tools' | 'skills';
    id: string;
    tier: CapabilityClass;
}[]): Promise<ModePolicy>;
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
/** Compatibility writes for callers without a mode; never used by the menu. */
export declare function writeLegacyGlobalChoices(file: string, changes: {
    kind: 'tools' | 'skills' | 'servers';
    id: string;
    tier: CapabilityClass | null;
}[]): Promise<void>;
//# sourceMappingURL=policy-state.d.ts.map