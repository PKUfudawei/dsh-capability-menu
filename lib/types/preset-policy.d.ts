import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { CapabilityClass } from './policy.ts';
export interface PolicyOverrides {
    tools: Record<string, CapabilityClass>;
    skills: Record<string, CapabilityClass>;
    servers: Record<string, CapabilityClass>;
}
export type PolicyContext = Agent | string | undefined;
export declare const emptyOverrides: () => PolicyOverrides;
export declare function presetOf(ctx: Context, context: PolicyContext): string | undefined;
export declare function validateOverrides(value: unknown): PolicyOverrides;
//# sourceMappingURL=preset-policy.d.ts.map