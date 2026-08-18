/**
 * Colour ramps for the heightmap surface -- Mainsail's
 * `store/gui/heightmap/getters.ts`, verbatim, including the stop order.
 *
 * Kept as data rather than derived from the theme on purpose: the ramp encodes
 * a MEASUREMENT (millimetres of deviation), and a bed that reads blue in the
 * working interface has to read blue here too. Recolouring it per theme would
 * make two screenshots of the same mesh disagree.
 *
 * Portland is upstream's default and is diverging around its middle stop, which
 * is the right family for a signed deviation: the neutral band is where the bed
 * is flat.
 */
export const HEIGHTMAP_COLOR_SCHEMES = {
    portland: [
        '#313695',
        '#4575b4',
        '#74add1',
        '#abd9e9',
        '#e0f3f8',
        '#ffffbf',
        '#fee090',
        '#fdae61',
        '#f46d43',
        '#d73027',
        '#a50026',
    ],
    spring: ['#ff00ff', '#ffff00'],
    hot: ['#000000', '#ff0000', '#ffff00', '#ffffff'],
    hsv: ['#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000'],
    grayscale: ['#ffffff', '#000000'],
} as const

export type HeightmapColorScheme = keyof typeof HEIGHTMAP_COLOR_SCHEMES

/**
 * 🔴 The lookup is case-INSENSITIVE, and that is load-bearing rather than
 * defensive. Upstream's settings tab stores the grayscale scheme as
 * `'grayScale'` while the getter switches on `'grayscale'`; it only works
 * because the getter lower-cases first. Dropping the normalisation here would
 * make that one scheme silently fall through to Portland -- a setting that
 * appears to do nothing.
 *
 * The stored value is normalised on write too (see the settings section), so new
 * writes are lower-case; this handles values written by an older build.
 */
export function colorSchemeList(name: string): readonly string[] {
    const key = name.toLowerCase() as HeightmapColorScheme
    return HEIGHTMAP_COLOR_SCHEMES[key] ?? HEIGHTMAP_COLOR_SCHEMES.portland
}

export const HEIGHTMAP_COLOR_SCHEME_OPTIONS: { value: HeightmapColorScheme; label: string }[] = [
    { value: 'portland', label: 'Portland (default)' },
    { value: 'spring', label: 'Spring' },
    { value: 'hot', label: 'Hot' },
    { value: 'hsv', label: 'HSV' },
    { value: 'grayscale', label: 'Grayscale' },
]

/**
 * Camera angles for the 3D box, upstream's four presets. `alpha` is elevation
 * and `beta` is rotation, both in degrees, exactly as echarts-gl's `viewControl`
 * takes them.
 */
export const HEIGHTMAP_ORIENTATIONS = {
    rightFront: { alpha: 25, beta: 40 },
    leftFront: { alpha: 25, beta: -40 },
    front: { alpha: 25, beta: 0 },
    top: { alpha: 90, beta: 0 },
} as const

export type HeightmapOrientation = keyof typeof HEIGHTMAP_ORIENTATIONS

export const HEIGHTMAP_ORIENTATION_OPTIONS: { value: HeightmapOrientation; label: string }[] = [
    { value: 'rightFront', label: 'Right front' },
    { value: 'leftFront', label: 'Left front' },
    { value: 'front', label: 'Front' },
    { value: 'top', label: 'Top' },
]
