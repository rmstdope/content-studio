/**
 * What the cost check of a step that may spend answers when the step would not be refused (a
 * `<route>/cost` route, §9): the paid model's price a minute, null when it is free; or, when the
 * step would change nothing, what it would answer. A refusal is answered as the step answers it.
 */
export type SpendCheck = { ok: true; price: string | null } | { ok: true; unchanged: object }
