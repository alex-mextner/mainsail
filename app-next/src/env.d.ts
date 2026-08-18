/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue'
    const component: DefineComponent<{}, {}, any>
    export default component
}

/**
 * echarts-gl ships no type declarations and there is no @types package for it.
 *
 * Both entry points export nothing but registrable extensions, which are only
 * ever passed straight to echarts' `use()`. The type is borrowed from `use`
 * itself rather than written out, because echarts does not export
 * `EChartsExtensionInstaller` by name -- so this stays correct if echarts
 * changes it.
 *
 * Only the two extensions this app registers are declared. Listing the other
 * nine (Globe, Bar3D, ScatterGL, ...) would advertise that they work here; they
 * are untested and each drags in more of claygl.
 *
 * The 3D OPTION keys (`grid3D`, `xAxis3D`, `series.type: 'surface'`) are absent
 * from echarts' own `EChartsOption` for the same reason, which is why
 * HeightmapChart builds a plain object instead of a typed one.
 */
declare module 'echarts-gl/components' {
    type EChartsExtension = Exclude<Parameters<typeof import('echarts/core').use>[0], unknown[]>
    export const Grid3DComponent: EChartsExtension
}

declare module 'echarts-gl/charts' {
    type EChartsExtension = Exclude<Parameters<typeof import('echarts/core').use>[0], unknown[]>
    export const SurfaceChart: EChartsExtension
}
