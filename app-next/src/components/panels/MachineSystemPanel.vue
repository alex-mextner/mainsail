<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiMemory } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import Dialog from '@/components/ui/Dialog.vue'
import LoadRing from './Machine/LoadRing.vue'
import { formatFilesize } from '@/lib/format'
import { usePrinterStore } from '@/stores/printer'
import { useServerStore } from '@/stores/server'

/**
 * System load -- upstream's `SystemPanel` plus `SystemPanelMcu` and
 * `SystemPanelHost`, as one panel.
 *
 * Three files upstream because each owned a v-dialog and a column layout; here
 * the MCU rows and the host row are the same shape (identity on the left,
 * gauges on the right) and one template covers both without the two drifting.
 *
 * READ-ONLY, and that is a decision rather than an omission. Upstream's
 * neighbouring panels can restart Klipper, restart the firmware and reboot or
 * shut down the host. Nothing here does any of that -- see MachinePage.vue.
 */
const printer = usePrinterStore()
const server = useServerStore()

const detailsFor = ref<string | null>(null)

/**
 * Every MCU Klipper reports.
 *
 * Klipper names the first one plainly `mcu` and any others `mcu <name>`, so
 * the object key is the identity. This machine has exactly one (the
 * atmega2560 on the RAMPS board); the loop is here because a second MCU is a
 * normal Klipper setup, not because this printer has one.
 */
interface McuStats {
    mcu_awake?: number
    mcu_task_avg?: number
    mcu_task_stddev?: number
    freq?: number
    bytes_retransmit?: number
    bytes_invalid?: number
    [key: string]: number | undefined
}

const mcus = computed(() => {
    return Object.keys(printer.objects)
        .filter((key) => key === 'mcu' || key.startsWith('mcu '))
        .sort((a, b) => a.localeCompare(b))
        .map((key) => {
            const object = printer.objects[key] as {
                mcu_version?: string
                mcu_constants?: Record<string, string | number>
                last_stats?: McuStats
            }

            const stats = object?.last_stats ?? {}

            /**
             * Klipper's own load figure: how much of each scheduling slot the
             * MCU spends awake, plus a term for how variable its task time is.
             * Upstream's formula verbatim -- it is what the number in Mainsail
             * means, and inventing a different one would make the two
             * interfaces disagree about the same board.
             */
            const load = Math.max(stats.mcu_task_avg ?? 0, stats.mcu_task_stddev ?? 0) * 100000
            const awake = ((stats.mcu_awake ?? 0) / 5) * 100

            return {
                key,
                name: key === 'mcu' ? 'mcu' : key.slice(4),
                chip: object?.mcu_constants?.MCU as string | undefined,
                version: object?.mcu_version ?? '—',
                frequency: stats.freq ? `${Math.round(stats.freq / 1000000)} MHz` : null,
                awake: awake.toFixed(1),
                load: load.toFixed(0),
                loadPercent: Math.min(100, Math.round(Math.max(load, awake))),
                retransmits: stats.bytes_retransmit ?? 0,
                invalid: stats.bytes_invalid ?? 0,
                constants: object?.mcu_constants ?? {},
                stats,
            }
        })
})

/** Klipper's view of the host it runs on: `system_stats`. */
const klippyLoad = computed(() => {
    const stats = printer.objects.system_stats as { sysload?: number; cputime?: number; memavail?: number } | undefined
    if (!stats) return null

    const cores = server.systemInfo?.cpu_info?.cpu_count ?? 1
    const total = server.systemInfo?.cpu_info?.total_memory ?? null

    return {
        // sysload is a 1-minute run-queue average, not a percentage: on four
        // cores a load of 4.0 is 100%, which is why it is divided by the count.
        loadPercent: Math.min(100, Math.round(((stats.sysload ?? 0) / cores) * 100)),
        memAvailable: stats.memavail ?? null,
        memPercent: total && stats.memavail ? Math.round(((total - stats.memavail) / total) * 100) : null,
    }
})

const host = computed(() => {
    const info = server.systemInfo
    if (!info) return null

    const network = Object.entries(info.network ?? {}).map(([name, iface]) => {
        const ipv4 = iface.ip_addresses?.find((address) => address.family === 'ipv4')
        const ipv6 = iface.ip_addresses?.find((address) => address.family === 'ipv6')
        return { name, address: ipv4?.address ?? ipv6?.address ?? null }
    })

    return {
        distribution: [info.distribution?.name, info.distribution?.kernel_version].filter(Boolean).join(' · ') || '—',
        cpu: [info.cpu_info?.cpu_desc, info.cpu_info?.bits].filter(Boolean).join(', ') || '—',
        cores: info.cpu_info?.cpu_count ?? null,
        memory: info.cpu_info?.total_memory ? formatFilesize(info.cpu_info.total_memory * 1024) : null,
        python: info.python?.version_string?.split(' ')[0] ?? null,
        sd: [info.sd_info?.manufacturer, info.sd_info?.product_name, info.sd_info?.capacity].filter(Boolean).join(' '),
        network,
    }
})

const detailsEntries = computed<[string, string][]>(() => {
    const mcu = mcus.value.find((entry) => entry.key === detailsFor.value)
    if (!mcu) return []

    return [
        ...Object.entries(mcu.constants).map(([key, value]) => [key, String(value)] as [string, string]),
        ...Object.entries(mcu.stats).map(([key, value]) => [key, String(value)] as [string, string]),
    ]
})

/**
 * Undervoltage / thermal throttling, as reported by Moonraker.
 *
 * Surfaced instead of hidden in a dialog because it is the single most useful
 * thing this panel can tell you on a single-board computer: a printer that
 * misbehaves on a marginal power supply looks like a mechanical fault until
 * you see this flag.
 */
const throttled = computed(() => server.throttledFlags.filter((flag) => !flag.toLowerCase().includes('previously')))
</script>

<template>
    <Panel panel-name="machine-system" title="System load" :icon="mdiMemory" collapsible>
        <div
            v-if="throttled.length"
            class="border-warn/40 bg-warn/10 text-warn mb-3 rounded-md border px-3 py-2 text-xs">
            Host reports: {{ throttled.join(', ') }}
        </div>

        <div class="divide-border divide-y">
            <div v-for="mcu in mcus" :key="mcu.key" class="flex items-center gap-4 py-3 first:pt-0">
                <div class="min-w-0 flex-1">
                    <button
                        type="button"
                        class="hover:text-primary text-left text-sm font-semibold transition-colors"
                        @click="detailsFor = mcu.key">
                        {{ mcu.name }}
                        <span v-if="mcu.chip" class="text-muted-foreground font-normal">({{ mcu.chip }})</span>
                    </button>
                    <p class="text-muted-foreground mt-0.5 text-xs">Version: {{ mcu.version }}</p>
                    <p class="text-muted-foreground text-xs">
                        Load: {{ mcu.load }}%, awake: {{ mcu.awake }}%
                        <span v-if="mcu.frequency">, {{ mcu.frequency }}</span>
                    </p>
                    <!--
                        Retransmits are the number that matters on this build:
                        a flaky USB link to the RAMPS board shows up here long
                        before it shows up as a failed print. Upstream buries it
                        in the details dialog.
                    -->
                    <p v-if="mcu.retransmits || mcu.invalid" class="text-warn mt-0.5 text-xs">
                        Retransmitted {{ mcu.retransmits }} B, invalid {{ mcu.invalid }} B
                    </p>
                </div>
                <LoadRing :value="mcu.loadPercent" label="MCU" />
            </div>

            <div v-if="host" class="flex items-center gap-4 py-3">
                <div class="min-w-0 flex-1 space-y-0.5">
                    <p class="text-sm font-semibold">{{ host.distribution }}</p>
                    <p class="text-muted-foreground text-xs">
                        {{ host.cpu }}
                        <span v-if="host.cores">, {{ host.cores }} cores</span>
                        <span v-if="host.memory">, {{ host.memory }} RAM</span>
                    </p>
                    <p v-if="host.python" class="text-muted-foreground text-xs">Python {{ host.python }}</p>
                    <p v-if="host.sd" class="text-muted-foreground text-xs">{{ host.sd }}</p>
                    <p v-for="iface in host.network" :key="iface.name" class="text-muted-foreground text-xs">
                        {{ iface.name }}
                        <span v-if="iface.address">({{ iface.address }})</span>
                    </p>
                    <p v-if="server.cpuTemp !== null" class="text-muted-foreground text-xs">
                        SoC temperature: {{ server.cpuTemp.toFixed(1) }} °C
                    </p>
                </div>

                <!--
                    `v-if="klippyLoad"` on the WRAPPER, not on each ring.
                    Written per-ring it read `klippyLoad?.memPercent !== null`,
                    which is `undefined !== null` -- true -- whenever Klipper is
                    down, and the next expression then dereferenced the null.
                    Caught as a live console error on :8090, not by the compiler:
                    the non-null assertions told TypeScript to stop checking.
                -->
                <div v-if="klippyLoad" class="flex shrink-0 gap-3">
                    <LoadRing :value="klippyLoad.loadPercent" label="Load" />
                    <LoadRing v-if="klippyLoad.memPercent !== null" :value="klippyLoad.memPercent" label="Memory" />
                </div>
            </div>
        </div>

        <p v-if="!mcus.length && !host" class="text-muted-foreground py-6 text-center text-sm italic">
            No system information yet.
        </p>

        <Dialog
            :model-value="detailsFor !== null"
            :title="detailsFor ?? ''"
            description="Constants the firmware was built with, and the last statistics block it sent."
            content-class="max-h-[80vh] w-[min(92vw,36rem)]"
            @update:model-value="detailsFor = null">
            <div class="max-h-[60vh] overflow-y-auto">
                <table class="w-full text-sm">
                    <tbody>
                        <tr v-for="[key, value] in detailsEntries" :key="key" class="border-border/60 border-b">
                            <td class="text-muted-foreground py-1.5 pr-3">{{ key }}</td>
                            <td class="tabular py-1.5 text-right break-all">{{ value }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </Dialog>
    </Panel>
</template>
