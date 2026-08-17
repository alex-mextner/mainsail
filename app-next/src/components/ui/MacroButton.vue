<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { mdiMenuDown, mdiRefresh } from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Menu } from '@/components/ui/menu'
import { cn } from '@/lib/utils'
import { buildMacroCommand } from '@/lib/macroParams'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import type { MacroColor } from '@/stores/gui'

/**
 * One macro button -- Mainsail's `components/inputs/MacroButton.vue`.
 *
 * A macro that takes parameters becomes a split button: the left half fires it
 * bare (so its own defaults apply), the chevron opens a form of one field per
 * parameter. Empty fields are not sent at all, which is what makes "run it with
 * just LENGTH changed" work.
 *
 * 🔴 DELIBERATE DEPARTURE FROM UPSTREAM: THE DESCRIPTION IS NOT A TOOLTIP
 * ----------------------------------------------------------------------
 * Upstream puts Klipper's `description:` in a Vuetify hover tooltip. The tablet
 * at this machine is touch-only, and a hover tooltip is unreachable there --
 * the same finding that already moved the extruder panel's disabled-reason out
 * of a tooltip and into text.
 *
 * So the chevron opens for a macro that has EITHER parameters or a description,
 * and the description is rendered as text at the top of that popover. It costs
 * no extra affordance (the split button already existed) and it makes the help
 * reachable by tapping. `title` is still set, so a desktop hover behaves as
 * before.
 *
 * This matters more here than on a stock machine: the macros in this config
 * carry multi-sentence descriptions ("Hard ceiling 1.0 A RMS...", "Read
 * motor-tuning.cfg's header before running") that are safety-relevant, and a
 * tooltip nobody can open is the same as no description at all.
 */
const props = withDefaults(
    defineProps<{
        macro: { name: string }
        /** Named colour; maps onto the theme tokens, not onto Vuetify's palette. */
        color?: MacroColor
        /** Label override, e.g. a translated caption on a fixed button. */
        alias?: string | null
        icon?: string | null
        disabled?: boolean
    }>(),
    { color: 'primary', alias: null, icon: null, disabled: false }
)

const printer = usePrinterStore()
const connection = useConnectionStore()

/**
 * Look the macro up live rather than trusting the prop: a macrogroup entry
 * stores only a NAME, and its parameters and description come from whatever
 * Klipper currently has loaded. After a config change, that differs.
 */
const klipperMacro = computed(() => printer.macroByName(props.macro.name))

/** Klipper's own fallback help string; showing it tells the user nothing. */
const DEFAULT_DESCRIPTION = 'G-Code macro'

const description = computed(() => {
    const help = klipperMacro.value?.description ?? null
    return help && help !== DEFAULT_DESCRIPTION ? help : null
})

const paramNames = computed(() =>
    // A leading underscore marks an internal parameter upstream, same as for
    // macro names themselves.
    Object.keys(klipperMacro.value?.params ?? {}).filter((name) => !name.startsWith('_'))
)

const values = ref<Record<string, string>>({})

/** Reset the form whenever the macro's parameter list itself changes. */
watch(
    paramNames,
    (names) => {
        const next: Record<string, string> = {}
        for (const name of names) next[name] = values.value[name] ?? ''
        values.value = next
    },
    { immediate: true }
)

const hasMenu = computed(() => paramNames.value.length > 0 || description.value !== null)

/**
 * Columns for the parameter grid, upstream's arithmetic: one column per five
 * fields, capped at four. A macro with ten parameters is otherwise a column so
 * tall it runs off a tablet screen.
 */
const columns = computed(() => Math.min(4, Math.max(1, Math.ceil(paramNames.value.length / 5))))

const label = computed(() => props.alias ?? props.macro.name.replace(/_/g, ' '))

const loadingKey = computed(() => `macro_${props.macro.name}`)
const isLoading = computed(() => connection.isLoading(loadingKey.value))

/**
 * Colour classes rather than a Button variant: `success` and `warning` have no
 * variant, and inventing two more button variants for something only the macro
 * groups use would push machine-specific colour into the shared control.
 */
const COLORS: Record<MacroColor, string> = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    success: 'bg-ok text-background hover:bg-ok/90',
    warning: 'bg-warn text-background hover:bg-warn/90',
    error: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
}

const colorClass = computed(() => COLORS[props.color] ?? COLORS.primary)

function run(script: string) {
    void connection.sendGcode(script, loadingKey.value)
}

const runBare = () => run(props.macro.name)
const runWithParams = () => run(buildMacroCommand(props.macro.name, values.value))

const clear = (name: string) => {
    values.value[name] = ''
}
</script>

<template>
    <div class="inline-flex max-w-full align-top">
        <button
            type="button"
            :disabled="disabled || isLoading"
            :title="description ?? undefined"
            :class="
                cn(
                    'focus-visible:ring-ring inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium tracking-wide uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
                    colorClass,
                    hasMenu && 'rounded-r-none'
                )
            "
            @click="runBare">
            <MdiIcon v-if="icon" :path="icon" class="size-4 shrink-0" />
            <span
                v-if="isLoading"
                class="size-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden="true" />
            <span class="truncate">{{ label }}</span>
        </button>

        <Menu v-if="hasMenu" align="start" persistent content-class="max-w-[min(90vw,32rem)]">
            <template #trigger>
                <button
                    type="button"
                    :disabled="disabled"
                    :aria-label="`${macro.name} details`"
                    :class="
                        cn(
                            'focus-visible:ring-ring ml-px inline-flex items-center rounded-md rounded-l-none px-1 transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
                            colorClass
                        )
                    ">
                    <MdiIcon :path="mdiMenuDown" class="size-4" />
                </button>
            </template>

            <div class="flex flex-col gap-3 p-2">
                <!-- Klipper's own words about the macro, wrapped rather than
                     clipped: several on this machine are a paragraph long. -->
                <p
                    v-if="description"
                    class="text-muted-foreground max-h-40 overflow-y-auto text-xs leading-snug whitespace-pre-line">
                    {{ description }}
                </p>

                <template v-if="paramNames.length">
                    <hr v-if="description" class="border-border" />

                    <div class="grid gap-2" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
                        <label v-for="name in paramNames" :key="name" class="flex min-w-0 flex-col gap-1">
                            <span class="text-muted-foreground text-[11px]">{{ name }}</span>
                            <span
                                class="border-input bg-background focus-within:ring-ring flex min-w-0 items-center rounded-md border pr-1 focus-within:ring-2">
                                <input
                                    v-model="values[name]"
                                    type="text"
                                    :placeholder="klipperMacro?.params?.[name]?.default ?? ''"
                                    :aria-label="name"
                                    class="w-full min-w-0 bg-transparent px-2 py-1.5 text-sm outline-none"
                                    @keyup.enter="runWithParams" />
                                <button
                                    v-if="values[name]"
                                    type="button"
                                    class="text-muted-foreground hover:text-foreground shrink-0"
                                    :aria-label="`Clear ${name}`"
                                    @click="clear(name)">
                                    <MdiIcon :path="mdiRefresh" class="size-4" />
                                </button>
                            </span>
                        </label>
                    </div>

                    <!--
                        The placeholder is the macro's own default, and an empty
                        field is omitted from the command. Said in words because
                        a greyed-out number in a field otherwise reads as "this
                        will be sent".
                    -->
                    <p class="text-muted-foreground text-[11px]">
                        Empty fields are not sent; the macro's own default applies.
                    </p>

                    <button
                        type="button"
                        :class="
                            cn(
                                'focus-visible:ring-ring w-full rounded-md px-3 py-2 text-xs font-medium tracking-wide uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none',
                                colorClass
                            )
                        "
                        @click="runWithParams">
                        Send
                    </button>
                </template>
            </div>
        </Menu>
    </div>
</template>
