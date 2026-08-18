/**
 * RGB <-> HSV, for the light colour picker.
 *
 * Upstream uses `@jaames/iro` for the wheel. That dependency is not pulled in
 * here: iro renders into a DOM node it owns and is styled from the outside,
 * which is exactly the kind of component this rewrite is replacing everywhere
 * else (Vuetify's inputs, sliders and dialogs are all hand-rebuilt on the same
 * design tokens). Two conversions and a CSS gradient are cheaper than a
 * dependency whose look has to be fought back into the theme -- and this page
 * has to work in light AND dark, which an externally-styled canvas does not do
 * for free.
 *
 * Everything here is 0..255 per channel on the RGB side, because that is the
 * unit the numeric inputs and Klipper's own `initial_RED`-style config values
 * are read in, and 0..360 / 0..1 / 0..1 on the HSV side.
 */

export interface Rgb {
    red: number
    green: number
    blue: number
}

export interface Hsv {
    hue: number
    saturation: number
    value: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function rgbToHsv({ red, green, blue }: Rgb): Hsv {
    const r = clamp(red, 0, 255) / 255
    const g = clamp(green, 0, 255) / 255
    const b = clamp(blue, 0, 255) / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min

    let hue = 0
    if (delta !== 0) {
        if (max === r) hue = ((g - b) / delta) % 6
        else if (max === g) hue = (b - r) / delta + 2
        else hue = (r - g) / delta + 4
    }

    hue = Math.round(hue * 60)
    if (hue < 0) hue += 360

    return { hue, saturation: max === 0 ? 0 : delta / max, value: max }
}

export function hsvToRgb({ hue, saturation, value }: Hsv): Rgb {
    const h = ((hue % 360) + 360) % 360
    const s = clamp(saturation, 0, 1)
    const v = clamp(value, 0, 1)

    const c = v * s
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = v - c

    const sector = Math.floor(h / 60) % 6
    const table: [number, number, number][] = [
        [c, x, 0],
        [x, c, 0],
        [0, c, x],
        [0, x, c],
        [x, 0, c],
        [c, 0, x],
    ]
    const [r, g, b] = table[sector]

    return {
        red: Math.round((r + m) * 255),
        green: Math.round((g + m) * 255),
        blue: Math.round((b + m) * 255),
    }
}

export const rgbToCss = ({ red, green, blue }: Rgb): string =>
    `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`
