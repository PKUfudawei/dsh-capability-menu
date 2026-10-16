import type { CapabilityClass } from './policy.ts';
export interface TierState {
    readonly tool: Map<string, CapabilityClass>;
    readonly skill: Map<string, CapabilityClass>;
}
/** Missing files mean no UI overrides; malformed files fail instead of losing edits. */
export declare function readTierState(file: string): Promise<TierState>;
/** Merge only this instance's moves with the latest file, then replace atomically. */
export declare function writeTierState(file: string, moves: TierState): Promise<boolean>;
//# sourceMappingURL=policy-state.d.ts.map