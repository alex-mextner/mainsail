/**
 * Temperature series colours -- Mainsail's own, reproduced exactly.
 *
 * WHY NOT A NEW PALETTE
 * --------------------
 * The user asked for colours "преемственные" -- continuous with the interface
 * they already use. So these are not chosen here; they are lifted verbatim from
 * `src/store/variables.ts` and the assignment order from
 * `src/store/printer/tempHistory/actions.ts`, so a reading that is red in the
 * working Mainsail is red here too.
 *
 * The assignment was verified against the live machine rather than assumed:
 * Moonraker's database (namespace `mainsail`, key
 * `view.tempchart.datasetSettings`) has `temperature_fan electronics_fan` stored
 * as `#8E379D`, which is `COLOR_ARRAY[1]`. That is only reachable if the sort is
 * over FULL Klipper object names and `heater_bed` does not consume an index --
 * which is what the code below does.
 *
 * This also fixes a real defect in the previous role-based scheme: it gave every
 * sensor the same colour, so `electronics_fan`, `hotend_fan` and `OrangePi_CPU`
 * were three indistinguishable violet lines on one chart.
 */

/** src/store/variables.ts:13 */
export const COLOR_ARRAY = ['#F44336', '#8e379d', '#03DAC5', '#3F51B5', '#ffde03', '#009688', '#E91E63'] as const

/** src/store/variables.ts:15-16 */
export const COLOR_HEATER_BED = '#2196F3'
export const COLOR_CHAMBER = '#4CAF50'

/**
 * Assign a colour to every series, in Mainsail's order.
 *
 * `heater_bed` and chamber sensors take their fixed colour WITHOUT advancing the
 * rotating index -- that off-by-one is load-bearing, see the DB check above.
 */
export function assignSensorColors(names: string[]): Record<string, string> {
    const result: Record<string, string> = {}
    let next = 0

    for (const name of [...names].sort()) {
        if (name === 'heater_bed') {
            result[name] = COLOR_HEATER_BED
            continue
        }

        if (name.endsWith(' chamber')) {
            result[name] = COLOR_CHAMBER
            continue
        }

        // Upstream falls back to a random colour once the array runs out. A
        // deterministic wrap is used instead: a colour that changes on every
        // page load is not a colour you can refer to.
        result[name] = COLOR_ARRAY[next % COLOR_ARRAY.length]
        next++
    }

    return result
}

const clamp = (value: number) => Math.min(255, Math.max(0, value))

function parseHex(hex: string): [number, number, number] {
    const clean = hex.replace('#', '')
    const full =
        clean.length === 3
            ? clean
                  .split('')
                  .map((char) => char + char)
                  .join('')
            : clean

    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

const toHex = (rgb: [number, number, number]) =>
    '#' + rgb.map((channel) => clamp(Math.round(channel)).toString(16).padStart(2, '0')).join('')

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
    const channel = (value: number) => {
        const scaled = value / 255
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

const contrastWithWhite = (rgb: [number, number, number]) => 1.05 / (luminance(rgb) + 0.05)

/**
 * Darken a colour just enough to stay legible on the light theme.
 *
 * Mainsail is effectively dark-only, so its palette was never checked against a
 * white card. `#ffde03` on white is a contrast ratio of about 1.1 -- an
 * invisible line, not a stylistic quibble. Each channel is scaled down (which
 * preserves hue, so the colour is still recognisably "the yellow one") until it
 * clears 3:1, the WCAG minimum for graphical objects.
 *
 * Colours that already pass are returned untouched, so on this machine only the
 * pale members of the array move at all.
 */
export function darkenForLightTheme(hex: string, minContrast = 3): string {
    let rgb = parseHex(hex)
    if (Number.isNaN(rgb[0])) return hex

    // Bounded loop: 40 steps of 5 % reaches near-black, which passes for certain.
    for (let step = 0; step < 40 && contrastWithWhite(rgb) < minContrast; step++) {
        rgb = [rgb[0] * 0.95, rgb[1] * 0.95, rgb[2] * 0.95]
    }

    return toHex(rgb)
}

/** Colour for one series, in the theme currently showing. */
export function sensorColor(name: string, palette: Record<string, string>, isDark: boolean): string {
    const base = palette[name] ?? '#888888'
    return isDark ? base : darkenForLightTheme(base)
}
