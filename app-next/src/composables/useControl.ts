import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import { useGuiStore } from '@/stores/gui'

/**
 * Toolhead movement and homing -- Mainsail's `components/mixins/control.ts`,
 * rewritten as a composable.
 *
 * Same commands, same loading keys, same `_CLIENT_LINEAR_MOVE` preference. The
 * mixin reached into `$store.state` from inside components; here the state comes
 * from the two stores and the components get a flat, typed surface.
 */
export function useControl() {
    const printer = usePrinterStore()
    const connection = useConnectionStore()
    const gui = useGuiStore()

    const { homedAxes, capabilities, levelingApplied, printerState } = storeToRefs(printer)

    const control = computed(() => gui.state.control)

    const feedrateXY = computed(() => control.value.feedrateXY ?? 100)
    const feedrateZ = computed(() => control.value.feedrateZ ?? 10)
    const enableXYHoming = computed(() => control.value.enableXYHoming)

    const isPrinting = computed(() => printerState.value === 'printing')

    const xAxisHomed = computed(() => homedAxes.value.includes('x'))
    const yAxisHomed = computed(() => homedAxes.value.includes('y'))
    const zAxisHomed = computed(() => homedAxes.value.includes('z'))

    /**
     * The single extra button next to "home all". Upstream falls back to
     * motors-off, and refuses a stored choice the machine cannot honour -- e.g.
     * a saved `qgl` on a printer without quad gantry levelling.
     */
    const defaultActionButton = computed(() => {
        if (capabilities.value.qgl) return 'qgl' as const
        if (capabilities.value.zTilt) return 'ztilt' as const
        return 'motorsOff' as const
    })

    const actionButton = computed(() => {
        const chosen = control.value.actionButton ?? defaultActionButton.value
        if (chosen === 'qgl' && !capabilities.value.qgl) return defaultActionButton.value
        if (chosen === 'ztilt' && !capabilities.value.zTilt) return defaultActionButton.value
        return chosen
    })

    /** Warn colour while the levelling result is stale, primary when applied. */
    const qglState = computed<'ok' | 'stale'>(() => (levelingApplied.value.qgl ? 'ok' : 'stale'))
    const zTiltState = computed<'ok' | 'stale'>(() => (levelingApplied.value.zTilt ? 'ok' : 'stale'))

    const send = (gcode: string, loadingKey?: string) => connection.sendGcode(gcode, loadingKey)

    const doHome = () => send('G28', 'homeAll')
    const doHomeX = () => send('G28 X', 'homeX')
    const doHomeY = () => send('G28 Y', 'homeY')
    const doHomeXY = () => send('G28 X Y', 'homeXY')
    const doHomeZ = () => send('G28 Z', 'homeZ')
    const doQGL = () => send('QUAD_GANTRY_LEVEL', 'qgl')
    const doZtilt = () => send('Z_TILT_ADJUST', 'zTilt')
    const doMotorsOff = () => send('M84')

    /**
     * Relative jog. `_CLIENT_LINEAR_MOVE` (from mainsail.cfg) is preferred when
     * present because it clamps to the printable area; the raw form has to
     * bracket the move in SAVE/RESTORE_GCODE_STATE so a jog cannot leave the
     * machine in relative mode.
     *
     * `gcode` is upstream's format: axis letter, sign, distance -- "X-10", "Z+0.1".
     */
    function doSendMove(gcode: string, feedrate: number): void {
        if (capabilities.value.clientLinearMove) {
            const args = gcode
                .split(' ')
                .map((part) => `${part.slice(0, 1)}=${parseFloat(part.slice(1))}`)
                .join(' ')

            send(`_CLIENT_LINEAR_MOVE ${args} F=${feedrate * 60}`)
            return
        }

        send(
            [
                'SAVE_GCODE_STATE NAME=_ui_movement',
                'G91',
                `G1 ${gcode} F${feedrate * 60}`,
                'RESTORE_GCODE_STATE NAME=_ui_movement',
            ].join('\n')
        )
    }

    return {
        // state
        printerState,
        isPrinting,
        homedAxes,
        xAxisHomed,
        yAxisHomed,
        zAxisHomed,
        capabilities,
        actionButton,
        defaultActionButton,
        qglState,
        zTiltState,
        feedrateXY,
        feedrateZ,
        enableXYHoming,
        control,
        isLoading: connection.isLoading,
        // commands
        send,
        doSend: send,
        doHome,
        doHomeX,
        doHomeY,
        doHomeXY,
        doHomeZ,
        doQGL,
        doZtilt,
        doMotorsOff,
        doSendMove,
    }
}
