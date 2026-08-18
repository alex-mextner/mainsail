<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { mdiDownload, mdiEyeOutline, mdiFileDocumentOutline, mdiFolder, mdiFolderUpload } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import Dialog from '@/components/ui/Dialog.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import { formatDateTime, formatFilesize } from '@/lib/format'
import { escapePath } from '@/stores/files'
import { useConnectionStore } from '@/stores/connection'

/**
 * Config files -- upstream's `ConfigFilesPanel`, READ AND DOWNLOAD ONLY.
 *
 * 🔴 NO EDITING, NO SAVING, NO DELETING, AND THAT IS THE PROJECT'S OWN RULE
 * The repository this fork lives in has a hard rule dated 2026-07-29:
 * `printer-configs/` in the ultra-3d-printer repo is the source of truth for
 * this machine's configuration, and editing `~/printer_data/config/*` directly
 * over SSH -- or through a web editor, which is the same thing with a nicer
 * font -- is no longer allowed. Changes go: edit in the repo, commit, deploy
 * with `scripts/deploy.sh`, which lints, checks the machine is not printing,
 * backs up, uploads and restarts.
 *
 * Shipping a working save button here would put a second, unlinted,
 * unversioned path to the same files right next to the one that exists to
 * prevent exactly that. So this panel browses and reads. Upstream's editor,
 * its save-and-restart, its rename/delete/upload and its "restart Klipper
 * after saving" prompt are all absent by design, not by omission.
 *
 * Viewing is genuinely useful and carries no such risk: it answers "what is
 * actually running on the machine right now", which is the question the repo's
 * own CLAUDE.md says to answer by looking at the live config rather than at a
 * snapshot that goes stale.
 */
const connection = useConnectionStore()

type Root = 'config' | 'config_examples' | 'docs'

interface RemoteFile {
    path: string
    modified: number
    size: number
}

const root = ref<Root>('config')
const currentPath = ref('')
const files = ref<RemoteFile[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const viewing = ref<string | null>(null)
const viewContent = ref('')
const viewLoading = ref(false)

async function load(): Promise<void> {
    loading.value = true
    error.value = null

    const result = await connection.call<RemoteFile[]>('server.files.list', { root: root.value }).catch(() => null)

    if (!result) error.value = `Moonraker did not return the "${root.value}" root.`
    else files.value = result

    loading.value = false
}

watch(root, () => {
    currentPath.value = ''
    void load()
})

void load()

/**
 * `server.files.list` returns FLAT paths for the whole root, so the directory
 * structure has to be derived. Upstream keeps a directory-at-a-time cache from
 * `server.files.get_directory`; a flat list is fine here because a config root
 * is tens of files, not the thousands a gcodes root can hold.
 */
const entries = computed(() => {
    const prefix = currentPath.value ? `${currentPath.value}/` : ''
    const dirs = new Map<string, number>()
    const here: RemoteFile[] = []

    for (const file of files.value) {
        if (!file.path.startsWith(prefix)) continue

        const rest = file.path.slice(prefix.length)
        const slash = rest.indexOf('/')

        if (slash === -1) {
            here.push({ ...file, path: rest })
            continue
        }

        const dir = rest.slice(0, slash)
        dirs.set(dir, Math.max(dirs.get(dir) ?? 0, file.modified))
    }

    return {
        dirs: [...dirs.entries()]
            .map(([name, modified]) => ({ name, modified }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        files: here.sort((a, b) => a.path.localeCompare(b.path)),
    }
})

const fullPath = (name: string) => (currentPath.value ? `${currentPath.value}/${name}` : name)

const hrefFor = (name: string) => `/server/files/${root.value}/${escapePath(fullPath(name))}`

function up(): void {
    const index = currentPath.value.lastIndexOf('/')
    currentPath.value = index === -1 ? '' : currentPath.value.slice(0, index)
}

async function view(name: string): Promise<void> {
    viewing.value = fullPath(name)
    viewLoading.value = true
    viewContent.value = ''

    try {
        const response = await fetch(hrefFor(name))
        // Config files are text and small; a 5 MB klippy backup pasted into the
        // DOM would freeze the tablet, so the read is capped.
        const text = await response.text()
        viewContent.value = text.length > 200_000 ? `${text.slice(0, 200_000)}\n\n… truncated` : text
    } catch {
        viewContent.value = 'Could not read this file.'
    } finally {
        viewLoading.value = false
    }
}

/** Text-ish files are worth opening inline; anything else is download-only. */
const isViewable = (name: string) => /\.(cfg|conf|json|log|txt|md|bak.*|bkp)$/i.test(name)
</script>

<template>
    <Panel
        panel-name="machine-config-files"
        title="Config files"
        :icon="mdiFileDocumentOutline"
        collapsible
        :loading="loading">
        <template #buttons>
            <SegmentedControl
                :model-value="root"
                :options="[
                    { value: 'config', label: 'Config' },
                    { value: 'config_examples', label: 'Examples' },
                    { value: 'docs', label: 'Docs' },
                ]"
                @update:model-value="root = $event" />
        </template>

        <p v-if="error" class="text-destructive py-4 text-sm">{{ error }}</p>

        <div v-else class="w-full min-w-0 overflow-x-auto">
            <table class="w-full min-w-md border-collapse text-sm">
                <tbody>
                    <tr v-if="currentPath" class="border-border hover:bg-accent/50 cursor-pointer border-b" @click="up">
                        <td class="py-1.5 pr-2 pl-1" colspan="4">
                            <span class="inline-flex items-center gap-2">
                                <MdiIcon :path="mdiFolderUpload" class="text-muted-foreground size-4" />
                                ..
                            </span>
                        </td>
                    </tr>

                    <tr
                        v-for="dir in entries.dirs"
                        :key="`d-${dir.name}`"
                        class="border-border hover:bg-accent/50 cursor-pointer border-b"
                        @click="currentPath = fullPath(dir.name)">
                        <td class="py-1.5 pr-2 pl-1">
                            <span class="inline-flex items-center gap-2">
                                <MdiIcon :path="mdiFolder" class="text-muted-foreground size-4" />
                                {{ dir.name }}
                            </span>
                        </td>
                        <td class="text-muted-foreground py-1.5 text-right text-xs whitespace-nowrap">—</td>
                        <td class="text-muted-foreground py-1.5 pl-3 text-right text-xs whitespace-nowrap">
                            {{ formatDateTime(dir.modified * 1000) }}
                        </td>
                        <td class="w-16" />
                    </tr>

                    <tr
                        v-for="file in entries.files"
                        :key="`f-${file.path}`"
                        class="border-border hover:bg-accent/40 border-b">
                        <td class="py-1.5 pr-2 pl-1">
                            <span class="inline-flex items-center gap-2">
                                <MdiIcon :path="mdiFileDocumentOutline" class="text-muted-foreground size-4" />
                                <span class="truncate">{{ file.path }}</span>
                            </span>
                        </td>
                        <td class="text-muted-foreground tabular py-1.5 text-right text-xs whitespace-nowrap">
                            {{ formatFilesize(file.size) }}
                        </td>
                        <td class="text-muted-foreground py-1.5 pl-3 text-right text-xs whitespace-nowrap">
                            {{ formatDateTime(file.modified * 1000) }}
                        </td>
                        <td class="py-1.5 pl-3 text-right whitespace-nowrap">
                            <button
                                v-if="isViewable(file.path)"
                                type="button"
                                class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-7 items-center justify-center rounded-md"
                                :aria-label="`View ${file.path}`"
                                @click="view(file.path)">
                                <MdiIcon :path="mdiEyeOutline" class="size-4" />
                            </button>
                            <a
                                :href="hrefFor(file.path)"
                                :download="file.path"
                                class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-7 items-center justify-center rounded-md"
                                :aria-label="`Download ${file.path}`">
                                <MdiIcon :path="mdiDownload" class="size-4" />
                            </a>
                        </td>
                    </tr>

                    <tr v-if="!loading && !entries.dirs.length && !entries.files.length">
                        <td colspan="4" class="text-muted-foreground py-6 text-center text-sm italic">Nothing here.</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <p class="text-muted-foreground mt-3 text-xs">
            Read-only. This machine's configuration is versioned in the ultra-3d-printer repository and deployed with
            <code>scripts/deploy.sh</code>
            , which lints it, refuses while a print is running and backs up first. A save button here would be a second,
            unchecked way to change the same files.
        </p>

        <Dialog
            :model-value="viewing !== null"
            :title="viewing ?? ''"
            description="Read-only view of the file as it is on the printer right now."
            content-class="max-h-[85vh] w-[min(95vw,64rem)]"
            @update:model-value="viewing = null">
            <pre
                v-if="!viewLoading"
                class="bg-muted max-h-[65vh] overflow-auto rounded-md p-3 text-xs leading-relaxed whitespace-pre"
                >{{ viewContent }}</pre>
            <p v-else class="text-muted-foreground py-6 text-center text-sm">Loading…</p>
        </Dialog>
    </Panel>
</template>
