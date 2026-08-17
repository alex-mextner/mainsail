<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { mdiCog, mdiHelp, mdiTrashCan } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { Menu, MenuCheckboxItem, MenuLabel, MenuSeparator } from '@/components/ui/menu'
import ConsoleLog from '@/components/console/ConsoleLog.vue'
import ConsoleInput from '@/components/console/ConsoleInput.vue'
import { useConsole } from '@/composables/useConsole'
import { useConnectionStore } from '@/stores/connection'
import { useGuiStore } from '@/stores/gui'

/**
 * Console -- Mainsail's `pages/Console.vue`.
 *
 * Two reading directions, both upstream's and both kept:
 *   table -- newest line at the top, input above it. Nothing moves under you.
 *   shell -- newest at the bottom, input below, autoscrolling like a terminal.
 *
 * The log is its own scroll region sized to the viewport, so the page itself
 * never scrolls and the input stays put while output arrives.
 */
const { orderedLines, settings, helpList, clear, brokenFilters } = useConsole()
const connection = useConnectionStore()
const gui = useGuiStore()

const { moonrakerComponents } = storeToRefs(connection)

const input = ref<InstanceType<typeof ConsoleInput> | null>(null)
const scroller = ref<HTMLElement | null>(null)
const showHelp = ref(false)
const helpSearch = ref('')

const isShell = computed(() => settings.value.direction === 'shell')

const helpFiltered = computed(() => {
    const needle = helpSearch.value.trim().toLowerCase()
    if (!needle) return helpList.value
    return helpList.value.filter(
        (entry) => entry.command.toLowerCase().includes(needle) || entry.help.toLowerCase().includes(needle)
    )
})

function scrollToBottom(): void {
    void nextTick(() => {
        if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
    })
}

// Only in shell mode: in table mode the newest line is already at the top, and
// scrolling would drag the user away from what they were reading.
watch(
    () => orderedLines.value.length,
    () => {
        if (isShell.value && settings.value.autoscroll) scrollToBottom()
    }
)

watch(isShell, (shell) => shell && scrollToBottom(), { immediate: true })

const setCommand = (command: string) => input.value?.setCommand(command)

function pickFromHelp(command: string): void {
    showHelp.value = false
    setCommand(command)
}

const toggle = (key: string, value: boolean) => gui.saveSetting(`console.${key}`, value)
</script>

<template>
    <div class="gap-dgap flex w-full flex-col" :class="isShell ? 'flex-col-reverse' : ''">
        <div class="gap-dgap flex items-start" :class="isShell ? 'pt-dgap' : ''">
            <div class="min-w-0 flex-1">
                <ConsoleInput ref="input" />
            </div>

            <div class="flex shrink-0 items-center gap-1">
                <button
                    type="button"
                    class="border-input hover:bg-accent inline-flex size-9 items-center justify-center rounded-md border"
                    title="Clear the console"
                    @click="clear">
                    <MdiIcon :path="mdiTrashCan" class="size-4" />
                </button>

                <button
                    type="button"
                    class="border-input hover:bg-accent inline-flex size-9 items-center justify-center rounded-md border"
                    title="Command list"
                    @click="showHelp = true">
                    <MdiIcon :path="mdiHelp" class="size-4" />
                </button>

                <Menu align="end" persistent>
                    <template #trigger>
                        <button
                            type="button"
                            class="border-input hover:bg-accent inline-flex size-9 items-center justify-center rounded-md border"
                            aria-label="Console settings">
                            <MdiIcon :path="mdiCog" class="size-4" />
                        </button>
                    </template>

                    <MenuLabel class="text-muted-foreground px-2 py-1.5 text-xs">View</MenuLabel>
                    <MenuCheckboxItem
                        label="Terminal order (newest at the bottom)"
                        :model-value="isShell"
                        @update:model-value="gui.saveSetting('console.direction', $event ? 'shell' : 'table')" />
                    <MenuCheckboxItem
                        v-if="isShell"
                        label="Autoscroll"
                        :model-value="settings.autoscroll"
                        @update:model-value="toggle('autoscroll', $event)" />
                    <MenuCheckboxItem
                        label="Compact rows"
                        :model-value="settings.entryStyle === 'compact'"
                        @update:model-value="gui.saveSetting('console.entryStyle', $event ? 'compact' : 'default')" />
                    <MenuCheckboxItem
                        label="Raw output"
                        :model-value="settings.rawOutput"
                        @update:model-value="toggle('rawOutput', $event)" />

                    <MenuSeparator class="bg-border my-1 h-px" />
                    <MenuLabel class="text-muted-foreground px-2 py-1.5 text-xs">Hide</MenuLabel>
                    <MenuCheckboxItem
                        label="Temperature reports"
                        :model-value="settings.hideWaitTemperatures"
                        @update:model-value="toggle('hideWaitTemperatures', $event)" />
                    <MenuCheckboxItem
                        v-if="moonrakerComponents.includes('timelapse')"
                        label="Timelapse commands"
                        :model-value="settings.hideTlCommands"
                        @update:model-value="toggle('hideTlCommands', $event)" />
                    <MenuCheckboxItem
                        v-for="(filter, index) in settings.filters"
                        :key="index"
                        :label="filter.name"
                        :model-value="filter.enabled"
                        @update:model-value="gui.saveSetting(`console.filters.${index}.enabled`, $event)" />
                </Menu>
            </div>
        </div>

        <p v-if="brokenFilters.length" class="text-warn text-xs">
            Ignoring {{ brokenFilters.length }} console filter(s) that are not valid regular expressions:
            {{ brokenFilters.join(', ') }}
        </p>

        <div class="bg-card text-card-foreground rounded-xl border shadow-sm">
            <div ref="scroller" class="px-dpx py-dpy h-[calc(100vh-14rem)] min-h-[12rem] overflow-y-auto">
                <ConsoleLog
                    :lines="orderedLines"
                    :raw="settings.rawOutput"
                    :compact="settings.entryStyle === 'compact'"
                    @command="setCommand" />
            </div>
        </div>

        <Dialog v-model="showHelp" title="Command list" content-class="w-[min(92vw,42rem)]">
            <input
                v-model="helpSearch"
                type="search"
                placeholder="Search"
                aria-label="Search commands"
                class="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2" />

            <div class="max-h-[50vh] overflow-y-auto">
                <button
                    v-for="entry in helpFiltered"
                    :key="entry.command"
                    type="button"
                    class="hover:bg-accent block w-full rounded-md px-2 py-1.5 text-left"
                    @click="pickFromHelp(entry.command)">
                    <span class="text-primary font-mono text-xs font-medium">{{ entry.command }}</span>
                    <span v-if="entry.help" class="text-muted-foreground block text-xs leading-snug">
                        {{ entry.help }}
                    </span>
                </button>

                <p v-if="!helpFiltered.length" class="text-muted-foreground py-4 text-center text-sm italic">
                    No command matches “{{ helpSearch }}”.
                </p>
            </div>
        </Dialog>
    </div>
</template>
