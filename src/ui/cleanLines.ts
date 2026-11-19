/** "line" or "lines" for a count. */
const lines = (n: number) => (n === 1 ? 'line' : 'lines')

/** How many of a voice's lines in the game are not cleaned. */
export function notCleaned({ total, cleaned }: { total: number; cleaned: number }): number {
  return total - cleaned
}

/** The count line while some lines are not cleaned: its sentence and its button. */
export function countText(n: number, total: number): { sentence: string; button: string } {
  const only = n === 1 && total === 1
  const none = n === total && total > 1
  return {
    sentence: only
      ? 'The 1 line in the game isn’t cleaned yet.'
      : none
        ? `None of the ${total} lines in the game is cleaned yet.`
        : `${n} of ${total} ${lines(total)} in the game ${n === 1 ? 'isn’t' : 'aren’t'} cleaned yet.`,
    button: `Clean ${n} ${lines(n)}…`,
  }
}

/** The count line when every line is cleaned. */
export function allCleanedText(total: number): string {
  if (total === 1) return `The 1 line in the game is cleaned.`
  return `All ${total} lines in the game are cleaned.`
}

/** The heading of the question before cleaning. */
export function askCleanTitle(n: number): string {
  return `Clean ${n} ${lines(n)} already in the game?`
}

/** The heading of the question before switching off. */
export function askPutBackTitle(n: number): string {
  return `Put back ${n} ${lines(n)} as recorded?`
}

/** The progress line while cleaning. */
export function cleaningText(done: number, total: number): string {
  return `Cleaning lines in the game… ${done} of ${total}`
}

/** The progress line while putting back. */
export function puttingBackText(done: number, total: number): string {
  return `Putting back lines as recorded… ${done} of ${total}`
}

/** Under the count line after some lines could not be cleaned: how many, and the first reason as given. */
export function couldntCleanText(failed: number, reason: string): string {
  return `${failed} ${lines(failed)} couldn’t be cleaned: ${reason}`
}

/** Under the "still cleaned" line after some lines could not be put back. */
export function couldntPutBackText(failed: number, reason: string): string {
  return `${failed} ${lines(failed)} couldn’t be put back: ${reason}`
}

/** What is said, and the button, when the switch is off and lines in the game are still cleaned. */
export function stillCleanedText(n: number): { sentence: string; button: string } {
  return {
    sentence: `${n} ${lines(n)} in the game ${n === 1 ? 'is' : 'are'} still cleaned.`,
    button: 'Put them back',
  }
}

/** The confirming button of the question before cleaning. */
export function cleanButtonText(n: number): string {
  return `Clean ${n} ${lines(n)}`
}
