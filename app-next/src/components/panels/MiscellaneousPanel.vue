<script setup lang="ts">
import { computed } from 'vue'
import { mdiDipSwitch } from '@mdi/js'
import Panel from '@/components/ui/Panel.vue'
import MiscellaneousControl from './Miscellaneous/MiscellaneousControl.vue'
import MiscellaneousLight from './Miscellaneous/MiscellaneousLight.vue'
import FilamentSensorRow from './Miscellaneous/FilamentSensorRow.vue'
import SensorRow from './Miscellaneous/SensorRow.vue'
import { useMiscellaneous } from '@/composables/useMiscellaneous'
import { useSensorsStore } from '@/stores/sensors'
import { useConnectionStore } from '@/stores/connection'

/**
 * "Miscellaneous" -- Mainsail's `panels/MiscellaneousPanel.vue`.
 *
 * 🔴 THIS PANEL WAS ON NEITHER QUEUE, AND THAT WAS AN ENUMERATION GAP.
 * Queue 1 was "what this machine physically has" and queue 2 "what it does
 * not"; this panel was simply not listed in either, so "queue 1 closed" was
 * true only of the panels somebody had written down. It belongs firmly in
 * queue 1: on this machine it renders the RGB status strip (`[led rgb_strip]`),
 * the extruder-motor fan (`[controller_fan]`) and the three smoke-alarm pins
 * (`[output_pin siren]`, `siren_armed`, `smoke_alarm_active`) -- all real
 * hardware, and `siren_armed` in particular exists as an `[output_pin]` ONLY so
 * that Mainsail would draw a switch for it (smoke-alarm.cfg says so in as many
 * words, after the user asked where his toggle was). Without this panel the new
 * tree was a regression against port 80 for that switch.
 *
 * What lands here on this machine, and what does not:
 *   rendered  [led rgb_strip], [controller_fan extruder_motor_fan],
 *             [output_pin siren], [output_pin siren_armed],
 *             [output_pin smoke_alarm_active]
 *   elsewhere [temperature_fan electronics_fan] and [temperature_fan hotend_fan]
 *             -- they are in the temperature panel with their sensors, which is
 *             upstream's split and the right one; two homes would mean two
 *             different controls for one fan.
 *   absent    no [fan]: this machine has no part-cooling fan wired, and
 *             hotend-fan.cfg redefines M106/M107 to drive the hotend fan
 *             instead. Verified against the live object list, not assumed --
 *             so the first row of this panel is a controller fan, not the part
 *             fan upstream's sort expects to put there.
 */
const { controls, lights, filamentSensors, sensors } = useMiscellaneous()
const moonrakerSensors = useSensorsStore()
const connection = useConnectionStore()

const moonrakerRows = computed(() =>
    moonrakerSensors.names.map((name) => {
        const sensor = moonrakerSensors.sensors[name]
        return {
            key: `moonraker:${name}`,
            // Moonraker falls back to the section name when no friendly name is
            // configured, so an unchanged one is not worth showing twice.
            title: sensor.friendly_name && sensor.friendly_name !== name ? sensor.friendly_name : name,
            values: Object.entries(sensor.values ?? {}).map(([label, value]) => ({
                label,
                value,
                unit: moonrakerSensors.unitOf(name, label),
            })),
        }
    })
)

/**
 * Upstream hides the whole panel when there is nothing in it -- kept, because
 * an empty card on the dashboard is worse than no card. It stays hidden while
 * Klippy is not ready for the same reason: the object bag is empty then, so
 * "nothing fitted" and "nothing known yet" would look identical.
 */
const hasContent = computed(
    () =>
        connection.klippyState === 'ready' &&
        (controls.value.length > 0 ||
            lights.value.length > 0 ||
            filamentSensors.value.length > 0 ||
            sensors.value.length > 0 ||
            moonrakerRows.value.length > 0)
)

/** One divider between neighbours, never a leading or trailing one. */
const rows = computed(() => [
    ...controls.value.map((entry) => ({ kind: 'control' as const, key: entry.key, entry })),
    ...lights.value.map((light) => ({ kind: 'light' as const, key: light.key, light })),
    ...filamentSensors.value.map((sensor) => ({ kind: 'filament' as const, key: sensor.key, sensor })),
    ...sensors.value.map((sensor) => ({
        kind: 'sensor' as const,
        key: sensor.key,
        title: sensor.name,
        values: [{ label: sensor.name, value: sensor.value, unit: sensor.unit }],
    })),
    ...moonrakerRows.value.map((row) => ({ kind: 'sensor' as const, ...row })),
])
</script>

<template>
    <Panel v-if="hasContent" panel-name="miscellaneous" title="Miscellaneous" :icon="mdiDipSwitch" collapsible>
        <div class="divide-border flex flex-col divide-y">
            <template v-for="row in rows" :key="row.key">
                <MiscellaneousControl v-if="row.kind === 'control'" :entry="row.entry" />
                <MiscellaneousLight v-else-if="row.kind === 'light'" :light="row.light" />
                <FilamentSensorRow v-else-if="row.kind === 'filament'" :sensor="row.sensor" />
                <SensorRow v-else :title="row.title" :values="row.values" />
            </template>
        </div>
    </Panel>
</template>
