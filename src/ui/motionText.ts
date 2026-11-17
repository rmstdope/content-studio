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
