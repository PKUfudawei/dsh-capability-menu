import { type Context } from '@deepseek-ai/cordis';
import type { ToolActivationContext } from '@deepseek-ai/dsh-tools';
/**
 * DSH 0.2.2 owns tool declarations after the prompt waterfall. Its step-owned
 * tool set is the shared input to prompt assembly and direct dispatch, so
 * filtering that view hides non-Resident tools without unregistering them.
 * A nested meta_invoke call uses the same host executor without a step tool
 * set and can still reach an On-demand registration through normal policy.
 */
export declare function installToolAdmission(ctx: Context, isResident: (name: string, agent: ToolActivationContext['agent']) => boolean): boolean;
//# sourceMappingURL=tool-admission.d.ts.map