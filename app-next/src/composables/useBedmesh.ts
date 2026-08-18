import { computed } from 'vue'
import { usePrinterStore } from '@/stores/printer'
import type { BedMesh, BedMeshProfile } from '@/types/printer'

/**
 * The loaded bed mesh -- Mainsail's `components/mixins/bedmesh.ts`, rewritten as
 * a composable.
 *
 * Every panel on the heightmap page needs the same handful of derived numbers
 * (min, max, range, is-a-mesh-loaded), so they live here once rather than in
 * four components.
 */
export function useBedmesh() {
    const printer = usePrinterStore()

    /** Klipper's live `bed_mesh` object, or an empty one when there is none. */
    const bedMesh = computed<BedMesh>(() => (printer.objects.bed_mesh as BedMesh | undefined) ?? {})

    const profiles = computed<Record<string, BedMeshProfile>>(() => bedMesh.value.profiles ?? {})

    const meshMin = computed<number[]>(() => bedMesh.value.mesh_min ?? [0, 0])
    const meshMax = computed<number[]>(() => bedMesh.value.mesh_max ?? [0, 0])

    const probedMatrix = computed<number[][]>(() => bedMesh.value.probed_matrix ?? [])
    const meshMatrix = computed<number[][]>(() => bedMesh.value.mesh_matrix ?? [])

    const profileName = computed(() => bedMesh.value.profile_name ?? '')

    /** Every probed point, row-major -- the order `index_*` below assumes. */
    const points = computed<number[]>(() => probedMatrix.value.flat())

    /**
     * 🔴 `Math.min()` of nothing is `Infinity`, and `Math.max()` of nothing is
     * `-Infinity`. Upstream returns those and relies on every caller being
     * guarded by `is_active`; here the empty case returns 0 so that a stray
     * render during the frame between "mesh cleared" and "panel hidden" prints
     * `0.000 mm` instead of `Infinity mm`.
     */
    const min = computed(() => (points.value.length ? Math.min(...points.value) : 0))
    const max = computed(() => (points.value.length ? Math.max(...points.value) : 0))

    /** Peak-to-peak deviation, the number people actually quote about a bed. */
    const variance = computed(() => Math.abs(min.value - max.value).toFixed(3))

    /**
     * Whether a mesh is loaded right now.
     *
     * Upstream's test, kept: a non-empty `profile_name` means loaded, and an
     * adaptive mesh (computed for one print, never saved) has no profile name
     * but does have non-zero bounds.
     *
     * The extra `probed_matrix` clause is ours: `BED_MESH_CLEAR` leaves
     * `mesh_min`/`mesh_max` behind on some Klipper versions, and drawing a chart
     * with bounds but no points is how you get an empty 3D box with axes.
     */
    const isActive = computed(() => {
        if (!probedMatrix.value.length) return false
        if (profileName.value !== '') return true

        return (
            meshMin.value[0] !== 0 || meshMin.value[1] !== 0 || meshMax.value[0] !== 0 || meshMax.value[1] !== 0
        )
    })

    /** Display name of the loaded mesh. Upstream's 'Unknown' for adaptive ones. */
    const name = computed(() => (profileName.value !== '' ? profileName.value : 'Unknown'))

    const xCount = computed(() => probedMatrix.value[0]?.length ?? 0)
    const yCount = computed(() => probedMatrix.value.length)

    const xStepSize = computed(() => (xCount.value < 2 ? 0 : (meshMax.value[0] - meshMin.value[0]) / (xCount.value - 1)))
    const yStepSize = computed(() => (yCount.value < 2 ? 0 : (meshMax.value[1] - meshMin.value[1]) / (yCount.value - 1)))

    /** Bed coordinates of the highest and lowest probed point. */
    const positionOf = (index: number) => {
        if (index < 0 || xCount.value === 0) return null

        return {
            x: meshMin.value[0] + (index % xCount.value) * xStepSize.value,
            y: meshMin.value[1] + Math.trunc(index / xCount.value) * yStepSize.value,
        }
    }

    const positionMax = computed(() => positionOf(points.value.indexOf(max.value)))
    const positionMin = computed(() => positionOf(points.value.indexOf(min.value)))

    return {
        bedMesh,
        profiles,
        meshMin,
        meshMax,
        probedMatrix,
        meshMatrix,
        profileName,
        points,
        min,
        max,
        variance,
        isActive,
        name,
        xCount,
        yCount,
        xStepSize,
        yStepSize,
        positionMax,
        positionMin,
    }
}

/** Min / max / peak-to-peak of one SAVED profile, for the profile list rows. */
export function profileStats(profile: BedMeshProfile) {
    const points = (profile.points ?? []).flat()
    if (!points.length) return { min: 0, max: 0, variance: '0.000' }

    const min = Math.round(Math.min(...points) * 1000) / 1000
    const max = Math.round(Math.max(...points) * 1000) / 1000

    return { min, max, variance: Math.abs(min - max).toFixed(3) }
}
