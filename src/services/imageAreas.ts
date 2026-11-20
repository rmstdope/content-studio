import { dirname } from 'node:path'
import {
  areaFractions,
  effectsForGame,
  withAreas,
  withEffects,
  withZoom,
  zoomForGame,
} from '../core/images'
import { ImageManifestSchema } from '../core/imageTakes'
import type { Problem, Project } from '../core/project'
import { readResource, writeAtomic, writeFailure } from './files'
import { readImages } from './imageLists'
import { patchesInGame, type ManifestPatch } from './imagePatchGame'
import { choices, sorted } from './musicClips'

/** What passing the placed areas to the game answered: done, or why the manifest could not take them. */
export type AreaSyncResult =
  { ok: true } | { ok: false; reason: 'read' | 'write' | 'entry'; message: string }

/**
 * Brings the `areas` and `effects` of the images manifest entries of `ids` up to date with the
 * studio's edits (the effects are those saved as on, as the game's renderer is asked for them; the slow zoom is `zoom`: the saved numbers, null when off, no key when none is saved). The areas are the boxes placed in
 * the edits: only the areas the game currently asks for, as fractions of the picture, the
 * key gone when none are placed. An image with no entry is left alone (`requireEntry` makes that a
 * failure) and one the lists disagree on is no row, so it keeps what the game has. The manifest is
 * written only when something changed. It takes its turn with the choosing of takes, which write
 * the same manifest.
 */
export function syncImageEntries(
  projectFile: string,
  project: Project,
  ids: readonly string[],
  options: { requireEntry?: boolean } = {},
): Promise<AreaSyncResult> {
  // The turn of choosing a take, which reads and writes the same manifest: never both at once.
  return choices().run(`image-choice\0${projectFile}`, () =>
    syncNow(dirname(projectFile), project, ids, options),
  )
}

async function syncNow(
  root: string,
  project: Project,
  ids: readonly string[],
  { requireEntry = false }: { requireEntry?: boolean },
): Promise<AreaSyncResult> {
  const config = project.images
  if (!config) return { ok: true }
  const problems: Problem[] = []
  const read = await readResource(root, config.manifest, ImageManifestSchema, problems)
  if (read === 'invalid') {
    return { ok: false, reason: 'read', message: 'the images manifest could not be read' }
  }
  const manifest = read === 'missing' ? {} : read
  const summary = await readImages(root, project, [])
  const rows = summary?.acts.flatMap((act) => act.rows) ?? []
  let changed = false
  for (const id of ids) {
    const row = rows.find((r) => r.id === id)
    if (!row) continue
    const entry = manifest[id]
    if (!entry) {
      if (requireEntry) {
        return {
          ok: false,
          reason: 'entry',
          message: 'the image has no entry in the images manifest',
        }
      }
      continue
    }
    const next = withZoom(
      withEffects(
        withAreas(await withPatches(root, config.clips, entry, row), areaFractions(row.areas, row)),
        effectsForGame(row.effects),
      ),
      zoomForGame(row.zoom),
    )
    if (JSON.stringify(next) !== JSON.stringify(entry)) {
      manifest[id] = next
      changed = true
    }
  }
  if (!changed) return { ok: true }
  try {
    await writeAtomic(root, config.manifest, `${JSON.stringify(sorted(manifest), null, 2)}\n`)
  } catch (error) {
    return { ok: false, reason: 'write', message: writeFailure(error) }
  }
  return { ok: true }
}

/**
 * The entry with the patches the game gets with the image's chosen take as the game's list asks
 * for them now (as-evwv): a patch whose chosen take no longer lies on what is underneath leaves,
 * and comes back when the ask goes. Patches the game stopped listing stay, as on choosing a take;
 * an image with no chosen take, or no patches listed, keeps its entry as it is.
 */
async function withPatches<E extends Record<string, unknown>>(
  root: string,
  clips: string,
  entry: E,
  row: Parameters<typeof patchesInGame>[0]['row'] & { chosenTake: number | null },
): Promise<E> {
  if (row.chosenTake === null || row.patches.length === 0) return entry
  const patches = await patchesInGame({ root, clips, row }, row.chosenTake)
  const declared = new Set(row.patches.map((patch) => patch.id))
  for (const [id, listed] of Object.entries(
    (entry.patches ?? {}) as Record<string, ManifestPatch>,
  )) {
    if (!declared.has(id)) patches[id] = listed
  }
  const { patches: _old, ...others } = entry
  return (Object.keys(patches).length ? { ...others, patches } : others) as E
}
