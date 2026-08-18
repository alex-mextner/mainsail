<script setup lang="ts">
import { computed } from 'vue'
import { mdiAlertOutline, mdiCheckCircleOutline, mdiUpdate } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { useServerStore } from '@/stores/server'

/**
 * Update manager -- upstream's `UpdatePanel`, AS A REPORT ONLY.
 *
 * 🔴 NO UPDATE CAN BE STARTED FROM HERE, ON PURPOSE
 * Two independent reasons, and either one alone would be enough:
 *
 * 1. Mainsail is one of the entries Moonraker's update manager owns. Updating
 *    it replaces /home/ultra/mainsail -- the interface the user actually
 *    prints with, and the thing this whole rewrite exists beside rather than
 *    on top of. That is the hazard already filed as M7 in the project's task
 *    list ("Update Manager может затереть форк"), and it is not a hazard this
 *    panel should be the first to discover.
 * 2. Every git_repo update ends in a service restart -- klipper, moonraker or
 *    both. Restarting either is out of scope while the machine is being
 *    diagnosed.
 *
 * So the panel does what the panel is actually FOR: it tells you what is out
 * of date. Running the update is a decision, and it belongs to the user, in
 * the interface they print with, at a moment they choose. When M7 is resolved
 * -- pinning or excluding the fork in moonraker.conf -- wiring the buttons is
 * a small change to this file and a `machine.update.*` action in the store.
 *
 * `is_dirty` is surfaced rather than hidden, because on this machine
 * `mainsail-config` is dirty AND invalid: an update there would either fail or
 * discard local edits, and seeing that before pressing anything is the whole
 * value of the report.
 */
const server = useServerStore()

const entries = computed(() =>
    [...server.updates].sort((a, b) => {
        const outdated = Number(server.isOutdated(b)) - Number(server.isOutdated(a))
        return outdated !== 0 ? outdated : a.name.localeCompare(b.name)
    })
)

const describe = (entry: (typeof entries.value)[number]): string => {
    if (entry.configured_type === 'system') {
        const count = entry.package_count ?? 0
        return count ? `${count} package${count === 1 ? '' : 's'} can be upgraded` : 'up to date'
    }

    if (!entry.version) return 'no version reported'
    if (server.isOutdated(entry)) return `${entry.version} → ${entry.remote_version}`
    return entry.version
}
</script>

<template>
    <Panel panel-name="machine-updates" title="Software updates" :icon="mdiUpdate" collapsible>
        <template #buttons>
            <span
                v-if="server.updatesLoaded"
                class="rounded px-2 py-0.5 text-xs font-medium"
                :class="server.outdatedCount ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok'">
                {{ server.outdatedCount ? `${server.outdatedCount} outdated` : 'up to date' }}
            </span>
        </template>

        <div class="divide-border divide-y">
            <div v-for="entry in entries" :key="entry.name" class="flex items-center gap-3 py-2">
                <MdiIcon
                    :path="server.isOutdated(entry) ? mdiAlertOutline : mdiCheckCircleOutline"
                    class="size-4 shrink-0"
                    :class="server.isOutdated(entry) ? 'text-warn' : 'text-ok'" />

                <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">
                        {{ entry.name }}
                        <span v-if="entry.channel" class="text-muted-foreground text-xs font-normal">
                            ({{ entry.channel }})
                        </span>
                    </p>
                    <p class="text-muted-foreground tabular truncate text-xs">{{ describe(entry) }}</p>
                </div>

                <span v-if="entry.is_dirty" class="bg-warn/15 text-warn shrink-0 rounded px-2 py-0.5 text-xs">
                    dirty
                </span>
                <span
                    v-else-if="entry.is_valid === false"
                    class="bg-destructive/15 text-destructive shrink-0 rounded px-2 py-0.5 text-xs">
                    invalid
                </span>
            </div>
        </div>

        <p v-if="!entries.length" class="text-muted-foreground py-4 text-sm italic">
            {{ server.updatesLoaded ? 'The update manager reported nothing.' : 'Loading…' }}
        </p>

        <!--
            Said on screen, not only in the source. Someone looking for the
            update button needs to know it is missing on purpose and where to
            press it instead.
        -->
        <p class="text-muted-foreground mt-3 text-xs">
            Report only — this build starts no updates. Mainsail is one of the managed entries, so an update from here
            could replace the working interface on port 80, and every repository update restarts Klipper or Moonraker.
            Run updates from that interface instead. Versions are Moonraker's cached values; nothing here queries
            GitHub.
        </p>
    </Panel>
</template>
