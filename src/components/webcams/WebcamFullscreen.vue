<template>
    <v-dialog
        v-model="show"
        fullscreen
        hide-overlay
        transition="fade-transition"
        content-class="webcam-fullscreen-dialog">
        <div ref="container" class="webcam-fullscreen">
            <div class="webcam-fullscreen__stream">
                <webcam-wrapper v-if="show" :webcam="webcam" :show-fps="false" page="fullscreen" />
            </div>

            <div class="webcam-fullscreen__actions">
                <v-btn icon dark :title="hudButtonTitle" @click="showHud = !showHud">
                    <v-icon>{{ showHud ? mdiEyeOffOutline : mdiEyeOutline }}</v-icon>
                </v-btn>
                <v-btn
                    v-if="browserFullscreenSupported"
                    icon
                    dark
                    :title="$t('Panels.WebcamPanel.Hud.Fullscreen')"
                    @click="toggleBrowserFullscreen">
                    <v-icon>{{ isBrowserFullscreen ? mdiFullscreenExit : mdiFullscreen }}</v-icon>
                </v-btn>
                <v-btn icon dark :title="$t('Panels.WebcamPanel.Hud.Close')" @click="show = false">
                    <v-icon>{{ mdiClose }}</v-icon>
                </v-btn>
            </div>

            <transition name="fade-transition">
                <webcam-hud v-if="showHud" class="webcam-fullscreen__hud" />
            </transition>
        </div>
    </v-dialog>
</template>

<script lang="ts">
import Component from 'vue-class-component'
import { Mixins, Prop, Ref, Watch } from 'vue-property-decorator'
import BaseMixin from '@/components/mixins/base'
import WebcamWrapper from '@/components/webcams/WebcamWrapper.vue'
import WebcamHud from '@/components/webcams/WebcamHud.vue'
import { GuiWebcamStateWebcam } from '@/store/gui/webcams/types'
import { mdiClose, mdiEyeOffOutline, mdiEyeOutline, mdiFullscreen, mdiFullscreenExit } from '@mdi/js'

@Component({
    components: { WebcamHud, WebcamWrapper },
})
export default class WebcamFullscreen extends Mixins(BaseMixin) {
    mdiClose = mdiClose
    mdiEyeOutline = mdiEyeOutline
    mdiEyeOffOutline = mdiEyeOffOutline
    mdiFullscreen = mdiFullscreen
    mdiFullscreenExit = mdiFullscreenExit

    @Prop({ type: Boolean, default: false }) declare readonly value: boolean
    @Prop({ type: Object, required: true }) declare readonly webcam: GuiWebcamStateWebcam

    @Ref('container') readonly container!: HTMLDivElement

    showHud = true
    isBrowserFullscreen = false

    get show() {
        return this.value
    }

    set show(newVal: boolean) {
        this.$emit('input', newVal)
    }

    get hudButtonTitle() {
        return this.showHud ? this.$t('Panels.WebcamPanel.Hud.HideHud') : this.$t('Panels.WebcamPanel.Hud.ShowHud')
    }

    get browserFullscreenSupported() {
        return typeof document !== 'undefined' && document.fullscreenEnabled
    }

    mounted() {
        document.addEventListener('fullscreenchange', this.fullscreenChanged)
    }

    beforeDestroy() {
        document.removeEventListener('fullscreenchange', this.fullscreenChanged)
    }

    fullscreenChanged() {
        this.isBrowserFullscreen = document.fullscreenElement !== null
    }

    async toggleBrowserFullscreen() {
        try {
            if (document.fullscreenElement === null) await this.container?.requestFullscreen()
            else await document.exitFullscreen()
        } catch {
            // the browser may refuse fullscreen (permission policy, ios safari). the dialog
            // itself already covers the viewport, so this is only a nice-to-have.
        }
    }

    // leave the browser fullscreen behind when the overlay is closed
    @Watch('show')
    showChanged(newVal: boolean) {
        if (newVal || document.fullscreenElement === null) return

        document.exitFullscreen().catch(() => {
            /* ignore */
        })
    }
}
</script>

<style scoped>
.webcam-fullscreen {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100vh;
    height: 100dvh;
    background: #000;
}

.webcam-fullscreen__stream {
    width: 100%;
    height: 100%;
}

/*
 * the streamer components cap themselves at `calc(100vh - 155px)` to leave room for the
 * dashboard around them. in the fullscreen overlay there is nothing else on screen, so the
 * image is allowed to use the full viewport. !important is needed because the streamer sets
 * that cap from its own scoped style with the same specificity.
 */
.webcam-fullscreen__stream ::v-deep .webcamBackground {
    max-height: 100vh !important;
    max-height: 100dvh !important;
    height: 100vh;
    height: 100dvh;
    background: transparent;
}

.webcam-fullscreen__stream ::v-deep .webcamImage {
    width: 100%;
    height: 100vh;
    height: 100dvh;
    /* never crop the print: letterbox instead */
    object-fit: contain;
}

.webcam-fullscreen__actions {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    padding: 2px;
    border-radius: 24px;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(6px);
}

.webcam-fullscreen__hud {
    position: absolute;
    right: 12px;
    bottom: 12px;
    left: 12px;
    max-width: 720px;
    margin: 0 auto;
}

@media (min-width: 960px) {
    .webcam-fullscreen__hud {
        right: auto;
        left: 16px;
        bottom: 16px;
        width: 420px;
        margin: 0;
    }
}
</style>
