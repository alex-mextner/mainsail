import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { useConnectionStore } from './connection'
import type { WebcamConfig } from '@/lib/webcam'

/**
 * The cameras Moonraker knows about.
 *
 * These live in the Moonraker database (namespace `webcams`), NOT in
 * printer.cfg, and Moonraker exposes them through `server.webcams.list`. That
 * is the same list the working Mainsail on port 80 reads, and this store only
 * ever reads it -- editing a camera is done in the interface the user prints
 * with, and a rewrite that silently rewrote those entries would be exactly the
 * kind of damage this fork is not allowed to do.
 *
 * The list is refetched whenever the socket comes back, because Moonraker's
 * `notify_webcams_changed` is the only push it sends and a reconnect can hide
 * one.
 */
export const useWebcamsStore = defineStore('webcams', () => {
    const connection = useConnectionStore()

    const all = ref<WebcamConfig[]>([])
    const loaded = ref(false)

    async function load() {
        const result = await connection
            .call<{ webcams?: WebcamConfig[] }>('server.webcams.list')
            .catch(() => null)

        if (!result) return

        all.value = result.webcams ?? []
        loaded.value = true
    }

    /** Disabled cameras are hidden upstream too -- the toggle means "not shown". */
    const webcams = computed(() => all.value.filter((webcam) => webcam.enabled !== false))

    const byName = (name: string): WebcamConfig | null =>
        webcams.value.find((webcam) => webcam.name === name) ?? null

    connection.onNotify((notification) => {
        if (notification.method === 'notify_webcams_changed') void load()
    })

    watch(
        () => connection.isConnected,
        (connected) => {
            if (connected) void load()
        },
        { immediate: true }
    )

    return { all, webcams, loaded, byName, load }
})
