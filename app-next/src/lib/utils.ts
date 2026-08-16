import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn's class merge helper: conditional classes + Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}
