import { cva, type VariantProps } from 'class-variance-authority'

export { default as Badge } from './Badge.vue'

export const badgeVariants = cva(
    'inline-flex items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 transition-colors',
    {
        variants: {
            variant: {
                default: 'border-transparent bg-primary text-primary-foreground',
                secondary: 'border-transparent bg-secondary text-secondary-foreground',
                destructive: 'border-transparent bg-destructive text-destructive-foreground',
                outline: 'text-foreground',
                // Domain variants: heating / at-target / idle, used by the
                // temperature panel so state reads without parsing numbers.
                heating: 'border-transparent bg-warn/15 text-warn',
                ok: 'border-transparent bg-ok/15 text-ok',
                muted: 'border-transparent bg-muted text-muted-foreground',
            },
        },
        defaultVariants: { variant: 'default' },
    }
)

export type BadgeVariants = VariantProps<typeof badgeVariants>
