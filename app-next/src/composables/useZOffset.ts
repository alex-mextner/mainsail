import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { usePrinterStore } from '@/stores/printer'
import { useGuiStore } from '@/stores/gui'

/**
 * Live Z offset (baby-stepping) -- Mainsail's `components/mixins/zoffset.ts`.
 *
 * The interesting part is where a saved offset should GO, and upstream gets it
 * right in a way worth preserving exactly:
 *
 *   - If Z homing runs against the probe (`stepper_z.endstop_pin` contains
 *     `probe:z_virtual_endstop`), the offset belongs to the probe, so
 *     Z_OFFSET_APPLY_PROBE.
 *   - Otherwise Z homes against a physical switch and the offset belongs to
 *     `position_endstop`, so Z_OFFSET_APPLY_ENDSTOP.
 *
 * That distinction matters on this machine specifically: a CR-Touch is declared
 * as `[bltouch]` but is deliberately NOT wired to Z homing (`endstop_pin: ^!PD3`
 * is a real switch). A rule of "a probe exists, therefore save to the probe"
 * would write the offset somewhere homing never reads. Deriving it from the
 * endstop pin, as upstream does, lands on ENDSTOP here -- which is correct.
 */
export function useZOffset() {
    const printer = usePrinterStore()
    const gui = useGuiStore()

    const { gcodeMove, config, homedAxes } = storeToRefs(printer)

    const homingOrigin = computed(() => gcodeMove.value?.homing_origin ?? [])

    /** Rounded to µm, upstream's precision. */
    const zGcodeOffset = computed(() =>
        homingOrigin.value.length > 1 ? Math.round((homingOrigin.value[2] ?? 0) * 1000) / 1000 : 0
    )

    const zOffsetLabel = computed(() => (homingOrigin.value[2] ?? 0).toFixed(3))

    const kinematics = computed(() => (config.value.printer?.kinematics as string | undefined) ?? 'cartesian')

    const stepperName = computed(() => {
        if (kinematics.value === 'delta') return 'stepper_a'
        if (kinematics.value === 'generic_cartesian') return 'carriage carriage_z'
        return 'stepper_z'
    })

    const endstopPin = computed(() => {
        const pin = config.value[stepperName.value]?.endstop_pin
        return typeof pin === 'string' ? pin.trim() : null
    })

    const isEndstopProbe = computed(() =>
        (endstopPin.value ?? '').replaceAll(' ', '').includes('probe:z_virtual_endstop')
    )

    const canApplyProbe = computed(() => printer.hasCommand('Z_OFFSET_APPLY_PROBE'))
    const canApplyEndstop = computed(() => printer.hasCommand('Z_OFFSET_APPLY_ENDSTOP'))

    /** Saving a zero offset is a no-op, so the button hides rather than lying. */
    const showSaveButton = computed(() => {
        if (zGcodeOffset.value === 0) return false
        if (isEndstopProbe.value) return canApplyProbe.value
        return canApplyEndstop.value
    })

    const autoSaveOption = computed(() =>
        isEndstopProbe.value && canApplyProbe.value ? 'Z_OFFSET_APPLY_PROBE' : 'Z_OFFSET_APPLY_ENDSTOP'
    )

    const saveOption = computed(() => gui.state.control.offsetZSaveOption ?? autoSaveOption.value)

    /** MOVE=1 only once every axis is homed; otherwise Klipper rejects it. */
    const moveSuffix = computed(() => (homedAxes.value === 'xyz' ? ' MOVE=1' : ''))

    return {
        zGcodeOffset,
        zOffsetLabel,
        isEndstopProbe,
        showSaveButton,
        saveOption,
        autoSaveOption,
        moveSuffix,
    }
}
