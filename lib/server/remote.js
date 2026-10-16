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
import { describeSkillEntry, isProjectSkillsDir } from "../locations.js";
import { ADOPTABLE_SKILL_SOURCES, PROJECT_SKILL_SOURCES } from "../constants.js";
import { checkSelfUpdate, installSelfUpdate, switchSelfToNpm } from "./self-update.js";
import { basename, dirname, resolve } from 'node:path';
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
    let _checkSelfUpdate_decorators;
    let _installSelfUpdate_decorators;
    let _switchSelfToNpm_decorators;
    let _getConfig_decorators;
    let _updateConfig_decorators;
    let _classifyAll_decorators;
    let _getDiagnostics_decorators;
    let _refresh_decorators;
    let _getDetail_decorators;
    let _getSearchMetadata_decorators;
    let _updateSearchMetadata_decorators;
    let _updateSummaryMaxChars_decorators;
    let _listSkillDir_decorators;
    let _readSkillFile_decorators;
    let _getCatalogDocs_decorators;
    let _listLocations_decorators;
    let _addLocation_decorators;
    let _removeLocation_decorators;
    let _updateLocation_decorators;
    let _listSkillLocations_decorators;
    let _addSkillLocation_decorators;
    let _importSkillFromGitHub_decorators;
    let _adoptSkillLocation_decorators;
    let _removeSkillLocation_decorators;
    let _updateSkillLocation_decorators;
    let _catalogVersion_decorators;
    return class CapabilityPolicyGateway extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _checkSelfUpdate_decorators = [Remote('checkSelfUpdate')];
            _installSelfUpdate_decorators = [Remote('installSelfUpdate')];
            _switchSelfToNpm_decorators = [Remote('switchSelfToNpm')];
            _getConfig_decorators = [Remote('getConfig')];
            _updateConfig_decorators = [Remote('updateConfig')];
            _classifyAll_decorators = [Remote('classifyAll')];
            _getDiagnostics_decorators = [Remote('getDiagnostics')];
            _refresh_decorators = [Remote('refresh')];
            _getDetail_decorators = [Remote('getDetail')];
            _getSearchMetadata_decorators = [Remote('getSearchMetadata')];
            _updateSearchMetadata_decorators = [Remote('updateSearchMetadata')];
            _updateSummaryMaxChars_decorators = [Remote('updateSummaryMaxChars')];
            _listSkillDir_decorators = [Remote('listSkillDir')];
            _readSkillFile_decorators = [Remote('readSkillFile')];
            _getCatalogDocs_decorators = [Remote('getCatalogDocs')];
            _listLocations_decorators = [Remote('listLocations')];
            _addLocation_decorators = [Remote('addLocation')];
            _removeLocation_decorators = [Remote('removeLocation')];
            _updateLocation_decorators = [Remote('updateLocation')];
            _listSkillLocations_decorators = [Remote('listSkillLocations')];
            _addSkillLocation_decorators = [Remote('addSkillLocation')];
            _importSkillFromGitHub_decorators = [Remote('importSkillFromGitHub')];
            _adoptSkillLocation_decorators = [Remote('adoptSkillLocation')];
            _removeSkillLocation_decorators = [Remote('removeSkillLocation')];
            _updateSkillLocation_decorators = [Remote('updateSkillLocation')];
            _catalogVersion_decorators = [Remote('catalogVersion')];
            __esDecorate(this, null, _checkSelfUpdate_decorators, { kind: "method", name: "checkSelfUpdate", static: false, private: false, access: { has: obj => "checkSelfUpdate" in obj, get: obj => obj.checkSelfUpdate }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _installSelfUpdate_decorators, { kind: "method", name: "installSelfUpdate", static: false, private: false, access: { has: obj => "installSelfUpdate" in obj, get: obj => obj.installSelfUpdate }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _switchSelfToNpm_decorators, { kind: "method", name: "switchSelfToNpm", static: false, private: false, access: { has: obj => "switchSelfToNpm" in obj, get: obj => obj.switchSelfToNpm }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getConfig_decorators, { kind: "method", name: "getConfig", static: false, private: false, access: { has: obj => "getConfig" in obj, get: obj => obj.getConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _updateConfig_decorators, { kind: "method", name: "updateConfig", static: false, private: false, access: { has: obj => "updateConfig" in obj, get: obj => obj.updateConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _classifyAll_decorators, { kind: "method", name: "classifyAll", static: false, private: false, access: { has: obj => "classifyAll" in obj, get: obj => obj.classifyAll }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getDiagnostics_decorators, { kind: "method", name: "getDiagnostics", static: false, private: false, access: { has: obj => "getDiagnostics" in obj, get: obj => obj.getDiagnostics }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _refresh_decorators, { kind: "method", name: "refresh", static: false, private: false, access: { has: obj => "refresh" in obj, get: obj => obj.refresh }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getDetail_decorators, { kind: "method", name: "getDetail", static: false, private: false, access: { has: obj => "getDetail" in obj, get: obj => obj.getDetail }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getSearchMetadata_decorators, { kind: "method", name: "getSearchMetadata", static: false, private: false, access: { has: obj => "getSearchMetadata" in obj, get: obj => obj.getSearchMetadata }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _updateSearchMetadata_decorators, { kind: "method", name: "updateSearchMetadata", static: false, private: false, access: { has: obj => "updateSearchMetadata" in obj, get: obj => obj.updateSearchMetadata }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _updateSummaryMaxChars_decorators, { kind: "method", name: "updateSummaryMaxChars", static: false, private: false, access: { has: obj => "updateSummaryMaxChars" in obj, get: obj => obj.updateSummaryMaxChars }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listSkillDir_decorators, { kind: "method", name: "listSkillDir", static: false, private: false, access: { has: obj => "listSkillDir" in obj, get: obj => obj.listSkillDir }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _readSkillFile_decorators, { kind: "method", name: "readSkillFile", static: false, private: false, access: { has: obj => "readSkillFile" in obj, get: obj => obj.readSkillFile }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getCatalogDocs_decorators, { kind: "method", name: "getCatalogDocs", static: false, private: false, access: { has: obj => "getCatalogDocs" in obj, get: obj => obj.getCatalogDocs }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listLocations_decorators, { kind: "method", name: "listLocations", static: false, private: false, access: { has: obj => "listLocations" in obj, get: obj => obj.listLocations }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _addLocation_decorators, { kind: "method", name: "addLocation", static: false, private: false, access: { has: obj => "addLocation" in obj, get: obj => obj.addLocation }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _removeLocation_decorators, { kind: "method", name: "removeLocation", static: false, private: false, access: { has: obj => "removeLocation" in obj, get: obj => obj.removeLocation }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _updateLocation_decorators, { kind: "method", name: "updateLocation", static: false, private: false, access: { has: obj => "updateLocation" in obj, get: obj => obj.updateLocation }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _listSkillLocations_decorators, { kind: "method", name: "listSkillLocations", static: false, private: false, access: { has: obj => "listSkillLocations" in obj, get: obj => obj.listSkillLocations }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _addSkillLocation_decorators, { kind: "method", name: "addSkillLocation", static: false, private: false, access: { has: obj => "addSkillLocation" in obj, get: obj => obj.addSkillLocation }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _importSkillFromGitHub_decorators, { kind: "method", name: "importSkillFromGitHub", static: false, private: false, access: { has: obj => "importSkillFromGitHub" in obj, get: obj => obj.importSkillFromGitHub }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _adoptSkillLocation_decorators, { kind: "method", name: "adoptSkillLocation", static: false, private: false, access: { has: obj => "adoptSkillLocation" in obj, get: obj => obj.adoptSkillLocation }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _removeSkillLocation_decorators, { kind: "method", name: "removeSkillLocation", static: false, private: false, access: { has: obj => "removeSkillLocation" in obj, get: obj => obj.removeSkillLocation }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _updateSkillLocation_decorators, { kind: "method", name: "updateSkillLocation", static: false, private: false, access: { has: obj => "updateSkillLocation" in obj, get: obj => obj.updateSkillLocation }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _catalogVersion_decorators, { kind: "method", name: "catalogVersion", static: false, private: false, access: { has: obj => "catalogVersion" in obj, get: obj => obj.catalogVersion }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['capabilityPolicy', 'capability'];
        constructor(ctx) {
            super(ctx, 'capabilityPolicyGateway', { namespace: 'capabilityPolicy' });
            __runInitializers(this, _instanceExtraInitializers);
        }
        async checkSelfUpdate() {
            return checkSelfUpdate();
        }
        async installSelfUpdate(version) {
            await installSelfUpdate(version);
        }
        async switchSelfToNpm(version) {
            await switchSelfToNpm(version);
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
        /** Explain filtered, overridden, broken, empty, and unbrowseable inventory states. */
        getDiagnostics() {
            return this.ctx.capability.diagnostics();
        }
        /**
         * Rebuild the capability catalog now and resolve once it has converged.
         * The UI calls this after registering a new source (an MCP server or a
         * skill directory) so the list reflects it without waiting for the
         * scheduler's debounce window.
         */
        async refresh() {
            await this.ctx.capability.refresh();
        }
        /** Resolve one capability's full detail (schema, description; skill body optional). */
        async getDetail(id) {
            return this.ctx.capability.getDetail(id);
        }
        getSearchMetadata(id, kind) {
            return this.ctx.capability.getSearchMetadata(id, kind);
        }
        async updateSearchMetadata(input) {
            await this.ctx.capability.updateSearchMetadata(input);
        }
        async updateSummaryMaxChars(value) {
            await this.ctx.capability.updateSummaryMaxChars(value);
        }
        /** List a skill's directory children (one level deep; optional subpath). */
        async listSkillDir(id, relPath) {
            return this.ctx.capability.listSkillDir(id, relPath);
        }
        /** Read a text file inside a skill's directory. */
        async readSkillFile(id, relPath) {
            return this.ctx.capability.readSkillFile(id, relPath);
        }
        /** Return the effective rules and the generated on-demand search catalog. */
        async getCatalogDocs() {
            const config = this.ctx.capabilityPolicy.getConfig();
            const summaryMaxChars = this.ctx.capability.summaryMaxChars();
            const searchSettingsEnabled = this.ctx.capability.searchSettingsEnabled();
            const settings = { summaryMaxChars, searchSettingsEnabled };
            const policyYaml = yaml.dump({
                metaTools: [...this.ctx.capabilityPolicy.metaTools()],
                tools: config.tools ?? {},
                skills: config.skills ?? {},
            });
            const catalogPath = this.ctx.capability.catalogPath?.();
            if (catalogPath === undefined) {
                return { policyYaml, ...settings, catalogMissing: 'disabled', catalogState: 'disabled' };
            }
            const catalogStatus = this.ctx.capability.diagnostics().catalog;
            if (catalogStatus.state === 'policy-unmounted' || catalogStatus.state === 'write-failed') {
                return { policyYaml, ...settings, catalogMissing: catalogStatus.state, catalogState: catalogStatus.state };
            }
            try {
                const content = await readFile(catalogPath, 'utf8');
                return { policyYaml, ...settings, catalog: { path: catalogPath, content }, catalogState: catalogStatus.state };
            }
            catch (error) {
                this.ctx.logger.warn(`capability-menu-remote: on-demand catalog read failed (${catalogPath}): ${String(error)}`);
                return { policyYaml, ...settings, catalogMissing: 'read-failed', catalogState: catalogStatus.state };
            }
        }
        // — 注册能力（MCP 服务器 / Skill 目录）—
        //
        // Every mutation edits the patch file and lets dsh hot-reload mount or
        // unmount the source. The gateway never mounts anything itself.
        /** MCP servers declared in the patch file. */
        async listLocations() {
            return this.ctx.capabilityPolicy.listLocations();
        }
        /** Declare a new MCP server. */
        async addLocation(input) {
            return this.ctx.capabilityPolicy.addLocation(input);
        }
        /** Remove a declared MCP server. */
        async removeLocation(id) {
            return this.ctx.capabilityPolicy.removeLocation(id);
        }
        /** Replace a declared MCP server's connection config. */
        async updateLocation(id, input) {
            return this.ctx.capabilityPolicy.updateLocation(id, input);
        }
        /**
         * Skill entries the operator can manage: everything under the user root, plus
         * the project-scoped entries the skill index knows about.
         *
         * dsh discovers a project's skills from `<projectRoot>/.dsh/skills` and
         * `<projectRoot>/.agents/skills` for whichever project the *session* cwd sits
         * in, so reading the user root alone cannot see them. The index records each
         * skill's own directory, which is what lets these rows be edited and removed
         * rather than merely listed.
         */
        async listSkillLocations() {
            const rows = [...await this.ctx.capabilityPolicy.listSkillLocations()];
            const seen = new Set(rows.map(row => `${row.entryDir}\u0000${row.name}`));
            for (const entry of this.ctx.capability.skillDirs()) {
                if (!PROJECT_SKILL_SOURCES.has(entry.source ?? ''))
                    continue;
                const entryDir = dirname(entry.skillDir);
                if (!isProjectSkillsDir(entryDir))
                    continue;
                // `entry.name` is the skill's *declared* name, which need not match the
                // directory dsh found it in. `describeSkillEntry` addresses the entry
                // itself, so it has to be given the directory's own basename — passing the
                // declared name made it look for a directory that does not exist and
                // silently drop the row, leaving such a skill uneditable.
                const entryName = basename(entry.skillDir);
                const key = `${resolve(entryDir)}\u0000${entryName}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                const row = await describeSkillEntry(entryDir, entryName, 'project');
                if (row !== undefined)
                    rows.push(row);
            }
            return rows;
        }
        /**
         * Register a skill directory: into the user root by default, or into a
         * project's `.dsh/skills` when `projectPath` names a path inside that project.
         * Returns the entry path actually written so the UI can report it.
         */
        async addSkillLocation(dir, projectPath) {
            return this.ctx.capabilityPolicy.addSkillLocation(dir, projectPath);
        }
        /** Clone and validate the selected directory from a public GitHub skill URL. */
        async importSkillFromGitHub(url, projectPath) {
            return this.ctx.capabilityPolicy.importSkillFromGitHub(url, projectPath);
        }
        /**
         * Adopt a skill that already lives in a user-level root this plugin reads but
         * does not manage (`~/.agents/skills`, custom dirs) by linking its own
         * directory into the user root. The content is untouched — this is exactly how
         * the entries already in `~/.dsh/skills` are set up — and the skill becomes
         * editable afterwards. Returns the entry path written.
         *
         * A skill that ships inside an agent preset is refused: linking it into the
         * user root would make it global, which is the opposite of what a preset
         * skill is for. It is also the same check the UI applies (it hides the button),
         * repeated here because the source label alone cannot tell a preset's
         * `customSkillDirs` from a user's.
         */
        async adoptSkillLocation(name) {
            const record = this.ctx.capability.get(name.trim(), 'skill');
            const dir = record?.origin.path;
            const source = record?.origin.source;
            const preset = record?.origin.preset;
            if (preset !== undefined) {
                throw new Error(`该技能随预设 ${preset} 分发，不支持纳入管理（纳入管理会把它变成全局技能）`);
            }
            if (dir === undefined)
                throw new Error(`该技能没有可链接的目录，无法纳入管理：${name}`);
            if (source === undefined || !ADOPTABLE_SKILL_SOURCES.has(source)) {
                throw new Error(`该技能来自 ${source ?? '未知来源'}，不支持纳入管理`);
            }
            return this.ctx.capabilityPolicy.addSkillLocation(dir);
        }
        /** Unregister a skill entry; `entryDir` addresses a project entry. */
        async removeSkillLocation(name, entryDir) {
            return this.ctx.capabilityPolicy.removeSkillLocation(name, entryDir);
        }
        /** Repoint a registered skill entry at a different directory. */
        async updateSkillLocation(name, dir, entryDir) {
            return this.ctx.capabilityPolicy.updateSkillLocation(name, dir, entryDir);
        }
        /**
         * The registry's catalog version — one number, cheap enough to poll. The
         * management page uses it to notice changes the wire never announces (a file
         * dropped into an already-registered skill directory reindexes the host via
         * `skills/change`, which is not a forwarded event), and only re-reads
         * `classifyAll` when the number actually moved.
         *
         * Appended at the end of the class on purpose: the client-side descriptors in
         * `src/client/remote.ts` carry each method's `sourceLocation` line, and
         * inserting here would shift every line below it.
         */
        catalogVersion() {
            return this.ctx.capability.version();
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