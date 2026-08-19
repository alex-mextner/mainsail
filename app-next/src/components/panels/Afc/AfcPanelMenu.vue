<script setup lang="ts">
import { computed } from 'vue'
import {
    mdiDotsVertical,
    mdiWrench,
    mdiLightbulbOnOutline,
    mdiLightbulbOutline,
    mdiArrowDownBold,
} from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Menu, MenuItem, MenuCheckboxItem, MenuSeparator } from '@/components/ui/menu'
import { useAfc } from '@/composables/useAfc'
import { useConnectionStore } from '@/stores/connection'
import { usePrinterStore } from '@/stores/printer'
import { useGuiStore } from '@/stores/gui'

/**
 * The AFC panel's overflow menu -- Mainsail's `AfcPanelButtons.vue`, plus the
 * view toggles that upstream keeps in a separate `AfcPanelSettings.vue`.
 *
 * 🔴 EVERY MACRO ROW IS FILTERED AGAINST THE MACROS THE PRINTER ACTUALLY HAS,
 * which is upstream's rule and matters more here than it looks. `AFC_BRUSH`,
 * `AFC_PARK` and the TD-1 capture only exist when the corresponding accessory
 * is configured, and the config keys that gate them (`afc.wipe`, `afc.park`)
 * name a CUSTOM macro that may be called something else entirely. Offering a
 * button for a macro Klipper does not have produces "Unknown command" on a
 * machine whose owner has no idea what they were supposed to have installed.
 */
const afc = useAfc()
const connection = useConnectionStore()
const printer = usePrinterStore()
const gui = useGuiStore()

const view = computed(() => gui.state.view.afc)

const isPrintingOnly = computed(() => printer.printerState === 'printing')

const settings = computed(() => (printer.config.afc ?? {}) as Record<string, unknown>)

const macros = computed(() => {
    const ledOn = afc.afc.value.led_state ?? false

    const wanted: { icon: string | null; text: string; macro: string; disabled: boolean }[] = [
        { icon: mdiWrench, text: 'Calibration', macro: 'AFC_CALIBRATION', disabled: isPrintingOnly.value },
        {
            icon: ledOn ? mdiLightbulbOnOutline : mdiLightbulbOutline,
            text: ledOn ? 'Turn off LEDs' : 'Turn on LEDs',
            macro: ledOn ? 'TURN_OFF_AFC_LED' : 'TURN_ON_AFC_LED',
            disabled: false,
        },
    ]

    if (afc.afc.value.td1_present) {
        wanted.push({ icon: null, text: 'Capture TD', macro: 'AFC_GET_TD_ONE_DATA', disabled: isPrintingOnly.value })
    }
    if (settings.value.wipe) {
        wanted.push({
            icon: null,
            text: 'Brush nozzle',
            macro: String(settings.value.wipe_cmd || 'AFC_BRUSH'),
            disabled: isPrintingOnly.value,
        })
    }
    if (settings.value.park) {
        wanted.push({
            icon: null,
            text: 'Park nozzle',
            macro: String(settings.value.park_cmd || 'AFC_PARK'),
            disabled: isPrintingOnly.value,
        })
    }

    const available = new Set(printer.macros.map((macro) => macro.name.toLowerCase()))
    return wanted.filter((entry) => available.has(entry.macro.toLowerCase()))
})

const toggles = [
    { key: 'showFilamentName' as const, label: 'Filament name' },
    { key: 'showLaneInfinite' as const, label: 'Infinite spool' },
    { key: 'showUnitIcons' as const, label: 'Unit icons' },
    { key: 'showTd1Color' as const, label: 'Use TD-1 colour' },
]

const run = (macro: string) => connection.sendGcode(macro)

/**
 * Everything AFC knows, as a file -- upstream's "debug json", kept because it
 * is what an AFC bug report is asked for. Built from `configfile.config`,
 * `configfile.settings` and the live objects, all filtered by the `afc` prefix.
 *
 * It touches no network: a Blob and an object URL, revoked straight after.
 */
function downloadDebugJson(): void {
    const objects = printer.objects as Record<string, unknown>
    const pick = (source: Record<string, unknown>) =>
        Object.fromEntries(
            Object.entries(source)
                .filter(([key]) => key.toLowerCase().startsWith('afc'))
                .map(([key, value]) => [key, { ...(value as object) }])
        )

    // `configfile.config` is the file as written; `configfile.settings` is the
    // same after Klipper resolved defaults. The store only keeps the second
    // one, so the raw half is read off the live object where it still is.
    const configfile = (objects.configfile ?? {}) as { config?: Record<string, unknown> }

    const payload = {
        config: pick(configfile.config ?? {}),
        settings: pick(printer.config as Record<string, unknown>),
        printer: pick(objects),
    }

    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'afc_debug.json'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
}
</script>

<template>
    <Menu content-class="min-w-[13rem]">
        <template #trigger>
            <button
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-8 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                aria-label="AFC functions">
                <MdiIcon :path="mdiDotsVertical" class="size-4" />
            </button>
        </template>

        <MenuItem
            v-for="entry in macros"
            :key="entry.macro"
            :disabled="entry.disabled"
            :data-afc-macro="entry.macro"
            @select="run(entry.macro)">
            <MdiIcon v-if="entry.icon" :path="entry.icon" class="size-4" />
            <span v-else class="size-4" />
            <span>{{ entry.text }}</span>
        </MenuItem>

        <MenuSeparator v-if="macros.length" class="bg-border -mx-1 my-1 h-px" />

        <MenuCheckboxItem
            v-for="toggle in toggles"
            :key="toggle.key"
            :model-value="view[toggle.key]"
            :label="toggle.label"
            @update:model-value="gui.state.view.afc[toggle.key] = $event" />

        <MenuSeparator class="bg-border -mx-1 my-1 h-px" />

        <MenuItem data-afc-action="debug-json" @select="downloadDebugJson">
            <MdiIcon :path="mdiArrowDownBold" class="size-4" />
            <span>Download debug JSON</span>
        </MenuItem>
    </Menu>
</template>
