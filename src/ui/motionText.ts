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
export function takeCaption(take: number): string {
  return `Take ${take}, as the game will show it. Space pauses · F for full screen.`
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

/** The words of an effect's spot: its line on the row, the drawing bars and what goes wrong. */
export const SPOT_WORDS = {
  draw: 'Draw a spot',
  change: 'Change',
  clear: 'Clear',
  addShape: '＋ Add a shape',
  deleteShape: 'Delete this shape',
  finish: 'Finish',
  keep: 'Keep it',
  delete: 'Delete',
  leftOut: "The shape you hadn't closed was left out.",
  noPicture: 'Choose a take on Make to draw a spot.',
  saveFailed:
    "Couldn't save the spot: the image edits file can't be written. Your shape is still on the picture.",
} as const

/** The spot line of an effect's row: the whole picture, or how many shapes, and whether it is being drawn or kept off. */
export function spotLine(shapes: number, state: 'plain' | 'drawing' | 'off' = 'plain'): string {
  const what = shapes === 0 ? 'the whole picture' : `${shapes} ${shapes === 1 ? 'shape' : 'shapes'}`
  const tail = state === 'drawing' ? ' · drawing now' : state === 'off' ? ' (kept while off)' : ''
  return `Spot: ${what}${tail}`
}

/** What the bar above the picture says while a spot is being drawn: its bold lead and the rest. */
export function drawingBar(name: string): { lead: string; rest: string } {
  return {
    lead: `Drawing the spot for ${name}.`,
    rest: ' Drag a corner to move it; double-click a corner to take it out. Click a shape to pick it.',
  }
}

/** What the bar says while the corners of a new shape are being placed. */
export function newShapeBar(name: string): { lead: string; rest: string } {
  return {
    lead: `New shape for ${name}.`,
    rest: ' Click to place each corner; click the first corner to close the shape. Esc stops this shape.',
  }
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
} as const

/** A menu choice: the effect shows while this patch is laid. */
export function tieChoice(title: string, gone = false): string {
  return `While ${title} is laid${gone ? ' · gone' : ''}`
}

/** The tag beside a tied effect's name. */
export function tieTag(title: string): string {
  return `with ${title}`
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
