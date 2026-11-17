/**
 * The sample game's motion renderer, small on purpose: two effects that drift specks over the
 * picture. It has what the studio asks of a game's renderer: `EFFECT_TYPES` and `createMotionScene`.
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
  { type: 'dust', title: 'Dust', spot: false, settings: [AMOUNT, SPEED] },
  { type: 'embers', title: 'Embers', spot: false, settings: [AMOUNT, SPEED] },
]

interface Speck {
  x: number
  y: number
  r: number
  v: number
}

/** A scene that drifts specks up the canvas for each effect switched on. */
export function createMotionScene() {
  let width = 640
  let height = 400
  let specs: { kind: string; settings?: Record<string, number> }[] = []
  let specks: { kind: string; list: Speck[] }[] = []
  const reseed = () => {
    specks = specs.map((spec) => ({
      kind: spec.kind,
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
      for (const layer of specks) {
        ctx.fillStyle = layer.kind === 'embers' ? '#ff9a3d' : '#fff8'
        for (const speck of layer.list) {
          ctx.beginPath()
          ctx.arc(speck.x, speck.y, speck.r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    },
    isEmpty: () => specks.every((layer) => layer.list.length === 0),
  }
}
