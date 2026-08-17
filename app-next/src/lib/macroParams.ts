/**
 * Work out which parameters a g-code macro accepts, by reading its own body.
 *
 * Ported verbatim in behaviour from Mainsail's `plugins/helpers.ts::getMacroParams`,
 * including both passes and both regexes.
 *
 * 🔴 WHY THIS IS A REGEX OVER JINJA AND NOT SOMETHING BETTER
 * ---------------------------------------------------------
 * Klipper does not publish a macro's parameter list anywhere. `gcode.commands`
 * gives the `description:` string and nothing else, and `configfile.settings`
 * gives the raw `gcode:` body. So the only evidence that `LOAD_FILAMENT` takes
 * a SPEED is the `params.SPEED` written inside its Jinja. That is what upstream
 * reads, and there is no better source to switch to.
 *
 * Consequences worth knowing rather than discovering:
 *   - a parameter used only through `params.get('X')` is invisible here;
 *   - a `.` inside a default value ends the match early;
 *   - it is per-line: `.` does not cross newlines, so a `{% set %}` split over
 *     two lines yields nothing.
 * All three are upstream's behaviour too. The failure mode is a missing field,
 * never a wrong command: an unfilled field is simply not sent, and Klipper's own
 * defaults apply.
 */

export type MacroParamType = 'int' | 'double' | 'string' | null

export interface MacroParam {
    type: MacroParamType
    /** The `|default(...)` value, shown as the field's placeholder. */
    default: string | null
}

export type MacroParams = Record<string, MacroParam> | null

/**
 * `{% set speed = params.SPEED|default(300)|float %}` and friends.
 * Group 1 name, group 2/4 type, group 3 default.
 */
const PARAM_REGEX =
    /{%?.*?params\.([A-Za-z_0-9]+)(?:\|(int|string|double))?(?:\|default\('?"?(.*?)"?'?\))?(?:\|(int|string))?.*?%?}/g

/** `{% if 'X' in params %}` -- a parameter that is tested but never read. */
const PARAM_IN_REGEX = /{%?.*?if.*?'([A-Za-z_0-9]+)' (?:not )?in params.*?%?}/g

/**
 * Upstream runs a non-global regex in a loop, deleting each match from the
 * string before re-running it. `matchAll` over a global regex visits the same
 * matches in the same order -- deleting a whole match can never expose an
 * earlier-starting one, because the deleted text takes its opening `{` with it.
 */
export function getMacroParams(macro: { gcode: string }): MacroParams {
    let result: Record<string, MacroParam> | null = null

    for (const match of macro.gcode.matchAll(PARAM_REGEX)) {
        result ??= {}
        result[match[1]] = {
            type: (match[2] ?? match[4] ?? null) as MacroParamType,
            default: match[3] ?? null,
        }
    }

    for (const match of macro.gcode.matchAll(PARAM_IN_REGEX)) {
        result ??= {}
        // A `params.X` hit earlier in the body carries type and default; this
        // pass must not overwrite it with nulls.
        result[match[1]] ??= { type: null, default: null }
    }

    return result
}

/**
 * G-code-style commands take `S255`, everything else takes `NAME=value`.
 * Upstream's test, kept as-is: it is what makes an `M117`-shaped macro send
 * something Klipper will actually parse.
 */
export const isGcodeStyleName = (name: string): boolean => /[GM]\d{1,3}/.test(name)

/**
 * Build the command line for a macro plus the values the user typed. Empty
 * fields are omitted entirely so the macro's own defaults survive, and a value
 * containing a space is quoted -- Klipper splits parameters on whitespace.
 */
export function buildMacroCommand(name: string, values: Record<string, string>): string {
    const gcodeStyle = isGcodeStyleName(name)

    const parts = Object.entries(values).flatMap(([param, raw]) => {
        const value = raw?.toString().trim() ?? ''
        if (value === '') return []

        const quoted = value.includes(' ') ? `"${value}"` : value
        return [gcodeStyle ? `${param}${quoted}` : `${param}=${quoted}`]
    })

    return parts.length ? `${name} ${parts.join(' ')}` : name
}
