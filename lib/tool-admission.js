import { symbols } from '@deepseek-ai/cordis';
/**
 * DSH 0.2.2 owns tool declarations after the prompt waterfall. Its step-owned
 * tool set is the shared input to prompt assembly and direct dispatch, so
 * filtering that view hides non-Resident tools without unregistering them.
 * A nested meta_invoke call uses the same host executor without a step tool
 * set and can still reach an On-demand registration through normal policy.
 */
export function installToolAdmission(ctx, isResident) {
    const proxy = ctx.tools;
    const tools = proxy[symbols.original] ?? proxy;
    const original = tools.resolve;
    if (typeof original !== 'function')
        return false;
    let active = true;
    const wrapped = async function (context) {
        const resolved = await original.call(this, context);
        if (!active)
            return resolved;
        let blocked;
        try {
            blocked = new Set([...resolved.view(context.agent).keys()].filter(name => !isResident(name)));
        }
        catch (error) {
            ctx.logger.warn(`capability-policy: tool admission failed; retaining host selection: ${String(error)}`);
            return resolved;
        }
        if (blocked.size === 0)
            return resolved;
        return Object.freeze({
            dispose: () => resolved.dispose(),
            view: (scope) => {
                const visible = resolved.view(scope);
                return new Map([...visible].filter(([name]) => !blocked.has(name)));
            },
        });
    };
    tools.resolve = wrapped;
    ctx.effect(() => () => {
        active = false;
        if (tools.resolve === wrapped)
            tools.resolve = original;
    }, 'capability-menu-policy: restore tool admission');
    return true;
}
//# sourceMappingURL=tool-admission.js.map