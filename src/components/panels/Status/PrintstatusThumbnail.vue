<template>
    <div v-if="current_filename" class="statusPanel-printstatus-thumbnail">
        <div
            v-if="boolBigThumbnail"
            class="statusPanel-big-thumbnail"
            :class="{ 'statusPanel-big-thumbnail--zoomable': printstatusThumbnailZoom }"
            :tabindex="printstatusThumbnailZoom ? -1 : false"
            :style="thumbnailStyle"
            @focus="focus = true"
            @blur="focus = false">
            <div class="statusPanel-big-thumbnail__backdrop" :style="backdropStyle"></div>
            <v-img :src="thumbnailBig" contain height="100%" class="d-flex align-end statusPanel-big-thumbnail__image">
                <v-card-title class="white--text py-2 px-2" :style="styleThumbnailOverlay">
                    <v-row>
                        <v-col>
                            <span class="subtitle-2 text-truncate px-0 text--disabled d-block">
                                <v-icon small class="mr-2">{{ mdiFileOutline }}</v-icon>
                                {{ current_filename }}
                            </span>
                        </v-col>
                    </v-row>
                </v-card-title>
            </v-img>
        </div>
        <template v-else>
            <v-container>
                <v-row>
                    <v-col
                        :class="thumbnailSmall ? 'py-3' : 'py-2'"
                        :style="thumbnailSmall ? 'width: calc(100% - 40px);' : ''">
                        <span class="subtitle-2 text-truncate d-block px-0 text--disabled">
                            <v-icon small class="mr-2">{{ mdiFileOutline }}</v-icon>
                            {{ current_filename }}
                        </span>
                    </v-col>
                    <v-col v-if="thumbnailSmall" class="pa-2 pl-0 col-auto">
                        <template v-if="thumbnailSmall && thumbnailBig">
                            <v-tooltip top content-class="tooltip__content-opacity1">
                                <template #activator="{ on, attrs }">
                                    <vue-load-image class="d-flex">
                                        <img
                                            slot="image"
                                            :src="thumbnailSmall"
                                            width="32"
                                            height="32"
                                            :alt="current_filename"
                                            v-bind="attrs"
                                            v-on="on" />
                                        <div slot="preloader">
                                            <v-progress-circular indeterminate color="primary" />
                                        </div>
                                        <div slot="error">
                                            <v-icon>{{ mdiFile }}</v-icon>
                                        </div>
                                    </vue-load-image>
                                </template>
                                <span><img :src="thumbnailBig" width="250" :alt="current_filename" /></span>
                            </v-tooltip>
                        </template>
                        <template v-else-if="thumbnailSmall">
                            <vue-load-image>
                                <img
                                    slot="image"
                                    :src="thumbnailSmall"
                                    width="32"
                                    height="32"
                                    :alt="current_filename" />
                                <div slot="preloader">
                                    <v-progress-circular indeterminate color="primary" />
                                </div>
                                <div slot="error">
                                    <v-icon>{{ mdiFile }}</v-icon>
                                </div>
                            </vue-load-image>
                        </template>
                    </v-col>
                </v-row>
            </v-container>
        </template>
    </div>
</template>

<script lang="ts">
import Component from 'vue-class-component'
import { Mixins } from 'vue-property-decorator'
import BaseMixin from '@/components/mixins/base'
import {
    defaultBigThumbnailBackground,
    thumbnailBigMaxHeight,
    thumbnailBigMin,
    thumbnailSmallMax,
    thumbnailSmallMin,
} from '@/store/variables'
import { mdiFileOutline, mdiFile } from '@mdi/js'
import { escapePath } from '@/plugins/helpers'
import { FileStateFileThumbnail } from '@/store/files/types'

@Component({})
export default class StatusPanelPrintstatusThumbnail extends Mixins(BaseMixin) {
    mdiFileOutline = mdiFileOutline
    mdiFile = mdiFile

    focus = false

    get current_filename() {
        return this.$store.state.printer.print_stats?.filename ?? ''
    }

    get current_file() {
        return this.$store.state.printer.current_file ?? {}
    }

    get thumbnailBig() {
        if ('thumbnails' in this.current_file && this.current_file.thumbnails.length) {
            const thumbnail = this.current_file.thumbnails.find(
                (thumb: FileStateFileThumbnail) => thumb.width >= thumbnailBigMin
            )

            if (thumbnail && 'relative_path' in thumbnail) {
                let relative_url = ''
                if (this.current_file.filename.lastIndexOf('/') !== -1) {
                    relative_url = this.current_file.filename.substr(0, this.current_file.filename.lastIndexOf('/') + 1)
                }

                if (thumbnail && 'relative_path' in thumbnail) {
                    return `${this.apiUrl}/server/files/gcodes/${escapePath(
                        relative_url + thumbnail.relative_path
                    )}?timestamp=${this.current_file.modified}`
                }
            }
        }

        return ''
    }

    get thumbnailBigHeight() {
        if ('thumbnails' in this.current_file && this.current_file.thumbnails.length) {
            const thumbnail = this.current_file.thumbnails.find(
                (thumb: FileStateFileThumbnail) => thumb.width >= thumbnailBigMin
            )

            if (thumbnail && 'height' in thumbnail) {
                return thumbnail.height
            }
        }

        return 200
    }

    get thumbnailBigWidth() {
        if ('thumbnails' in this.current_file && this.current_file.thumbnails.length) {
            const thumbnail = this.current_file.thumbnails.find(
                (thumb: FileStateFileThumbnail) => thumb.width >= thumbnailBigMin
            )

            if (thumbnail && 'width' in thumbnail) {
                return thumbnail.width
            }
        }

        return 300
    }

    get thumbnailSmall() {
        if ('thumbnails' in this.current_file && this.current_file.thumbnails.length) {
            const thumbnail = this.current_file.thumbnails.find(
                (thumb: FileStateFileThumbnail) =>
                    thumb.width >= thumbnailSmallMin &&
                    thumb.width <= thumbnailSmallMax &&
                    thumb.height >= thumbnailSmallMin &&
                    thumb.height <= thumbnailSmallMax
            )

            if (thumbnail && 'relative_path' in thumbnail) {
                let relative_url = ''
                if (this.current_file.filename.lastIndexOf('/') !== -1) {
                    relative_url = this.current_file.filename.substr(0, this.current_file.filename.lastIndexOf('/') + 1)
                }

                if (thumbnail && 'relative_path' in thumbnail) {
                    return `${this.apiUrl}/server/files/gcodes/${escapePath(
                        relative_url + thumbnail.relative_path
                    )}?timestamp=${this.current_file.modified}`
                }
            }
        }

        return ''
    }

    get boolBigThumbnail() {
        const setting = this.$store.state.gui.uiSettings.boolBigThumbnail ?? true

        return this.current_filename && setting && this.thumbnailBig
    }

    get bigThumbnailBackground() {
        return this.$store.state.gui.uiSettings.bigThumbnailBackground ?? defaultBigThumbnailBackground
    }

    // the frame keeps the aspect ratio of the thumbnail itself, so the image inside can be
    // displayed with `contain` without ever being cropped and without empty letterbox bars.
    // only very tall thumbnails run into the height cap and get (correct) bars on the sides.
    get thumbnailStyle() {
        const output: { aspectRatio: string; maxHeight: string; backgroundColor?: string } = {
            aspectRatio: `${this.thumbnailBigWidth} / ${this.thumbnailBigHeight}`,
            maxHeight: `${thumbnailBigMaxHeight}px`,
        }

        // click/focus lifts the height cap, but never beyond the viewport
        if (this.printstatusThumbnailZoom && this.focus) output.maxHeight = '100vh'

        if (defaultBigThumbnailBackground.toLowerCase() !== this.bigThumbnailBackground.toLowerCase()) {
            output.backgroundColor = this.bigThumbnailBackground
        }

        return output
    }

    // blurred copy of the thumbnail, fills the free space next to a contained image
    get backdropStyle() {
        if (!this.thumbnailBig) return {}

        return { backgroundImage: `url("${this.thumbnailBig}")` }
    }

    get styleThumbnailOverlay() {
        const style = {
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            backdropFilter: 'blur(3px)',
        }

        if (!this.$vuetify.theme.dark) {
            style.backgroundColor = 'rgba(255, 255, 255, 0.3)'
        }

        return style
    }

    get printstatusThumbnailZoom() {
        return this.$store.state.gui.uiSettings.printstatusThumbnailZoom ?? true
    }
}
</script>

<style scoped>
.statusPanel-printstatus-thumbnail {
    position: relative;
}

.statusPanel-big-thumbnail {
    position: relative;
    width: 100%;
    overflow: hidden;
    outline: none;
    transition: max-height 0.25s ease-out;
}

.statusPanel-big-thumbnail--zoomable {
    cursor: zoom-in;
}

.statusPanel-big-thumbnail--zoomable:focus {
    cursor: zoom-out;
}

.statusPanel-big-thumbnail__backdrop {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    background-position: center center;
    background-size: cover;
    filter: blur(20px);
    transform: scale(1.2);
    opacity: 0.35;
    pointer-events: none;
}

.statusPanel-big-thumbnail__image {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
}

.statusPanel-thumbnail-overlay {
    background-color: rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(3px);
}
</style>
