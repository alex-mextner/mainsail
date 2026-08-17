<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { mdiSend } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { useConsole, type HelpEntry } from '@/composables/useConsole'

/**
 * The command field -- Mainsail's `inputs/ConsoleTextarea.vue`.
 *
 * A textarea and not an input, because Klipper accepts several commands at
 * once: Shift+Enter adds a line, Enter sends the lot. It grows with its
 * content up to a cap rather than scrolling internally.
 *
 * Keys, upstream's: ⇵ walks the history (only when the caret is on the first /
 * last line, so a multi-line entry is still editable), Tab completes.
 */
const { history, send, complete } = useConsole()

const field = ref<HTMLTextAreaElement | null>(null)
const text = ref('')
/** Index into history while walking it; null means "at the live line". */
const cursor = ref<number | null>(null)
const suggestions = ref<HelpEntry[]>([])

const rows = computed(() => Math.min(6, text.value.split('\n').length))

function focus(): void {
    void nextTick(() => field.value?.focus())
}

/** Put a command back in the field -- from a clicked line or the help list. */
function setCommand(command: string): void {
    text.value = command
    cursor.value = null
    focus()
}

defineExpose({ setCommand })

function submit(): void {
    if (!text.value.trim()) return

    send(text.value)
    text.value = ''
    cursor.value = null
    suggestions.value = []
}

function onEnter(event: KeyboardEvent): void {
    // Shift+Enter is a newline; the browser does it for us.
    if (event.shiftKey) return

    event.preventDefault()
    submit()
}

/** Which line of the textarea the caret sits on, 1-based. */
function currentLine(): number {
    const element = field.value
    if (!element) return 1
    return element.value.slice(0, element.selectionStart).split('\n').length
}

function onUp(event: KeyboardEvent): void {
    if (rows.value > 1 && currentLine() > 1) return
    event.preventDefault()

    const entries = history.value
    if (!entries.length) return

    if (cursor.value === null) cursor.value = entries.length - 1
    else if (cursor.value > 0) cursor.value--

    text.value = entries[cursor.value]
}

function onDown(event: KeyboardEvent): void {
    if (rows.value > currentLine()) return
    event.preventDefault()

    const entries = history.value
    if (cursor.value === null) return

    if (cursor.value < entries.length - 1) {
        cursor.value++
        text.value = entries[cursor.value]
        return
    }

    // Past the newest entry is the empty line you were typing on.
    cursor.value = null
    text.value = ''
}

function onTab(event: KeyboardEvent): void {
    event.preventDefault()

    const element = field.value
    if (!element) return

    const position = element.selectionStart
    const before = text.value.slice(0, position)
    const lineStart = before.lastIndexOf('\n') + 1
    const prefix = before.slice(lineStart)

    const { completion, matches } = complete(prefix)

    // Ambiguous completions are listed under the field rather than pushed into
    // the log: upstream injected them as a fake console event, which then sat
    // in the scrollback pretending the printer had said it.
    suggestions.value = matches
    if (completion === prefix) return

    text.value = text.value.slice(0, lineStart) + completion + text.value.slice(position)
    focus()
}
</script>

<template>
    <div class="flex flex-col gap-2">
        <div class="flex items-end gap-2">
            <textarea
                ref="field"
                v-model="text"
                :rows="rows"
                spellcheck="false"
                autocomplete="off"
                autocapitalize="off"
                placeholder="Send code…"
                aria-label="G-code command"
                class="border-input bg-background focus-visible:ring-ring min-w-0 flex-1 resize-none rounded-md border px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2"
                @keydown.enter="onEnter"
                @keydown.up="onUp"
                @keydown.down="onDown"
                @keydown.tab="onTab" />

            <button
                type="button"
                class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex size-9 shrink-0 items-center justify-center rounded-md disabled:opacity-50"
                aria-label="Send"
                :disabled="!text.trim()"
                @click="submit">
                <MdiIcon :path="mdiSend" class="size-4" />
            </button>
        </div>

        <div v-if="suggestions.length" class="border-border max-h-40 overflow-y-auto rounded-md border p-2">
            <button
                v-for="entry in suggestions"
                :key="entry.command"
                type="button"
                class="hover:bg-accent block w-full rounded px-2 py-1 text-left text-xs"
                @click="setCommand(entry.command)">
                <span class="text-primary font-mono font-medium">{{ entry.command }}</span>
                <span v-if="entry.help" class="text-muted-foreground ml-2">{{ entry.help }}</span>
            </button>
        </div>
    </div>
</template>
