<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Dialog from '@/components/ui/Dialog.vue'
import { Button } from '@/components/ui/button'
import { useConnectionStore } from '@/stores/connection'
import { useBedmesh } from '@/composables/useBedmesh'
import { validateProfileName } from '@/lib/bedmeshNames'

/**
 * Rename a saved mesh -- Mainsail's `dialogs/HeightmapRenameProfileDialog.vue`.
 *
 * 🔴 Klipper has no rename. Upstream's trick, kept because it is the only one
 * there is: save the CURRENTLY LOADED mesh under the new name, then remove the
 * old profile. Two consequences worth knowing, and both are stated in the
 * dialog rather than left to be discovered:
 *
 *   - it only works on the profile that is loaded, which is why the rename
 *     affordance appears on the active row and nowhere else;
 *   - neither SAVE nor REMOVE writes anything by itself. Both only STAGE a
 *     pending config change (`bed_mesh.py`, `save_profile`/`remove_profile`
 *     call `configfile.set()`/`remove_section()` and then print "The
 *     SAVE_CONFIG command will update the printer config"). The rename is
 *     therefore in-memory until the user runs SAVE_CONFIG, which rewrites
 *     printer.cfg and RESTARTS Klipper. Read on this machine, not assumed.
 */
const props = defineProps<{ name: string }>()
const open = defineModel<boolean>({ required: true })

const connection = useConnectionStore()
const { profiles } = useBedmesh()

const newName = ref('')
const input = ref<HTMLInputElement | null>(null)

const error = computed(() =>
    validateProfileName(newName.value, {
        reserved: true,
        // The current name is not a collision with itself.
        existing: Object.keys(profiles.value).filter((profile) => profile !== props.name),
    })
)

watch(open, async (isOpen) => {
    if (!isOpen) return

    newName.value = props.name
    await nextTick()
    input.value?.focus()
    input.value?.select()
})

function rename(): void {
    if (error.value) return

    if (newName.value === props.name) {
        open.value = false
        return
    }

    void connection.sendGcode(
        `BED_MESH_PROFILE SAVE="${newName.value}"\nBED_MESH_PROFILE REMOVE="${props.name}"`,
        'bedMeshRename'
    )
    open.value = false
}
</script>

<template>
    <Dialog v-model="open" title="Rename bed mesh profile">
        <div class="flex flex-col gap-2">
            <label for="bedmesh-rename-name" class="text-sm font-medium">New name</label>
            <input
                id="bedmesh-rename-name"
                ref="input"
                v-model="newName"
                type="text"
                autocomplete="off"
                class="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
                :aria-invalid="!!error"
                @keyup.enter="rename" />
            <p v-if="error" class="text-destructive text-xs">{{ error }}</p>
            <p v-else class="text-muted-foreground text-xs leading-snug">
                Klipper has no rename: the loaded mesh is saved under the new name and the old profile is removed.
                Neither writes anything yet — the change is staged until
                <code class="font-mono">SAVE_CONFIG</code>
                , which rewrites
                <code class="font-mono">printer.cfg</code>
                and restarts Klipper.
            </p>
        </div>

        <template #footer>
            <Button variant="ghost" @click="open = false">Cancel</Button>
            <Button :disabled="!!error" @click="rename">Rename</Button>
        </template>
    </Dialog>
</template>
