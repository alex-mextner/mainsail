<script setup lang="ts">
import { computed } from 'vue'
import {
    mdiAlertOutline,
    mdiCheckboxMarkedCircleOutline,
    mdiChevronDown,
    mdiChevronUp,
    mdiCloseCircleOutline,
    mdiFile,
    mdiFileCancel,
    mdiProgressClock,
} from '@mdi/js'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import type { HistoryColumn } from './columns'
import type { HistoryJob } from '@/stores/history'

/**
 * The print-history table -- upstream's `v-data-table` in `HistoryListPanel`
 * plus its `HistoryListEntryJob` row.
 *
 * Same structural decisions as the g-code file table, for the same reasons: a
 * real `<table>` because the columns are user-configurable and each must size
 * to its widest value, and horizontal scrolling INSIDE the container rather
 * than dropping columns, so the tablet at the machine never shows silently
 * less than the desktop.
 */
const props = defineProps<{
    jobs: HistoryJob[]
    columns: HistoryColumn[]
    sortBy: string
    sortDesc: boolean
    selected: string[]
    loading: boolean
}>()

const emit = defineEmits<{
    sort: [key: string]
    'update:selected': [value: string[]]
}>()

const allSelected = computed(() => props.jobs.length > 0 && props.selected.length === props.jobs.length)

function toggleAll(): void {
    emit('update:selected', allSelected.value ? [] : props.jobs.map((job) => job.job_id))
}

function toggleOne(job: HistoryJob): void {
    const next = props.selected.includes(job.job_id)
        ? props.selected.filter((id) => id !== job.job_id)
        : [...props.selected, job.job_id]

    emit('update:selected', next)
}

/**
 * Upstream's status icons and colours. `klippy_shutdown`, `error`,
 * `interrupted` and anything Moonraker adds later fall through to the warning
 * icon rather than disappearing.
 */
const STATUS = {
    in_progress: { icon: mdiProgressClock, class: 'text-primary' },
    completed: { icon: mdiCheckboxMarkedCircleOutline, class: 'text-ok' },
    cancelled: { icon: mdiCloseCircleOutline, class: 'text-destructive' },
} as const

const statusOf = (job: HistoryJob) =>
    STATUS[job.status as keyof typeof STATUS] ?? { icon: mdiAlertOutline, class: 'text-warn' }

const statusLabel = (job: HistoryJob) => job.status.replace(/_/g, ' ')
</script>

<template>
    <!--
        `min-w-0`: this is a flex item, and a flex item's default
        `min-width: auto` sizes it to its content, so `overflow-x-auto` never
        triggers and a fifteen-column table pushes the whole PAGE sideways.
        Same trap the file table hit, caught there by a screenshot that came
        back 2771px wide at a 1400px viewport.
    -->
    <div class="w-full min-w-0 overflow-x-auto">
        <table class="w-max min-w-full border-collapse text-sm">
            <thead>
                <tr class="text-muted-foreground border-border border-b text-left text-xs">
                    <th class="w-8 py-2 pr-2 pl-1">
                        <input
                            type="checkbox"
                            class="accent-primary size-4 align-middle"
                            aria-label="Select all jobs"
                            :checked="allSelected"
                            :disabled="!jobs.length"
                            @change="toggleAll" />
                    </th>
                    <th class="w-9 px-1 py-2"><span class="sr-only">File</span></th>
                    <th class="cursor-pointer py-2 pr-3 font-medium select-none" @click="emit('sort', 'filename')">
                        <span class="inline-flex items-center gap-1">
                            Filename
                            <MdiIcon
                                v-if="sortBy === 'filename'"
                                :path="sortDesc ? mdiChevronDown : mdiChevronUp"
                                class="size-3.5" />
                        </span>
                    </th>
                    <th
                        class="cursor-pointer px-2 py-2 text-right font-medium select-none"
                        @click="emit('sort', 'status')">
                        <span class="inline-flex items-center gap-1">
                            Status
                            <MdiIcon
                                v-if="sortBy === 'status'"
                                :path="sortDesc ? mdiChevronDown : mdiChevronUp"
                                class="size-3.5" />
                        </span>
                    </th>
                    <th
                        v-for="column in columns"
                        :key="column.key"
                        class="cursor-pointer px-2 py-2 font-medium whitespace-nowrap select-none"
                        :class="column.numeric ? 'text-right' : 'text-left'"
                        @click="emit('sort', column.key)">
                        <span class="inline-flex items-center gap-1">
                            {{ column.label }}
                            <MdiIcon
                                v-if="sortBy === column.key"
                                :path="sortDesc ? mdiChevronDown : mdiChevronUp"
                                class="size-3.5" />
                        </span>
                    </th>
                </tr>
            </thead>

            <tbody>
                <tr v-if="loading && !jobs.length">
                    <td :colspan="columns.length + 4" class="text-muted-foreground py-6 text-center text-sm">
                        Loading…
                    </td>
                </tr>

                <tr v-else-if="!jobs.length">
                    <td :colspan="columns.length + 4" class="text-muted-foreground py-6 text-center text-sm italic">
                        No print jobs yet.
                    </td>
                </tr>

                <tr v-for="job in jobs" :key="job.job_id" class="border-border hover:bg-accent/40 border-b">
                    <td class="py-1.5 pr-2 pl-1">
                        <input
                            type="checkbox"
                            class="accent-primary size-4 align-middle"
                            :aria-label="`Select job ${job.filename}`"
                            :checked="selected.includes(job.job_id)"
                            @change="toggleOne(job)" />
                    </td>

                    <!--
                        A job whose g-code file has since been deleted gets the
                        struck-through file icon, upstream's `mdiFileCancel`.
                        Without it a row you can no longer act on looks exactly
                        like one you can.

                        No thumbnail: the picture lives in `.thumbs/` next to
                        the FILE, so for the jobs where the distinction matters
                        -- the deleted ones -- it is gone too, and a broken
                        image is worse than an icon.
                    -->
                    <td class="px-1 py-1.5">
                        <MdiIcon
                            :path="job.exists === false ? mdiFileCancel : mdiFile"
                            class="size-5"
                            :class="job.exists === false ? 'text-muted-foreground/50' : 'text-muted-foreground'"
                            :title="job.exists === false ? 'The g-code file no longer exists' : undefined" />
                    </td>

                    <td
                        class="max-w-[24rem] truncate py-1.5 pr-3"
                        :class="job.exists === false ? 'text-muted-foreground' : ''"
                        :title="job.filename">
                        {{ job.filename }}
                    </td>

                    <td class="px-2 py-1.5 text-right whitespace-nowrap">
                        <!--
                            The status WORD is rendered, not only the icon.
                            Upstream puts it in a hover tooltip, and the screen
                            at the machine is a touch tablet where hover never
                            fires -- there the tooltip is simply invisible.
                        -->
                        <span class="inline-flex items-center gap-1.5" :class="statusOf(job).class">
                            <MdiIcon :path="statusOf(job).icon" class="size-4" />
                            <span class="text-xs">{{ statusLabel(job) }}</span>
                        </span>
                    </td>

                    <td
                        v-for="column in columns"
                        :key="column.key"
                        class="px-2 py-1.5 whitespace-nowrap"
                        :class="column.numeric ? 'tabular text-right' : ''">
                        {{ column.format(job) }}
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
