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

/** What the Effects group says of the effects the renderer has. */
export function effectsCount(count: number, tryThem: boolean): string {
  return tryThem
    ? `The project's renderer has ${count}. Try them here; nothing is saved yet.`
    : `The project's renderer has ${count}.`
}
