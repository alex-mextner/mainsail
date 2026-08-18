/**
 * `klipper-led_effect` effects, which this machine does not have.
 *
 * The plugin is a third-party Klipper extra; there are no `[led_effect]`
 * sections in printer-configs/ and Klipper publishes no such object, so the
 * panel is invisible against the live printer -- by design, that is exactly
 * what it does when the plugin is absent.
 *
 * Names are the ones the plugin's own documentation uses, so anyone who has
 * seen a real installation recognises the panel. One of them is RUNNING
 * (`enabled: true`), because the running state is a different button colour and
 * a different command (`SET_LED_EFFECT ... STOP=1` rather than plain), and a
 * fixture where everything is off exercises neither.
 *
 * `_startup` is here to be INVISIBLE: leading-underscore effects are internal
 * helpers and must not get a button, the same rule as macros. A fixture that
 * only contains things that should appear cannot catch a filter that stopped
 * filtering.
 */
export const ledEffectsFixture = {
    'led_effect critical_error': { enabled: false },
    'led_effect heating': { enabled: true },
    'led_effect printing': { enabled: false },
    'led_effect standby': { enabled: false },
    'led_effect _startup': { enabled: false },

    configfile: {
        settings: {
            'led_effect critical_error': { leds: 'neopixel:chamber_bar', autostart: false, frame_rate: 24 },
            'led_effect heating': { leds: 'neopixel:chamber_bar', autostart: false, frame_rate: 24 },
            'led_effect printing': { leds: 'neopixel:chamber_bar', autostart: false, frame_rate: 24 },
            'led_effect standby': { leds: 'neopixel:chamber_bar', autostart: true, frame_rate: 24 },
            'led_effect _startup': { leds: 'neopixel:chamber_bar', autostart: true, frame_rate: 24 },
        },
    },
}
