/**
 * `@sindarius/gcodeviewer` ships no type declarations and has no @types package.
 *
 * Only the surface WebcamHudModel.vue actually touches is declared, and it is
 * declared loosely on purpose: the package is a rollup bundle with no source
 * types at all, so anything written here would be a guess dressed up as a
 * contract. The component treats the instance as untyped and comments what it
 * relies on, which is honest about where the knowledge came from (reading the
 * bundle) and does not pretend the library is checked.
 *
 * A file of its own rather than a block in env.d.ts, so this and the echarts-gl
 * shims stay independent.
 */
declare module '@sindarius/gcodeviewer' {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const GCodeViewer: new (canvas: HTMLCanvasElement) => any
    export default GCodeViewer
}
