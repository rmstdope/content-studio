/**
 * The sample game's motion renderer, small on purpose: three effects that drift specks over the
 * picture, or only inside an effect's spot when it is given one. The ripples paint their spot opaque, as a game's water redraws the painting, and are drawn under the others. It has what the studio asks of a game's renderer: `EFFECT_TYPES` and `createMotionScene`.
 */
interface Setting {
  id: string
  title: string
  min: number
  max: number
  step: number
  default: number
}

const AMOUNT: Setting = { id: 'amount', title: 'Amount', min: 0, max: 3, step: 0.05, default: 1 }
const SPEED: Setting = { id: 'speed', title: 'Speed', min: 0, max: 3, step: 0.05, default: 1 }

/** Every effect type the sample renderer has. */
export const EFFECT_TYPES = [
  {
    type: 'dust',
    title: 'Dust',
    spot: false,
    // The game's own place for dust: a band across the lower part of the picture.
    placement: [
      [
        [0.05, 0.6],
        [0.95, 0.6],
        [0.95, 0.95],
        [0.05, 0.95],
      ],
    ] as [number, number][][],
    settings: [AMOUNT, SPEED],
  },
  {
    type: 'ripples',
    title: 'Ripples',
    spot: false,
    // Water: a pond in the lower middle of the picture.
    placement: [
      [
        [0.25, 0.55],
        [0.75, 0.55],
        [0.75, 0.85],
        [0.25, 0.85],
      ],
    ] as [number, number][][],
    settings: [AMOUNT, SPEED],
  },
  { type: 'embers', title: 'Embers', spot: false, placement: 'whole', settings: [AMOUNT, SPEED] },
]

interface Speck {
  x: number
  y: number
  r: number
  v: number
}

/** Where the game places an effect when no spot is given: its shapes, or none for the whole picture. */
function defaultSpot(kind: string): [number, number][][] | undefined {
  const placement = EFFECT_TYPES.find((t) => t.type === kind)?.placement
  return Array.isArray(placement) ? placement : undefined
}

/** A scene that drifts specks up the canvas for each effect switched on. */
export function createMotionScene() {
  let width = 640
  let height = 400
  let specs: {
    kind: string
    settings?: Record<string, number>
    spot?: [number, number][][]
  }[] = []
  let specks: { kind: string; spot?: [number, number][][]; list: Speck[] }[] = []
  const reseed = () => {
    specks = specs.map((spec) => ({
      kind: spec.kind,
      // Placed where the person drew it, else where the game puts it.
      spot: spec.spot ?? defaultSpot(spec.kind),
      list: Array.from({ length: Math.round(30 * (spec.settings?.amount ?? 1)) }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1 + Math.random() * 2,
        v: (0.02 + Math.random() * 0.06) * (spec.settings?.speed ?? 1),
      })),
    }))
  }
  return {
    resize(w: number, h: number) {
      width = w
      height = h
      reseed()
    },
    setEffects(next: typeof specs) {
      // A kind this renderer does not have is ignored, as the contract asks of a game's renderer.
      specs = next.filter((spec) => EFFECT_TYPES.some((t) => t.type === spec.kind))
      reseed()
    },
    step(ms: number) {
      for (const layer of specks) {
        for (const speck of layer.list) {
          speck.y -= speck.v * ms
          if (speck.y < 0) speck.y = height
        }
      }
    },
    draw(ctx: CanvasRenderingContext2D) {
      ctx.clearRect(0, 0, width, height)
      // The ripples first, so the effects over them show whatever the order they were switched on in.
      const ordered = [...specks].sort(
        (a, b) => Number(b.kind === 'ripples') - Number(a.kind === 'ripples'),
      )
      for (const layer of ordered) {
        // An effect with a spot is held to its shapes, as a game's renderer places it.
        if (layer.spot) {
          ctx.save()
          ctx.beginPath()
          for (const shape of layer.spot) {
            shape.forEach(([x, y], i) =>
              i === 0 ? ctx.moveTo(x * width, y * height) : ctx.lineTo(x * width, y * height),
            )
            ctx.closePath()
          }
          ctx.clip()
        }
        // Ripples redraw the painting inside their spot, as RetroQuest's do, so they cover whatever
        // was drawn there before: they are drawn under the others (above), or they would hide them.
        if (layer.kind === 'ripples') {
          ctx.fillStyle = '#1d4e6b'
          ctx.fill()
        }
        ctx.fillStyle = layer.kind === 'embers' ? '#ff9a3d' : '#fff8'
        for (const speck of layer.list) {
          ctx.beginPath()
          ctx.arc(speck.x, speck.y, speck.r, 0, Math.PI * 2)
          ctx.fill()
        }
        if (layer.spot) ctx.restore()
      }
    },
    isEmpty: () => specks.every((layer) => layer.list.length === 0),
  }
}
