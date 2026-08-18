<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Dialog from '@/components/ui/Dialog.vue'
import { Button } from '@/components/ui/button'
import { useConnectionStore } from '@/stores/connection'
import { validateProfileName } from '@/lib/bedmeshNames'

/**
 * Name the mesh, then probe it -- Mainsail's
 * `dialogs/HeightmapCalibrateMeshDialog.vue`.
 *
 * The name is asked for BEFORE probing rather than after, because
 * `BED_MESH_CALIBRATE PROFILE="x"` saves under that name as part of the same
 * run; a mesh probed without one lands in `default` and quietly overwrites it.
 */
const open = defineModel<boolean>({ required: true })

const connection = useConnectionStore()

const name = ref('default')
const input = ref<HTMLInputElement | null>(null)

const error = computed(() => validateProfileName(name.value))

watch(open, async (isOpen) => {
    if (!isOpen) return

    name.value = 'default'
    await nextTick()
    input.value?.focus()
    input.value?.select()
})

function calibrate(): void {
    if (error.value) return

    void connection.sendGcode(`BED_MESH_CALIBRATE PROFILE="${name.value}"`, 'bedMeshCalibrate')
    open.value = false
}
</script>

<template>
    <Dialog v-model="open" title="Calibrate bed mesh">
        <div class="flex flex-col gap-2">
            <label for="bedmesh-calibrate-name" class="text-sm font-medium">Profile name</label>
            <input
                id="bedmesh-calibrate-name"
                ref="input"
                v-model="name"
                type="text"
                autocomplete="off"
                class="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
                :aria-invalid="!!error"
                @keyup.enter="calibrate" />
            <p v-if="error" class="text-destructive text-xs">{{ error }}</p>
            <!--
                Said plainly because probing MOVES the machine, and this dialog
                is one Enter key away from starting it.
            -->
            <p v-else class="text-muted-foreground text-xs leading-snug">
                Probes the whole bed and saves the result under this name. The nozzle must be clean and the bed at
                printing temperature — a mesh probed cold does not describe the bed you print on.
            </p>
        </div>

        <template #footer>
            <Button variant="ghost" @click="open = false">Cancel</Button>
            <Button :disabled="!!error" @click="calibrate">Calibrate</Button>
        </template>
    </Dialog>
</template>
