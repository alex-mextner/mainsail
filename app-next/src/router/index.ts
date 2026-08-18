import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import {
    mdiMonitorDashboard,
    mdiConsoleLine,
    mdiFileDocumentMultipleOutline,
    mdiHistory,
    mdiWrench,
    mdiWebcam,
    mdiCog,
    mdiGrid,
} from '@mdi/js'

/**
 * Navigation mirrors Mainsail's own (src/routes/index.ts): same names, same
 * paths, same order, so muscle memory carries over.
 *
 * `ported: false` marks a route whose panels have not been rewritten yet. It
 * renders an honest placeholder instead of being hidden -- hiding them would
 * misrepresent how much of Mainsail actually exists here.
 */
export interface AppRouteMeta extends Record<string | number | symbol, unknown> {
    title: string
    icon: string
    showInNavi: boolean
    ported: boolean
    position: number
    /**
     * Rendered WITHOUT the shell -- no top bar, no drawer, no page padding.
     * Optional so the nine ordinary routes need no edit. See App.vue.
     */
    fullscreen?: boolean
}

const routes: RouteRecordRaw[] = [
    {
        name: 'dashboard',
        path: '/',
        component: () => import('@/pages/DashboardPage.vue'),
        meta: {
            title: 'Dashboard',
            icon: mdiMonitorDashboard,
            showInNavi: true,
            ported: true,
            position: 10,
        } satisfies AppRouteMeta,
    },
    {
        name: 'webcam',
        path: '/cam',
        component: () => import('@/pages/WebcamPage.vue'),
        meta: {
            title: 'Webcam',
            icon: mdiWebcam,
            showInNavi: true,
            ported: true,
            position: 20,
        } satisfies AppRouteMeta,
    },
    {
        /**
         * Fullscreen camera with the hud on top. Deliberately NOT in the
         * navigation: the sidebar already has "Webcam" for the same camera, and
         * this route is reached from the expand button and meant to be
         * bookmarked / opened directly.
         */
        name: 'overcam',
        path: '/overcam/:name?',
        component: () => import('@/pages/OvercamPage.vue'),
        meta: {
            title: 'Webcam',
            icon: mdiWebcam,
            showInNavi: false,
            ported: true,
            position: 21,
            fullscreen: true,
        } satisfies AppRouteMeta,
    },
    {
        name: 'console',
        path: '/console',
        component: () => import('@/pages/ConsolePage.vue'),
        meta: {
            title: 'Console',
            icon: mdiConsoleLine,
            showInNavi: true,
            ported: true,
            position: 30,
        } satisfies AppRouteMeta,
    },
    {
        name: 'heightmap',
        path: '/heightmap',
        component: () => import('@/pages/HeightmapPage.vue'),
        meta: {
            title: 'Heightmap',
            icon: mdiGrid,
            showInNavi: true,
            /**
             * True: the route renders the real panels. It renders an honest
             * "this printer has no [bed_mesh] section" on THIS machine, which
             * is a state of the machine, not of the port. See HeightmapPage.vue.
             */
            ported: true,
            position: 40,
        } satisfies AppRouteMeta,
    },
    {
        name: 'files',
        path: '/files',
        component: () => import('@/pages/FilesPage.vue'),
        meta: {
            title: 'G-Code Files',
            icon: mdiFileDocumentMultipleOutline,
            showInNavi: true,
            ported: true,
            position: 50,
        } satisfies AppRouteMeta,
    },
    {
        name: 'history',
        path: '/history',
        component: () => import('@/pages/HistoryPage.vue'),
        meta: {
            title: 'History',
            icon: mdiHistory,
            showInNavi: true,
            ported: true,
            position: 60,
        } satisfies AppRouteMeta,
    },
    {
        name: 'machine',
        path: '/machine',
        component: () => import('@/pages/MachinePage.vue'),
        meta: {
            title: 'Machine',
            icon: mdiWrench,
            showInNavi: true,
            /**
             * True, with a caveat recorded in MachinePage.vue: every panel is
             * ported, but the actions that CHANGE the machine (config saving,
             * starting updates, host reboot/shutdown, service restarts, log
             * rollover) are deliberately absent. `ported` tracks whether the
             * route renders the real thing rather than a placeholder, and it
             * does.
             */
            ported: true,
            position: 90,
        } satisfies AppRouteMeta,
    },
    {
        name: 'settings',
        path: '/settings',
        component: () => import('@/pages/SettingsPage.vue'),
        meta: {
            title: 'Settings',
            icon: mdiCog,
            showInNavi: true,
            ported: true,
            position: 100,
        } satisfies AppRouteMeta,
    },
    {
        name: 'not-found',
        path: '/:pathMatch(.*)*',
        component: () => import('@/pages/PlaceholderPage.vue'),
        meta: {
            title: 'Not found',
            icon: mdiWrench,
            showInNavi: false,
            ported: false,
            position: 999,
        } satisfies AppRouteMeta,
    },
]

export const naviRoutes = routes
    .filter((route) => (route.meta as AppRouteMeta | undefined)?.showInNavi)
    .sort((a, b) => (a.meta as AppRouteMeta).position - (b.meta as AppRouteMeta).position)

export const router = createRouter({
    history: createWebHistory(),
    routes,
})
