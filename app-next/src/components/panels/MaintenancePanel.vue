<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { mdiWrenchClock, mdiCheck, mdiDelete, mdiAlertCircleOutline } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import Dialog from '@/components/ui/Dialog.vue'
import { Button } from '@/components/ui/button'
import { useMaintenanceStore, type MaintenanceEntry } from '@/stores/maintenance'
import { formatDateTime } from '@/lib/format'

/**
 * Maintenance reminders -- Mainsail's maintenance rows on the History page
 * (`HistoryListEntryMaintenance.vue` and its four dialogs).
 *
 * 🔴 A PANEL, NOT ROWS IN THE JOB TABLE. Upstream interleaves maintenance
 * records into the history list, which means a page of jobs and a page of
 * reminders share one sort, one filter and one paging window. That paging is
 * already the trickiest part of this port's History page -- it has its own
 * `pageJobs` array precisely so listing cannot disturb the file table -- and
 * threading a second, differently-keyed record type through it would put the
 * two back in one place. They are separate here and say so.
 *
 * 🔴 WHAT IS DELIBERATELY MISSING: creating and editing an entry. Both are
 * writes into a Moonraker database namespace the OTHER interface owns and
 * reads, and there is no way to offer them here without the button also
 * working during a screenshot run. Performing and deleting an existing entry
 * are wired, because those act on a record the user already made. Adding one
 * belongs with the settings surface that is not ported yet.
 *
 * On this machine the namespace holds only upstream's `MAINTENANCE_INIT`
 * marker, so the honest rendering is the empty state -- and that marker is
 * filtered in the store, not here, because it is a record with a name and no
 * other field and would throw on `entry.reminder`.
 */
const maintenance = useMaintenanceStore()

const performing = ref<MaintenanceEntry | null>(null)
const removing = ref<MaintenanceEntry | null>(null)
const note = ref('')

onMounted(() => maintenance.load())

async function confirmPerform(): Promise<void> {
    if (!performing.value) return
    await maintenance.perform(performing.value, note.value)
    performing.value = null
    note.value = ''
}

async function confirmRemove(): Promise<void> {
    if (!removing.value) return
    await maintenance.remove(removing.value.id)
    removing.value = null
}
</script>

<template>
    <Panel panel-name="maintenance" title="Maintenance" :icon="mdiWrenchClock" collapsible>
        <div class="px-4 pb-4" data-maintenance-body>
            <p v-if="maintenance.loading" class="text-muted-foreground py-6 text-center text-sm">Loading...</p>

            <p
                v-else-if="!maintenance.entries.length"
                class="text-muted-foreground py-6 text-center text-sm"
                data-testid="maintenance-empty">
                No maintenance reminders have been set up on this printer.
            </p>

            <ul v-else class="divide-border divide-y" data-testid="maintenance-list">
                <li
                    v-for="entry in maintenance.entries"
                    :key="entry.id"
                    class="flex items-center gap-3 py-3"
                    :data-maintenance-entry="entry.name"
                    :data-maintenance-due="maintenance.progressOf(entry)?.due === true">
                    <MdiIcon
                        v-if="maintenance.progressOf(entry)?.due"
                        :path="mdiAlertCircleOutline"
                        class="text-destructive size-5 shrink-0" />

                    <div class="min-w-0 grow">
                        <div class="truncate text-sm font-medium">{{ entry.name }}</div>
                        <div v-if="entry.note" class="text-muted-foreground truncate text-xs">{{ entry.note }}</div>

                        <div v-if="maintenance.progressOf(entry)" class="mt-1 flex items-center gap-2">
                            <div class="bg-muted h-1.5 w-32 overflow-hidden rounded-full">
                                <div
                                    class="h-full rounded-full"
                                    :class="maintenance.progressOf(entry)!.due ? 'bg-destructive' : 'bg-primary'"
                                    :style="{
                                        width: `${Math.min(100, Math.round(maintenance.progressOf(entry)!.ratio * 100))}%`,
                                    }" />
                            </div>
                            <span class="text-muted-foreground text-xs">
                                {{ maintenance.progressOf(entry)!.label }}
                            </span>
                        </div>

                        <div v-if="entry.end_time" class="text-muted-foreground mt-0.5 text-xs">
                            Done {{ formatDateTime(entry.end_time * 1000) }}
                        </div>
                    </div>

                    <div class="flex shrink-0 gap-1">
                        <button
                            v-if="!entry.end_time"
                            type="button"
                            class="border-border hover:bg-accent inline-flex size-8 items-center justify-center rounded-md border"
                            :aria-label="`Mark ${entry.name} as done`"
                            title="Mark as done"
                            @click="performing = entry">
                            <MdiIcon :path="mdiCheck" class="size-4" />
                        </button>
                        <button
                            type="button"
                            class="border-border hover:bg-accent text-destructive inline-flex size-8 items-center justify-center rounded-md border"
                            :aria-label="`Delete ${entry.name}`"
                            title="Delete"
                            @click="removing = entry">
                            <MdiIcon :path="mdiDelete" class="size-4" />
                        </button>
                    </div>
                </li>
            </ul>
        </div>

        <Dialog
            :model-value="performing !== null"
            title="Mark as done"
            :description="performing ? `Record that “${performing.name}” has been carried out.` : ''"
            @update:model-value="performing = null">
            <textarea
                v-model="note"
                rows="3"
                placeholder="What was done (optional)"
                class="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                data-testid="maintenance-note" />
            <div class="flex justify-end gap-2">
                <Button variant="outline" size="sm" @click="performing = null">Cancel</Button>
                <Button size="sm" data-testid="maintenance-perform-confirm" @click="confirmPerform">Done</Button>
            </div>
        </Dialog>

        <Dialog
            :model-value="removing !== null"
            title="Delete reminder"
            :description="removing ? `“${removing.name}” will be removed. This cannot be undone.` : ''"
            @update:model-value="removing = null">
            <div class="flex justify-end gap-2">
                <Button variant="outline" size="sm" @click="removing = null">Cancel</Button>
                <Button variant="destructive" size="sm" data-testid="maintenance-delete-confirm" @click="confirmRemove">
                    Delete
                </Button>
            </div>
        </Dialog>
    </Panel>
</template>
