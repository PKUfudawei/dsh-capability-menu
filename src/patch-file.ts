/**
 * Comment-preserving, loop-safe editing of a dsh patch file.
 *
 * dsh owns and composes these files (`~/.dsh/cordis.patch.yml` and per-profile
 * `cordis.patch.yml`), and in a `patchReload: live` profile it *watches* them:
 * any write triggers a transactional re-apply of the patch, which re-applies
 * this very plugin. Two consequences drive everything below:
 *
 * - **A no-op must never write.** Writing on every startup/apply would make the
 *   plugin reload itself forever. So each mutation reports whether it actually
 *   changed the document, and nothing is written when it did not.
 * - **A write must never damage the file.** The file is a hand-maintained asset
 *   (comments, `!!js` expressions, credentials). Edits go through `yaml`'s
 *   document API, which keeps comments, and every write is backed up, verified
 *   by re-parsing, and rolled back on failure.
 *
 * Note the round-trip is *not* byte-identical — `yaml` normalizes trailing
 * comment spacing and quoting style. That is why "did this change anything?" is
 * decided by the mutation, never by comparing before/after text.
 */
import { copyFile, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'

/** One `- id: … / name: … / config: …` row in a patch file. */
export interface PatchEntry {
  readonly id: string
  readonly name: string
  readonly disabled?: boolean
  readonly config?: Record<string, unknown>
}

/** Default patch file: the home-level layer shared by every profile. */
export function defaultPatchFile(): string {
  const home = process.env['DSH_HOME']
  if (home !== undefined && home.length > 0) return join(home, 'cordis.patch.yml')
  return join(homedir(), '.dsh', 'cordis.patch.yml')
}

/**
 * Every entry row in the document: both bare top-level rows and rows nested in
 * an `- insert:` block (the form dsh's own patches and this bundle use).
 */
function* entryNodes(doc: YAML.Document.Parsed): Generator<{ node: YAML.YAMLMap; parent: YAML.YAMLSeq }> {
  const root = doc.contents
  if (!YAML.isSeq(root)) return
  for (const item of root.items) {
    if (!YAML.isMap(item)) continue
    const insert = item.get('insert')
    if (insert !== undefined && insert !== null) {
      if (!YAML.isSeq(insert)) continue
      for (const row of insert.items) {
        if (YAML.isMap(row)) yield { node: row, parent: insert }
      }
      continue
    }
    if (item.get('id') !== undefined) yield { node: item, parent: root }
  }
}

/** Find the entry row with `id`, if the file declares one. */
export function findEntry(doc: YAML.Document.Parsed, id: string): YAML.YAMLMap | undefined {
  for (const { node } of entryNodes(doc)) {
    if (node.get('id') === id) return node
  }
  return undefined
}

/** Read every declared entry as plain data (never mutates the file). */
export async function readEntries(file: string): Promise<PatchEntry[]> {
  const source = await readFile(file, 'utf8')
  const doc = YAML.parseDocument(source)
  const entries: PatchEntry[] = []
  for (const { node } of entryNodes(doc)) {
    const value = node.toJSON() as Partial<PatchEntry>
    if (typeof value.id !== 'string' || typeof value.name !== 'string') continue
    entries.push(value as PatchEntry)
  }
  return entries
}

/** The last `- insert:` block in the document, if any. */
function lastInsertSeq(doc: YAML.Document.Parsed): YAML.YAMLSeq | undefined {
  const root = doc.contents
  if (!YAML.isSeq(root)) return undefined
  let found: YAML.YAMLSeq | undefined
  for (const item of root.items) {
    if (!YAML.isMap(item)) continue
    const insert = item.get('insert')
    if (YAML.isSeq(insert)) found = insert
  }
  return found
}

/**
 * Append a row to the document. Reuses the last `- insert:` block so new rows
 * land next to the existing ones; creates one when the file has none.
 */
export function addEntry(doc: YAML.Document.Parsed, entry: PatchEntry): void {
  const root = doc.contents
  if (!YAML.isSeq(root)) throw new Error('patch file root is not a sequence')
  const target = lastInsertSeq(doc) ?? ((): YAML.YAMLSeq => {
    const block = doc.createNode({ insert: [] }) as YAML.YAMLMap
    // `root` is narrowed to a parsed sequence; the freshly built map is not
    // narrowed with it even though it is a real document node.
    root.add(block as unknown as YAML.ParsedNode)
    return block.get('insert') as YAML.YAMLSeq
  })()
  target.add(doc.createNode({ ...entry }))
}

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
export function addEntryOverride(doc: YAML.Document.Parsed, entry: PatchEntry): void {
  const root = doc.contents
  if (!YAML.isSeq(root)) throw new Error('patch file root is not a sequence')
  // `root` is narrowed to a parsed sequence; the freshly built map is not
  // narrowed with it even though it is a real document node.
  root.add(doc.createNode({ ...entry }) as unknown as YAML.ParsedNode)
}

/** Remove the row with `id`. Returns false when the file has no such row. */
export function removeEntry(doc: YAML.Document.Parsed, id: string): boolean {
  for (const { node, parent } of entryNodes(doc)) {
    if (node.get('id') !== id) continue
    parent.delete(parent.items.indexOf(node))
    return true
  }
  return false
}

/** Set or clear `disabled:` on the row with `id`. */
export function setEntryDisabled(doc: YAML.Document.Parsed, id: string, disabled: boolean): boolean {
  const node = findEntry(doc, id)
  if (node === undefined) return false
  if (disabled) node.set('disabled', true)
  else node.delete('disabled')
  return true
}

/** Replace the row's `config:` (patch semantics replace the whole value). */
export function setEntryConfig(doc: YAML.Document.Parsed, id: string, config: Record<string, unknown>): boolean {
  const node = findEntry(doc, id)
  if (node === undefined) return false
  node.set('config', doc.createNode(config))
  return true
}

/**
 * Load the patch file, apply `mutate`, and persist only when it reports a
 * change. Returns whether a write happened (i.e. whether dsh will hot-reload).
 *
 * `mutate` must be pure apart from its edits to `doc`: it may be the only
 * chance to change the file, and a thrown error leaves the file untouched.
 */
export async function mutatePatch(
  file: string,
  mutate: (doc: YAML.Document.Parsed) => boolean,
): Promise<boolean> {
  const original = await readFile(file, 'utf8')
  const doc = YAML.parseDocument(original)
  if (!mutate(doc)) return false

  const next = doc.toString()
  const backup = `${file}.bak`
  const tmp = `${file}.tmp-${randomUUID()}`
  await copyFile(file, backup)
  try {
    await writeFile(tmp, next, 'utf8')
    // Verify before it becomes the live file: a document that no longer parses
    // would take the whole profile down on the next reload.
    const check = YAML.parseDocument(await readFile(tmp, 'utf8'))
    if (check.errors.length > 0) {
      throw new Error(`rewritten patch file does not parse: ${check.errors[0]?.message ?? 'unknown error'}`)
    }
    await rename(tmp, file)
    return true
  } catch (error) {
    await unlink(tmp).catch(() => {})
    await copyFile(backup, file).catch(() => {})
    throw error
  }
}
