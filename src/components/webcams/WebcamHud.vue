<template>
    <div class="webcam-hud" :class="`webcam-hud--${layout}`">
        <div class="webcam-hud__info">
            <div class="webcam-hud__head">
                <v-icon small class="mr-2">{{ mdiFileOutline }}</v-icon>
                <span class="webcam-hud__filename">{{ filename || $t('Panels.WebcamPanel.Hud.NoFile') }}</span>
                <span class="webcam-hud__state">{{ stateLabel }}</span>
            </div>

            <div v-if="showProgress" class="webcam-hud__progress">
                <v-progress-linear :value="progress" height="6" rounded background-color="rgba(255, 255, 255, 0.15)" />
                <span class="webcam-hud__progress-value">{{ progress.toFixed(0) }} %</span>
            </div>
        </div>

        <div class="webcam-hud__stats" data-overcam-stats>
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

        <!--
            Between the readings and the chart, which in a docked bar is the vertical middle -
            and, since the bar became the sum of both letterbox strips, the empty half of it.
            Floating over the image the tile is left out on purpose: that card is 420px wide and
            sits ON the picture, so a model there would cover the very thing being watched.
        -->
        <!--
            v-show and NOT v-if, which is the difference between one download and
            one per button press. Undocking destroys the tile under v-if, and a
            re-docked tile starts from nothing: engine rebuilt, 4 MB of g-code
            pulled off the printer's SD card again. Measured on the live build -
            ten dock/undock cycles cost eleven downloads. Hidden with `display:
            none` the box measures 0, so the tile stops drawing by its own floor
            rule and the scene simply waits.
        -->
        <webcam-hud-model v-show="showModel" class="webcam-hud__model" />

        <webcam-hud-chart v-if="showChart" class="webcam-hud__chart" data-overcam-chart :height="chartHeight" />
    </div>
</template>

<script lang="ts">
import Component from 'vue-class-component'
import { Mixins, Prop } from 'vue-property-decorator'
import BaseMixin from '@/components/mixins/base'
import WebcamHudChart from '@/components/webcams/WebcamHudChart.vue'
import WebcamHudModel from '@/components/webcams/WebcamHudModel.vue'
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
    components: { WebcamHudChart, WebcamHudModel },
})
export default class WebcamHud extends Mixins(BaseMixin) {
    mdiFileOutline = mdiFileOutline

    // 'floating' = card on top of the image, 'vertical' = docked into a side bar,
    // 'horizontal' = docked into a top/bottom bar
    @Prop({ type: String, default: 'floating' }) declare readonly layout: string
    @Prop({ type: Number, default: 110 }) declare readonly chartHeight: number
    @Prop({ type: Boolean, default: true }) declare readonly showChart: boolean
    @Prop({ type: Boolean, default: false }) declare readonly showModel: boolean

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
    display: flex;
    flex-direction: column;
    padding: 12px 16px 4px;
    border-radius: 8px;
    color: #fff;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    box-shadow: 0 2px 18px rgba(0, 0, 0, 0.45);
}

/*
 * docked into one of the black bars next to the image. there is no image behind the hud in
 * that case, so it does not need its own scrim - and the shadow would only smear onto the
 * black bar.
 */
.webcam-hud--vertical,
.webcam-hud--horizontal {
    height: 100%;
    border-radius: 0;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: none;
    box-shadow: none;
}

/* side bar: a column, the chart is pushed to the bottom so the card fills the bar */
.webcam-hud--vertical .webcam-hud__stats {
    gap: 10px 12px;
}

.webcam-hud--vertical .webcam-hud__chart {
    margin-top: auto;
}

/* the tile eats the gap that `margin-top: auto` used to leave between the readings and the
   chart - it grows into whatever is left and never pushes either of them around */
.webcam-hud--vertical .webcam-hud__model {
    flex: 1 1 auto;
    min-height: 0;
}

/* in a letterbox row there is no vertical middle to speak of: the tile becomes a square as
   tall as the row, parked between the readings and the chart. It only appears at all above
   webcamHudMinRowModelWidth, so it can never squeeze the numbers onto a second line. */
.webcam-hud--horizontal .webcam-hud__model {
    flex: 0 0 auto;
    align-self: stretch;
    aspect-ratio: 1;
    margin: 0;
    max-width: 40%;
}

/* top/bottom bar: one row - info, then the numbers, then the chart on the right */
.webcam-hud--horizontal {
    flex-direction: row;
    align-items: center;
    gap: 4px 24px;
    padding: 8px 16px;
}

.webcam-hud--horizontal .webcam-hud__info {
    flex: 0 1 260px;
    min-width: 0;
    margin-bottom: 0;
}

.webcam-hud--horizontal .webcam-hud__stats {
    flex: 1 1 auto;
    justify-content: space-around;
}

.webcam-hud--horizontal .webcam-hud__chart {
    flex: 0 1 340px;
    min-width: 160px;
    margin-top: 0;
}

.webcam-hud--horizontal .webcam-hud__progress {
    margin-bottom: 0;
}

.webcam-hud__info {
    margin-bottom: 2px;
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
