import type { ZodType } from 'zod'
import type { RouteContext } from './context'
import { badBody, notFound, takeResponse, type RouteRequest } from './shared'

/** What a take service answers: nothing when the thing is not there, else a result that may refuse. */
type Answer = { ok?: boolean } | null | undefined

/**
 * The take actions every medium with takes offers under the same names, whatever its takes are
 * called (files or numbers): what goes by the track, effect or image id alone.
 */
export type TakeListService<Make> = {
  view(projectFile: string, id: string): Promise<object | null>
  make(projectFile: string, id: string, request: Make): Promise<Answer>
  unchoose(projectFile: string, id: string): Promise<Answer>
  accept(projectFile: string, id: string): Promise<Answer>
  stop(projectFile: string, id: string): Promise<object | null>
}

/**
 * The take actions a medium whose takes are files offers under the same names, so one set of
 * routes serves every such medium (sound effects and music's tracks).
 */
export type TakeService<Make, Fades> = TakeListService<Make> & {
  takeFile(projectFile: string, id: string, name: string): Promise<string | null>
  trimmedSound(projectFile: string, id: string, name: string): Promise<Uint8Array | null>
  drop(projectFile: string, id: string, name: string): Promise<Answer>
  setFades(projectFile: string, id: string, name: string, fades: Fades | null): Promise<Answer>
  choose(projectFile: string, id: string, name: string): Promise<Answer>
  trim(projectFile: string, id: string, name: string, undo: boolean): Promise<Answer>
  /** Saves a take's level; only a medium whose takes have one (sound effects) offers it. */
  setLevel?(projectFile: string, id: string, name: string, level: number): Promise<Answer>
}

/** One medium's take routes: where they live, its service, and the bodies it accepts. */
export type TakeRoutesMedium<Make, Fades> = {
  /** The address before `/:id`, such as `/api/effects`. */
  base: string
  service: TakeService<Make, Fades>
  bodies: {
    make: ZodType<Make>
    fades: ZodType<Fades>
    choose: ZodType<{ file: string }>
    trim: ZodType<{ file: string; undo?: boolean | undefined }>
    /** The body of a save of a take's level; with `service.setLevel`, adds the level route. */
    level?: ZodType<{ level: number }>
  }
}

/** The answer for a result that may refuse: 404 for nothing, 409 for a refusal, else 200. */
function resultResponse(result: Answer): Response {
  if (!result) return notFound()
  return Response.json(result, {
    status: result.ok === false || result.ok === undefined ? 409 : 200,
  })
}

/** The routes that go by id alone (list, make, un-choose, accept, stop), for any medium with takes. */
export function takeListRoutes<Make>(
  c: Pick<RouteContext, 'fromOwnPage' | 'guard' | 'projectFile'>,
  {
    base,
    service,
    bodies,
  }: { base: string; service: TakeListService<Make>; bodies: { make: ZodType<Make> } },
) {
  const { fromOwnPage, guard, projectFile } = c
  const json = async (request: Request) => request.json().catch(() => null)
  return {
    [`${base}/:id/takes`]: {
      GET: guard(async (request: RouteRequest) => {
        const view = await service.view(projectFile, request.params.id)
        return view ? Response.json(view) : notFound()
      }),
      POST: fromOwnPage(async (request: RouteRequest) => {
        const body = bodies.make.safeParse(await json(request))
        if (!body.success) return badBody(bodies.make, body.error)
        return resultResponse(await service.make(projectFile, request.params.id, body.data))
      }),
    },
    [`${base}/:id/unchoose`]: {
      POST: fromOwnPage(async (request: RouteRequest) =>
        resultResponse(await service.unchoose(projectFile, request.params.id)),
      ),
    },
    [`${base}/:id/accept`]: {
      POST: fromOwnPage(async (request: RouteRequest) =>
        resultResponse(await service.accept(projectFile, request.params.id)),
      ),
    },
    [`${base}/:id/stop`]: {
      POST: fromOwnPage(async (request: RouteRequest) => {
        const result = await service.stop(projectFile, request.params.id)
        return result ? Response.json(result) : notFound()
      }),
    },
  }
}

/** The route that saves a take's level, for a medium whose takes have one. */
function levelRoute(
  { fromOwnPage, projectFile }: Pick<RouteContext, 'fromOwnPage' | 'projectFile'>,
  base: string,
  save: NonNullable<TakeService<unknown, unknown>['setLevel']>,
  body: ZodType<{ level: number }>,
) {
  return {
    [`${base}/:id/takes/:file/level`]: {
      PUT: fromOwnPage(async (request: RouteRequest) => {
        const parsed = body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return badBody(body, parsed.error)
        return resultResponse(
          await save(projectFile, request.params.id, request.params.file, parsed.data.level),
        )
      }),
    },
  }
}

/**
 * The routes for takes (list, make, serve, drop, fades, choose, trim, un-choose, accept, stop) of a
 * medium whose takes are files, declared once and instantiated per medium. A new take action is one route here.
 */
export function takeRoutes<Make, Fades>(
  c: Pick<RouteContext, 'fromOwnPage' | 'guard' | 'projectFile'>,
  { base, service, bodies }: TakeRoutesMedium<Make, Fades>,
) {
  const { fromOwnPage, guard, projectFile } = c
  const json = async (request: Request) => request.json().catch(() => null)
  const fades = (request: RouteRequest, value: Fades | null) =>
    service.setFades(projectFile, request.params.id, request.params.file, value)
  return {
    ...takeListRoutes(c, { base, service, bodies }),
    [`${base}/:id/takes/:file`]: {
      GET: guard(async (request: RouteRequest) => {
        const file = await service.takeFile(projectFile, request.params.id, request.params.file)
        if (!file) return notFound()
        // `?trimmed=1`: only the part between a trimmed take's cuts (the whole sound if not trimmed).
        const part =
          new URL(request.url).searchParams.get('trimmed') === '1'
            ? await service.trimmedSound(projectFile, request.params.id, request.params.file)
            : null
        return takeResponse(request, file, part ?? undefined)
      }),
      DELETE: fromOwnPage(async (request: RouteRequest) =>
        resultResponse(await service.drop(projectFile, request.params.id, request.params.file)),
      ),
    },
    [`${base}/:id/takes/:file/fades`]: {
      PUT: fromOwnPage(async (request: RouteRequest) => {
        const body = bodies.fades.safeParse(await json(request))
        if (!body.success) return badBody(bodies.fades, body.error)
        return resultResponse(await fades(request, body.data))
      }),
      DELETE: fromOwnPage(async (request: RouteRequest) =>
        resultResponse(await fades(request, null)),
      ),
    },
    ...(service.setLevel &&
      bodies.level &&
      levelRoute(c, base, service.setLevel.bind(service), bodies.level)),
    [`${base}/:id/choose`]: {
      POST: fromOwnPage(async (request: RouteRequest) => {
        const body = bodies.choose.safeParse(await json(request))
        if (!body.success) return badBody(bodies.choose, body.error)
        return resultResponse(await service.choose(projectFile, request.params.id, body.data.file))
      }),
    },
    [`${base}/:id/trim`]: {
      POST: fromOwnPage(async (request: RouteRequest) => {
        const body = bodies.trim.safeParse(await json(request))
        if (!body.success) return badBody(bodies.trim, body.error)
        return resultResponse(
          await service.trim(
            projectFile,
            request.params.id,
            body.data.file,
            body.data.undo ?? false,
          ),
        )
      }),
    },
  }
}
