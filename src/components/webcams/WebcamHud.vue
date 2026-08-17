<template>
    <div class="webcam-hud">
        <div class="webcam-hud__head">
            <v-icon small class="mr-2">{{ mdiFileOutline }}</v-icon>
            <span class="webcam-hud__filename">{{ filename || $t('Panels.WebcamPanel.Hud.NoFile') }}</span>
            <span class="webcam-hud__state">{{ stateLabel }}</span>
        </div>

        <div v-if="showProgress" class="webcam-hud__progress">
            <v-progress-linear :value="progress" height="6" rounded background-color="rgba(255, 255, 255, 0.15)" />
            <span class="webcam-hud__progress-value">{{ progress.toFixed(0) }} %</span>
        </div>

        <div class="webcam-hud__stats">
            <div v-for="heater in heaters" :key="heater.key" class="webcam-hud__stat">
                <span class="webcam-hud__label">
                    <span class="webcam-hud__dot" :style="{ backgroundColor: heater.color }"></span>
                    {{ heater.label }}
                </span>
                <span class="webcam-hud__value">
                    {{ heater.temperature }}
                    <small class="webcam-hud__unit">/ {{ heater.target }} °C</small>
                </span>
            </div>
            <div class="webcam-hud__stat">
                <span class="webcam-hud__label">{{ $t('Panels.WebcamPanel.Hud.Layer') }}</span>
                <span class="webcam-hud__value">{{ layerOutput }}</span>
            </div>
            <div class="webcam-hud__stat">
                <span class="webcam-hud__label">{{ $t('Panels.WebcamPanel.Hud.Speed') }}</span>
                <span class="webcam-hud__value">
                    {{ speed }}
                    <small class="webcam-hud__unit">mm/s</small>
                </span>
            </div>
            <div class="webcam-hud__stat">
                <span class="webcam-hud__label">{{ $t('Panels.WebcamPanel.Hud.Remaining') }}</span>
                <span class="webcam-hud__value">{{ remainingOutput }}</span>
            </div>
            <div class="webcam-hud__stat">
                <span class="webcam-hud__label">{{ $t('Panels.WebcamPanel.Hud.ETA') }}</span>
                <span class="webcam-hud__value">{{ etaOutput }}</span>
            </div>
        </div>

        <webcam-hud-chart class="webcam-hud__chart" />
    </div>
</template>

<script lang="ts">
import Component from 'vue-class-component'
import { Mixins } from 'vue-property-decorator'
import BaseMixin from '@/components/mixins/base'
import WebcamHudChart from '@/components/webcams/WebcamHudChart.vue'
import { mdiFileOutline } from '@mdi/js'
import { colorArray, colorHeaterBed } from '@/store/variables'

interface WebcamHudHeater {
    key: string
    label: string
    color: string
    temperature: string
    target: string
}

@Component({
    components: { WebcamHudChart },
})
export default class WebcamHud extends Mixins(BaseMixin) {
    mdiFileOutline = mdiFileOutline

    get filename() {
        return this.$store.state.printer.print_stats?.filename ?? ''
    }

    // same wording as the status panel headline: the raw klipper state, capitalized
    get stateLabel() {
        if (this.printer_state === '') return this.$t('Panels.StatusPanel.Unknown')

        return this.printer_state.charAt(0).toUpperCase() + this.printer_state.slice(1)
    }

    get showProgress() {
        return ['printing', 'paused'].includes(this.printer_state)
    }

    get progress() {
        return (this.$store.getters['printer/getPrintPercent'] ?? 0) * 100
    }

    get heaters(): WebcamHudHeater[] {
        const output: WebcamHudHeater[] = []

        const extruder = this.$store.state.printer.extruder
        if (extruder) {
            output.push({
                key: 'extruder',
                label: this.$t('Panels.WebcamPanel.Hud.Nozzle').toString(),
                color: this.$store.getters['printer/tempHistory/getDatasetColor']('extruder') ?? colorArray[0],
                temperature: (extruder.temperature ?? 0).toFixed(0),
                target: (extruder.target ?? 0).toFixed(0),
            })
        }

        const heaterBed = this.$store.state.printer.heater_bed
        if (heaterBed) {
            output.push({
                key: 'heater_bed',
                label: this.$t('Panels.WebcamPanel.Hud.Bed').toString(),
                color: this.$store.getters['printer/tempHistory/getDatasetColor']('heater_bed') ?? colorHeaterBed,
                temperature: (heaterBed.temperature ?? 0).toFixed(0),
                target: (heaterBed.target ?? 0).toFixed(0),
            })
        }

        return output
    }

    get layerOutput() {
        const maxLayers = this.$store.getters['printer/getPrintMaxLayers'] ?? 0
        if (!maxLayers) return '--'

        const currentLayer = this.$store.getters['printer/getPrintCurrentLayer'] ?? 0

        return `${currentLayer} / ${maxLayers}`
    }

    get speed() {
        const liveVelocity = this.$store.state.printer.motion_report?.live_velocity
        if (typeof liveVelocity !== 'number') return '--'

        return Math.abs(liveVelocity).toFixed(0)
    }

    get remainingOutput() {
        const estimatedTime = this.$store.getters['printer/getEstimatedTimeAvg'] ?? 0
        if (!estimatedTime || !this.showProgress) return '--'

        const hours = Math.floor(estimatedTime / 3600)
        const minutes = ('0' + Math.floor((estimatedTime % 3600) / 60)).slice(-2)

        return `${hours}:${minutes}`
    }

    get etaOutput() {
        if (!this.showProgress) return '--'

        return this.$store.getters['printer/getEstimatedTimeETAFormat'] || '--'
    }
}
</script>

<style scoped>
.webcam-hud {
    padding: 12px 16px 4px;
    border-radius: 8px;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    box-shadow: 0 2px 18px rgba(0, 0, 0, 0.45);
}

.webcam-hud__head {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
}

.webcam-hud__head .v-icon {
    color: rgba(255, 255, 255, 0.6);
}

.webcam-hud__filename {
    flex: 1 1 auto;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.85rem;
    color: rgba(255, 255, 255, 0.75);
}

.webcam-hud__state {
    flex: 0 0 auto;
    margin-left: 12px;
    padding: 1px 8px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.12);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

.webcam-hud__progress {
    display: flex;
    align-items: center;
    margin-bottom: 10px;
}

.webcam-hud__progress-value {
    flex: 0 0 auto;
    margin-left: 10px;
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
}

.webcam-hud__stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 24px;
}

.webcam-hud__stat {
    display: flex;
    flex-direction: column;
    min-width: 78px;
}

.webcam-hud__label {
    display: flex;
    align-items: center;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(255, 255, 255, 0.6);
}

.webcam-hud__dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 5px;
    border-radius: 50%;
}

.webcam-hud__value {
    font-size: 1.15rem;
    line-height: 1.3;
    font-variant-numeric: tabular-nums;
}

.webcam-hud__unit {
    font-size: 0.7rem;
    color: rgba(255, 255, 255, 0.6);
}

.webcam-hud__chart {
    margin-top: 4px;
}
</style>
