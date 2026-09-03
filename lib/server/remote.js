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
/**
 * Host-side remote face for the 能力菜单 tab. Every method delegates to the
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
         * 能力目录查看：返回当前生效的三档策略配置 YAML，以及按需能力目录
         * 物化文件（~/.dsh/capability-catalog.yaml）的路径与内容。两者都是
         * 只读视图——策略持久化入口仍是 cordis.patch.yml。
         */
        async getCatalogDocs() {
            const config = this.ctx.capabilityPolicy.getConfig();
            const policyYaml = [
                '# 能力菜单 · 当前生效策略（实时视图，只读；持久化入口：cordis.patch.yml）',
                '# 未在规则列表中的能力默认 Resident（常驻）。',
                yaml.dump({
                    metaTools: [...this.ctx.capabilityPolicy.metaTools()],
                    tools: config.tools ?? {},
                    skills: config.skills ?? {},
                }),
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