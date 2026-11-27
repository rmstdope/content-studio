import type { RouteContext } from './context'
import { allowedHosts, forbidden, WITHOUT_HEADER } from './shared'
import { readSpendCheck } from '../core/spendCheck'
import { ACTIONS, actionBody, matchAction, type ActionPage } from './mcpActions'
import { READABLE, matchReadable, type ReadablePage } from './mcpReadable'
import { describeSound, soundFacts, whisperLanguage, type WhisperAsk } from '../services/soundFacts'
import { openProject } from '../services/workspace'

/**
 * The line an agent reads for what a fetched scene mix leaves out, from the header the mix route
 * sets (a URI-encoded JSON list of the Scenes page's phrases); null when nothing, or nothing legible.
 */
function leftOut(header: string | null): string | null {
  if (!header) return null
  try {
    const list: unknown = JSON.parse(decodeURIComponent(header))
    const phrases = Array.isArray(list) ? list.filter((p) => typeof p === 'string') : []
    return phrases.length > 0 ? `Left out of this mix: ${phrases.join('; ')}.` : null
  } catch {
    return null
  }
}

/** The largest file `studio_fetch` hands over, in bytes. */
const MAX_FILE = 64 * 1024 * 1024

/** The MCP protocol versions the studio speaks; the newest is offered to a client that asks for another. */
const VERSIONS = ['2025-06-18', '2025-03-26']

/** What a tool call answers: MCP content blocks, and whether the call failed. */
interface ToolResult {
  content: (
    { type: 'text'; text: string } | { type: 'image' | 'audio'; data: string; mimeType: string }
  )[]
  isError?: true
}

const failed = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

const pathArgument = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'A path from studio_pages, with its :names filled in, and an optional query.',
    },
  },
  required: ['path'],
  additionalProperties: false,
}

/** The tools an agent is offered. */
const TOOLS = [
  {
    name: 'studio_pages',
    description:
      "Lists what can be read of the studio, by the page of the web UI that shows it (each path's route, whether it answers state (JSON) or a file (an image or a sound), and what it shows), and under `actions` the steps studio_act can do, with the ones that need the user's confirmation.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'studio_read',
    description:
      'Reads the state a page of the web UI shows, as JSON: a `state` path from studio_pages. Changes nothing.',
    inputSchema: pathArgument,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'studio_fetch',
    description:
      'Fetches an image or a sound the web UI can show or play, so it can be looked at or listened to: a `file` path from studio_pages. Changes nothing.',
    inputSchema: pathArgument,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'studio_act',
    description:
      'Does a step of a page of the web UI (Setup, Narration, Images, Music and Stingers, Sound effects and Scenes so far), through the same route the page uses, so every check holds: the body is the one the page sends (a spending step carries the amount confirmed, as its body says: confirmedCost / confirmedCredits from its plan, or spendUpTo / creditsUpTo). A step marked `confirm` in studio_pages needs `confirmed: true`, set only once the user has agreed to what it says.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['POST', 'PUT', 'PATCH', 'DELETE'] },
        path: {
          type: 'string',
          description:
            'A path from the actions of studio_pages, with its :names filled in, and an optional query.',
        },
        body: {
          type: 'object',
          description: 'The JSON body, the one the page sends; for a form, its text fields.',
        },
        files: {
          type: 'array',
          description:
            'Recordings for a form body (clone-voice): the field, name, type and base64 bytes of each.',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string' },
              base64: { type: 'string' },
            },
            required: ['field', 'name', 'base64'],
          },
        },
        confirmed: { type: 'boolean' },
      },
      required: ['method', 'path'],
      additionalProperties: false,
    },
    annotations: { destructiveHint: true },
  },
]

/**
 * The studio's MCP endpoint (§9): stateless Streamable HTTP, JSON-RPC over POST. Its tools reach
 * the studio's own routes over the loopback, so an agent sees and does exactly what the web UI
 * does, through the same checks: reads on the GET routes, changes only the registered ones.
 */
export function mcpRoutes(c: RouteContext) {
  const { guard, listening, agentChanges } = c

  const own = () => `http://127.0.0.1:${listening.port}`

  async function read(path: unknown, kind: 'state' | 'file'): Promise<ToolResult> {
    const entry = typeof path === 'string' ? matchReadable(path) : null
    if (typeof path !== 'string' || !entry) {
      return failed(`Not something to read: ${String(path)}. studio_pages lists what is.`)
    }
    if (entry.kind !== kind) {
      return failed(
        `${path} is ${entry.kind === 'file' ? 'a file: use studio_fetch' : 'state: use studio_read'}.`,
      )
    }
    const response = await fetch(`${own()}${path}`, {
      headers: { host: `127.0.0.1:${listening.port}` },
    })
    if (!response.ok) return failed(`${response.status} ${await response.text()}`)
    if (kind === 'state') return { content: [{ type: 'text', text: await response.text() }] }
    const mimeType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim()
    const type = mimeType.startsWith('image/')
      ? 'image'
      : mimeType.startsWith('audio/')
        ? 'audio'
        : null
    if (!type) return failed(`${path} is not an image or a sound (${mimeType || 'unknown type'}).`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_FILE)
      return failed(`${path} is too large to hand over (${bytes.byteLength} bytes).`)
    const facts: ToolResult['content'] = []
    if (type === 'audio') {
      facts.push({ type: 'text', text: await soundText(bytes, entry.page, path) })
    }
    const left = leftOut(response.headers.get(WITHOUT_HEADER))
    if (left) facts.push({ type: 'text', text: left })
    return {
      content: [
        { type: 'text', text: `${path}: ${mimeType}, ${bytes.byteLength} bytes` },
        ...facts,
        { type, data: Buffer.from(bytes).toString('base64'), mimeType },
      ],
    }
  }

  /**
   * What an agent that cannot hear a sound reads instead: its length and loudness, and on the
   * Narration page's sounds (lines and auditions) the words Whisper heard, in the `?language=`
   * asked. A sound that cannot be measured is said so; the fetch still hands the file over.
   */
  async function soundText(bytes: Uint8Array, page: ReadablePage, path: string): Promise<string> {
    try {
      let whisper: WhisperAsk | undefined
      if (page === 'Narration') {
        const opened = await openProject(c.projectFile)
        if (!opened.ok) {
          whisper = { off: 'Whisper did not listen: the project file could not be read.' }
        } else if (opened.project.narration.generate.transcriber === 'none') {
          whisper = { off: 'Whisper is off (generate.transcriber is "none").' }
        } else {
          const transcriber = await c.transcriberFor()
          // Told the language only in a project with several, as the studio's own check is: the
          // one asked for if the project has it, else its source language.
          const language = whisperLanguage(
            opened.project.languages,
            new URL(path, 'http://studio').searchParams.get('language'),
          )
          whisper = transcriber
            ? {
                transcriber,
                model: opened.project.narration.generate.whisperModel,
                ...(language ? { language } : {}),
              }
            : { off: 'Whisper did not listen: no transcriber is running.' }
        }
      }
      return describeSound(await soundFacts(bytes, { whisper }))
    } catch (error) {
      return `Could not measure it: ${error instanceof Error ? error.message : String(error)}.`
    }
  }

  /**
   * What the route of a spending step says a call would cost (`<path>/cost`): the answer to give
   * instead of calling the step (its refusal, or what it would answer when it would change
   * nothing), or else what to confirm, if anything. An answer that cannot be told is asked about,
   * never let through, and a step with no cost route is refused there.
   */
  async function spendCheck(
    path: string,
    init: RequestInit,
  ): Promise<{ answer: ToolResult } | { spend: string | null }> {
    const url = new URL(path, own())
    url.pathname += '/cost'
    const response = await fetch(url, init)
    const text = await response.text()
    if (!response.ok) return { answer: failed(`${response.status} ${text}`) }
    const check = readSpendCheck(text)
    if (check && 'unchanged' in check) {
      return { answer: { content: [{ type: 'text', text: JSON.stringify(check.unchanged) }] } }
    }
    if (check && check.price === null) return { spend: null }
    const price = check?.price ?? 'the price could not be found'
    return { spend: `might spend ElevenLabs credit (${price})` }
  }

  async function act(args: Record<string, unknown>): Promise<ToolResult> {
    const { method, path, body, files, confirmed } = args
    const action =
      typeof method === 'string' && typeof path === 'string' ? matchAction(method, path) : null
    if (!action) {
      return failed(
        `Not something to do: ${String(method)} ${String(path)}. studio_pages lists what is.`,
      )
    }
    // However the path was written, it must reach the route it matched: the URL is not rewritten.
    if (new URL(String(path), own()).pathname !== String(path).split('?')[0]) {
      return failed(`Not something to do: ${String(path)}.`)
    }
    const headers: Record<string, string> = {
      host: `127.0.0.1:${listening.port}`,
      origin: own(),
    }
    let payload: string | FormData | undefined
    if (Array.isArray(files) && files.length) {
      const form = new FormData()
      for (const [name, value] of Object.entries((body ?? {}) as Record<string, unknown>)) {
        if (typeof value !== 'string') return failed(`The form field ${name} must be text.`)
        form.append(name, value)
      }
      for (const f of files) {
        const { field, name, type, base64 } = (f ?? {}) as Record<string, unknown>
        if (typeof field !== 'string' || typeof name !== 'string' || typeof base64 !== 'string') {
          return failed('Each of files needs a field, a name and base64 bytes.')
        }
        form.append(
          field,
          new File([Buffer.from(base64, 'base64')], name, {
            type: typeof type === 'string' ? type : '',
          }),
        )
      }
      payload = form
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const init = { method: action.method, headers, body: payload }
    let confirm = action.confirm
    // A confirmed step goes straight to its route, which refuses by itself.
    if (action.spends && confirmed !== true) {
      const check = await spendCheck(String(path), init)
      if ('answer' in check) return check.answer
      if (check.spend) confirm = confirm ? `${confirm}; ${check.spend}` : check.spend
    }
    if (confirm && confirmed !== true) {
      return failed(
        `Needs the user's confirmation first: this ${confirm}. Once the user has agreed, call again with confirmed: true.`,
      )
    }
    const response = await fetch(`${own()}${path}`, init)
    const answer = await response.text()
    if (!response.ok) return failed(`${response.status} ${answer}`)
    agentChanges.count++
    return { content: [{ type: 'text', text: answer || 'Done.' }] }
  }

  async function callTool(name: unknown, args: unknown): Promise<ToolResult> {
    const path = (args as { path?: unknown } | null)?.path
    if (name === 'studio_pages') {
      const read: Partial<Record<ReadablePage, unknown[]>> = {}
      for (const { page, ...rest } of READABLE) (read[page] ??= []).push(rest)
      const actions: Partial<Record<ActionPage, unknown[]>> = {}
      for (const action of ACTIONS) {
        const { page, ...rest } = action
        ;(actions[page] ??= []).push({ ...rest, body: actionBody(action) })
      }
      return { content: [{ type: 'text', text: JSON.stringify({ read, actions }, null, 2) }] }
    }
    if (name === 'studio_act') return act((args ?? {}) as Record<string, unknown>)
    if (name === 'studio_read') return read(path, 'state')
    if (name === 'studio_fetch') return read(path, 'file')
    return failed(`No tool called ${String(name)}.`)
  }

  const reply = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result })
  const refusal = (id: unknown, code: number, message: string) => ({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  })

  /** The answer to one message; null for a notification, which has none. */
  async function handle(message: unknown): Promise<object | null> {
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      return refusal(null, -32600, 'expected a JSON-RPC message')
    }
    const { id, method, params } = message as { id?: unknown; method?: unknown; params?: unknown }
    // A notification, or a client's answer to a request (it has no method): nothing to reply.
    if (id === undefined || method === undefined) return null
    const given = params as {
      name?: unknown
      arguments?: unknown
      protocolVersion?: unknown
    } | null
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: VERSIONS.find((v) => v === given?.protocolVersion) ?? VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'content-studio', version: '0.1.0' },
        })
      case 'ping':
        return reply(id, {})
      case 'tools/list':
        return reply(id, { tools: TOOLS })
      case 'tools/call':
        return reply(id, await callTool(given?.name, given?.arguments))
      default:
        return refusal(id, -32601, `no method ${String(method)}`)
    }
  }

  const notAllowed = () => new Response(null, { status: 405, headers: { allow: 'POST' } })

  return {
    // What open pages poll to read again after an agent's step: not a page's state, so not in READABLE.
    '/api/agent-changes': { GET: guard(() => Response.json({ count: agentChanges.count })) },
    '/mcp': {
      // An MCP client is no browser and sends no Origin, and a browser always sends one
      // on a cross-site POST: any Origin that is not the studio's own is refused, so no web page
      // can reach a change through it.
      POST: guard(async (request: Request) => {
        const origin = request.headers.get('origin')
        if (origin && !allowedHosts(listening.port!).some((host) => origin === `http://${host}`)) {
          return forbidden('requests from other pages are not accepted')
        }
        // A page of another site cannot send JSON without a preflight this server never answers.
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
          return Response.json(refusal(null, -32600, 'send application/json'), { status: 415 })
        }
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json(refusal(null, -32700, 'not JSON'), { status: 400 })
        }
        if (Array.isArray(body)) {
          if (!body.length)
            return Response.json(refusal(null, -32600, 'an empty batch'), { status: 400 })
          const answers = (await Promise.all(body.map(handle))).filter((a) => a !== null)
          return answers.length ? Response.json(answers) : new Response(null, { status: 202 })
        }
        const answer = await handle(body)
        return answer ? Response.json(answer) : new Response(null, { status: 202 })
      }),
      GET: guard(notAllowed),
      DELETE: guard(notAllowed),
    },
  }
}
