/**
 * Printer Administration RPC Interface
 *
 * These endpoints provide access to printer state and printer control.
 * Klippy must be connected to Moonraker to receive a successful response.
 *
 * @see https://moonraker.readthedocs.io/en/latest/external_api/printer/
 */
export interface PrinterRPC {
    /**
     * Returns a list of all available printer objects.
     */
    'printer.objects.list': () => Promise<{
        /** Array of available printer object names */
        objects: string[]
    }>

    /**
     * Subscribe to printer object updates.
     * The objects parameter specifies which objects and attributes to subscribe to.
     * Use `null` to subscribe to all attributes of an object.
     */
    'printer.objects.subscribe': (params: {
        /** Object names mapped to arrays of attribute names (or null for all attributes) */
        objects: Record<string, string[] | null>
    }) => Promise<{
        /** The time at which the status was received, according Klipper's monotonic clock */
        eventtime: number
        /** Current status of all subscribed objects */
        status: Record<string, unknown>
    }>

    /**
     * Query printer object status.
     * Returns the current values of the specified objects and attributes.
     */
    'printer.objects.query': (params: {
        /** Object names mapped to arrays of attribute names (or null for all attributes) */
        objects: Record<string, string[] | null>
    }) => Promise<{
        /** The time at which the status was received, according Klipper's monotonic clock */
        eventtime: number
        /** Current status of all queried objects */
        status: Record<string, unknown>
    }>

    /**
     * Klippy host state. `state` is one of ready / startup / shutdown / error;
     * `state_message` carries the reason, which is how a smoke-alarm shutdown is
     * told apart from an ordinary one (see components/webcams/overcam-light.ts).
     */
    'printer.info': () => Promise<{
        state: string
        state_message: string
        hostname: string
        klipper_path: string
        config_file: string
        software_version: string
    }>

    /** Run a gcode script. Resolves with "ok" once Klipper has executed it. */
    'printer.gcode.script': (params: {
        /** The gcode to execute */
        script: string
    }) => Promise<string>
}
