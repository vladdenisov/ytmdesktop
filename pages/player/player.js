//const cacheProvider = require("../../providers/cacheProvider");
const { remote, ipcRenderer: ipc } = require('electron')
const Amplitude = require('amplitudejs')
const path = require('path')
const settingsProvider = require('../../providers/settingsProvider')

const getAverageRGB = imgEl => {
    var blockSize = 5, // only visit every 5 pixels
        defaultRGB = { r: 0, g: 0, b: 0 }, // for non-supporting envs
        canvas = document.createElement('canvas'),
        context = canvas.getContext && canvas.getContext('2d'),
        data,
        width,
        height,
        i = -4,
        length,
        rgb = { r: 0, g: 0, b: 0 },
        count = 0

    if (!context) {
        return defaultRGB
    }

    height = canvas.height =
        imgEl.naturalHeight || imgEl.offsetHeight || imgEl.height
    width = canvas.width =
        imgEl.naturalWidth || imgEl.offsetWidth || imgEl.width

    context.drawImage(imgEl, 0, 0)

    try {
        data = context.getImageData(0, 0, width, height)
    } catch (e) {
        /* security error, img on diff domain */
        return defaultRGB
    }

    length = data.data.length

    while ((i += blockSize * 4) < length) {
        ++count
        rgb.r += data.data[i]
        rgb.g += data.data[i + 1]
        rgb.b += data.data[i + 2]
    }

    // ~~ used to floor values
    rgb.r = ~~(rgb.r / count)
    rgb.g = ~~(rgb.g / count)
    rgb.b = ~~(rgb.b / count)

    return rgb
}
document.addEventListener('DOMContentLoaded', async function() {
    const data = ipc.sendSync('load-downloaded')
    const list_el = document.getElementsByClassName('track_list')[0]
    let songs = []
    console.log(data)
    data.data.all.forEach((song, index) => {
        // list_el.innerHTML += `<div class="song amplitude-song-container amplitude-play-pause" data-amplitude-song-index="${index}">
        //         <span class="song-number-now-playing">
        //           <span class="number">${index}</span>
        //           <img class="now-playing" src="https://521dimensions.com/img/open-source/amplitudejs/examples/flat-black/now-playing.svg"/>
        //         </span>

        //         <div class="song-meta-container">
        //           <span class="song-name" data-amplitude-song-info="name" data-amplitude-song-index="${index}"></span>
        //           <span class="song-artist-album"><span data-amplitude-song-info="artist" data-amplitude-song-index="${index}"></span> - <span data-amplitude-song-info="album" data-amplitude-song-index="${index}"></span></span>
        //         </div>
        //         <span class="song-duration">
        //           ${song.durationHuman}
        //         <span>
        //       </div>`;
        songs.push({
            name: song.title,
            artist: song.author,
            album: song.album,
            cover_art_url: path.join(
                data.path + `/${song.author}/${song.filename}.jpg`
            ),
            url: path.join(data.path + `/${song.author}/${song.filename}.opus`),
        })
    })
    Amplitude.init({
        songs,
        callbacks: {
            song_change: async function() {
                console.log('Audio has been stopped.')
                const audio = Amplitude.getAudio()
                audio.addEventListener('play', () => {
                    document.getElementById('play-pause').innerHTML = 'pause'
                    console.log('Audio has been started.')
                    ipc.send('media-stop')
                })
                audio.addEventListener('pause', () => {
                    document.getElementById('play-pause').innerHTML =
                        'play_arrow'
                })
                audio.volume =
                    document.getElementsByClassName(
                        'amplitude-volume-slider'
                    )[0].value / 100
                navigator.mediaDevices.enumerateDevices().then(devices => {
                    var audioDevices = devices.filter(
                        device => device.kind === 'audiooutput'
                    )
                    var result = audioDevices.filter(
                        deviceInfo =>
                            deviceInfo.label ==
                            settingsProvider.get('settings-app-audio-output')
                    )
                    if (result.length) {
                        audio.setSinkId(result[0].deviceId)
                    }
                })
                console.log(audio)
            },
            initialized: async () => {
                const audio = Amplitude.getAudio()
                audio.addEventListener('play', () => {
                    document.getElementById('play-pause').innerHTML = 'pause'
                    console.log('Audio has been started.')
                    ipc.send('media-stop')
                })
                audio.addEventListener('pause', () => {
                    document.getElementById('play-pause').innerHTML =
                        'play_arrow'
                })
                navigator.mediaDevices.enumerateDevices().then(devices => {
                    var audioDevices = devices.filter(
                        device => device.kind === 'audiooutput'
                    )
                    var result = audioDevices.filter(
                        deviceInfo =>
                            deviceInfo.label ==
                            settingsProvider.get('settings-app-audio-output')
                    )
                    if (result.length) {
                        audio.setSinkId(result[0].deviceId)
                    }
                })
                console.log(audio)
                console.log(audio)
            },
        },
        debug: true,
    })
    ipc.send('oPlayer_ready')
    ipc.on('media-started', e => {
        console.log('recieved')
        Amplitude.pause()
    })
    const img = document.getElementsByClassName('main-album-art')[0]
    img.addEventListener('load', async () => {
        const rgb = getAverageRGB(img)
        console.log(rgb)
        document.getElementsByTagName(
            'body'
        )[0].style.backgroundColor = `rgba(${rgb.r},${rgb.g},${rgb.b}, 0.3)`
    })
    ipc.on('new-download', (e, song) => {
        console.log(song)
        Amplitude.addSong({
            name: song.title,
            artist: song.author,
            album: song.album,
            cover_art_url: path.join(
                data.path + `/${song.author}/${song.filename}.jpg`
            ),
            url: path.join(data.path + `/${song.author}/${song.filename}.opus`),
        })
    })
})
