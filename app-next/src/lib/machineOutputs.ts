/**
 * Output pins this machine publishes but must not be switched from the UI.
 *
 * 🔴 WHY THIS IS A HARD-CODED LIST AND NOT DERIVED FROM THE CONFIG
 * ---------------------------------------------------------------
 * Every other "do not offer what this machine cannot do" decision in this port
 * is read out of the live config: no `[bed_mesh]` section, so no Calibrate
 * button; no `[quad_gantry_level]`, so no levelling menu. Klipper publishes
 * nothing that distinguishes the case below, because to Klipper it IS an
 * ordinary `[output_pin]` -- it is what the pin MEANS on this machine that
 * makes a toggle wrong, and meaning is not in the object model.
 *
 * So this is data, kept in one greppable place with the reason attached, and
 * the reason is shown to the user rather than hidden in a comment. Anything
 * not listed here keeps upstream's behaviour exactly.
 *
 * `smoke_alarm_active` (printer-configs/smoke-alarm.cfg): the discriminator
 * that answers "is the buzzer sounding BECAUSE OF SMOKE" -- raised only by the
 * SMOKE_ALARM macro, deliberately not by _BEEP, not by SMOKE_TEST_SIREN and not
 * by any other Klipper shutdown. A dashboard toggle would let one stray tap on
 * the tablet make the machine claim a fire that is not happening, which is the
 * one failure mode a fire alarm may not have. Its VALUE is still shown -- that
 * is the whole point of the pin -- it just cannot be written here.
 *
 * `siren` deliberately stays writable: sounding the buzzer is a legitimate
 * bench check, it is self-evidently reversible (click again), and the machine
 * already ships a SMOKE_TEST_SIREN macro that does the same thing.
 * `siren_armed` deliberately stays writable too -- smoke-alarm.cfg says in so
 * many words that the flag was moved onto an `[output_pin]` FOR this switch,
 * because a `gcode_macro` variable renders no toggle in Mainsail and the user
 * asked where the toggle was.
 */
export const READ_ONLY_OUTPUT_PINS: Record<string, string> = {
    smoke_alarm_active: 'Set only by the SMOKE_ALARM macro — read-only here, so a tap cannot claim a fire.',
}
