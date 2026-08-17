<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { mdiConsoleLine, mdiOpenInNew } from '@mdi/js'
import { RouterLink } from 'vue-router'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import Panel from '@/components/ui/Panel.vue'
import ConsoleLog from '@/components/console/ConsoleLog.vue'
import ConsoleInput from '@/components/console/ConsoleInput.vue'
import { useConsole } from '@/composables/useConsole'

/**
 * The console on the dashboard -- Mainsail's `MiniconsolePanel.vue`.
 *
 * Same lines, same filters, same input as the full page: it is the same
 * composable, so a filter switched off on one is off on the other. What differs
 * is only that the log is a short fixed box and the settings live on the
 * Console page rather than being duplicated into this header.
 *
 * It always reads terminal-style regardless of the console's direction setting.
 * A dashboard box that puts the newest line at the top and grows downward
 * pushes the panels below it around every time the printer says anything.
 */
const { lines, settings, clear } = useConsole()

const scroller = ref<HTMLElement | null>(null)
const input = ref<InstanceType<typeof ConsoleInput> | null>(null)

/** Last 100 only: the dashboard box shows a few lines, not the scrollback. */
const visible = computed(() => lines.value.slice(-100))

function scrollToBottom(): void {
    void nextTick(() => {
        if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
    })
}

watch(() => visible.value.length, scrollToBottom)
watch(scroller, scrollToBottom)

const setCommand = (command: string) => input.value?.setCommand(command)
</script>

<template>
    <Panel
        panel-name="miniconsole"
        title="Console"
        :icon="mdiConsoleLine"
        collapsible
        content-class="flex flex-col gap-dgap">
        <template #buttons>
            <button
                type="button"
                class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-8 items-center justify-center rounded-md"
                title="Clear the console"
                @click="clear">
                <span class="text-xs">clear</span>
            </button>
            <RouterLink
                to="/console"
                class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-8 items-center justify-center rounded-md"
                title="Open the full console">
                <MdiIcon :path="mdiOpenInNew" class="size-4" />
            </RouterLink>
        </template>

        <div ref="scroller" class="border-border h-56 overflow-y-auto rounded-md border px-2">
            <ConsoleLog
                :lines="visible"
                :raw="settings.rawOutput"
                :compact="settings.entryStyle === 'compact'"
                @command="setCommand" />
        </div>

        <ConsoleInput ref="input" />
    </Panel>
</template>
