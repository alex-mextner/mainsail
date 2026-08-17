<script setup lang="ts">
import { computed } from 'vue'
import { mdiThermometer } from '@mdi/js'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import MdiIcon from '@/components/ui/MdiIcon.vue'
import TemperatureRow from './TemperatureRow.vue'
import TemperatureChart from './TemperatureChart.vue'
import { usePrinterStore } from '@/stores/printer'
import { useConnectionStore } from '@/stores/connection'

const printer = usePrinterStore()
const connection = useConnectionStore()

const hasAny = computed(() => printer.allTemperatures.length > 0)
</script>

<template>
    <Card>
        <CardHeader>
            <CardTitle class="flex items-center gap-2">
                <MdiIcon :path="mdiThermometer" class="text-muted-foreground size-4" />
                Temperature
            </CardTitle>
        </CardHeader>

        <CardContent class="flex flex-col gap-dgap">
            <p v-if="!hasAny" class="text-muted-foreground py-6 text-center text-sm">
                {{ connection.isConnected ? 'Waiting for Klipper objects…' : 'Connecting to Moonraker…' }}
            </p>

            <template v-else>
                <div class="divide-border divide-y">
                    <TemperatureRow v-for="heater in printer.heaters" :key="heater.name" :heater="heater" />
                </div>

                <TemperatureChart />

                <div v-if="printer.sensors.length" class="divide-border divide-y border-t pt-2">
                    <p class="text-muted-foreground pt-1 pb-1 text-[11px] font-medium tracking-wide uppercase">
                        Sensors
                    </p>
                    <TemperatureRow v-for="sensor in printer.sensors" :key="sensor.name" :heater="sensor" />
                </div>
            </template>
        </CardContent>
    </Card>
</template>
