import YAML from 'yaml';
/** One `- id: … / name: … / config: …` row in a patch file. */
export interface PatchEntry {
    readonly id: string;
    readonly name: string;
    readonly disabled?: boolean;
    readonly config?: Record<string, unknown>;
}
/** Default patch file: the home-level layer shared by every profile. */
export declare function defaultPatchFile(): string;
/** Find the entry row with `id`, if the file declares one. */
export declare function findEntry(doc: YAML.Document.Parsed, id: string): YAML.YAMLMap | undefined;
/** Read every declared entry as plain data (never mutates the file). */
export declare function readEntries(file: string): Promise<PatchEntry[]>;
/**
 * Append a row to the document. Reuses the last `- insert:` block so new rows
 * land next to the existing ones; creates one when the file has none.
 */
export declare function addEntry(doc: YAML.Document.Parsed, entry: PatchEntry): void;
/**
 * Append a bare, id-targeted override row (`- id: … / name: … / config: …`) at
 * the top level — a patch that *finds* a row instead of adding one.
 *
 * Deliberately not {@link addEntry}: the row being configured is usually
 * contributed by another layer. This plugin's own bundle patch inserts
 * `capability-menu-policy`, and a profile's home layer is applied *after* that
 * layer, so inserting a second row with the same id here leaves the composed
 * tree with two rows sharing an id — which dsh refuses outright with
 * `duplicate loader entry id`, taking the whole profile down.
 */
export declare function addEntryOverride(doc: YAML.Document.Parsed, entry: PatchEntry): void;
/** Remove the row with `id`. Returns false when the file has no such row. */
export declare function removeEntry(doc: YAML.Document.Parsed, id: string): boolean;
/** Set or clear `disabled:` on the row with `id`. */
export declare function setEntryDisabled(doc: YAML.Document.Parsed, id: string, disabled: boolean): boolean;
/** Replace the row's `config:` (patch semantics replace the whole value). */
export declare function setEntryConfig(doc: YAML.Document.Parsed, id: string, config: Record<string, unknown>): boolean;
/**
 * Load the patch file, apply `mutate`, and persist only when it reports a
 * change. Returns whether a write happened (i.e. whether dsh will hot-reload).
 *
 * `mutate` must be pure apart from its edits to `doc`: it may be the only
 * chance to change the file, and a thrown error leaves the file untouched.
 */
export declare function mutatePatch(file: string, mutate: (doc: YAML.Document.Parsed) => boolean): Promise<boolean>;
//# sourceMappingURL=patch-file.d.ts.map