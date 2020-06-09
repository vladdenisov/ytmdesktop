const { remote, ipcRenderer } = require('electron')

window.ipcRenderer = ipcRenderer
var content = remote.getCurrentWebContents()

content.addListener('dom-ready', function() {
    createContextMenu()

    content
        .executeJavaScript('window.location')
        .then(location => {
            if (location.hostname == 'music.youtube.com') {
                createMiddleContent()
                createRightContent()
                playerBarScrollToChangeVolume()
                createPlayerBarContent()
                createDownloadsButtons()
            } else {
                createOffTheRoadContent()
            }
        })
        .catch(_ => ipcRenderer.send('debug', 'error on inject'))
})
function createDownloadsButtons() {
    content.executeJavaScript(`
    console.log()
  `)
    content.addListener('did-navigate-in-page', (e, url) => {
        if (url.includes('playlist') || url.includes('album'))
            content.executeJavaScript(`
    if (!dButton) var dButton = document.createElement('div')
    dButton.innerHTML = "<i class='material-icons' style='margin-right: 5px'>get_app</i>Download"
    document.getElementById("top-level-buttons").appendChild(dButton)
    dButton.style.border = "1px solid rgb(170,170,170);"
    dButton.style.borderRadius = "2px"
    dButton.style.fontFamily = "Roboto"
    dButton.style.display = "flex"
    dButton.style.justifyContent = "center"
    dButton.style.alignItems = "center"
    dButton.style.padding = "0px 8px"
    dButton.style.marginLeft = "1em"
    dButton.style.cursor = "pointer"
    dButton.addEventListener("click", () => {
      ipcRenderer.send("download-playlist", "${url}")
    })
    `)
    })
    console.log(content.getURL())
    if (content.getURL().includes('playlist')) {
        console.log('playlist')
    }
}
function createContextMenu() {
    content.executeJavaScript(`
        var materialIcons = document.createElement('link');
        materialIcons.setAttribute('href', 'https://fonts.googleapis.com/icon?family=Material+Icons');
        materialIcons.setAttribute('rel', 'stylesheet');

        document.body.prepend(materialIcons);
    `)

    content.insertCSS(`
        #ytmd-menu {
            visibility: hidden;
            opacity: 0;
            position: fixed;
            background: #232323;
            /*color: #AAA;*/
            font-family: sans-serif;

            -webkit-transition: opacity .2s ease-in-out;
            transition: opacity .2s ease-in-out;
            
            padding: 0 !important;
            
            border: 1px solid rgba(255, 255, 255, .08) !important;
            border-radius: 2px !important;

            z-index: 999999 !important;

            min-width: 99px;
        }
    
        #ytmd-menu a {
            color: #AAA;
            display: inline-block;
            cursor: pointer;

            padding: 10px 12px 6px 12px;
        }

        #ytmd-menu a:hover {
            background-color: rgba(255, 255, 255, 0.1);
        }

        .divider {
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            height: 21px;
            display: inline-block;
        }

        .hide {
            visibility: hidden;
        }

        .pointer {
            cursor: pointer;
        }

        .ytmd-icons {
            margin: 0 18px 0 2px !important;
        }

        .pointer:hover {
            color: #FFF !important;
        }

        .center-content {
            padding-top: 12px;
        }

        .btn-disabled {
            color: #000 !important;
        }

        .text-red {
            color: red !important;
        }
    `)

    var menu = `<a id="ytmd-menu-lyrics"><i class="material-icons">music_note</i></a> <a id="ytmd-menu-miniplayer"><i class="material-icons">picture_in_picture_alt</i></a> <a id="ytmd-menu-bug-report"><i class="material-icons text-red">bug_report</i></a>`

    content.executeJavaScript(`
        var menuDiv = document.createElement("div");
        menuDiv.setAttribute('id', 'ytmd-menu');
        menuDiv.innerHTML = '${menu}';
        document.body.prepend(menuDiv);
    `)

    // LISTENERS FOR MENU OPTIONS
    content.executeJavaScript(`
        var menuElement = document.getElementById("ytmd-menu").style;

        var buttonOpenCompanion = document.getElementById('ytmd-menu-companion-server');
        var buttonOpenMiniplayer = document.getElementById('ytmd-menu-miniplayer');
        var buttonOpenLyrics = document.getElementById('ytmd-menu-lyrics');
        var buttonOpenBugReport = document.getElementById('ytmd-menu-bug-report');
        var buttonPageOpenMiniplayer = document.getElementsByClassName('player-minimize-button ytmusic-player')[0];

        document.addEventListener('contextmenu', function (e) {
            var posX = e.clientX;
            var posY = e.clientY;
            showMenu(posX, posY);
            e.preventDefault();
            }, false);
            document.addEventListener('click', function (e) {
            menuElement.opacity = "0";
            setTimeout(function () {
                menuElement.visibility = "hidden";
            }, 501);
        }, false);
        
        if (buttonOpenCompanion) {
            buttonOpenCompanion.addEventListener('click', function() { ipcRenderer.send('show-companion'); } );
        }

        if (buttonOpenLyrics) {
            buttonOpenLyrics.addEventListener('click', function() { ipcRenderer.send('show-lyrics'); } );
        }

        if (buttonOpenMiniplayer) {
            buttonOpenMiniplayer.addEventListener('click', function() { ipcRenderer.send('show-miniplayer'); } );
        }

        if (buttonPageOpenMiniplayer) {
            buttonPageOpenMiniplayer.addEventListener('click', function(e) { /* Temporary fix */ document.getElementsByClassName('player-maximize-button ytmusic-player')[0].click(); ipcRenderer.send('show-miniplayer'); } );
        }
        
        if (buttonOpenBugReport) {
            buttonOpenBugReport.addEventListener('click', function() { ipcRenderer.send('bug-report'); } );
        }

        function showMenu(x, y) {
            menuElement.top = y + "px";
            menuElement.left = x + "px";
            menuElement.visibility = "visible";
            menuElement.opacity = "1";
        }`)
}

function createMiddleContent() {
    content.executeJavaScript(`
        var center_content = document.getElementsByTagName('ytmusic-pivot-bar-renderer')[0];

        // HISTORY BACK
        var element = document.createElement('i');
        element.id = 'ytmd_history_back';
        element.classList.add('material-icons', 'pointer', 'ytmd-icons', 'center-content');
        element.style.color = '#666';
        element.innerText = 'keyboard_backspace';

        element.addEventListener('click', function() { history.go(-1); } )
        
        center_content.prepend(element);
    `)
}

function createRightContent() {
    // ADD BUTTONS TO RIGHT CONTENT (side to the photo)
    content.executeJavaScript(`
        var right_content = document.getElementById('right-content');

        // SETTINGS
        var elementSettings = document.createElement('i');
        elementSettings.id = 'ytmd_settings';
        elementSettings.classList.add('material-icons', 'pointer', 'ytmd-icons');
        elementSettings.style.color = '#909090';
        elementSettings.innerText = 'settings';

        elementSettings.addEventListener('click', function() { ipcRenderer.send('show-settings', true); } )
        
        right_content.prepend(elementSettings);

        // Offline player
        const OPlayer = document.createElement('i')
        OPlayer.id = 'ytmd_settings';
        OPlayer.classList.add('material-icons', 'pointer', 'ytmd-icons');
        OPlayer.style.color = '#909090';
        OPlayer.innerText = 'cloud_download';

        OPlayer.addEventListener('click', function() { ipcRenderer.send('show-offline', true); } )
        
        right_content.prepend(OPlayer);
        
        // UPDATE
        var element = document.createElement('i');
        element.id = 'ytmd_update';
        element.classList.add('material-icons', 'green-text', 'pointer', 'ytmd-icons', 'hide');
        element.style.color = '#4CAF50';
        element.innerText = 'arrow_downward';

        element.addEventListener('click', function() { ipcRenderer.send('btn-update-clicked', true); } )

        right_content.prepend(element);

        ipcRenderer.on('downloaded-new-update', function(e, data) {
            document.getElementById("ytmd_update").classList.remove("hide");
        });
        

        `)
}

function createPlayerBarContent() {
    content.executeJavaScript(`
        var playerBarRightControls = document.getElementsByClassName('right-controls-buttons style-scope ytmusic-player-bar')[0];

        // LYRICS
        var elementLyrics = document.createElement('i');
        elementLyrics.id = 'ytmd_lyrics';
        elementLyrics.classList.add('material-icons', 'pointer', 'ytmd-icons');
        elementLyrics.innerText = 'music_note';

        elementLyrics.addEventListener('click', function() { ipcRenderer.send('show-lyrics', true); } )
        
        playerBarRightControls.append(elementLyrics);

        // MINIPLAYER
        var elementMiniplayer = document.createElement('i');
        elementMiniplayer.id = 'ytmd_miniplayer';
        elementMiniplayer.classList.add('material-icons', 'pointer', 'ytmd-icons');
        elementMiniplayer.innerText = 'picture_in_picture_alt';

        elementMiniplayer.addEventListener('click', function() { ipcRenderer.send('show-miniplayer', true); } )
        playerBarRightControls.append(elementMiniplayer);

        var elementDownload = document.createElement('i');
        elementDownload.id = 'ytmd_download';
        elementDownload.classList.add('material-icons', 'pointer', 'ytmd-icons');
        elementDownload.innerText = 'get_app';

        elementDownload.addEventListener('click', function() { ipcRenderer.send('download-current'); } )
        playerBarRightControls.append(elementDownload);
    `)
}

function playerBarScrollToChangeVolume() {
    content.executeJavaScript(`
        var playerBar = document.getElementsByTagName('ytmusic-player-bar')[0];

        playerBar.addEventListener('wheel', function(ev) {
            ev.preventDefault();
            
            if ( ev.deltaY < 0) {
                ipcRenderer.send('media-command', { command: 'media-volume-up' });
            } else {
                ipcRenderer.send('media-command', { command: 'media-volume-down' });
            }
        });
    `)
}

function createOffTheRoadContent() {
    content.executeJavaScript(
        `
        var body = document.getElementsByTagName('body')[0];

        var elementBack = document.createElement('i');
        elementBack.id = 'ytmd_lyrics';
        elementBack.classList.add('material-icons');
        elementBack.style.cssFloat = "left";
        elementBack.style.cursor = "pointer";
        elementBack.innerText = 'arrow_back';

        elementBack.addEventListener('click', function() { ipcRenderer.send('reset-url') } )
        
        body.prepend(elementBack);
        `
    )
}
