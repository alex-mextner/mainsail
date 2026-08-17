<script setup lang="ts">
import { computed } from 'vue'
import { formatConsoleMessage } from '@/composables/useConsole'
import type { ConsoleLine } from '@/stores/connection'

/**
 * The console output -- Mainsail's `ConsoleTable.vue` / `ConsoleTableEntry.vue`.
 *
 * Every line is time-stamped and monospaced, and a line that was a COMMAND is
 * clickable: clicking it puts it back in the input. That is upstream's most
 * used console affordance and the reason its messages were HTML.
 *
 * Here it needs no HTML, because "is this a command" is already known from the
 * line's type rather than having to be re-discovered from markup. Everything
 * else renders as text with `white-space: pre-wrap`, which also fixes something
 * upstream loses: the aligned tables this machine's TUNE_* and SMOKE_* macros
 * print keep their columns instead of having their spaces collapsed by HTML.
 */
const props = defineProps<{
    lines: ConsoleLine[]
    /** Show the raw wire text instead of stripping Klipper's `//` / `!!`. */
    raw: boolean
    compact: boolean
}>()

const emit = defineEmits<{ command: [value: string] }>()

const rendered = computed(() =>
    props.lines.map((line) => ({
        ...line,
        text: props.raw ? line.message : formatConsoleMessage(line.message),
        // `!!` is Klipper's error convention; the type carries it for lines we
        // sent ourselves, the prefix for lines it pushed.
        isError: line.type === 'error' || line.message.startsWith('!! '),
        isMuted: line.type === 'action' || line.type === 'debug',
    }))
)

/** Local time, seconds included: console lines are read against each other. */
const time = (value: number) =>
    new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
</script>

<template>
    <div class="font-mono text-xs">
        <p v-if="!rendered.length" class="text-muted-foreground py-6 text-center italic">Nothing yet.</p>

        <div
            v-for="line in rendered"
            :key="line.id"
            class="border-border/60 flex gap-3 border-b last:border-b-0"
            :class="compact ? 'py-0.5' : 'py-1.5'">
            <span class="text-muted-foreground shrink-0 tabular select-none">{{ time(line.time) }}</span>

            <button
                v-if="line.type === 'command'"
                type="button"
                class="text-primary min-w-0 flex-1 text-left break-words whitespace-pre-wrap hover:underline"
                title="Click to put this back in the input"
                @click="emit('command', line.message)">
                {{ line.text }}
            </button>

            <span
                v-else
                class="min-w-0 flex-1 break-words whitespace-pre-wrap"
                :class="line.isError ? 'text-destructive' : line.isMuted ? 'text-muted-foreground' : ''">
                {{ line.text }}
            </span>
        </div>
    </div>
</template>
