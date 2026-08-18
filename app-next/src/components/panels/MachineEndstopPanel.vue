<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiArrowExpandVertical, mdiSync } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'

/**
 * Endstop states -- upstream's `EndstopPanel` and `EndstopPanelItem`.
 *
 * 🔴 THE STATE IS NOT PUSHED. IT HAS TO BE ASKED FOR.
 * Klipper does not publish endstop states in the object model; they only exist
 * as the reply to `printer.query_endstops.status`, and that query enqueues a
 * command to the MCU. So the panel is empty until the button is pressed, and
 * the button is the only thing on this page that reaches the microcontroller
 * at all.
 *
 * 🔴 DISABLED WHILE A PRINT IS RUNNING -- a departure from upstream, and a
 * deliberate one. The query goes into the same command queue as the print
 * moves. Upstream leaves the button live and lets you stall your own print
 * with it; on this machine, where the constraint is "no commands during
 * diagnostics", making the UI enforce that is better than remembering not to
 * press it.
 *
 * QUERY_PROBE is sent only when Klipper actually reports a `probe` object,
 * which is upstream's own `existsQueryProbe` guard. This machine's CR-Touch is
 * dead and unconfigured, so that branch never fires here -- but the guard is
 * upstream's, not an invention, and it matters again the day the probe is
 * replaced.
 */
const printer = usePrinterStore()
const connection = useConnectionStore()

const endstops = ref<Record<string, string>>({})
const querying = ref(false)
const queried = ref(false)

const printing = computed(() => ['printing', 'paused'].includes(printer.printStats?.state ?? ''))

const hasProbe = computed(() => {
    const commands = printer.gcodeCommands
    if (commands) return 'QUERY_PROBE' in commands
    return 'probe' in printer.objects
})

const items = computed(() => {
    const list = Object.entries(endstops.value)
        .map(([name, value]) => ({ name: name.toUpperCase(), value, kind: 'endstop' as const }))
        .sort((a, b) => a.name.localeCompare(b.name))

    const probe = printer.objects.probe as { last_query?: boolean } | undefined
    if (list.length && probe && 'last_query' in probe) {
        list.push({ name: 'PROBE', value: probe.last_query ? 'TRIGGERED' : 'open', kind: 'endstop' })
    }

    return list
})

async function query(): Promise<void> {
    if (printing.value || querying.value) return

    querying.value = true
    try {
        const result = await connection.call<Record<string, string>>('printer.query_endstops.status').catch(() => null)

        if (result) endstops.value = result
        queried.value = true

        if (hasProbe.value) await connection.call('printer.gcode.script', { script: 'QUERY_PROBE' }).catch(() => null)
    } finally {
        querying.value = false
    }
}
</script>

<template>
    <Panel panel-name="machine-endstops" title="Endstops" :icon="mdiArrowExpandVertical" collapsible>
        <template #buttons>
            <button
                type="button"
                aria-label="Query endstops"
                class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-40"
                :disabled="printing || querying"
                @click="query">
                <MdiIcon :path="mdiSync" class="size-5" :class="querying ? 'animate-spin' : ''" />
            </button>
        </template>

        <div v-if="items.length" class="divide-border divide-y">
            <div v-for="item in items" :key="item.name" class="flex items-center justify-between py-1.5">
                <span class="text-sm font-medium">{{ item.name }}</span>
                <span
                    class="rounded px-2 py-0.5 text-xs font-medium"
                    :class="item.value === 'open' ? 'bg-ok/15 text-ok' : 'bg-destructive/15 text-destructive'">
                    {{ item.value === 'open' ? 'open' : 'TRIGGERED' }}
                </span>
            </div>
        </div>

        <p v-else-if="printing" class="text-muted-foreground py-4 text-sm">
            A print is running. Querying the endstops puts a command in the same queue as the print moves, so the
            refresh is disabled until it finishes.
        </p>

        <p v-else class="text-muted-foreground py-4 text-sm">
            {{
                queried
                    ? 'Klipper reported no endstops.'
                    : 'Klipper does not publish endstop states — press refresh to ask the board.'
            }}
        </p>
    </Panel>
</template>
