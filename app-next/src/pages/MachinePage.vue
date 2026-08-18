<script setup lang="ts">
import { useBreakpoint } from '@/composables/useBreakpoint'
import KlippyStatePanel from '@/components/panels/KlippyStatePanel.vue'
import MachineConfigFilesPanel from '@/components/panels/MachineConfigFilesPanel.vue'
import MachineSystemPanel from '@/components/panels/MachineSystemPanel.vue'
import MachineUpdatePanel from '@/components/panels/MachineUpdatePanel.vue'
import MachineEndstopPanel from '@/components/panels/MachineEndstopPanel.vue'
import MachineLogfilesPanel from '@/components/panels/MachineLogfilesPanel.vue'

/**
 * `/machine` -- upstream's `pages/Machine.vue`.
 *
 * Layout is upstream's: config files down the left, and Klippy state, system
 * load, updates, endstops and logs down the right, collapsing to one column
 * below the tablet width.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 WHAT IS DELIBERATELY NOT WIRED ON THIS PAGE, AND WHY
 * ─────────────────────────────────────────────────────────────────────────
 * Machine is the one page in Mainsail whose buttons change the machine rather
 * than the view. Each panel documents its own case; collected here so the gap
 * is visible in one place instead of being discovered one button at a time.
 *
 *  · Config file EDITING and saving. The repository this fork lives in makes
 *    `printer-configs/` the source of truth and forbids editing the printer's
 *    config directly; changes go through `scripts/deploy.sh`, which lints,
 *    refuses while a print is running, and backs up. A save button here would
 *    be a second, unchecked path to the same files. Browse, view and download
 *    are ported. — MachineConfigFilesPanel.vue
 *
 *  · Starting UPDATES. Mainsail itself is one of the entries the update
 *    manager owns, so an update from here can replace the working interface on
 *    port 80 that this rewrite is built beside — the hazard already filed as
 *    M7. Every git_repo update also ends in a Klipper or Moonraker restart.
 *    The report of what is out of date IS ported, because that is the part you
 *    actually read. — MachineUpdatePanel.vue
 *
 *  · Host REBOOT and SHUTDOWN, service restarts, Klipper restart and firmware
 *    restart. Upstream puts these in this area; none of them are here. They
 *    are one confirmation dialog away from stopping a running print, and this
 *    build has no reason to be the thing that does it.
 *
 *  · Log ROLLOVER. It restarts the services holding the log files open.
 *
 * The endstop query IS wired, because reading endstop state is the point of
 * that panel and there is no other way to get it — but it is disabled while a
 * print is running, since the query shares the command queue with the print
 * moves. — MachineEndstopPanel.vue
 *
 * None of this is a claim that the actions should never exist. It is a claim
 * about which of them this build should own today; every one of them is a
 * small, local change once the user says so.
 */
const { breakpoint } = useBreakpoint()
</script>

<template>
    <div class="gap-dgap grid w-full grid-cols-12">
        <div :class="breakpoint === 'mobile' ? 'col-span-12' : 'col-span-6'" class="gap-dgap flex flex-col">
            <MachineConfigFilesPanel />
        </div>

        <div :class="breakpoint === 'mobile' ? 'col-span-12' : 'col-span-6'" class="gap-dgap flex flex-col">
            <KlippyStatePanel />
            <MachineSystemPanel />
            <MachineUpdatePanel />
            <MachineEndstopPanel />
            <MachineLogfilesPanel />
        </div>
    </div>
</template>
