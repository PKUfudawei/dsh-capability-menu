export const emptyOverrides = () => ({ tools: {}, skills: {}, servers: {} });
export function presetOf(ctx, context) {
    if (typeof context === 'string')
        return context || undefined;
    if (!context)
        return;
    const presets = ctx.get('agentPresets');
    return presets?.presetForSession?.(context.session) ?? context.session?.header?.agentPreset;
}
export function validateOverrides(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid policy overrides');
    const result = emptyOverrides();
    for (const key of ['tools', 'skills', 'servers']) {
        const map = value[key] ?? {};
        if (!map || typeof map !== 'object' || Array.isArray(map))
            throw new Error(`Invalid ${key} overrides`);
        for (const [id, tier] of Object.entries(map)) {
            if (!id.trim() || !['resident', 'on-demand', 'disabled'].includes(tier))
                throw new Error('Invalid capability tier');
            Object.defineProperty(result[key], id, { value: tier, enumerable: true, writable: true, configurable: true });
        }
    }
    return result;
}
//# sourceMappingURL=preset-policy.js.map