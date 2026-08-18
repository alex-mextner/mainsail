/**
 * Webcam geometry and URL helpers.
 *
 * Ported from the Vue 2 tree's `components/mixins/webcam.ts` and the webcam
 * block of `store/variables.ts`. Kept as plain functions rather than a mixin so
 * the streamer components and the overlay can share them without inheritance.
 */

import {
    mdiAlbum,
    mdiCampfire,
    mdiDoor,
    mdiPrinter3d,
    mdiPrinter3dNozzle,
    mdiRadiatorDisabled,
    mdiRaspberryPi,
    mdiWebcam,
} from '@mdi/js'

/** One entry of Moonraker's `server.webcams.list`, as it comes off the wire. */
export interface WebcamConfig {
    name: string
    enabled?: boolean
    icon?: string
    /** "4:3", "16:9", ... Only a stand-in until the first frame is measured. */
    aspect_ratio?: string | null
    target_fps?: number
    target_fps_idle?: number
    location?: string
    service: string
    stream_url: string
    snapshot_url: string
    flip_horizontal?: boolean
    flip_vertical?: boolean
    rotation?: number
    extra_data?: Record<string, unknown>
    uid?: string
}

/**
 * Absolute URL for a stream/snapshot path.
 *
 * Moonraker stores these relative (`/webcam/?action=stream`) because the proxy
 * that serves them lives on whatever host the UI is loaded from. Same-origin is
 * therefore the right resolution, and it is what makes the nginx `/webcam/`
 * location on port 8090 the thing that has to exist -- see
 * `scripts/deploy-to-printer.sh`.
 *
 * Upstream's mixin additionally rewrites the port when the UI is served from a
 * non-standard one. That logic exists for the "Mainsail on 4408, Moonraker on
 * 80" setups; here the bundle and the proxy are the same nginx server, so
 * rewriting the port would break exactly the case that works.
 */
export function resolveWebcamUrl(url: string | undefined | null): string {
    if (!url) return ''
    if (/^https?:\/\//i.test(url) || url.startsWith('://')) return url

    if (typeof window === 'undefined') return url
    return new URL(url, window.location.origin).toString()
}

/**
 * CSS transform for flip + rotation.
 *
 * The extra `scale(1 / aspectRatio)` on a quarter turn is upstream's: rotating
 * a 4:3 image by 90° inside a box that is still 4:3 would overflow it, so the
 * image is scaled back down to fit.
 */
export function webcamTransform(
    flipHorizontal: boolean,
    flipVertical: boolean,
    rotation: number,
    aspectRatio = 1
): string {
    const transforms: string[] = []

    if (flipHorizontal) transforms.push('scaleX(-1)')
    if (flipVertical) transforms.push('scaleY(-1)')

    if (rotation !== 0) {
        transforms.push(`rotate(${rotation}deg)`)
        if (aspectRatio !== 1 && rotation !== 180) transforms.push(`scale(${1 / aspectRatio})`)
    }

    return transforms.length ? transforms.join(' ') : 'none'
}

/** The wrapper only needs a forced aspect ratio when a quarter turn swaps the axes. */
export function webcamWrapperStyle(aspectRatio: number | null, rotation: number): Record<string, string> {
    if (aspectRatio === null || aspectRatio === 1 || rotation === 0 || rotation === 180) return {}

    if (aspectRatio < 1 && (rotation === 90 || rotation === 270)) {
        return { aspectRatio: String(1 / aspectRatio) }
    }

    return { aspectRatio: String(aspectRatio) }
}

/**
 * Moonraker stores a camera's icon as the STRING NAME of an mdi export
 * (`"mdiWebcam"`), because its database holds JSON and cannot hold an svg path.
 * The name has to be mapped back to a path by hand -- upstream's
 * `convertWebcamIcon`, same seven names, same `mdiWebcam` fallback.
 *
 * A lookup table rather than an index into the `@mdi/js` module: importing the
 * whole icon set to resolve one string would pull ~7 MB of paths into the
 * bundle, and this app is served off an Orange Pi.
 */
const WEBCAM_ICONS: Record<string, string> = {
    mdiAlbum,
    mdiCampfire,
    mdiDoor,
    mdiRadiatorDisabled,
    mdiPrinter3d,
    mdiPrinter3dNozzle,
    mdiRaspberryPi,
    mdiWebcam,
}

export function webcamIcon(name: string | undefined | null): string {
    if (!name) return mdiWebcam
    return WEBCAM_ICONS[name] ?? mdiWebcam
}

/** `"4:3"` -> 1.333. Null when the camera declares nothing usable. */
export function parseAspectRatio(ratio: string | null | undefined): number | null {
    if (!ratio) return null

    const parts = ratio.split(':')
    if (parts.length !== 2) return null

    const width = parseFloat(parts[0])
    const height = parseFloat(parts[1])
    if (!width || !height) return null

    return width / height
}

/*
 * The webcam hud docks into the black bar next to the camera image when that bar is big
 * enough to stay readable, and floats on top of the image otherwise.
 *
 * Minimum width of a vertical (pillarbox) bar. The docked column has to fit two things
 * without wrapping: the temperature row ("241 / 240 °C" plus its label, ~150px at the hud
 * type scale) and a chart that still shows its y-axis labels and ~4 time ticks (~150px), plus
 * 2x12px padding - so ~175px is the functional floor. 200px keeps a little air and is exactly
 * what the most common desktop case produces (a 16:9 window with a 4:3 camera leaves 200px
 * bars at 1600x900).
 */
export const WEBCAM_HUD_MIN_DOCK_WIDTH = 200

/*
 * Minimum height of a horizontal (letterbox) bar: 2x10px padding plus the tallest content
 * block (12px label + 22px value + gap ~= 46px) still leaves the chart as the binding
 * constraint, and a temperature chart under ~56px cannot show gridlines. 20 + 56 = 76,
 * rounded up to 90 for breathing room.
 */
export const WEBCAM_HUD_MIN_DOCK_HEIGHT = 90

/*
 * Minimum window width for the chart to be worth showing in a HORIZONTAL dock.
 *
 * A letterbox bar has a height the window gives it, and content that needs a
 * second line of readings does not fit: measured at 900x900, where the bar is
 * 112px, "Remaining" and "ETA" wrapped and ran off the bottom of the screen.
 * So the readings must stay on ONE line, and the chart is what gives way.
 *
 * There are SIX readings (nozzle, bed, layer, speed, remaining, ETA), each with
 * a 72px floor and a 16px gap between them: 6x72 + 5x16 = 512px, and the widest
 * real content ("255 / 255 °C") pushes that to about 548. The row around them
 * is 16px padding + a 260px file/progress block + a 24px gap ... 24px gap + a
 * 340px chart + 16px padding.
 *
 * 16 + 260 + 24 + 548 + 24 + 340 + 16 = 1228, rounded to 1240. Below this the
 * chart is dropped and the readings get the whole bar: the numbers are what you
 * came for, the chart is the extra.
 *
 * Note this can only ever fire on a TALL window -- a horizontal dock needs the
 * window to be narrower than the camera's aspect ratio in the first place, so
 * 1240px of width means upwards of ~930px of height. On a landscape desktop the
 * bar that appears is the vertical one.
 *
 * There is no matching rule for the vertical dock -- a column is at least
 * WEBCAM_HUD_MIN_DOCK_WIDTH wide by definition, which is what that threshold
 * was derived from.
 */
export const WEBCAM_HUD_MIN_ROW_CHART_WIDTH = 1240

/** Distance the hud keeps from the edges when it floats over the image. */
export const WEBCAM_HUD_MARGIN = 16
