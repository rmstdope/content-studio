import type { SpotShape } from './images'

/** A number held to the picture (0 to 1) and to four decimals, as a saved corner is. */
export function clampUnit(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000
}

/** Whether the point (fractions of the picture) lies inside the shape. */
export function pointInShape(shape: SpotShape, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const [xi, yi] = shape[i]!
    const [xj, yj] = shape[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The index of the shape at the point, the one drawn last when they overlap; null when none. */
export function shapeAt(spot: readonly SpotShape[], x: number, y: number): number | null {
  for (let i = spot.length - 1; i >= 0; i--) if (pointInShape(spot[i]!, x, y)) return i
  return null
}

/** The shape with corner `at` moved to the point, which is held to the picture. */
export function moveCorner(shape: SpotShape, at: number, x: number, y: number): SpotShape {
  return shape.map((corner, i) => (i === at ? [clampUnit(x), clampUnit(y)] : corner))
}

/** The shape without corner `at`; null when that would leave fewer than three. */
export function removeCorner(shape: SpotShape, at: number): SpotShape | null {
  return shape.length <= 3 ? null : shape.filter((_, i) => i !== at)
}

/** The spot with a shape added at the end. */
export function addShape(spot: readonly SpotShape[] | undefined, shape: SpotShape): SpotShape[] {
  return [...(spot ?? []), shape]
}

/** The spot with shape `at` replaced. */
export function replaceShape(
  spot: readonly SpotShape[],
  at: number,
  shape: SpotShape,
): SpotShape[] {
  return spot.map((was, i) => (i === at ? shape : was))
}

/** The spot without shape `at`; undefined when no shape is left (the whole picture). */
export function dropShape(spot: readonly SpotShape[], at: number): SpotShape[] | undefined {
  const rest = spot.filter((_, i) => i !== at)
  return rest.length ? rest : undefined
}
