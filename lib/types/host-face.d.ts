/**
 * Host-face Typert contribution for the `capabilityPolicy` namespace.
 *
 * WHY THIS EXISTS — the claim set of `@deepseek-ai/dsh-api-gateway` is built
 * once and then frozen. `claimsEndpoint()` decides whether an
 * `/api/<namespace>/<method>` request belongs to the gateway:
 *
 *     claimsEndpoint(endpoint) {
 *       if (this.ctx.typert.local.get(endpoint) !== void 0 || …hasSeen(endpoint)) return true
 *       this.srcClaims ??= this.collectSrcClaims()   // ← built once, never refreshed
 *       return this.srcClaims.has(endpoint)
 *     }
 *
 * `collectSrcClaims()` only sees the services that were already visible in
 * `ctx.reflect.props` at the moment of that first evaluation, and the snapshot is
 * only dropped again by an `internal/service` event. A host that starts serving
 * the browser before this package's gateway has registered therefore freezes a
 * claim set without `capabilityPolicy` — and then every 能力菜单 call falls
 * through to the default answer, which the browser reports as
 * `transport failure for /api/capabilityPolicy/…: HTTP 404`. The official
 * desktop application hits that ordering: `dsh-desktop-host` hands the window
 * its authenticated URL as soon as the profile is ready, and the renderer fires
 * `/api/session/…` immediately.
 *
 * `ctx.typert.register()` is the documented path for contributions that do not
 * ship a generated `./typert` artifact (`@deepseek-ai/dsh-typert-loader`: *"Manual
 * `ctx.typert.register()` remains available for contributions that do not use a
 * `./typert` artifact"*). Registering the namespace here puts every endpoint into
 * the **local** store, which `claimsEndpoint()` consults dynamically — so
 * whether the panel can reach the host stops depending on who won the startup
 * race.
 *
 * The wire metadata mirrors the browser face in `src/client/remote.ts`; keep the
 * two tables in step (`tests/host-face.spec.ts` fails when they drift). The
 * codecs are deliberately pass-through: the gateway decodes arguments with
 * `codec.create().parse(value)` and encodes a strict result with
 * `codec.encode?.(value) ?? value`, while the real argument and result types are
 * already enforced by the method signatures in `src/server/remote.ts`.
 *
 * @module @daweifu/capability-menu/host-face
 */
import type { Context } from '@deepseek-ai/cordis';
/** Package that owns this face — must equal the package the manifest is registered for. */
export declare const HOST_FACE_PACKAGE = "@daweifu/capability-menu";
/** Wire namespace shared with the browser face. */
export declare const HOST_FACE_NAMESPACE = "capabilityPolicy";
/**
 * Service key the gateway registers under (`super(ctx, 'capabilityPolicyGateway',
 * { namespace: 'capabilityPolicy' })`). The gateway looks the receiver up by this
 * key, so it has to match `src/server/remote.ts` exactly.
 */
export declare const HOST_FACE_SERVICE = "capabilityPolicyGateway";
/** One wire parameter of a registered invocation. */
export interface HostFaceParameter {
    readonly name: string;
    readonly wire: string;
    readonly source: 'json';
    /** Present for optional arguments: the gateway only allows a missing wire field when it is set. */
    readonly acceptsUndefined?: true;
    readonly codec: HostFaceCodec;
}
/** Strict codec as the gateway consumes it (`create().parse` on decode). */
export interface HostFaceCodec {
    readonly mode: 'strict';
    readonly typeSymbol: string;
    readonly create: () => {
        parse: (value: unknown) => unknown;
    };
}
/** One registered invocation of the host face. */
export interface HostFaceInvocation {
    readonly id: string;
    readonly service: string;
    readonly namespace: string;
    readonly method: string;
    readonly invocation: {
        readonly kind: 'direct';
    };
    readonly parameters: readonly HostFaceParameter[];
    readonly result: HostFaceCodec;
}
/** Contribution accepted by `ctx.typert.register()`. */
export interface TypertHostFace {
    readonly package: string;
    readonly face: 'host';
    readonly schemas: readonly never[];
    readonly invocations: readonly HostFaceInvocation[];
    readonly model: {
        readonly services: readonly never[];
        readonly events: readonly never[];
        readonly objects: readonly never[];
    };
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /**
         * Typert registry (`@deepseek-ai/dsh-typert-registry`). Redeclared locally
         * because this package does not depend on that package; only `register` is
         * used, and only for the contribution below.
         */
        typert: {
            register(contribution: TypertHostFace): unknown;
        };
    }
}
/** Build the host face for the `capabilityPolicy` namespace. */
export declare function capabilityPolicyHostFace(): TypertHostFace;
/**
 * Claim the `capabilityPolicy` namespace on a host that has a Typert registry.
 * Call from a `ctx.inject(['typert'], …)` hook so hosts without the registry are
 * unaffected.
 */
export declare function registerCapabilityPolicyHostFace(ctx: Context): void;
//# sourceMappingURL=host-face.d.ts.map