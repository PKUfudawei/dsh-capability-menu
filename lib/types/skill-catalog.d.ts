/** Project native catalogs before commit, reconciling against the visible session surface. */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export declare function installSkillCatalog(ctx: Context, resident: (name: string, agent: Agent) => boolean, disabled: (name: string, agent: Agent) => boolean): void;
//# sourceMappingURL=skill-catalog.d.ts.map