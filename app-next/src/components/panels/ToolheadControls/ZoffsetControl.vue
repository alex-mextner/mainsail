<script setup lang="ts">
import { ref, computed } from 'vue'
import { mdiArrowCollapseDown, mdiArrowExpandUp, mdiBroom, mdiContentSave, mdiInformation } from '@mdi/js'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription } from 'reka-ui'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import { Button } from '@/components/ui/button'
import { useGuiStore } from '@/stores/gui'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'
import { useZOffset } from '@/composables/useZOffset'

/**
 * Live Z offset (baby-stepping) -- Mainsail's `ToolheadControls/ZoffsetControl.vue`.
 *
 * Layout note kept from upstream: the minus row is rendered with the LARGEST
 * step at the outer edge on wide layouts, so the two rows read as one
 * continuous number line running from -0.05 to +0.05 rather than two
 * independently-sorted groups.
 */
const gui = useGuiStore()
const printer = usePrinterStore()
const connection = useConnectionStore()
const { zGcodeOffset, zOffsetLabel, showSaveButton, saveOption, moveSuffix } = useZOffset()

const offsets = computed(() => gui.state.control.offsetsZ)
const saveDialogOpen = ref(false)
const isPrinting = computed(() => printer.printerState === 'printing')

const babyStep = (offset: number, direction: '+' | '-') =>
    connection.sendGcode(`SET_GCODE_OFFSET Z_ADJUST=${direction}${offset}${moveSuffix.value}`, `babyStep${direction}`)

const clearOffset = () => connection.sendGcode(`SET_GCODE_OFFSET Z=0${moveSuffix.value}`, 'babySteppingClear')

async function saveOffset(): Promise<void> {
    await connection.sendGcode(saveOption.value)
    // The apply command only rewrites the pending config; SAVE_CONFIG is what
    // makes it survive a restart, and it restarts Klipper -- hence the prompt.
    saveDialogOpen.value = true
}

async function saveConfig(): Promise<void> {
    saveDialogOpen.value = false
    await connection.sendGcode('SAVE_CONFIG', 'topbarSaveConfig')
}
</script>

<template>
    <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
            <MdiIcon :path="mdiArrowCollapseDown" class="text-muted-foreground size-4 shrink-0" />
            <span class="text-muted-foreground text-dlabel">Z offset:</span>
            <span class="tabular text-sm font-semibold">{{ zOffsetLabel }}</span>

            <span class="grow" />

            <Button
                v-if="zGcodeOffset !== 0"
                variant="ghost"
                size="sm"
                :disabled="connection.isLoading('babySteppingClear')"
                @click="clearOffset">
                <MdiIcon :path="mdiBroom" class="size-4" />
                Clear
            </Button>

            <Button v-if="showSaveButton" variant="ghost" size="sm" class="text-primary" @click="saveOffset">
                <MdiIcon :path="mdiContentSave" class="size-4" />
                Save
            </Button>
        </div>

        <!--
            Container-width, not viewport-width. Four offsets plus a direction
            icon in half a dashboard column clipped "+0.005" to "+0.00"; the two
            groups only sit side by side once the panel itself is wide enough,
            which is what upstream's element-width `Responsive` did.
            The icons are dropped below that width for the same reason.
        -->
        <div class="gap-dgap @md:grid-cols-2 grid grid-cols-1">
            <!-- Minus first on wide layouts so the two groups read left-to-right
                 as one axis; on narrow it stacks plus-over-minus, as upstream. -->
            <div class="seg-group @md:order-1 order-2">
                <button
                    v-for="(offset, index) in [...offsets].reverse()"
                    :key="`down-${offset}`"
                    type="button"
                    class="seg-btn tabular whitespace-nowrap"
                    @click="babyStep(offset, '-')">
                    &minus;{{ offset }}
                    <MdiIcon
                        v-if="index === offsets.length - 1"
                        :path="mdiArrowCollapseDown"
                        class="@md:hidden @lg:inline size-3.5 shrink-0" />
                </button>
            </div>

            <div class="seg-group @md:order-2 order-1">
                <button
                    v-for="(offset, index) in offsets"
                    :key="`up-${offset}`"
                    type="button"
                    class="seg-btn tabular whitespace-nowrap"
                    @click="babyStep(offset, '+')">
                    <MdiIcon
                        v-if="index === 0"
                        :path="mdiArrowExpandUp"
                        class="@md:hidden @lg:inline size-3.5 shrink-0" />
                    &plus;{{ offset }}
                </button>
            </div>
        </div>

        <DialogRoot v-model:open="saveDialogOpen">
            <DialogPortal>
                <DialogOverlay class="fixed inset-0 z-50 bg-black/60" />
                <DialogContent
                    class="bg-card text-card-foreground fixed top-1/2 left-1/2 z-50 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5 shadow-lg">
                    <DialogTitle class="flex items-center gap-2 font-semibold">
                        <MdiIcon :path="mdiInformation" class="text-muted-foreground size-5" />
                        Offset stored
                    </DialogTitle>

                    <DialogDescription class="text-muted-foreground mt-3 text-sm">
                        <template v-if="isPrinting">
                            The new offset is held in the pending configuration. It cannot be written to disk while a
                            print is running -- run SAVE_CONFIG once the print has finished.
                        </template>
                        <template v-else>
                            The new offset is held in the pending configuration. SAVE_CONFIG writes it to printer.cfg
                            and RESTARTS Klipper.
                        </template>
                    </DialogDescription>

                    <div class="mt-4 flex justify-end gap-2">
                        <template v-if="isPrinting">
                            <Button variant="outline" size="sm" @click="saveDialogOpen = false">OK</Button>
                        </template>
                        <template v-else>
                            <Button variant="ghost" size="sm" @click="saveDialogOpen = false">Later</Button>
                            <Button size="sm" @click="saveConfig">SAVE_CONFIG</Button>
                        </template>
                    </div>
                </DialogContent>
            </DialogPortal>
        </DialogRoot>
    </div>
</template>
