<script setup lang="ts">
import { computed } from 'vue'
import { useStore } from 'vuex'
import { Thermometer } from 'lucide-vue-next'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import TemperatureRow from './TemperatureRow.vue'
import { useTemperatureHistory } from '@/composables/useTemperatureHistory'
import type { Heater } from '@/store/printer/types'
import type { RootState } from '@/store/types'

const store = useStore<RootState>()

const heaters = computed<Heater[]>(() => store.getters['printer/getHeaters'] ?? [])
const sensors = computed<Heater[]>(() => store.getters['printer/getSensors'] ?? [])
const all = computed<Heater[]>(() => [...heaters.value, ...sensors.value])

const { history } = useTemperatureHistory(all)

const connection = computed(() => store.getters['socket/getConnectionState'] as string)
const klippyState = computed(() => store.state.socket.klippyState as string | null)

const connectionBadge = computed(() => {
    if (connection.value !== 'connected') return { label: connection.value, variant: 'muted' as const }
    if (klippyState.value === 'ready') return { label: 'ready', variant: 'ok' as const }
    return { label: klippyState.value ?? 'unknown', variant: 'heating' as const }
})
</script>

<template>
    <Card>
        <CardHeader>
            <CardTitle class="flex items-center gap-2">
                <Thermometer class="text-muted-foreground size-4" />
                Temperature
            </CardTitle>
            <Badge :variant="connectionBadge.variant">{{ connectionBadge.label }}</Badge>
        </CardHeader>

        <CardContent>
            <p v-if="!all.length" class="text-muted-foreground py-6 text-center text-sm">
                {{ connection === 'connected' ? 'Waiting for Klipper objects…' : 'Connecting to Moonraker…' }}
            </p>

            <div v-else class="divide-border divide-y">
                <TemperatureRow
                    v-for="heater in heaters"
                    :key="heater.name"
                    :heater="heater"
                    :series="history[heater.name] ?? []" />

                <template v-if="sensors.length">
                    <p class="text-muted-foreground pt-4 pb-1 text-[11px] font-medium tracking-wide uppercase">
                        Sensors
                    </p>
                    <TemperatureRow
                        v-for="sensor in sensors"
                        :key="sensor.name"
                        :heater="sensor"
                        :series="history[sensor.name] ?? []" />
                </template>
            </div>
        </CardContent>
    </Card>
</template>
