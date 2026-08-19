<script setup lang="ts">
import { computed } from 'vue'
import { mdiAlert, mdiClose } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import AfcUnit from './Afc/AfcUnit.vue'
import AfcExtruderRow from './Afc/AfcExtruderRow.vue'
import AfcPanelMenu from './Afc/AfcPanelMenu.vue'
import { afcIconLogo } from '@/lib/afcIcons'
import { useAfc } from '@/composables/useAfc'
import { useConnectionStore } from '@/stores/connection'
import { useGuiStore } from '@/stores/gui'

/**
 * AFC (Armored Turtle Automated Filament Changer) -- Mainsail's `AfcPanel.vue`
 * and the fourteen files under `panels/Afc/`.
 *
 * 🔴 NOT PRESENT ON THIS MACHINE. Checked against the live printer before
 * porting, not assumed: `printer/objects/list` returns 118 objects and not one
 * of them is `AFC` or `AFC_*`. AFC is a Klipper EXTRA, so unlike Spoolman or
 * timelapse there is no `server.info` component to gate on either -- the panel
 * gates on the Klipper object itself, which is upstream's own test.
 *
 * The consequence for verification is the whole reason `scripts/lib/rig.mjs`
 * exists: against this printer every state below is unreachable, so "it looks
 * right" would only ever mean "the hidden state looks right". The fixture in
 * `scripts/fixtures/afc.mjs` supplies a four-lane BoxTurtle in a set of states
 * the real hardware would have to be physically manipulated to produce.
 *
 * NOT ported, and recorded rather than dropped: the AFC settings dialogs
 * (`AfcSettingsDialog*`, four files that write `SET_AFC_*` calibration values
 * per lane, hub and extruder), and `StartPrintDialogAfc*` which belongs with
 * the start-print flow rather than with this panel. Both are editing surfaces
 * for numbers nobody can calibrate without the hardware in front of them.
 */
const afc = useAfc()
const connection = useConnectionStore()
const gui = useGuiStore()

const hiddenExtruders = computed(() => gui.state.view.afc.hiddenExtruders)
const hiddenUnits = computed(() => gui.state.view.afc.hiddenUnits)

const extruders = computed(() => afc.extruders.value.filter((name) => !hiddenExtruders.value.includes(name)))
const units = computed(() => afc.units.value.filter((name) => !hiddenUnits.value.includes(name)))

const message = computed(() => afc.afc.value.message?.message ?? '')

/**
 * Upstream warns to the console on an unknown type and falls back to `error`.
 * Kept: an AFC build that invents a severity should still show its text, and
 * showing it as the loudest thing available is the safe direction.
 */
const messageType = computed(() => {
    const type = afc.afc.value.message?.type ?? 'error'
    if (!['info', 'warning', 'success', 'error'].includes(type)) {
        console.warn(`AfcPanel: unknown message type "${type}", falling back to "error".`)
        return 'error'
    }
    return type
})

const messageClass = computed(
    () =>
        ({
            info: 'border-primary/40 bg-primary/10 text-foreground',
            success: 'border-primary/40 bg-primary/10 text-foreground',
            warning: 'border-amber-500/40 bg-amber-500/10 text-foreground',
            error: 'border-destructive/40 bg-destructive/10 text-foreground',
        })[messageType.value]
)

const clearMessage = () => connection.sendGcode('AFC_CLEAR_MESSAGE')
</script>

<template>
    <Panel v-if="afc.afcExists.value" panel-name="afc" title="AFC" :icon="afcIconLogo" collapsible>
        <template #buttons>
            <AfcPanelMenu />
        </template>

        <div class="flex flex-col gap-3 px-4 pb-4" data-panel="afc">
            <div
                v-if="message"
                class="flex items-start gap-2 rounded-md border px-3 py-2"
                :class="messageClass"
                role="status"
                data-testid="afc-message">
                <MdiIcon :path="mdiAlert" class="mt-0.5 size-4 shrink-0" />
                <span class="grow font-mono text-sm break-spaces whitespace-pre-wrap">{{ message }}</span>
                <button
                    type="button"
                    class="hover:bg-accent shrink-0 rounded p-1"
                    aria-label="Clear AFC message"
                    @click="clearMessage">
                    <MdiIcon :path="mdiClose" class="size-4" />
                </button>
            </div>

            <!--
                Bypass is a physical lever that routes filament past the unit
                straight into the toolhead. While it is engaged every lane
                control below is meaningless, so it gets its own banner rather
                than a subtle badge.
            -->
            <div
                v-if="afc.bypassState.value"
                class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
                role="status"
                data-testid="afc-bypass">
                Bypass is active -- filament goes straight to the toolhead.
            </div>

            <AfcExtruderRow v-for="name in extruders" :key="name" :name="name" />
            <AfcUnit v-for="name in units" :key="name" :name="name" />
        </div>
    </Panel>
</template>
