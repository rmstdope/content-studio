import type { SpotView } from '../core/motion'

/** The words of an image's Movement tab, in one place. */
export const MOVEMENT_WORDS = {
  tab: 'Movement',
  beside: "drawn by the project's renderer",
  pause: '❚❚ Pause',
  play: '▶ Play',
  fullScreen: '⛶ Full screen',
  gameOwn: "The game's own image, as the game will show it.",
  patches: 'Patches',
  effects: 'Effects',
  loading: 'Loading the motion renderer…',
  effectsLoading: 'Loading…',
  failed: 'The motion renderer could not be loaded.',
  tryAgain: 'Try again',
  failedCaption:
    'The still picture shows underneath. Fix the renderer in the game, then press Try again.',
  effectsFailed: 'None: the renderer did not load.',
  noEffects: "The project's renderer has no effects yet. The slow zoom and the patches still move.",
  noTake: 'No take chosen yet',
  lockHeading: 'The images lock could not be read',
  effectsLockNone:
    'None are saved for the game. Effects can be put in once the images lock can be read.',
  chooseOnMake: 'Choose a take on Make to see it move.',
  goToMake: 'Go to Make',
  notNamed:
    "This project names no motion renderer, so the studio can't show its images moving. The game names one in its project file.",
  reduced:
    'This computer asks for reduced motion. The preview moves anyway; players who ask for it see the picture still.',
  hide: 'Hide',
  show: 'Show',
  close: '✕ Close',
} as const

/** The caption under the picture of the chosen take. */
export function takeCaption(take: number, paused = false): string {
  const keys = paused ? 'Paused · Space plays' : 'Space pauses'
  return `Take ${take}, as the game will show it. ${keys} · F for full screen.`
}

/** A patch the game lists that has no chosen take to lay over the picture. */
export function patchNoTake(title: string): string {
  return `${title} · no take chosen`
}

/** A patch of the game's list while the images lock cannot be read: which of its takes is chosen is not known. */
export function patchNotKnown(title: string): string {
  return `${title} · not known`
}

/** Why a patch's switch is off while the images lock cannot be read. */
export const PATCH_NOT_KNOWN_WHY =
  'Which patch take is chosen is not known until the images lock can be read.'

/** How long a save may take before "Saving…" shows, and how long "Saved" stays, in milliseconds. */
export const SAVING_AFTER_MS = 400
export const SAVED_FOR_MS = 2000

/** The line under the Effects label: how many of the renderer's effects are in the game. */
export function effectsLine(on: number, total: number): string {
  const how = on === 0 ? 'None are on.' : `${on} of the renderer's ${total} are on.`
  return `Switch an effect on to put it in the game. ${how}`
}

/** The Movement tab's title: with the number of effects in the game, when there are any. */
export function movementTitle(on: number): string {
  return on === 0 ? 'Movement' : `Movement · ${on} ${on === 1 ? 'effect' : 'effects'}`
}

/** What the Effects group says when the renderer has not loaded but effects are saved for the game. */
export function savedForGame(types: string[]): string {
  return `Saved for the game: ${types.join(', ')}. They can be changed once the renderer loads.`
}

/** What the Effects group says of the effects saved for the game while the images lock cannot be read. */
export function savedForGameLockUnread(types: string[]): string {
  return `Saved for the game: ${types.join(', ')}. They can be changed once the images lock can be read.`
}

/** The words of saving the effects and of an effect the renderer no longer has. */
export const EFFECT_WORDS = {
  reset: 'Reset',
  saved: 'Saved',
  saving: 'Saving…',
  saveFailed:
    "Couldn't save the effects: the image edits file can't be written. Your last change is still on the picture.",
  remove: 'Remove',
  gone: "The project's renderer no longer has this effect, so the game won't show it. Its settings are kept until you remove it.",
} as const

/** The words of the Slow zoom group. */
export const ZOOM_WORDS = {
  heading: 'Slow zoom',
  switch: 'Zoom in and out',
  seconds: 'Each way',
  percent: 'How far',
  reset: 'Reset',
  saved: 'Saved',
  saving: 'Saving…',
  saveFailed:
    "Couldn't save the slow zoom: the image edits file can't be written. Your last change is still on the picture.",
} as const

/** The line under the group while the zoom is switched off, with the values kept for when it is back on. */
export function zoomOffLine(seconds: string, percent: string): string {
  return `Off: the picture stands still in the game. ${seconds} each way · ${percent} kept for when it's back on.`
}

/** The read-only line while the images record cannot be read: what is saved for the game ("24 s each way, 5%", or "no zoom" when switched off). */
export function zoomSavedLockUnread(saved: string): string {
  return `Saved for the game: ${saved}. It can be changed once the images record can be read.`
}

/** The words of an effect's spot: its line on the row, the drawing bars and what goes wrong. */
export const SPOT_WORDS = {
  draw: 'Draw your own',
  change: 'Change',
  back: "Back to the game's",
  removeIt: 'Remove it',
  undo: 'Undo',
  removed: ' · Your shape was removed.',
  keptNotUsed: '. A shape drawn earlier is kept but not used.',
  addShape: '＋ Add a shape',
  deleteShape: 'Delete this shape',
  lightFromMiddle: 'Light from the middle',
  alreadyMiddle: 'The light already comes from the middle of the shapes.',
  finish: 'Finish',
  stopShape: 'Stop this shape',
  keep: 'Keep it',
  delete: 'Delete',
  leftOut: "The shape you hadn't closed was left out.",
  noPicture: 'Choose a take on Make to draw a spot.',
  saveFailed:
    "Couldn't save the spot: the image edits file can't be written. Your shape is still on the picture.",
} as const

/** The spot line of an effect's row: whose shape it plays in, and whether it is being drawn or kept off. */
export function spotLine(view: SpotView, state: 'plain' | 'drawing' | 'off' = 'plain'): string {
  const tail = state === 'drawing' ? ' · drawing now' : state === 'off' ? ' (kept while off)' : ''
  if (view.who === 'own') {
    const what = `${view.count} ${view.count === 1 ? 'shape' : 'shapes'}`
    return `Spot: your own, ${what}${view.marked ? ', light from a marked point' : ''}${tail}`
  }
  if (view.who === 'fixed') {
    return `Spot: the game's — this effect can't be moved in the studio${tail}`
  }
  const what =
    view.shape === 'whole'
      ? ' — the whole picture'
      : view.shape === 'unknown'
        ? " — the game doesn't say where"
        : ''
  return `Spot: the game's${what}${tail}`
}

/**
 * What the bar above the picture says while a spot is being drawn: its bold lead and the rest;
 * `fromGame` while the shape is still the game's copy, `empty` when the game doesn't say where;
 * `esc: false` (full screen) leaves out the sentence about Esc.
 */
export function drawingBar(
  name: string,
  mode: 'own' | 'fromGame' | 'empty' = 'own',
  { esc = true }: { esc?: boolean } = {},
): { lead: string; rest: string } {
  const lead = `Drawing your own spot for ${name}.`
  if (mode === 'fromGame') {
    return {
      lead,
      rest: " It starts as the game's: drag a corner to move it, double-click a corner to take it out, click the picture to add a shape.",
    }
  }
  if (mode === 'empty') {
    return {
      lead,
      rest: placeWords(esc),
    }
  }
  return {
    lead,
    rest: ' Drag a corner to move it; double-click a corner to take it out. Click a shape to pick it. Drag the ● to where the light comes from, or press Alt and the arrows.',
  }
}

/** What the bar says while the corners of a new shape are being placed. */
export function newShapeBar(
  name: string,
  { esc = true }: { esc?: boolean } = {},
): { lead: string; rest: string } {
  return { lead: `New shape for ${name}.`, rest: placeWords(esc) }
}

/** The words for placing corners; full screen has no Esc to stop a shape (its button does it). */
function placeWords(esc: boolean): string {
  return ` Click to place each corner; click the first corner to close the shape.${esc ? ' Esc stops this shape.' : ''}`
}

/** The folded panel's words while a spot is drawn in full screen. */
export function foldedDrawing(name: string): string {
  return `Drawing ${name}`
}

/** The folded panel's words while the corners of a new shape are placed in full screen. */
export function foldedPlacing(name: string): string {
  return `New shape for ${name}`
}

/** What the bar asks before a shape is deleted. */
export function deleteAsk(corners: number): { lead: string; rest: string } {
  return { lead: 'Delete this shape?', rest: ` It has ${corners} corners.` }
}

/** The line under the other effects' spot links while one effect is being drawn. */
export function finishFirst(name: string): string {
  return `Finish the ${name} spot first.`
}

/** The words of tying an effect to a patch. */
export const TIE_WORDS = {
  shows: 'Shows',
  always: 'Always',
  lay: 'Lay it',
  takeOff: 'Take it off',
} as const

/** A menu choice: the effect shows while this patch is laid, or with `without` while it is not. */
export function tieChoice(title: string, gone = false, without = false): string {
  return `While ${title} is ${without ? 'not laid' : 'laid'}${gone ? ' · gone' : ''}`
}

/** The tag beside a tied effect's name. */
export function tieTag(title: string, without = false): string {
  return `${without ? 'without' : 'with'} ${title}`
}

/** Why an effect that shows while a patch is not laid is not on the picture: the patch is laid. */
export function laidLine(title: string): string {
  return `Not showing: ${title} is laid.`
}

/** What a "not laid" choice of a patch the game no longer lists means. */
export function patchGoneWithoutLine(title: string): string {
  return `The game no longer lists the patch ${title}. Choose Always or another patch.`
}

/** Why a tied effect is not on the picture: its patch is not laid. */
export function notLaidLine(title: string): string {
  return `Not showing: ${title} isn't laid.`
}

/** Why a tied effect is not on the picture: its patch has no take to lay. */
export function noTakeLine(title: string): string {
  return `Not showing: ${title} has no take chosen yet.`
}

/** What a tie to a patch the game no longer lists means. */
export function patchGoneLine(title: string): string {
  return `The game no longer lists the patch ${title}, so it won't show this effect. Choose Always or another patch.`
}
