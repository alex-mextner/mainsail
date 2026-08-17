<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Card, CardContent } from '@/components/ui/card'
import type { AppRouteMeta } from '@/router'

const route = useRoute()
const title = computed(() => (route.meta as AppRouteMeta | undefined)?.title ?? 'Page')
</script>

<template>
    <Card>
        <CardContent class="py-16 text-center">
            <h2 class="text-lg font-semibold">{{ title }}</h2>
            <p class="text-muted-foreground mx-auto mt-2 max-w-prose text-sm">
                Not rewritten yet. This route exists in Mainsail and will be ported; it is listed here rather than
                hidden so the navigation shows the real remaining scope instead of pretending to be complete.
            </p>
        </CardContent>
    </Card>
</template>
