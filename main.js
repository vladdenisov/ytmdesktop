require('./utils/defaultSettings')

const {
    app,
    BrowserWindow,
    BrowserView,
    globalShortcut,
    Menu,
    ipcMain,
    systemPreferences,
    nativeTheme,
    screen,
    shell,
} = require('electron')
const path = require('path')
const __ = require('./providers/translateProvider')
const isDev = require('electron-is-dev')
const ClipboardWatcher = require('electron-clipboard-watcher')
const electronLocalshortcut = require('electron-localshortcut')
const ytdl = require('ytdl-core')
const ffmpeg = require('fluent-ffmpeg')
const request = require('request')
const fs = require('fs')
const ytpl = require('ytpl')

const assetsProvider = require('./providers/assetsProvider')
const scrobblerProvider = require('./providers/scrobblerProvider')
const { statusBarMenu } = require('./providers/templateProvider')
const settingsProvider = require('./providers/settingsProvider')
const infoPlayerProvider = require('./providers/infoPlayerProvider')
const rainmeterNowPlaying = require('./providers/rainmeterNowPlaying')
const companionServer = require('./providers/companionServer')
const discordRPC = require('./providers/discordRpcProvider')
const mprisProvider = require('./providers/mprisProvider')

const { calcYTViewSize } = require('./utils/calcYTViewSize')
const { isWindows, isMac, isLinux } = require('./utils/systemInfo')
const { checkWindowPosition, doBehavior } = require('./utils/window')
const fileSystem = require('./utils/fileSystem')

/* Variables =========================================================================== */
let mainWindow,
    view,
    miniplayer,
    lyrics,
    settings,
    infoPlayerInterval,
    customCSSAppKey,
    customCSSPageKey,
    lastTrackId,
    doublePressPlayPause,
    queue = []

let isFirstTime = (isClipboardWatcherRunning = false)

let renderer_for_status_bar = (clipboardWatcher = null)

const defaultUrl = 'https://music.youtube.com'

let mainWindowParams = {
    url: defaultUrl,
    width: 1500,
    height: 800,
}

let windowConfig = {
    frame: false,
    titleBarStyle: '',
}

global.sharedObj = { title: 'N/A', paused: true }
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.

/* First checks ========================================================================= */
app.commandLine.appendSwitch('disable-features', 'MediaSessionService') //This keeps chromium from trying to launch up it's own mpris service, hence stopping the double service.

createDocumentsAppDir()

createCustomCSSDir()
createCustomCSSPageFile()

if (settingsProvider.get('settings-companion-server')) {
    companionServer.start()
}

if (settingsProvider.get('settings-rainmeter-web-now-playing')) {
    rainmeterNowPlaying.start()
}

if (settingsProvider.get('settings-discord-rich-presence')) {
    discordRPC.start()
}

if (isLinux()) {
    mprisProvider.start()
}

if (isMac()) {
    settingsProvider.set(
        'settings-shiny-tray-dark',
        nativeTheme.shouldUseDarkColors
    )
    systemPreferences.subscribeNotification(
        'AppleInterfaceThemeChangedNotification',
        function theThemeHasChanged() {
            settingsProvider.set(
                'settings-shiny-tray-dark',
                nativeTheme.shouldUseDarkColors
            )
            if (renderer_for_status_bar)
                renderer_for_status_bar.send('update-status-bar')
        }
    )
    const menu = Menu.buildFromTemplate(statusBarMenu)
    Menu.setApplicationMenu(menu)
}

/* Functions ============================================================================= */
function createWindow() {
    if (isMac() || isWindows()) {
        const execApp = path.basename(process.execPath)
        const startArgs = ['--processStart', `"${execApp}"`]
        const startOnBoot = settingsProvider.get('settings-start-on-boot')
        if (startOnBoot) {
            app.setLoginItemSettings({
                openAtLogin: true,
                path: process.execPath,
                args: startArgs,
            })
        } else {
            app.setLoginItemSettings({
                openAtLogin: false,
                args: startArgs,
            })
        }
    }
    windowSize = settingsProvider.get('window-size')
    windowMaximized = settingsProvider.get('window-maximized')
    windowMinimized = settingsProvider.get('settings-start-minimized')

    if (windowSize) {
        mainWindowParams.width = windowSize.width
        mainWindowParams.height = windowSize.height
    } else {
        let electronScreen = screen
        let size = electronScreen.getPrimaryDisplay().workAreaSize

        mainWindowParams.width = size.width - 150
        mainWindowParams.height = size.height - 150
    }

    browserWindowConfig = {
        icon: assetsProvider.getIcon('favicon'),
        width: mainWindowParams.width,
        height: mainWindowParams.height,
        minWidth: 300,
        minHeight: 300,
        show: windowMinimized ? false : true,
        autoHideMenuBar: true,
        backgroundColor: '#232323',
        center: true,
        closable: true,
        skipTaskbar: false,
        resize: true,
        maximizable: true,
        webPreferences: {
            nodeIntegration: true,
            webviewTag: true,
        },
    }

    switch (settingsProvider.get('titlebar-type')) {
        case 'nice':
            browserWindowConfig.frame = false
            browserWindowConfig.titleBarStyle = 'hidden'

            windowConfig.frame = false
            windowConfig.titleBarStyle = 'hidden'
            break

        case 'system':
            browserWindowConfig.frame = true

            windowConfig.frame = true
            windowConfig.titleBarStyle = 'hidden'
            break

        case 'none':
            browserWindowConfig.frame = false
            browserWindowConfig.titleBarStyle = 'hidden'

            windowConfig.frame = false
            windowConfig.titleBarStyle = 'hidden'
            break
    }

    mainWindow = new BrowserWindow(browserWindowConfig)
    mainWindow.webContents.session.setUserAgent(
        'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:54.0) Gecko/20100101 Firefox/71.0'
    )
    view = new BrowserView({
        webPreferences: {
            nodeIntegration: true,
            webviewTag: true,
            preload: path.join(app.getAppPath(), '/utils/injectControls.js'),
        },
    })

    mainWindow.loadFile(
        path.join(
            __dirname,
            './pages/shared/window-buttons/window-buttons.html'
        ),
        { search: 'page=home/home&title=YouTube Music' }
    )

    mainWindow.addBrowserView(view)

    view.setBounds(calcYTViewSize(settingsProvider, mainWindow))

    if (
        settingsProvider.get('settings-continue-where-left-of') &&
        settingsProvider.get('window-url')
    ) {
        mainWindowParams.url = settingsProvider.get('window-url')
    }

    view.webContents.loadURL(mainWindowParams.url)

    // Open the DevTools.
    // mainWindow.webContents.openDevTools({ mode: 'detach' });
    view.webContents.openDevTools({ mode: 'detach' })

    mediaControl.createThumbar(mainWindow, infoPlayerProvider.getAllInfo())

    if (windowMaximized) {
        setTimeout(function() {
            mainWindow.send('window-is-maximized', true)
            view.setBounds(calcYTViewSize(settingsProvider, mainWindow))
            mainWindow.maximize()
        }, 700)
    } else {
        let position = settingsProvider.get('window-position')
        if (position != undefined) {
            mainWindow.setPosition(position.x, position.y)
        }
    }

    mainWindow.on('ready-to-show', () => {
        console.log('show')
    })

    // Emitted when the window is closed.
    mainWindow.on('closed', function() {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null
    })
    mainWindow.on('show', function() {
        globalShortcut.unregister('CmdOrCtrl+M')

        mediaControl.createThumbar(mainWindow, infoPlayerProvider.getAllInfo())
    })

    view.webContents.on('new-window', function(event, url) {
        event.preventDefault()
        shell.openExternal(url)
    })

    // view.webContents.openDevTools({ mode: 'detach' });
    view.webContents.on('did-navigate-in-page', function() {
        initialized = true
        settingsProvider.set('window-url', view.webContents.getURL())
        view.webContents.insertCSS(`
            /* width */
            ::-webkit-scrollbar {
                width: 9px;
            }

            /* Track */
            ::-webkit-scrollbar-track {
                background: #232323;
            }

            /* Handle */
            ::-webkit-scrollbar-thumb {
                background: #555;
            }

            /* Handle on hover */
            ::-webkit-scrollbar-thumb:hover {
                background: #f44336;
            }
        `)
    })

    view.webContents.on('media-started-playing', function() {
        ipcMain.emit('media-started')
        if (!infoPlayerProvider.hasInitialized()) {
            infoPlayerProvider.init(view)
            mprisProvider.setRealPlayer(infoPlayerProvider) //this lets us keep track of the current time in playback.
        }

        if (isMac()) {
            global.sharedObj.paused = false
            renderer_for_status_bar.send('update-status-bar')
        }

        if (infoPlayerInterval === undefined) {
            infoPlayerInterval = setInterval(() => {
                if (global.on_the_road) {
                    updateActivity()
                }
            }, 800)
        }
    })

    view.webContents.on('did-start-navigation', function(_) {
        view.webContents.executeJavaScript('window.location').then(location => {
            if (location.hostname != 'music.youtube.com') {
                mainWindow.send('off-the-road')
                global.on_the_road = false
            } else {
                mainWindow.send('on-the-road')
                global.on_the_road = true

                loadAudioOutput()
                loadCustomCSSPage()
            }
        })
    })

    function updateActivity() {
        var trackInfo = infoPlayerProvider.getTrackInfo()
        var playerInfo = infoPlayerProvider.getPlayerInfo()

        var title = trackInfo.title
        var author = trackInfo.author
        var album = trackInfo.album
        var cover = trackInfo.cover
        var nowPlaying = `${title} - ${author}`

        logDebug(nowPlaying)

        discordRPC.setActivity(getAll())
        rainmeterNowPlaying.setActivity(getAll())
        mprisProvider.setActivity(getAll())

        mediaControl.createThumbar(mainWindow, infoPlayerProvider.getAllInfo())

        mediaControl.setProgress(
            mainWindow,
            settingsProvider.get('settings-enable-taskbar-progressbar')
                ? trackInfo.statePercent
                : -1,
            playerInfo.isPaused
        )

        /**
         * Update only when change track
         */
        if (lastTrackId !== trackInfo.id) {
            lastTrackId = trackInfo.id

            if (isMac()) {
                global.sharedObj.title = nowPlaying
                renderer_for_status_bar.send('update-status-bar')
            }

            mainWindow.setTitle(nowPlaying)
            tray.setTooltip(nowPlaying)
            if (!trackInfo.isAdvertisement) {
                scrobblerProvider.updateTrackInfo(title, author, album)
            }

            if (
                !mainWindow.isFocused() &&
                settingsProvider.get('settings-show-notifications')
            ) {
                tray.balloon(
                    title,
                    author,
                    cover,
                    assetsProvider.getIcon('favicon')
                )
            }
        }

        if (!isMac() && !settingsProvider.get('settings-shiny-tray')) {
            if (playerInfo.isPaused) {
                tray.updateTrayIcon(
                    path.join(
                        app.getAppPath(),
                        assetsProvider.getIcon('favicon_pause')
                    )
                )
            } else {
                tray.updateTrayIcon(
                    path.join(
                        app.getAppPath(),
                        assetsProvider.getIcon('favicon_play')
                    )
                )
            }
        }
    }

    view.webContents.on('media-started-playing', function() {
        logDebug('Playing')
        try {
            if (isMac()) {
                renderer_for_status_bar.send('update-status-bar')
            }

            global.sharedObj.paused = false
            mediaControl.createThumbar(
                mainWindow,
                infoPlayerProvider.getAllInfo()
            )
        } catch {}
    })

    view.webContents.on('media-paused', function() {
        logDebug('Paused')
        try {
            if (isMac()) {
                renderer_for_status_bar.send('update-status-bar')
            }

            global.sharedObj.paused = true
            mediaControl.createThumbar(
                mainWindow,
                infoPlayerProvider.getAllInfo()
            )
        } catch {}
    })

    mainWindow.on('resize', function() {
        let windowSize = mainWindow.getSize()
        setTimeout(() => {
            view.setBounds(calcYTViewSize(settingsProvider, mainWindow))
        }, 200)

        mainWindow.send('window-is-maximized', mainWindow.isMaximized())

        settingsProvider.set('window-maximized', mainWindow.isMaximized())
        if (!mainWindow.isMaximized()) {
            settingsProvider.set('window-size', {
                width: windowSize[0],
                height: windowSize[1],
            })
        }
    })

    let storePositionTimer
    mainWindow.on('move', function(e) {
        let position = mainWindow.getPosition()
        if (storePositionTimer) {
            clearTimeout(storePositionTimer)
        }
        storePositionTimer = setTimeout(() => {
            settingsProvider.set('window-position', {
                x: position[0],
                y: position[1],
            })
        }, 500)
    })

    mainWindow.on('focus', () => {
        view.webContents.focus()
    })

    mainWindow.on('close', function(e) {
        if (settingsProvider.get('settings-keep-background')) {
            e.preventDefault()
            mainWindow.hide()
        } else {
            app.exit()
        }
        return
    })

    // LOCAL
    electronLocalshortcut.register(view, 'CmdOrCtrl+S', () => {
        ipcMain.emit('show-settings')
    })

    electronLocalshortcut.register(view, 'CmdOrCtrl+M', () => {
        ipcMain.emit('show-miniplayer')
    })

    // GLOBAL
    globalShortcut.register('MediaPlayPause', function() {
        if (settingsProvider.get('settings-enable-double-tapping-show-hide')) {
            if (!doublePressPlayPause) {
                // The first press
                if (infoPlayerProvider.getTrackInfo().id == '') {
                    infoPlayerProvider.firstPlay(view.webContents)
                }

                doublePressPlayPause = true
                setTimeout(() => {
                    if (doublePressPlayPause) mediaControl.playPauseTrack(view)
                    doublePressPlayPause = false
                }, 200)
            } else {
                // The second press
                doublePressPlayPause = false
                doBehavior(mainWindow)
            }
        } else {
            mediaControl.playPauseTrack(view)
        }
    })

    globalShortcut.register('MediaStop', function() {
        mediaControl.stopTrack(view)
    })

    globalShortcut.register('MediaPreviousTrack', function() {
        mediaControl.previousTrack(view)
    })

    globalShortcut.register('MediaNextTrack', function() {
        mediaControl.nextTrack(view)
    })

    globalShortcut.register('CmdOrCtrl+Shift+Space', function() {
        mediaControl.playPauseTrack(view)
    })

    globalShortcut.register('CmdOrCtrl+Shift+PageUp', function() {
        mediaControl.nextTrack(view)
    })

    globalShortcut.register('CmdOrCtrl+Shift+PageDown', function() {
        mediaControl.previousTrack(view)
    })

    globalShortcut.register('CmdOrCtrl+Shift+numadd', function() {
        mediaControl.upVote(view)
    })

    globalShortcut.register('CmdOrCtrl+Shift+numsub', function() {
        mediaControl.downVote(view)
    })

    ipcMain.on('restore-main-window', function() {
        mainWindow.show()
    })

    ipcMain.on('settings-changed-zoom', function(e, value) {
        view.webContents.zoomFactor = value / 100
    })

    ipcMain.on('retrieve-player-info', function(e, _) {
        // IPCRenderer
        if (e !== undefined) {
            e.sender.send(
                'song-playing-now-is',
                infoPlayerProvider.getAllInfo()
            )
        }

        // IPCMain
        if (infoPlayerProvider.hasInitialized()) {
            ipcMain.emit('song-playing-now-is', infoPlayerProvider.getAllInfo())
        }
    })

    /*ipcMain.on("will-close-mainwindow", function() {
if (settingsProvider.get("settings-keep-background")) {
  mainWindow.hide();
} else {
  app.exit();
}
});*/

    ipcMain.on('settings-value-changed', (e, data) => {
        switch (data.key) {
            case 'settings-rainmeter-web-now-playing':
                if (data.value) {
                    rainmeterNowPlaying.start()
                } else {
                    rainmeterNowPlaying.stop()
                }
                break

            case 'settings-companion-server':
                if (data.value) {
                    companionServer.start()
                } else {
                    companionServer.stop()
                }
                break

            case 'settings-discord-rich-presence':
                if (data.value) {
                    discordRPC.start()
                } else {
                    discordRPC.stop()
                }
                break

            case 'settings-custom-css-app':
                if (data.value) {
                    loadCustomCSSApp()
                } else {
                    removeCustomCSSApp()
                }
                break

            case 'settings-custom-css-page':
                if (data.value) {
                    loadCustomCSSPage()
                } else {
                    removeCustomCSSPage()
                }
                break
        }
    })
    ipcMain.on('media-stop', () => {
        if (!global.sharedObj.paused) mediaControl.playPauseTrack(view)
    })
    ipcMain.on('media-command', (dataMain, dataRenderer) => {
        let command, value

        if (dataMain.command !== undefined) {
            command = dataMain.command
            value = dataMain.value
        } else {
            command = dataRenderer.command
            value = dataRenderer.value
        }

        switch (command) {
            case 'media-play-pause':
                mediaControl.playPauseTrack(view)
                break

            case 'media-track-next':
                mediaControl.nextTrack(view)
                break

            case 'media-track-previous':
                mediaControl.previousTrack(view)
                break

            case 'media-vote-up':
                mediaControl.upVote(view)
                break

            case 'media-vote-down':
                mediaControl.downVote(view)
                break

            case 'media-volume-up':
                mediaControl.volumeUp(view)
                break

            case 'media-volume-down':
                mediaControl.volumeDown(view)
                break

            case 'media-seekbar-forward':
                mediaControl.mediaForwardTenSeconds(view)
                break

            case 'media-seekbar-rewind':
                mediaControl.mediaRewindTenSeconds(view)
                break

            case 'media-seekbar-set':
                mediaControl.changeSeekbar(view, value)
                break

            case 'media-volume-set':
                mediaControl.changeVolume(view, value)
                break
        }
    })

    ipcMain.on('register-renderer', (event, arg) => {
        renderer_for_status_bar = event.sender
        event.sender.send('update-status-bar')
        event.sender.send('is-dev', isDev)
        event.sender.send('register-renderer', app)
    })

    ipcMain.on('update-tray', () => {
        if (isMac()) {
            renderer_for_status_bar.send('update-status-bar')
            tray.setShinyTray()
        }
    })

    ipcMain.on('btn-update-clicked', () => {
        updater.quitAndInstall()
    })

    ipcMain.on('show-guest-mode', function() {
        const incognitoWindow = new BrowserWindow({
            icon: assetsProvider.getIcon('favicon'),
            width: mainWindowParams.width,
            height: mainWindowParams.height,
            minWidth: 300,
            minHeight: 300,
            show: true,
            autoHideMenuBar: true,
            backgroundColor: '#232323',
            center: true,
            closable: true,
            skipTaskbar: false,
            resize: true,
            maximizable: true,
            frame: true,
            webPreferences: {
                nodeIntegration: true,
                partition: `guest-mode-${Date.now()}`,
            },
        })

        incognitoWindow.webContents.session.setUserAgent(
            'Mozilla/5.0 (Windows NT 6.1; WOW64; rv:54.0) Gecko/20100101 Firefox/71.0'
        )

        incognitoWindow.webContents.loadURL(mainWindowParams.url)
    })

    ipcMain.on('show-settings', function() {
        if (settings) {
            settings.show()
        } else {
            settings = new BrowserWindow({
                title: __.trans('LABEL_SETTINGS'),
                icon: assetsProvider.getIcon('favicon'),
                modal: false,
                frame: windowConfig.frame,
                titleBarStyle: windowConfig.titleBarStyle,
                center: true,
                resizable: true,
                backgroundColor: '#232323',
                width: 900,
                minWidth: 900,
                height: 550,
                minHeight: 550,
                autoHideMenuBar: false,
                skipTaskbar: false,
                webPreferences: {
                    nodeIntegration: true,
                    webviewTag: true,
                    //reload: path.join(app.getAppPath(), '/pages/settings/settings.js'),
                },
            })

            settings.loadFile(
                path.join(
                    __dirname,
                    './pages/shared/window-buttons/window-buttons.html'
                ),
                {
                    search:
                        'page=settings/settings&icon=settings&hide=btn-minimize,btn-maximize',
                }
            )
        }

        settings.on('closed', function() {
            settings = null
        })
    })

    ipcMain.on('show-miniplayer', function() {
        miniplayer = new BrowserWindow({
            title: __.trans('LABEL_MINIPLAYER'),
            icon: assetsProvider.getIcon('favicon'),
            modal: false,
            frame: false,
            center: false,
            resizable: false,
            alwaysOnTop: settingsProvider.get('settings-miniplayer-always-top'),
            backgroundColor: '#000000',
            minWidth: 100,
            minHeight: 100,
            autoHideMenuBar: true,
            skipTaskbar: false,
            webPreferences: {
                nodeIntegration: true,
                //preload: path.join(app.getAppPath(), '/pages/miniplayer/miniplayer.js'),
            },
        })

        miniplayer.loadFile(
            path.join(app.getAppPath(), '/pages/miniplayer/miniplayer.html')
        )

        switch (settingsProvider.get('settings-miniplayer-size')) {
            case '1':
                miniplayer.setSize(170, 170)
                break

            case '2':
                miniplayer.setSize(200, 200)
                break

            case '3':
                miniplayer.setSize(230, 230)
                break

            case '4':
                miniplayer.setSize(260, 260)
                break

            case '5':
                miniplayer.setSize(290, 290)
                break

            case '6':
                miniplayer.setSize(320, 320)
                break

            default:
                miniplayer.setSize(200, 200)
                break
        }

        let miniplayerPosition = settingsProvider.get('miniplayer-position')
        if (miniplayerPosition != undefined) {
            miniplayer.setPosition(miniplayerPosition.x, miniplayerPosition.y)
        }

        let storeMiniplayerPositionTimer
        miniplayer.on('move', function(e) {
            let position = miniplayer.getPosition()
            if (storeMiniplayerPositionTimer) {
                clearTimeout(storeMiniplayerPositionTimer)
            }
            storeMiniplayerPositionTimer = setTimeout(() => {
                settingsProvider.set('miniplayer-position', {
                    x: position[0],
                    y: position[1],
                })
            }, 1000)
        })

        mainWindow.hide()

        globalShortcut.register('CmdOrCtrl+M', function() {
            miniplayer.hide()
            mainWindow.show()
        })
    })

    ipcMain.on('show-last-fm-login', function() {
        const lastfm = new BrowserWindow({
            //parent: mainWindow,
            icon: assetsProvider.getIcon('favicon'),
            modal: false,
            frame: windowConfig.frame,
            titleBarStyle: windowConfig.titleBarStyle,
            center: true,
            resizable: true,
            backgroundColor: '#232323',
            width: 300,
            minWidth: 300,
            height: 260,
            minHeight: 260,
            autoHideMenuBar: false,
            skipTaskbar: false,
            webPreferences: {
                nodeIntegration: true,
                webviewTag: true,
            },
        })

        lastfm.loadFile(
            path.join(
                __dirname,
                './pages/shared/window-buttons/window-buttons.html'
            ),
            {
                search:
                    'page=settings/last-fm-login&icon=music_note&hide=btn-minimize,btn-maximize',
            }
        )
    })

    ipcMain.on('switch-clipboard-watcher', () => {
        switchClipboardWatcher()
    })

    ipcMain.on('miniplayer-toggle-ontop', function() {
        miniplayer.setAlwaysOnTop(!miniplayer.isAlwaysOnTop())
    })

    ipcMain.on('reset-url', () => {
        mainWindowParams.url = defaultUrl

        const options = { extraHeaders: 'pragma: no-cache\n' }
        view.webContents.loadURL(mainWindowParams.url, options)
    })

    ipcMain.on('show-editor-theme', function() {
        const editor = new BrowserWindow({
            icon: assetsProvider.getIcon('favicon'),
            frame: windowConfig.frame,
            titleBarStyle: windowConfig.titleBarStyle,
            center: true,
            resizable: true,
            backgroundColor: '#232323',
            width: 700,
            height: 800,
            maxHeight: 800,
            minHeight: 800,
            webPreferences: {
                nodeIntegration: true,
                webviewTag: true,
            },
        })

        editor.loadFile(
            path.join(
                __dirname,
                './pages/shared/window-buttons/window-buttons.html'
            ),
            {
                search:
                    'page=editor/editor&icon=color_lens&hide=btn-minimize,btn-maximize',
            }
        )
    })

    ipcMain.on('update-custom-css-page', function() {
        loadCustomCSSPage()
    })

    ipcMain.on('debug', (event, message) => {
        console.log(message)
    })

    ipcMain.on('bug-report', (event, message) => {
        let os = require('os')

        var os_platform = process.platform || '-'
        var os_arch = process.arch || '-'
        var os_system_version = process.getSystemVersion() || '-'

        var node_version = process.versions['node'] || '-'

        var ytmdesktop_version = process.env['npm_package_version'] || '-'

        var total_memory = bytesToSize(os.totalmem())

        var template = `%23%23%23%23 Problem %0A%23%23%23%23%23%23 (Describe the problem here) %0A%23%23%23%23 Environment %0A * YTMDesktop: ${ytmdesktop_version} %0A * Platform: ${os_platform} %0A * Arch: ${os_arch} %0A * Version: ${os_system_version} %0A * Memory: ${total_memory} %0A * Node: ${node_version} %0A%23%23%23%23 Prints %0A%23%23%23%23%23%23 (if possible) `
        shell.openExternal(
            `https://github.com/ytmdesktop/ytmdesktop/issues/new?body=${template}`
        )
    })

    ipcMain.on('change-audio-output', (event, data) => {
        setAudioOutput(data)
    })
    // Downloads section
    ipcMain.on('download-playlist', async (event, url) => {
        console.log(url)
        ytpl(url, async (err, playlist) => {
            if (!err) {
                const dir = path.join(app.getPath('music') + '/YTMusic/')
                let cache = JSON.parse(fileSystem.readFile(dir + 'cache.json'))
                cache.playlists[playlist.title] = []
                fileSystem.writeFile(dir + 'cache.json', JSON.stringify(cache))
                let index = 0
                for (const e of playlist.items) {
                    const a = async () => {
                        if (index === 0) console.log(e)
                        const info = await ytdl
                            .getBasicInfo(e.url_simple)
                            .catch(err => {
                                console.log(err)
                            })
                        console.log([
                            info.videoDetails.author.name,
                            info.videoDetails.title,
                            info.player_response.videoDetails.thumbnail
                                .thumbnails[
                                info.player_response.videoDetails.thumbnail
                                    .thumbnails.length - 1
                            ].url,
                        ])
                        queue.push({
                            author: e.author.name,
                            title: e.title,
                            cover:
                                info.player_response.videoDetails.thumbnail
                                    .thumbnails[
                                    info.player_response.videoDetails.thumbnail
                                        .thumbnails.length - 1
                                ].url,
                            durationHuman: e.duration,
                            url: e.url_simple,
                            id: e.id,
                            playlist: playlist.title,
                        })
                        if (index === 0) {
                            console.log('download')
                            if (!queue[1]) downloadSong(queue[0])
                        }
                        index += 1
                    }
                    await a()
                }
            } else {
                console.log(err)
            }
        })
    })
    ipcMain.on('download-current', async d => {
        let track = JSON.parse(
            JSON.stringify(infoPlayerProvider.getTrackInfo())
        )
        track.playlist = 'default'
        queue.push(track)
        if (!queue[1]) downloadSong(queue[0])
    })
    ipcMain.on('load-downloaded', (e, args) => {
        const dir = path.join(app.getPath('music') + '/YTMusic/')
        e.returnValue = {
            data: JSON.parse(fileSystem.readFile(dir + 'cache.json')),
            path: dir,
        }
    })
    ipcMain.on('show-offline', function() {
        const offPage = new BrowserWindow({
            title: 'Offline Player',
            modal: false,
            frame: windowConfig.frame,
            titleBarStyle: windowConfig.titleBarStyle,
            center: true,
            resizable: true,
            backgroundColor: '#000',
            width: 400,
            resizable: false,
            minWidth: 360,
            height: 715,
            minHeight: 715,
            autoHideMenuBar: false,
            skipTaskbar: false,
            webPreferences: {
                nodeIntegration: true,
                webviewTag: true,
            },
        })
        // settings.loadFile(path.join(app.getAppPath(), "/pages/settings/settings.html"));
        offPage.loadFile(
            path.join(
                __dirname,
                './pages/shared/window-buttons/window-buttons.html'
            ),
            {
                search:
                    'page=player/player&hide=btn-maximize&icon=video_library',
            }
        )
        offPage.webContents.executeJavaScript(`
      document.getElementById('content').style.marginTop = "28px"
      document.getElementById('webview').style.height = "100vh"
    `)
        //offPage.webContents.openDevTools()
        ipcMain.on('oPlayer_ready', event => {
            ipcMain.on('media-started', () => {
                event.sender.send('media-started')
            })
            ipcMain.on('new-download', track => {
                console.log('new download')
                event.sender.send('new-download', track)
            })
        })
    })
    async function downloadSong(track) {
        if (!track.title) return
        console.log(track)
        let dir = path.join(app.getPath('music') + `/YTMusic/${track.author}/`)
        !fileSystem.checkIfExists(dir) && fileSystem.createDir(dir)
        const cache_data = JSON.parse(
            fileSystem.readFile(
                path.join(app.getPath('music') + '/YTMusic/cache.json')
            )
        )
        if (cache_data.all.find(e => e.id === track.id)) {
            let cached_track = cache_data.all.find(e => e.id === track.id)
            if (cached_track.playlists.includes(track.playlist)) return
            cached_track.playlists.push(track.playlist)
            if (track.playlist === 'default')
                cache_data.default.push(cached_track)
            else cache_data.playlists[track.playlist].push(cached_track)
            fileSystem.writeFile(
                path.join(app.getPath('music') + '/YTMusic/cache.json'),
                JSON.stringify(cache_data)
            )
        }
        view.webContents.executeJavaScript(`
  if (!modal) {
    var modal = document.createElement('div')
    modal.id = "ytmd-modal"
    modal.style.transition = "opacity .15s cubic-bezier(0,0,.2,1) 0ms,transform .15s cubic-bezier(0,0,.2,1) 0ms,-webkit-transform .15s cubic-bezier(0,0,.2,1) 0ms;"
    modal.style.position = "fixed"
    modal.style.background = "#232323"
    modal.style.height = "70px"
    modal.style.width = "250px"
    modal.style.display = "flex"
    modal.style.flexDirection = "column"
    modal.style.bottom = "80px"
    modal.style.justifyContent = "center"
    modal.style.padding = "15px"
    modal.style.textAlign = "center"
    modal.style.zIndex = "99999"
    modal.style.transform = "scale(0.8)"
  }
  modal.innerHTML = "" 
  modal.style.opacity = "0"
  modal.innerHTML += '<i class="material-icons close" id="close">close</i>' +'<h2 style="color: rgb(170,170,170);font-weight: 100;font-size: 12px;margin-top: 5px;overflow-wrap: break-word;">Downloading ${track.author.replace(
      /['"]+/g,
      ' '
  )} - ${track.title.replace(
            /['"]+/g,
            ' '
        )}</h2><div id="progress" style="      width: 96%;       margin: auto;      border: 1px solid rgb(170,170,170);      height: 10px;      border-radius: 5vw">    <div id="bar" style="    width: 0%;    transition: 0.5s all ease;    background: rgb(39,147,232);    height: 100%;    border-radius: 5vw;    "></div>  </div>  <style>    .close {      position: absolute;      top: 5px;      right: 5px;      font-size: 14px;      cursor: pointer;    }  </style>'
  document.getElementsByTagName('body')[0].appendChild(modal)
    modal.style.opacity = "1"
  modal.style.transform = "scale(1)"
  `)
        // settings.loadFile(path.join(app.getAppPath(), "/pages/settings/settings.html"));
        let filename = fileSystem.filenamify(track.title)
        try {
            const info = await ytdl.getInfo(track.url)
            const format = info.formats.reduce((acc, x) => {
                if (x.itag > acc && x.audioCodec === 'opus') acc = x.itag
                return acc
            }, 0)
            ytdl.downloadFromInfo(info, { format })
                .on('progress', (chunkLength, downloaded, total) => {
                    const percent = downloaded / total
                    view.webContents.executeJavaScript(`
          document.getElementById('bar').style.width = "${Math.round(
              percent * 100
          )}%"
        `)
                })
                .on('end', () => {
                    request(track.cover).pipe(
                        fs.createWriteStream(dir + `${filename}.jpg`)
                    )
                    delete track.statePercent
                    track.filename = filename
                    track.playlist = [track.playlist]
                    if (track.playlist[0] === 'default')
                        cache_data.default.push(track)
                    else cache_data.playlists[track.playlist[0]].push(track)
                    cache_data.all.push(track)
                    fileSystem.writeFile(
                        path.join(app.getPath('music') + '/YTMusic/cache.json'),
                        JSON.stringify(cache_data)
                    )
                    ipcMain.emit('new-download', track)
                    queue.shift()
                    setTimeout(() => {
                        view.webContents.executeJavaScript(`
            document.getElementById("ytmd-modal").parentNode.removeChild(document.getElementById("ytmd-modal"))
          `)
                        if (queue[0]) downloadSong(queue[0])
                    }, 1000)
                })
                .pipe(fs.createWriteStream(`${dir}/${filename}.opus`))
        } catch (e) {
            console.log(e)
            if (e) return
        }
    }
    function setAudioOutput(audioLabel) {
        view.webContents
            .executeJavaScript(
                `
            navigator
            .mediaDevices
            .enumerateDevices()
            .then( devices => {
                var audioDevices = devices.filter(device => device.kind === 'audiooutput');
                var result = audioDevices.filter(deviceInfo => deviceInfo.label == "${audioLabel}");
                if(result.length) {
                    document.querySelector('.video-stream,.html5-main-video').setSinkId(result[0].deviceId);
                }
            });
        `
            )
            .then(_ => {})
            .catch(_ => console.log('error setAudioOutput'))
    }

    function loadAudioOutput() {
        if (settingsProvider.get('settings-app-audio-output')) {
            setAudioOutput(settingsProvider.get('settings-app-audio-output'))
        }
    }

    function loadCustomCSSApp() {
        const customThemeFile = path.join(
            fileSystem.getAppDocumentsPath(app),
            '/custom/css/app.css'
        )

        if (settingsProvider.get('settings-custom-css-app')) {
            if (fileSystem.checkIfExists(customThemeFile)) {
                if (customCSSAppKey) {
                    removeCustomCssApp()
                }
                view.webContents
                    .insertCSS(fileSystem.readFile(customThemeFile).toString())
                    .then(key => {
                        customCSSAppKey = key
                    })
            }
        }
    }

    function removeCustomCSSApp() {
        view.webContents.removeInsertedCSS(customCSSAppKey)
    }

    function loadCustomCSSPage() {
        const customThemeFile = path.join(
            fileSystem.getAppDocumentsPath(app),
            '/custom/css/page.css'
        )

        if (settingsProvider.get('settings-custom-css-page')) {
            if (fileSystem.checkIfExists(customThemeFile)) {
                if (customCSSPageKey) {
                    removeCustomCSSPage()
                }
                view.webContents
                    .insertCSS(fileSystem.readFile(customThemeFile).toString())
                    .then(key => {
                        customCSSPageKey = key
                    })
            }
        }
    }

    function removeCustomCSSPage() {
        view.webContents.removeInsertedCSS(customCSSPageKey)
    }

    function switchClipboardWatcher() {
        logDebug(
            'Switch clipboard watcher: ' +
                settingsProvider.get('settings-clipboard-read')
        )

        if (isClipboardWatcherRunning) {
            clipboardWatcher !== null && clipboardWatcher.stop()
            clipboardWatcher = null
            isClipboardWatcherRunning = false
        } else {
            if (settingsProvider.get('settings-clipboard-read')) {
                clipboardWatcher = ClipboardWatcher({
                    watchDelay: 1000,
                    onImageChange: function(nativeImage) {},
                    onTextChange: function(text) {
                        let regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|\?v=)([^#\&\?]*).*/
                        let match = text.match(regExp)
                        if (match && match[2].length == 11) {
                            let videoId = match[2]
                            logDebug('Video readed from clipboard: ' + videoId)
                            loadMusicByVideoId(videoId)
                        }
                    },
                })

                isClipboardWatcherRunning = true
            }
        }
    }

    function loadMusicByVideoId(videoId) {
        view.webContents.loadURL('https://music.youtube.com/watch?v=' + videoId)
    }

    setTimeout(function() {
        ipcMain.emit('switch-clipboard-watcher')
    }, 1000)

    loadCustomAppScript()
    loadCustomPageScript()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                if (mainWindow.isMinimized()) {
                    mainWindow.restore()
                }
            } else {
                mainWindow.show()
            }
            mainWindow.focus()
        }
    })

    app.whenReady().then(function() {
        checkWindowPosition(settingsProvider.get('window-position')).then(
            visiblePosition => {
                settingsProvider.set('window-position', visiblePosition)
            }
        )

        checkWindowPosition(settingsProvider.get('lyrics-position')).then(
            visiblePosition => {
                settingsProvider.set('lyrics-position', visiblePosition)
            }
        )

        createWindow()
        if (
            !fileSystem.checkIfExists(
                path.join(app.getPath('music') + '/YTMusic/cache.json')
            )
        ) {
            fileSystem.createDir(app.getPath('music') + '/YTMusic')
            fileSystem.writeFile(
                path.join(app.getPath('music') + '/YTMusic/cache.json'),
                JSON.stringify({ playlists: {}, default: [], all: [] })
            )
        }
        tray.createTray(mainWindow, assetsProvider.getIcon('favicon'))

        ipcMain.on('updated-tray-image', function(event, payload) {
            if (settingsProvider.get('settings-shiny-tray'))
                tray.updateImage(payload)
        })
        if (!isDev) {
            updater.checkUpdate(mainWindow, view)

            setInterval(function() {
                updater.checkUpdate(mainWindow, view)
            }, 1 * 60 * 60 * 1000)
        }
        ipcMain.emit('ready', app)
    })

    /*app.on('ready', function(ev) {
    
})*/

    app.on('browser-window-created', function(e, window) {
        window.removeMenu()
    })

    // Quit when all windows are closed.
    app.on('window-all-closed', function() {
        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (!isMac()) {
            app.quit()
        }
    })

    app.on('activate', function() {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (mainWindow === null) {
            createWindow()
        } else {
            mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
        }
    })

    app.on('before-quit', function(e) {
        if (isMac()) {
            app.exit()
        }
        tray.quit()
    })

    app.on('quit', function() {
        tray.quit()
    })
}

ipcMain.on('show-lyrics', function() {
    if (lyrics) {
        lyrics.show()
    } else {
        lyrics = new BrowserWindow({
            frame: windowConfig.frame,
            titleBarStyle: windowConfig.titleBarStyle,
            center: true,
            resizable: true,
            backgroundColor: '#232323',
            width: 700,
            height: 800,
            icon: assetsProvider.getIcon('favicon'),
            webPreferences: {
                nodeIntegration: true,
                webviewTag: true,
            },
        })

        let lyricsPosition = settingsProvider.get('lyrics-position')
        if (lyricsPosition != undefined) {
            lyrics.setPosition(lyricsPosition.x, lyricsPosition.y)
        }

        lyrics.loadFile(
            path.join(
                __dirname,
                './pages/shared/window-buttons/window-buttons.html'
            ),
            {
                search:
                    'page=lyrics/lyrics&icon=music_note&hide=btn-minimize,btn-maximize',
            }
        )

        let storeLyricsPositionTimer
        lyrics.on('move', function(e) {
            let position = lyrics.getPosition()
            if (storeLyricsPositionTimer) {
                clearTimeout(storeLyricsPositionTimer)
            }
            storeLyricsPositionTimer = setTimeout(() => {
                settingsProvider.set('lyrics-position', {
                    x: position[0],
                    y: position[1],
                })
            }, 500)
        })

        lyrics.on('closed', function() {
            lyrics = null
        })

        // lyrics.webContents.openDevTools();
    }
})

ipcMain.on('show-companion', function() {
    const x = mainWindow.getPosition()[0]
    const y = mainWindow.getPosition()[1]
    const width = 800
    const settings = new BrowserWindow({
        // parent: mainWindow,
        skipTaskbar: false,
        frame: windowConfig.frame,
        titleBarStyle: windowConfig.titleBarStyle,
        x: x + width / 2,
        y,
        resizable: false,
        backgroundColor: '#232323',
        width: 800,
        title: 'companionWindowTitle',
        webPreferences: {
            nodeIntegration: false,
        },
        icon: assetsProvider.getIcon('favicon'),
        autoHideMenuBar: true,
    })
    settings.loadURL('companionUrl')
})

function logDebug(data) {
    if (false) {
        console.log(data)
    }
}

function songInfo() {
    return infoPlayerProvider.getTrackInfo()
}

function playerInfo() {
    return infoPlayerProvider.getPlayerInfo()
}

function getAll() {
    return {
        track: songInfo(),
        player: playerInfo(),
    }
}

function bytesToSize(bytes) {
    var sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    if (bytes == 0) return '0 Byte'
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)))
    return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i]
}

function createDocumentsAppDir() {
    if (!fileSystem.checkIfExists(fileSystem.getAppDocumentsPath(app))) {
        isFirstTime = true
        fileSystem.createDir(fileSystem.getAppDocumentsPath(app))
    } else {
        isFirstTime = false
    }
}

function createCustomCSSDir() {
    const dirCustomTheme = path.join(
        fileSystem.getAppDocumentsPath(app),
        '/custom/css'
    )

    if (!fileSystem.checkIfExists(dirCustomTheme)) {
        fileSystem.createDir(dirCustomTheme, { recursive: true })
    }
}

function createCustomCSSPageFile() {
    const customThemeFile = path.join(
        fileSystem.getAppDocumentsPath(app),
        '/custom/css/page.css'
    )

    if (!fileSystem.checkIfExists(customThemeFile)) {
        fileSystem.writeFile(
            customThemeFile,
            `/** \n * Custom css for page \n*/\n\nhtml, body { background: #1D1D1D !important; }`
        )
    }
}

function loadCustomAppScript() {
    const customAppScriptFile = path.join(
        fileSystem.getAppDocumentsPath(app),
        'custom/js/app.js'
    )

    if (fileSystem.checkIfExists(customAppScriptFile)) {
        try {
            require(customAppScriptFile)
        } catch {}
    }
}

function loadCustomPageScript() {
    const customPageScriptFile = path.join(
        fileSystem.getAppDocumentsPath(app),
        'custom/js/page.js'
    )

    if (fileSystem.checkIfExists(customPageScriptFile)) {
        try {
            view.webContents.executeJavaScript(
                fileSystem.readFile(customPageScriptFile).toString()
            )
        } catch {
            console.log('Failed to execute page.js')
        }
    }
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
const mediaControl = require('./providers/mediaProvider')
const tray = require('./providers/trayProvider')
const updater = require('./providers/updateProvider')
const analytics = require('./providers/analyticsProvider')

analytics.setEvent('main', 'start', 'v' + app.getVersion(), app.getVersion())
analytics.setEvent('main', 'os', process.platform, process.platform)
analytics.setScreen('main')
