import type { ImageRow, PatchRow } from '../core/images'
import type { PatchWorkView } from '../core/imagePatches'
import type { Chosen } from '../core/lockRead'
import { movementTitle } from './motionText'
import { IMAGE_STATUS_LABEL } from './imagesText'

/** The jobs of an image's page, one tab each. */
export type ImageJob = 'make' | 'fine-tune' | 'patches' | 'areas' | 'movement'

/** One tab of an image's page: its job, its name, its chip and whether work is running in it. */
export interface JobTab {
  job: ImageJob
  title: string
  chip: { text: string; tone: 'ok' | 'warn' | 'accent' } | null
  making: boolean
}

/** What the tabs say, read from the row and the image's running work. */
export interface JobTabsInput {
  row: ImageRow
  makingTakes: boolean
  newFineTunes: number
  makingFineTunes: boolean
  makingPatches: boolean
  /**
   * What is chosen for this image: the whole answer of `imageChosen` (the list row and the
   * image's own views), not the row's alone.
   */
  chosen: Chosen
  /** How many of the renderer's effects are in the game, once the renderer has loaded; absent: count what is saved. */
  effectsOn?: number
}

/** The tabs an image's page shows, in order; Make, Fine-tune and Movement are on every image; Patches and Named areas only when the game asks for them. */
export function imageJobTabs(input: JobTabsInput): JobTab[] {
  const { row, chosen } = input
  // The lock cannot be read: which take the game shows is not known, so Make and Patches say so.
  const notKnown = { text: IMAGE_STATUS_LABEL.unknown, tone: 'warn' } as const
  const tabs: JobTab[] = [
    {
      job: 'make',
      title: 'Make',
      chip: !chosen.known
        ? notKnown
        : chosen.take === null
          ? { text: 'No take chosen', tone: 'warn' }
          : { text: `Take ${chosen.take} chosen`, tone: 'ok' },
      making: input.makingTakes,
    },
    {
      job: 'fine-tune',
      title: 'Fine-tune',
      chip: input.newFineTunes > 0 ? { text: `${input.newFineTunes} new`, tone: 'accent' } : null,
      making: input.makingFineTunes,
    },
  ]
  if (row.patches.length > 0) {
    tabs.push({
      job: 'patches',
      title: 'Patches',
      chip: !chosen.known ? notKnown : patchesChip(chosen.take, row.patches),
      making: input.makingPatches,
    })
  }
  if (row.areas.length > 0) {
    const placed = row.areas.filter((a) => a.placed).length
    tabs.push({
      job: 'areas',
      title: 'Named areas',
      chip: {
        text: `${placed} of ${row.areas.length}`,
        tone: placed === row.areas.length ? 'ok' : 'warn',
      },
      making: false,
    })
  }
  tabs.push({
    job: 'movement',
    title: movementTitle(
      input.effectsOn ?? Object.values(row.effects).filter((effect) => effect.on).length,
    ),
    chip: null,
    making: false,
  })
  return tabs
}

/** How many of the patches are chosen on the take the game shows, as the Patches tab's chip. */
function patchesChip(take: number | null, patches: PatchRow[]): JobTab['chip'] {
  const done = patches.filter((p) => patchChosen(take, p)).length
  return { text: `${done} of ${patches.length}`, tone: done === patches.length ? 'ok' : 'warn' }
}

/** The job a number key opens among the tabs shown (1 is the first tab); null for any other key. */
export function jobAtKey(tabs: JobTab[], key: string): ImageJob | null {
  return /^[1-9]$/.test(key) ? (tabs[Number(key) - 1]?.job ?? null) : null
}

/** Whether the patch is chosen on the image's chosen take, the take the game shows. */
export function patchChosen(take: number | null, patch: PatchRow): boolean {
  return take !== null && patch.chosenOn.includes(take)
}

/**
 * The heading over the patches: how many are chosen of those the game asks for, or, while the
 * images lock cannot be read, only how many the game asks for.
 */
export function patchesHeading(patches: readonly PatchRow[], chosen: Chosen): string {
  if (!chosen.known) return `Patches · ${patches.length}`
  const done = patches.filter((p) => patchChosen(chosen.take, p)).length
  return `Patches · ${done} of ${patches.length} chosen`
}

/** How the Patches tab lays out: a list beside a portrait image, chips above any other. */
export function patchLayoutOf(size: { width: number; height: number }): 'list' | 'chips' {
  return size.height > size.width ? 'list' : 'chips'
}

/** What a patch says of how far it has come: its chosen take, or how many takes there are. */
export function patchStateText({ takes, chosen }: Pick<PatchWorkView, 'takes' | 'chosen'>): string {
  if (chosen.known && chosen.take !== null) return `Take ${chosen.take} chosen`
  if (takes.length === 0) return 'no takes yet'
  return `${takes.length} ${takes.length === 1 ? 'take' : 'takes'}`
}
