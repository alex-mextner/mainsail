/**
 * Bed-mesh profile name rules -- upstream's `rules` arrays from the calibrate
 * and rename dialogs, in one place because the two lists overlap and had
 * drifted apart.
 *
 * The ASCII rule is not cosmetic: the name travels to Klipper inside a g-code
 * line (`BED_MESH_PROFILE SAVE="..."`), and Klipper's g-code parser is
 * byte-oriented. A Cyrillic profile name is accepted by the browser, mangled on
 * the way, and then cannot be selected again.
 *
 * Returns the reason it is invalid, or null when it is fine -- so a caller can
 * both disable its button and say why.
 */
export function validateProfileName(value: string, options: { reserved?: boolean; existing?: string[] } = {}): string | null {
    const name = value ?? ''

    if (!name.length) return 'A name is required.'

    // eslint-disable-next-line no-control-regex
    if (name !== name.replace(/[^\x00-\x7F]/g, '')) return 'Only ASCII characters — Klipper cannot round-trip the rest.'

    if (options.reserved && name === 'default') return '“default” is reserved.'

    if (options.existing?.includes(name)) return 'A profile with that name already exists.'

    return null
}
