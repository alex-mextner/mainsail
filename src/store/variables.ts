import { KlipperRepos, Theme } from '@/store/types'

export const defaultMode = 'dark'
export const defaultTheme = 'mainsail'
export const defaultLogoColor = '#D41216'
export const defaultPrimaryColor = '#2196f3'
export const defaultBigThumbnailBackground = '#1e1e1e'

export const minKlipperVersion = 'v0.11.0-257'
export const minMoonrakerVersion = 'v0.8.0-306'
export const minBrowserVersions = [{ name: 'safari', version: '16.5.2' }]

export const colorArray = ['#F44336', '#8e379d', '#03DAC5', '#3F51B5', '#ffde03', '#009688', '#E91E63']

export const colorHeaterBed = '#2196F3'
export const colorChamber = '#4CAF50'
export const opacityHeaterActive = '99'
export const opacityHeaterInactive = '44'
export const themeDir = '.theme'
export const datasetInterval = 1000
export const datasetTypes = ['temperature', 'target', 'power', 'speed']
export const datasetTypesInPercents = ['power', 'speed']
export const additionalSensors = [
    'aht10',
    'aht1x',
    'aht2x',
    'aht3x',
    'bme280',
    'htu21d',
    'sgp40',
    'sht3x',
    'sht4x',
    'temperature_combined',
]

/*
 * List of valid gcode file extensions
 */
export const validGcodeExtensions = ['.gcode', '.g', '.gco', '.ufp', '.nc']

/*
 * List of initable server components
 */
export const initableServerComponents = [
    'history',
    'power',
    'updateManager',
    'timelapse',
    'jobQueue',
    'announcements',
    'spoolman',
    'sensor',
]

/*
 * List of required klipper config modules
 */
export const checkKlipperConfigModules = [
    'virtual_sdcard',
    'pause_resume',
    'gcode_macro pause',
    'gcode_macro resume',
    'gcode_macro cancel_print',
]

/*
 * List of allowed metadata fields
 */
export const allowedMetadata = [
    'uuid',
    'estimated_time',
    'extruder_colors',
    'filament_change_count',
    'filament_colors',
    'filament_name',
    'filament_temps',
    'filament_type',
    'filament_colors',
    'extruder_colors',
    'filament_temps',
    'referenced_tools',
    'mmu_print',
    'filament_total',
    'filament_weight_total',
    'filament_weights',
    'nozzle_diameter',
    'first_layer_bed_temp',
    'first_layer_extr_temp',
    'chamber_temp',
    'first_layer_height',
    'gcode_end_byte',
    'gcode_start_byte',
    'job_id',
    'layer_height',
    'mmu_print',
    'object_height',
    'print_start_time',
    'referenced_tools',
    'size',
    'slicer',
    'slicer_version',
    'thumbnails',
]

export const maxEventHistory = 500
export const maxGcodeHistory = 50

/*
 * List of generic dashboard panels
 */
export const allDashboardPanels = [
    'afc',
    'toolhead-control',
    'extruder-control',
    'macros',
    'led-effects',
    'machine-settings',
    'miniconsole',
    'miscellaneous',
    'spoolman',
    'mmu',
    'temperature',
    'webcam',
]

export const thumbnailSmallMin = 30
export const thumbnailSmallMax = 64
export const thumbnailBigMin = 128
// default height cap of the big thumbnail in the status panel. the thumbnail keeps its own
// aspect ratio below that cap, so the model is always shown completely and never cropped.
export const thumbnailBigMaxHeight = 320

// The webcam hud docks into the black bar next to the camera image when that bar is big
// enough to stay readable, and floats on top of the image otherwise. Both thresholds below are
// compared against the TOTAL slack `object-fit: contain` leaves, i.e. both letterbox strips
// added together - a docked hud always gets the sum, with the frame pushed flush against the
// opposite edge, so there is no such thing as "one bar" to measure.
//
// Minimum width of a vertical (pillarbox) column. It has to fit two things without wrapping:
// the temperature row ("241 / 240 °C" plus its label, ~150px at the hud type scale) and a
// chart that still shows its y-axis labels and ~4 time ticks (~150px), plus 2x12px padding -
// so ~175px is the functional floor. 200px keeps a little air. A 16:9 window with a 4:3 camera
// leaves a quarter of its width free, so it clears the threshold from 800px of width up.
export const webcamHudMinDockWidth = 200
// Minimum height of a horizontal (letterbox) row, same rule - the sum of the strips above and
// below the frame. 2x10px padding plus the tallest content block (12px label + 22px value +
// gap ~= 46px) still leaves the chart as the binding constraint, and a temperature chart under
// ~56px cannot show gridlines. 20 + 56 = 76, rounded up to 90 for breathing room.
export const webcamHudMinDockHeight = 90
// Minimum window width for the chart to be worth showing in a HORIZONTAL dock.
//
// A letterbox bar is only as tall as the window gives it, and content that needs a second
// line does not fit: measured at 900x900, where the bar is 112px, "Remaining" and "ETA"
// wrapped onto a second line and their values sat on the bottom edge of the screen. So the
// six readings have to stay on ONE line, and the chart is what gives way.
//
// There are six of them (nozzle, bed, layer, speed, remaining, ETA), each with a 78px floor
// and a 24px gap: 6x78 + 5x24 = 588, and the widest real content ("255 / 255 °C") keeps it
// there. The row around them is 16px padding + a 260px file/progress block + a 24px gap ...
// 24px gap + a 340px chart + 16px padding. 16 + 260 + 24 + 588 + 24 + 340 + 16 = 1268,
// rounded down to 1240 to match the same constant in the Vue 3 port, where it was derived
// first. Below this the chart is dropped and the readings get the whole bar: the numbers are
// what you came for, the chart is the extra.
//
// This matters more since the hud can be docked BY HAND: a manual bottom dock reserves the
// 90px minimum at any window width, so the narrow row is reachable now, not just at the few
// window shapes where the letterbox happened to be that thin.
export const webcamHudMinRowChartWidth = 1240
// Distance the hud keeps from the edges when it floats over the image.
export const webcamHudMargin = 16
// How close to an edge the pointer has to be, while dragging the hud, for the drop to mean
// "put it into the bar on that edge" instead of "float it at the nearest of the eight
// anchors". 64px is comfortably below where any anchor lands: a floating card is 420px wide
// and is grabbed somewhere in its body, so parking it at the left anchor puts the pointer
// around x=226 - four times outside this band. So the two gestures cannot be confused.
export const webcamHudDockZoneDepth = 64

// The 3D tile in the middle of a docked bar. It is only ever given the space the readings and
// the chart did not want, so the floor below is a quality gate rather than a reservation: a
// scene shown at less than this is a smudge, and an empty frame is worse than no frame. 140px
// is where a 30mm cube at the default camera distance still reads as a cube.
export const webcamHudModelMinSide = 140
// Render quality handed to @sindarius/gcodeviewer for the tile: 1 = SBC, 2 = low, up to 6.
// The full /viewer route keeps whatever the user picked there - see WebcamHudModel.vue for why
// this is assigned as a field instead of through updateRenderQuality().
export const webcamHudModelRenderQuality = 2
// A horizontal (letterbox) bar only gets the tile when the window is this wide. The row already
// needs 16 + 260 (file block) + 24 + 588 (six readings) + 24 + 340 (chart) + 16 = 1268 to hold
// its own content on one line, which is where webcamHudMinRowChartWidth comes from; a square
// tile of webcamHudModelMinSide plus its gap adds 164 on top, so 1240 + 164 = 1404, rounded up
// to 1440 for air. Below that the row is left exactly as it was - the readings are the point.
// Note this is rare by construction: a letterbox row needs a window TALLER than width/aspect,
// so with a 4:3 camera the tile only ever appears on a large portrait screen (1440x1080 and up).
export const webcamHudMinRowModelWidth = 1440

export const navigationWidth = 220
export const navigationItemHeight = 48
export const panelToolbarHeight = 48
export const topbarHeight = 48

/*
 * List of hidden timelapse console outputs
 */
export const timelapseConsoleFilters = [
    '^_TIMELAPSE_NEW_FRAME',
    '^TIMELAPSE_TAKE_FRAME',
    '^TIMELAPSE_RENDER',
    '^_SET_TIMELAPSE_SETUP',
    '^HYPERLAPSE ACTION=',
    '^SET_GCODE_VARIABLE MACRO=TIMELAPSE_',
]

/*
 * List of hidden root directories in config files panel
 */
export const hiddenRootDirectories = ['gcodes', 'timelapse', 'timelapse_frames']

/*
 * Hide directories
 */
export const hiddenDirectories = ['.git']

/*
 * List of all downloadable logfiles
 */
export const genericLogfiles = ['AFC', 'crowsnest', 'mms', 'mmu', 'sonar']

/*
 * List of all rollover logfiles
 */
export const rolloverLogfiles = ['klipper', 'moonraker']

/*
 * List of keys that should not be saved to Moonraker DB
 * and are excluded when backup/restore settings
 */
export const excludeKeys = [
    'view.timelapse.currentPath',
    'view.timelapse.selectedFiles',
    'view.history.selectedJobs',
    'view.blockFileUpload',
    'view.configfiles.selectedFiles',
    'view.configfiles.rootPath',
    'view.configfiles.currentPath',
    'view.gcodefiles.search',
    'view.gcodefiles.currentPath',
    'view.gcodefiles.selectedFiles',
]

/*
 * List of all Themes
 */
export const themes: Theme[] = [
    { name: 'mainsail', displayName: 'Mainsail', colorLogo: defaultLogoColor },
    {
        name: 'klipper',
        displayName: 'Klipper',
        colorLogo: '#b12f35',
        logo: { show: true, light: false },
    },
    {
        name: 'voron',
        displayName: 'Voron Design',
        colorLogo: '#FF2300',
        logo: { show: true, light: false },
    },
    {
        name: 'ldo',
        displayName: 'LDO Motion (Sponsor)',
        colorLogo: '#326799',
        colorPrimary: '#326799',
        logo: { show: true, light: false },
    },
    {
        name: 'yumi',
        displayName: 'YUMI (Sponsor)',
        colorLogo: '#F6CF3D',
        colorPrimary: '#F6CF3D',
        logo: { show: true, light: false },
    },
    {
        name: 'vzbot',
        displayName: 'VzBot',
        colorLogo: '#FF0000',
        logo: { show: true, light: false },
        sidebarBackground: { show: true, light: false },
        css: true,
    },
    {
        name: 'prusa',
        displayName: 'Prusa Research (Sponsor)',
        colorLogo: '#fa6831',
        colorPrimary: '#fa6831',
        logo: { show: true, light: false },
    },
    {
        name: 'btt',
        displayName: 'BigTreeTech (Sponsor)',
        colorLogo: '#ef0025',
        logo: { show: true, light: false },
    },
    {
        name: 'multec',
        displayName: 'Multec GmbH (Sponsor)',
        colorLogo: '#234D7A',
        colorPrimary: '#234D7A',
        logo: { show: true, light: false },
    },
]

/*
 * List of all supported Klipper-Repos
 */
export const klipperRepos: KlipperRepos = {
    Klipper: {
        url: 'https://www.klipper3d.org/',
        docsLanguages: ['it', 'hu', 'zh'],
    },
    Kalico: {
        url: 'https://docs.kalico.gg/',
    },
}
