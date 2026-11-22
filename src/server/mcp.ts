import type { RouteContext } from './context'
import { allowedHosts, forbidden } from './shared'
import { READABLE, matchReadable, type ReadablePage } from './mcpReadable'

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
      "Lists what can be read of the studio, by the page of the web UI that shows it: each path's route, whether it answers state (JSON) or a file (an image or a sound), and what it shows.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'studio_read',
    description:
      'Reads the state a page of the web UI shows, as JSON: a `state` path from studio_pages. Changes nothing.',
    inputSchema: pathArgument,
  },
  {
    name: 'studio_fetch',
    description:
      'Fetches an image or a sound the web UI can show or play, so it can be looked at or listened to: a `file` path from studio_pages. Changes nothing.',
    inputSchema: pathArgument,
  },
]

/**
 * The studio's MCP endpoint (§9): stateless Streamable HTTP, JSON-RPC over POST, with tools that
 * only read. They reach the studio's own GET routes over the loopback, so an agent sees exactly
 * what the web UI gets, through the same checks.
 */
export function mcpRoutes(c: RouteContext) {
  const { guard, listening } = c

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
    return {
      content: [
        { type: 'text', text: `${path}: ${mimeType}, ${bytes.byteLength} bytes` },
        { type, data: Buffer.from(bytes).toString('base64'), mimeType },
      ],
    }
  }

  async function callTool(name: unknown, args: unknown): Promise<ToolResult> {
    const path = (args as { path?: unknown } | null)?.path
    if (name === 'studio_pages') {
      const pages: Partial<Record<ReadablePage, unknown[]>> = {}
      for (const { page, ...rest } of READABLE) (pages[page] ??= []).push(rest)
      return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] }
    }
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
    '/mcp': {
      // An MCP client is no browser and sends no Origin; the tools only read. A browser page
      // (any Origin that is not the studio's own) is refused, like a change from another site.
      POST: guard(async (request: Request) => {
        const origin = request.headers.get('origin')
        if (origin && !allowedHosts(listening.port!).some((host) => origin === `http://${host}`)) {
          return forbidden('requests from other pages are not accepted')
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
