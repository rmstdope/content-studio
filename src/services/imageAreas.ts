import type { Chosen } from '../core/lockRead'
import { dirname } from 'node:path'
import {
  areaFractions,
  type ManifestPatch,
  effectsForGame,
  withAreas,
  withEffects,
  withZoom,
  zoomForGame,
} from '../core/images'
import { ImageManifestSchema } from '../core/imageTakes'
import type { Problem, Project } from '../core/project'
import { readResource, writeOrRefuse, refusalFailed } from './files'
import { readImages } from './imageLists'
import { patchesInGame, setAsideOn } from './imagePatchGame'
import { choices, sorted } from './musicClips'

/**
 * What passing the placed areas to the game answered: done, or why the game could not take them,
 * with the file that says so: the manifest, or a patch picture that could not be written.
 */
export type AreaSyncResult =
  { ok: true } | { ok: false; reason: 'read' | 'write' | 'entry'; file: string; message: string }

/** A refused write, as `refusalFailed` answers it, as what the sync answers. */
function notWritten({ file, message }: { file: string; message: string }): AreaSyncResult {
  return { ok: false, reason: 'write', file, message }
}

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
    return {
      ok: false,
      reason: 'read',
      file: config.manifest,
      message: 'the images manifest could not be read',
    }
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
          file: config.manifest,
          message: 'the image has no entry in the images manifest',
        }
      }
      continue
    }
    const patched = await withPatches(root, config.clips, entry, row).then(
      (entry) => ({ ok: true as const, entry }),
      refusalFailed('saving a patch picture failed'),
    )
    if (!patched.ok) return notWritten(patched)
    const next = withZoom(
      withEffects(
        withAreas(patched.entry, areaFractions(row.areas, row)),
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
  const refused = await writeOrRefuse(
    root,
    config.manifest,
    `${JSON.stringify(sorted(manifest), null, 2)}\n`,
  ).then(() => null, refusalFailed('saving the images manifest failed'))
  return refused ? notWritten(refused) : { ok: true }
}

/**
 * The entry with its patches brought up to date with the game's list (as-evwv): a patch whose
 * chosen take no longer lies on what is underneath leaves, and one that does again comes back
 * with its stored game version. A patch the studio has no board or picture for (the cache is not
 * on this computer) keeps what the manifest has, and so do patches the game stopped listing. An
 * image with no chosen take, or no patches listed, keeps its entry as it is.
 */
async function withPatches<E extends Record<string, unknown>>(
  root: string,
  clips: string,
  entry: E,
  row: Parameters<typeof patchesInGame>[0]['row'] & { chosen: Chosen },
): Promise<E> {
  // No take in the game, or not known: the entry keeps what it has.
  const take = row.chosen.known ? row.chosen.take : null
  if (take === null || row.patches.length === 0) return entry
  const patches = {
    ...((entry.patches ?? {}) as Record<string, ManifestPatch>),
  }
  for (const id of await setAsideOn({ root, row }, take)) delete patches[id]
  const inGame = await patchesInGame({ root, clips, row }, take)
  for (const [path, png] of inGame.pictures) await writeOrRefuse(root, path, png)
  Object.assign(patches, inGame.entries)
  const { patches: _old, ...others } = entry
  return (Object.keys(patches).length ? { ...others, patches } : others) as E
}
