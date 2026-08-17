<template>
    <webcam-fullscreen v-if="currentCam" :webcam="currentCam" @close="close" />
    <div v-else class="text-center py-6">
        <p class="mb-0 text--disabled">{{ $t('Panels.WebcamPanel.NoWebcam') }}</p>
    </div>
</template>

<script lang="ts">
import Component from 'vue-class-component'
import { Mixins } from 'vue-property-decorator'
import BaseMixin from '@/components/mixins/base'
import WebcamFullscreen from '@/components/webcams/WebcamFullscreen.vue'
import { GuiWebcamStateWebcam } from '@/store/gui/webcams/types'
import { mdiViewGrid } from '@mdi/js'
import { Route } from 'vue-router'

@Component({
    components: { WebcamFullscreen },
})
export default class PageOvercam extends Mixins(BaseMixin) {
    // set by beforeRouteEnter: false when the page was opened directly (bookmark, reload),
    // in which case there is no history entry of ours to go back to
    cameFromApp = false

    get webcams(): GuiWebcamStateWebcam[] {
        return this.$store.getters['gui/webcams/getWebcams']
    }

    get routeCamName(): string | null {
        const name = this.$route.params.name
        return typeof name === 'string' && name.length ? name : null
    }

    get currentCam(): GuiWebcamStateWebcam | null {
        if (!this.webcams.length) return null

        // /overcam/<name> always wins, so a bookmarked link points at a specific camera
        if (this.routeCamName) {
            const named = this.webcams.find((webcam) => webcam.name === this.routeCamName)
            if (named) return named
        }

        if (this.webcams.length === 1) return this.webcams[0]

        // several cameras and no name given: show them all, like the panel does
        return {
            name: this.$t('Panels.WebcamPanel.All').toString(),
            service: 'grid',
            icon: mdiViewGrid,
        } as GuiWebcamStateWebcam
    }

    beforeRouteEnter(_to: Route, from: Route, next: (cb?: (vm: PageOvercam) => void) => void) {
        next((vm: PageOvercam) => {
            vm.cameFromApp = from.name !== null && from.name !== undefined
        })
    }

    close() {
        if (this.cameFromApp) {
            this.$router.back()
            return
        }

        this.$router.push('/')
    }
}
</script>
