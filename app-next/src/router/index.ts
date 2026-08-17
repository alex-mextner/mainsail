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
        component: () => import('@/pages/PlaceholderPage.vue'),
        meta: {
            title: 'Webcam',
            icon: mdiWebcam,
            showInNavi: true,
            ported: false,
            position: 20,
        } satisfies AppRouteMeta,
    },
    {
        name: 'console',
        path: '/console',
        component: () => import('@/pages/PlaceholderPage.vue'),
        meta: {
            title: 'Console',
            icon: mdiConsoleLine,
            showInNavi: true,
            ported: false,
            position: 30,
        } satisfies AppRouteMeta,
    },
    {
        name: 'heightmap',
        path: '/heightmap',
        component: () => import('@/pages/PlaceholderPage.vue'),
        meta: {
            title: 'Heightmap',
            icon: mdiGrid,
            showInNavi: true,
            ported: false,
            position: 40,
        } satisfies AppRouteMeta,
    },
    {
        name: 'files',
        path: '/files',
        component: () => import('@/pages/PlaceholderPage.vue'),
        meta: {
            title: 'G-Code Files',
            icon: mdiFileDocumentMultipleOutline,
            showInNavi: true,
            ported: false,
            position: 50,
        } satisfies AppRouteMeta,
    },
    {
        name: 'history',
        path: '/history',
        component: () => import('@/pages/PlaceholderPage.vue'),
        meta: {
            title: 'History',
            icon: mdiHistory,
            showInNavi: true,
            ported: false,
            position: 60,
        } satisfies AppRouteMeta,
    },
    {
        name: 'machine',
        path: '/machine',
        component: () => import('@/pages/PlaceholderPage.vue'),
        meta: {
            title: 'Machine',
            icon: mdiWrench,
            showInNavi: true,
            ported: false,
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
