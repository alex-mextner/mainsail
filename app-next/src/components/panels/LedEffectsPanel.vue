<script setup lang="ts">
import { computed } from 'vue'
import { mdiLedStrip, mdiStop } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { useConnectionStore } from '@/stores/connection'
import { usePrinterStore } from '@/stores/printer'

/**
 * `klipper-led_effect` -- Mainsail's `panels/LedEffectsPanel.vue` and its
 * `inputs/LedEffectButton.vue`.
 *
 * 🔴 NOT INSTALLED ON THIS MACHINE, and this panel is honest about it: it
 * renders nothing at all unless Klipper publishes at least one `[led_effect]`
 * object. `klipper-led_effect` is a third-party Klipper extra, not part of
 * Klipper, and there are no `[led_effect]` sections in printer-configs/. So
 * everything below is exercised by the rig fixture, never by the printer.
 *
 * 🔴 AND IF IT WERE INSTALLED, THE EFFECTS WOULD NOT ANIMATE ON THIS STRIP.
 * `[led rgb_strip]`'s Klipper pins are dummies; the real gates hang off Orange
 * Pi GPIO and smoke-siren-daemon.py mirrors `color_data` onto them by POLLING
 * once a second and thresholding each channel at 0.5 (rgb-status.cfg,
 * ARCHITECTURE and DIMMING). An effect is a per-frame animation, so what would
 * reach the strip is a 1 Hz sample of it, in eight colours. Worth knowing
 * before anyone installs the plugin expecting a breathing gradient; not said in
 * the UI, because the UI would be saying it about hardware that is not there.
 *
 * Ported exactly: one toggle per effect (`SET_LED_EFFECT EFFECT="x"`, plus
 * `STOP=1` when it is already running), a stop-all button in the header
 * (`STOP_LED_EFFECTS`), the enabled/disabled colour, per-button loading state,
 * and upstream's rule that all of it is disabled while a print is running.
 * Leading-underscore effects are hidden, same as macros.
 */
const printer = usePrinterStore()
const connection = useConnectionStore()

const STOP_ALL = 'STOP_LED_EFFECTS'

const effects = computed(() => {
    const prefix = 'led_effect '

    return Object.keys(printer.objects)
        .filter((key) => key.toLowerCase().startsWith(prefix))
        .map((key) => key.slice(prefix.length))
        .filter((name) => !name.startsWith('_'))
        .sort((a, b) => a.localeCompare(b))
})

const isEnabled = (name: string) =>
    ((printer.objects[`led_effect ${name}`] ?? {}) as { enabled?: boolean }).enabled === true

const loadingKey = (name: string) => `led_effect_${name}`

/**
 * Upstream's gate, kept: `printing` only, not `paused`. An effect is a g-code
 * command going into the same queue the print is moving through, and unlike a
 * fan it is not something anyone needs mid-print.
 */
const disabled = computed(() => printer.printerState === 'printing')

function toggle(name: string): void {
    const command = `SET_LED_EFFECT EFFECT="${name}"${isEnabled(name) ? ' STOP=1' : ''}`
    void connection.sendGcode(command, loadingKey(name))
}

const stopAll = () => connection.sendGcode(STOP_ALL, STOP_ALL)
</script>

<template>
    <Panel
        v-if="effects.length"
        panel-name="led-effects"
        title="LED effects"
        :icon="mdiLedStrip"
        collapsible
        hide-buttons-on-collapse>
        <template #buttons>
            <button
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30"
                :disabled="disabled || connection.isLoading(STOP_ALL)"
                aria-label="Stop all effects"
                @click="stopAll">
                <MdiIcon :path="mdiStop" class="size-5" />
            </button>
        </template>

        <div class="flex flex-wrap gap-2">
            <button
                v-for="name in effects"
                :key="name"
                type="button"
                class="focus-visible:ring-ring h-(--density-control) rounded-md px-3 text-sm font-medium tracking-wide uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-40"
                :class="
                    isEnabled(name)
                        ? 'bg-ok text-background hover:bg-ok/90'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90'
                "
                :disabled="disabled || connection.isLoading(loadingKey(name))"
                :aria-pressed="isEnabled(name)"
                @click="toggle(name)">
                {{ name }}
            </button>
        </div>

        <!--
            Said once, in the panel rather than in a tooltip: the tablet at the
            machine cannot open a tooltip at all, and "why is every button
            grey" is exactly the question this panel would otherwise leave
            unanswered mid-print.
        -->
        <p v-if="disabled" class="text-muted-foreground pt-dgap text-xs">Effects are held back while a print is running.</p>
    </Panel>
</template>
