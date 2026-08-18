<script setup lang="ts">
/**
 * A labelled settings row -- Mainsail's `settings/SettingsRow.vue`.
 *
 * Title and explanation on the left, control on the right, stacking on a narrow
 * container. The explanation is a permanent line rather than a tooltip, which
 * is the standing rule in this port: the tablet at the machine has no hover, so
 * a tooltip is not a shorter way of saying something, it is a way of not saying
 * it.
 */
defineProps<{ title: string; description?: string; blocked?: boolean }>()
</script>

<template>
    <div class="py-drow @md:flex-row @md:items-center flex flex-col gap-2">
        <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{{ title }}</p>
            <p v-if="description" class="text-muted-foreground pt-0.5 text-xs">{{ description }}</p>
            <!--
                `blockedsettings` is moonraker-timelapse's own list of keys
                pinned in moonraker.conf. Saying WHY the control is dead is the
                whole point: a greyed-out field with no explanation reads as a
                bug in this interface.
            -->
            <p v-if="blocked" class="text-warn pt-0.5 text-xs">Fixed in moonraker.conf — cannot be changed here.</p>
        </div>
        <div class="@md:w-56 @md:justify-end flex shrink-0 items-center justify-start">
            <slot />
        </div>
    </div>
</template>
