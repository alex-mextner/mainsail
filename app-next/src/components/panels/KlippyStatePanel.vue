<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { mdiAlertOutline, mdiConnection, mdiDownload, mdiMessageOutline, mdiRestart, mdiRocketLaunch } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Button } from '@/components/ui/button'
import { useConnectionStore } from '@/stores/connection'

/**
 * Why the printer is not usable -- Mainsail's `panels/KlippyStatePanel.vue`.
 *
 * This is the panel that shows when nothing else can, and it is the reason the
 * rest of the dashboard is allowed to simply disappear on a non-ready Klippy:
 * without it, a halted printer renders as an empty page and reads as "the web
 * interface is broken" rather than "Klipper is halted, and here is the reason".
 *
 * Klipper's `state_message` is quoted verbatim, whitespace preserved. It is
 * usually the single most actionable string available -- a config error names
 * the offending section and option outright -- so paraphrasing it would throw
 * away the only thing the user actually needs.
 *
 * Not ported from upstream, deliberately: the power-device branch (this machine
 * has no `[power]` device in moonraker.conf, so the branch could never render)
 * and the Moonraker/Klipper connection infographic, which needs a component of
 * its own. The `disconnected` case still gets its own message.
 */
const connection = useConnectionStore()
const { klippyState, klippyMessage, socketState, isConnected } = storeToRefs(connection)

/**
 * Colour and icon per state. `error`/`shutdown` are destructive, `startup` is
 * merely informational -- conflating them would make a normal boot look like a
 * fault.
 */
const appearance = computed(() => {
    switch (klippyState.value) {
        case 'startup':
            return { tone: 'info', icon: mdiRocketLaunch }
        case 'shutdown':
            return { tone: 'warn', icon: mdiAlertOutline }
        case 'error':
            return { tone: 'destructive', icon: mdiAlertOutline }
        case 'disconnected':
            return { tone: 'muted', icon: mdiConnection }
        default:
            return { tone: 'muted', icon: mdiMessageOutline }
    }
})

const toneClasses = computed(
    () =>
        ({
            info: 'border-primary/40 bg-primary/10 text-primary',
            warn: 'border-warn/40 bg-warn/10 text-warn',
            destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
            muted: 'border-border bg-muted text-muted-foreground',
        })[appearance.value.tone] ?? ''
)

/** Klippy answered at all -- i.e. Moonraker is talking to it. */
const klippyIsConnected = computed(() => klippyState.value !== null && klippyState.value !== 'disconnected')

const show = computed(() => isConnected.value && klippyState.value !== 'ready')

const headline = computed(() => {
    const service = klippyIsConnected.value ? 'Klipper' : 'Moonraker'
    return `${service} reports: ${(klippyState.value ?? 'unknown').toUpperCase()}`
})

const restart = () => connection.call('printer.restart').catch(() => undefined)
const firmwareRestart = () => connection.call('printer.firmware_restart').catch(() => undefined)

/** Same-origin, so it works wherever the bundle is served from. */
const logUrl = (name: string) => `${window.location.origin}/server/files/${name}`
</script>

<template>
    <div v-if="show" :class="['rounded-xl border border-l-4 p-4', toneClasses]">
        <p class="flex items-center gap-2 font-medium">
            <MdiIcon :path="appearance.icon" class="size-5 shrink-0" />
            {{ headline }}
        </p>

        <template v-if="klippyIsConnected">
            <!-- Verbatim, wrapped but not reflowed: Klipper's own message. -->
            <pre
                v-if="klippyMessage"
                class="text-foreground bg-background/50 mt-3 overflow-x-auto rounded-md p-3 text-xs whitespace-pre-wrap"
                >{{ klippyMessage.trim() }}</pre>
            <p v-else class="text-muted-foreground mt-3 text-sm">Waiting for Klipper to report a reason…</p>

            <div class="@md:grid-cols-2 mt-3 grid grid-cols-1 gap-2">
                <Button variant="outline" size="sm" class="w-full" @click="restart">
                    <MdiIcon :path="mdiRestart" class="size-4" />
                    Restart
                </Button>
                <Button variant="outline" size="sm" class="w-full" @click="firmwareRestart">
                    <MdiIcon :path="mdiRestart" class="size-4" />
                    Firmware restart
                </Button>
                <Button as="a" :href="logUrl('klippy.log')" target="_blank" variant="outline" size="sm" class="w-full">
                    <MdiIcon :path="mdiDownload" class="size-4" />
                    klippy.log
                </Button>
                <Button
                    as="a"
                    :href="logUrl('moonraker.log')"
                    target="_blank"
                    variant="outline"
                    size="sm"
                    class="w-full">
                    <MdiIcon :path="mdiDownload" class="size-4" />
                    moonraker.log
                </Button>
            </div>
        </template>

        <template v-else>
            <p class="mt-2 text-sm">
                Moonraker is up, but cannot reach Klipper. Check that the Klipper service is running and that the
                Unix-socket address in moonraker.conf matches it.
            </p>
        </template>
    </div>

    <div
        v-else-if="socketState !== 'connected'"
        class="border-border bg-muted text-muted-foreground rounded-xl border border-l-4 p-4">
        <p class="flex items-center gap-2 font-medium">
            <MdiIcon :path="mdiConnection" class="size-5 shrink-0" />
            {{ socketState === 'connecting' ? 'Connecting to Moonraker…' : 'No connection to Moonraker' }}
        </p>
    </div>
</template>
