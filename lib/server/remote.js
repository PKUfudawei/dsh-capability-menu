var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
import { readFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import { BUILT_IN_SERVER } from "../registry.js";
/**
 * Host-side remote face for the 能力管理 tab. Every method delegates to the
 * policy service installed by `@daweifu/capability-menu/policy`; the registry
 * sibling (`capability`) must be mounted for `classifyAll` to return anything.
 *
 * The service registers under a distinct key (`capabilityPolicyGateway`) so it
 * does not collide with the `capabilityPolicy` service the policy plugin
 * provides; the Typert wire namespace is still `capabilityPolicy` (matching
 * the client remote descriptors), and the gateway reads the real policy
 * service through `this.ctx.capabilityPolicy`.
 */
let CapabilityPolicyGateway = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _getConfig_decorators;
    let _updateConfig_decorators;
    let _classifyAll_decorators;
    let _getDetail_decorators;
    let _listSkillDir_decorators;
    let _readSkillFile_decorators;
    let _getCatalogDocs_decorators;
    return class CapabilityPolicyGateway extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _getConfig_decorators = [Remote('getConfig')];
            _updateConfig_decorators = [Remote('updateConfig')];
            _classifyAll_decorators = [Remote('classifyAll')];
            _getDetail_decorators = [Remote('getDetail')];
            _listSkillDir_decorators = [Remote('listSkillDir')];
            _readSkillFile_decorators = [Remote('readSkillFile')];
            _getCatalogDocs_decorators = [Remote('getCatalogDocs')];
            __esDecorate(this, null, _getConfig_decorators, { kind: "method", name: "getConfig", static: false, private: false, access: { has: obj => "getConfig" in obj, get: obj => obj.getConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _updateConfig_decorators, { kind: "method", name: "updateConfig", static: false, private: false, access: { has: obj => "updateConfig" in obj, get: obj => obj.updateConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _classifyAll_decorators, { kind: "method", name: "classifyAll", static: false, private: false, access: { has: obj => "classifyAll" in obj, get: obj => obj.classifyAll }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getDetail_decorators, { kind: "method", name: "getDetail", static: false, private: false, access: { has: obj => "getDetail" in obj, get: obj => obj.getDetail }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listSkillDir_decorators, { kind: "method", name: "listSkillDir", static: false, private: false, access: { has: obj => "listSkillDir" in obj, get: obj => obj.listSkillDir }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _readSkillFile_decorators, { kind: "method", name: "readSkillFile", static: false, private: false, access: { has: obj => "readSkillFile" in obj, get: obj => obj.readSkillFile }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getCatalogDocs_decorators, { kind: "method", name: "getCatalogDocs", static: false, private: false, access: { has: obj => "getCatalogDocs" in obj, get: obj => obj.getCatalogDocs }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['capabilityPolicy', 'capability'];
        constructor(ctx) {
            super(ctx, 'capabilityPolicyGateway', { namespace: 'capabilityPolicy' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        /** Current (resolved) policy config. */
        getConfig() {
            return this.ctx.capabilityPolicy.getConfig();
        }
        /** Replace a subset of the policy config (recompile rules + rewrite catalog). */
        async updateConfig(partial) {
            await this.ctx.capabilityPolicy.updateConfig(partial);
        }
        /** Classify every capability currently indexed by `ctx.capability`. */
        classifyAll() {
            return [...this.ctx.capabilityPolicy.classifyAll()];
        }
        /** Resolve one capability's full detail (schema, description; skill body optional). */
        async getDetail(id) {
            return this.ctx.capability.getDetail(id);
        }
        /** List a skill's directory children (one level deep; optional subpath). */
        async listSkillDir(id, relPath) {
            return this.ctx.capability.listSkillDir(id, relPath);
        }
        /** Read a text file inside a skill's directory. */
        async readSkillFile(id, relPath) {
            return this.ctx.capability.readSkillFile(id, relPath);
        }
        /**
         * 能力目录查看：返回「三档策略配置」语义化视图——默认全部常驻，
         * tools.resident 按 server 各显示 '*'，例外（on-demand/disabled）按
         * server → 工具短名 分级列出；skills 无 server 维度，resident 恒为 '*'，
         * 例外为短名平铺。空例外不渲染 key，避免 []/{} 歧义。
         * 另返回按需能力目录物化文件（~/.dsh/capability-catalog.yaml）的路径和内容。
         * 两者都是只读视图——策略持久化入口仍是 cordis.patch.yml。
         */
        async getCatalogDocs() {
            const effective = [...this.ctx.capabilityPolicy.classifyAll()];
            const toolRows = effective.filter(row => row.kind === 'tool');
            const skillRows = effective.filter(row => row.kind === 'skill');
            const count = (rows, cls) => rows.filter(row => row.class === cls).length;
            /** 例外档（on-demand/disabled）的生效工具，按 server 分组为 server → 短名列表。 */
            const toolGroups = (cls) => {
                const groups = new Map();
                for (const row of toolRows.filter(r => r.class === cls)) {
                    const server = row.server ?? BUILT_IN_SERVER;
                    const prefix = row.server === undefined ? undefined : `mcp__${row.server}__`;
                    const short = prefix !== undefined && row.name.startsWith(prefix) ? row.name.slice(prefix.length) : row.name;
                    const list = groups.get(server);
                    if (list === undefined)
                        groups.set(server, [short]);
                    else
                        list.push(short);
                }
                return Object.fromEntries([...groups.entries()]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([server, names]) => [server, names.sort((a, b) => a.localeCompare(b))]));
            };
            /** 例外档技能的生效短名（技能无 server 维度，平铺列表）。 */
            const skillNames = (cls) => skillRows.filter(row => row.class === cls).map(row => row.name).sort((a, b) => a.localeCompare(b));
            // tools.resident：每个含工具的 server 一个 '*'（该 server 其余工具默认常驻）。
            const servers = [...new Set(toolRows.map(row => row.server ?? BUILT_IN_SERVER))]
                .sort((a, b) => a.localeCompare(b));
            const residentTools = {};
            for (const server of servers)
                residentTools[server] = '*';
            // 例外档仅当实际存在时才写入，避免空的 []/{}。
            const tools = { resident: residentTools };
            const onDemandTools = toolGroups('on-demand');
            const disabledTools = toolGroups('disabled');
            if (Object.keys(onDemandTools).length > 0)
                tools['on-demand'] = onDemandTools;
            if (Object.keys(disabledTools).length > 0)
                tools.disabled = disabledTools;
            const skills = { resident: '*' };
            const onDemandSkills = skillNames('on-demand');
            const disabledSkills = skillNames('disabled');
            if (onDemandSkills.length > 0)
                skills['on-demand'] = onDemandSkills;
            if (disabledSkills.length > 0)
                skills.disabled = disabledSkills;
            const policyYaml = [
                '# 能力管理 · 当前生效策略（只读；持久化入口：cordis.patch.yml）',
                '# 语义：默认全部能力常驻；下方 on-demand / disabled 为按 server → 工具名分级的例外。',
                `# 生效：tools 常驻 ${count(toolRows, 'resident')} · 按需 ${count(toolRows, 'on-demand')} · 禁用 ${count(toolRows, 'disabled')}；` +
                    `skills 常驻 ${count(skillRows, 'resident')} · 按需 ${count(skillRows, 'on-demand')} · 禁用 ${count(skillRows, 'disabled')}`,
                yaml.dump({
                    metaTools: [...this.ctx.capabilityPolicy.metaTools()],
                    tools,
                    skills,
                }).trimEnd(),
            ].join('\n');
            const catalogPath = this.ctx.capability.catalogPath?.();
            if (catalogPath === undefined) {
                return { policyYaml, catalogMissing: 'disabled' };
            }
            try {
                const content = await readFile(catalogPath, 'utf8');
                return { policyYaml, catalog: { path: catalogPath, content } };
            }
            catch (error) {
                this.ctx.logger.warn(`capability-menu-remote: on-demand catalog read failed (${catalogPath}): ${String(error)}`);
                return { policyYaml, catalogMissing: 'read-failed' };
            }
        }
    };
})();
export { CapabilityPolicyGateway };
/** Register the remote gateway on a context. */
export const name = 'capability-menu-remote';
export const inject = ['capabilityPolicy', 'capability'];
export function apply(ctx) {
    ctx.plugin(CapabilityPolicyGateway);
}
//# sourceMappingURL=remote.js.map