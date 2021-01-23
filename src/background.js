import fs from 'fs';
import tmp from 'tmp';
import {
    app,
    BrowserWindow,
    clipboard,
    dialog,
    globalShortcut,
    ipcMain,
    Menu,
    powerMonitor,
    protocol,
    session,
    shell,
    Tray,
} from 'electron';
import Screenshots from "electron-screenshots";
import windowStateKeeper from 'electron-window-state';
import i18n from 'i18n';
import proto from '../marswrapper.node';

import pkg from '../package.json';
import Badge from 'electron-windows-badge';
import {createProtocol} from "vue-cli-plugin-electron-builder/lib";

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
    {scheme: 'app', privileges: {secure: true, standard: true, bypassCSP: true}}
])

const isDevelopment = process.env.NODE_ENV !== 'production'

const workingDir = isDevelopment ? `${__dirname}/public` : `${__dirname}`;

let Locales = {};
i18n.configure({
    locales: ['en', 'ch'],
    directory: workingDir + '/locales',
    register: Locales
});
Locales.setLocale('ch');

global.sharedObj = {proto: proto};

let forceQuit = false;
let downloading = false;
let mainWindow;
let winBadge;
let screenshots;
let tray;
let downloadFileMap = new Map()
let settings = {};
let isFullScreen = false;
let isMainWindowFocusedWhenStartScreenshot = false;
let isOsx = process.platform === 'darwin';
let isWin = !isOsx;

let isSuspend = false;
let userData = app.getPath('userData');
let imagesCacheDir = `${userData}/images`;
let voicesCacheDir = `${userData}/voices`;
let mainMenu = [
    {
        label: pkg.name,
        submenu: [
            {
                label: `About ${pkg.name}`,
                selector: 'orderFrontStandardAboutPanel:',
            },
            {
                label: Locales.__('Main').Preferences,
                accelerator: 'Cmd+,',
                click() {
                    mainWindow.show();
                    mainWindow.webContents.send('show-settings');
                }
            },
            {
                type: 'separator'
            },
            {
                role: 'hide'
            },
            {
                role: 'hideothers'
            },
            {
                role: 'unhide'
            },
            {
                label: Locales.__('Main').Check,
                accelerator: 'Cmd+U',
                click() {
                    checkForUpdates();
                }
            },
            {
                type: 'separator'
            },
            {
                label: Locales.__('Main').Quit,
                accelerator: 'Command+Q',
                selector: 'terminate:',
                click() {
                    forceQuit = true;
                    mainWindow = null;
                    disconnectAndQuit();
                }
            }
        ]
    },
    {
        label: Locales.__('File').Title,
        submenu: [
            {
                label: Locales.__('File').New,
                accelerator: 'Cmd+N',
                click() {
                    mainWindow.show();
                    mainWindow.webContents.send('show-newchat');
                }
            },
            {
                label: Locales.__('File').Search,
                accelerator: 'Cmd+F',
                click() {
                    mainWindow.show();
                    mainWindow.webContents.send('show-search');
                }
            },
            {
                type: 'separator',
            },
            {
                label: Locales.__('File').InsertEmoji,
                accelerator: 'Cmd+I',
                click() {
                    mainWindow.show();
                    mainWindow.webContents.send('show-emoji');
                }
            },
            {
                type: 'separator',
            },
            {
                label: Locales.__('File').Next,
                accelerator: 'Cmd+J',
                click() {
                    mainWindow.show();
                    mainWindow.webContents.send('show-next');
                }
            },
            {
                label: Locales.__('File').Prev,
                accelerator: 'Cmd+K',
                click() {
                    mainWindow.show();
                    mainWindow.webContents.send('show-previous');
                }
            },
        ]
    },
    // {
    //     label: Locales.__('Conversations').Title,
    //     submenu: [
    //         {
    //             label: Locales.__('Conversations').Loading,
    //         }
    //     ],
    // },
    // {
    //     label: Locales.__('Contacts').Title,
    //     submenu: [
    //         {
    //             label: Locales.__('Contacts').Loading,
    //         }
    //     ],
    // },
    {
        label: Locales.__('Edit').Title,
        submenu: [
            {
                role: 'undo',
                label: Locales.__('Edit').Undo
            },
            {
                role: 'redo',
                label: Locales.__('Edit').Redo
            },
            {
                type: 'separator'
            },
            {
                role: 'cut',
                label: Locales.__('Edit').Cut
            },
            {
                role: 'copy',
                label: Locales.__('Edit').Copy
            },
            {
                role: 'paste',
                label: Locales.__('Edit').Paste
            },
            {
                role: 'pasteandmatchstyle',
                label: Locales.__('Edit').PasteMatch
            },
            {
                role: 'delete',
                label: Locales.__('Edit').Delete
            },
            {
                role: 'selectall',
                label: Locales.__('Edit').SelectAll
            }
        ]
    },
    {
        label: Locales.__('View').Title,
        submenu: [
            {
                label: isFullScreen ? Locales.__('View').ExitFull : Locales.__('View').EnterFull,
                accelerator: 'Shift+Cmd+F',
                click() {
                    isFullScreen = !isFullScreen;

                    mainWindow.show();
                    mainWindow.setFullScreen(isFullScreen);
                }
            },
            {
                label: Locales.__('View').ToggleConversations,
                accelerator: 'Shift+Cmd+M',
                click() {
                    mainWindow.show();
                    mainWindow.webContents.send('show-conversations');
                }
            },
            {
                type: 'separator',
            },
            {
                type: 'separator',
            },
            {
                role: 'toggledevtools',
                label: Locales.__('View').ToggleDevtools
            },
            {
                role: 'togglefullscreen',
                label: Locales.__('View').ToggleFull
            }
        ]
    },
    {
        lable: Locales.__('Window').Title,
        role: 'window',
        submenu: [
            {
                lable: Locales.__('Window').Min,
                role: 'minimize'
            },
            {
                lable: Locales.__('Window').Close,
                role: 'close'
            }
        ]
    },
    {
        lable: Locales.__('Help').Title,
        role: 'help',
        submenu: [
            {
                label: Locales.__('Help').FeedBack,
                click() {
                    shell.openExternal('https://github.com/wildfirechat/vue-pc-chat/issues');
                }
            },
            {
                label: Locales.__('Help').Fork,
                click() {
                    shell.openExternal('https://github.com/wildfirechat/vue-pc-chat');
                }
            },
            {
                type: 'separator'
            },
            {
                role: 'reload',
                label: Locales.__('Help').Reload
            },
            {
                role: 'forcereload',
                label: Locales.__('Help').ForceReload
            },
        ]
    }
];
let trayMenu = [
    {
        label: '切换主窗口',
        click() {
            let isVisible = mainWindow.isVisible();
            isVisible ? mainWindow.hide() : mainWindow.show();
        }
    },
    {
        type: 'separator'
    },
    {
        label: Locales.__('Help').Fork,
        click() {
            shell.openExternal('https://github.com/wildfirechat/vue-pc-chat');
        }
    },
    {
        label: Locales.__('View').ToggleDevtools,
        accelerator: 'Alt+Command+I',
        click() {
            mainWindow.show();
            mainWindow.toggleDevTools();
        }
    },
    {
        type: 'separator'
    },
    {
        label: Locales.__('Main').Quit,
        accelerator: 'Command+Q',
        selector: 'terminate:',
        click() {
            forceQuit = true;
            mainWindow = null;
            global.sharedObj.proto.disconnect(0);
            console.log('--------------- disconnect', global.sharedObj.proto);
            var now = new Date();
            var exitTime = now.getTime() + 1000;
            while (true) {
                now = new Date();
                if (now.getTime() > exitTime)
                    break;
            }
            app.exit(0);
        }
    }
];
const icon = `${workingDir}/images/dock.png`;
let blink = null

function checkForUpdates() {
    if (downloading) {
        dialog.showMessageBox({
            type: 'info',
            buttons: ['OK'],
            title: pkg.name,
            message: `Downloading...`,
            detail: `Please leave the app open, the new version is downloading. You'll receive a new dialog when downloading is finished.`
        });

        return;
    }

}

function updateTray(unread = 0) {
    settings.showOnTray = true;

    if (settings.showOnTray) {
        if (tray
            && updateTray.lastUnread === unread) {
            return;
        }

        let contextmenu = Menu.buildFromTemplate(trayMenu);
        let icon;
        if (!isOsx) {
            icon = `${workingDir}/images/icon.png`;
        } else {
            icon = `${workingDir}/images/tray.png`;
        }


        // Make sure the last tray has been destroyed
        setTimeout(() => {
            if (!tray) {
                // Init tray icon
                tray = new Tray(icon);

                tray.on('right-click', () => {
                    tray.popUpContextMenu(contextmenu);
                });

                tray.on('click', () => {
                    mainWindow.show();
                });
            }

            if (isOsx) {
                tray.setTitle(unread > 0 ? ' ' + unread : '');
            }

            tray.setImage(icon);
            execBlink(unread > 0);
            // Avoid tray icon been recreate
            updateTray.lastUnread = unread;
        });
    } else {
        if (!tray) return;

        // if (!isOsx) {
        tray.destroy();
        // }
        tray = null;
    }


}

function createMenu() {
    var menu = Menu.buildFromTemplate(mainMenu);

    if (isOsx) {
        Menu.setApplicationMenu(menu);
    } else {
        mainWindow.setMenu(null);
    }
}

function regShortcut() {
    // if(isWin) {
    globalShortcut.register('CommandOrControl+G', () => {
        mainWindow.webContents.toggleDevTools();
    })
    // }
}

const createMainWindow = async () => {
    var mainWindowState = windowStateKeeper({
        defaultWidth: 1080,
        defaultHeight: 720,
    });

    mainWindow = new BrowserWindow({
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: 1080,
        height: 720,
        minWidth: 800,
        minHeight: 480,
        titleBarStyle: 'hidden',
        backgroundColor: 'none',
        // 以下两属性设置时会导致win不能正常unmaximize. electron bug
        // transparent: true,
        // resizable: false,
        webPreferences: {
            scrollBounce: true,
            nodeIntegration: true,
            nativeWindowOpen: true,
            webSecurity: false,
        },
        frame: !isWin,
        icon
    });
    const badgeOptions = {}
    winBadge = new Badge(mainWindow, badgeOptions);

    if (process.env.WEBPACK_DEV_SERVER_URL) {
        // Load the url of the dev server if in development mode
        await mainWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
        if (!process.env.IS_TEST) mainWindow.webContents.openDevTools()
    } else {
        createProtocol('app')
        // Load the index.html when not in development
        mainWindow.loadURL('app://./index.html')
    }
    mainWindow.webContents.on('did-finish-load', () => {
        try {
            mainWindow.show();
            mainWindow.focus();
        } catch (ex) {
            // do nothing
        }
    });

    mainWindow.webContents.on('new-window', (event, url) => {
        event.preventDefault();
        console.log('new-windows', url)
        shell.openExternal(url);
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        // do default action
        // event.preventDefault();
        // console.log('navigate', url)
        // shell.openExternal(url);
    });

    mainWindow.on('close', e => {
        if (forceQuit || !tray) {
            mainWindow = null;
            disconnectAndQuit();
        } else {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
        // 设置保存路径,使Electron不提示保存对话框。
        // item.setSavePath('/tmp/save.pdf')
        let fileName = downloadFileMap.get(item.getURL()).fileName;
        item.setSaveDialogOptions({defaultPath: fileName})

        item.on('updated', (event, state) => {
            if (state === 'interrupted') {
                console.log('Download is interrupted but can be resumed')
            } else if (state === 'progressing') {
                if (item.isPaused()) {
                    console.log('Download is paused')
                } else {
                    console.log(`Received bytes: ${item.getReceivedBytes()}, ${item.getTotalBytes()}`)
                    let messageId = downloadFileMap.get(item.getURL()).messageId
                    mainWindow.webContents.send('file-download-progress', {
                            messageId: messageId,
                            receivedBytes: item.getReceivedBytes(),
                            totalBytes: item.getTotalBytes()
                        }
                    );
                }
            }
        })
        item.once('done', (event, state) => {
            let messageId = downloadFileMap.get(item.getURL()).messageId
            if (state === 'completed') {
                console.log('Download successfully')
                mainWindow.webContents.send('file-downloaded', {messageId: messageId, filePath: item.getSavePath()});
            } else {
                mainWindow.webContents.send('file-download-failed', {messageId: messageId});
                console.log(`Download failed: ${state}`)
            }
            downloadFileMap.delete(item.getURL());
        })
    })

    ipcMain.on('screenshots-start', (event, args) => {
        // console.log('main voip-message event', args);
        isMainWindowFocusedWhenStartScreenshot = true;
        screenshots.startCapture();
    });

    ipcMain.on('voip-message', (event, args) => {
        // console.log('main voip-message event', args);
        mainWindow.webContents.send('voip-message', args);
    });

    ipcMain.on('update-call-start-message', (event, args) => {
        // console.log('main update-call-start-message event', args);
        mainWindow.webContents.send('update-call-start-message', args);
    });

    ipcMain.on('conference-request', (event, args) => {
        // console.log('main voip-message event', args);
        mainWindow.webContents.send('conference-request', args);
    });

    ipcMain.on('click-notification', (event, args) => {
        if (!mainWindow.isVisible()) {
            mainWindow.show();
            mainWindow.focus();
        }
    });

    ipcMain.on('exec-blink', (event, args) => {
        var isBlink = args.isBlink;
        execBlink(isBlink, args.interval);
    });

    ipcMain.on('message-unread', (event, args) => {
        let count = args.count;
        //if (settings.showOnTray) {
        updateTray(count);
        app.badgeCount = count;
        //}
    });

    ipcMain.on('file-paste', (event) => {
        var image = clipboard.readImage();
        var args = {hasImage: false};

        if (!image.isEmpty()) {
            let filename = tmp.tmpNameSync() + '.png';

            args = {
                hasImage: true,
                filename: filename,
                raw: image.toPNG(),
            };

            fs.writeFileSync(filename, image.toPNG());
        }

        event.returnValue = args;
    });

    ipcMain.on('file-download', async (event, args) => {
        var filename = args.remotePath;
        var messageId = args.messageId;
        filename = filename.replace(':80', '');
        downloadFileMap.set(encodeURI(filename), {messageId: messageId, fileName: args.fileName});

        mainWindow.webContents.loadURL(filename)
    });

    // 直接在ui层处理了
    // ipcMain.on('open-file', async (event, filename) => {
    //     shell.openItem(filename);
    // });
    //
    // ipcMain.on('open-folder', async (event, dir) => {
    //     shell.openItem(dir);
    // });

    ipcMain.on('open-map', (event, args) => {
        event.preventDefault();
        shell.openExternal(args.map);
    });

    ipcMain.on('is-suspend', (event, args) => {
        event.returnValue = isSuspend;
    });

    ipcMain.once('logined', event => {
        mainWindow.setResizable(true);
        mainWindow.setSize(mainWindowState.width, mainWindowState.height);
        mainWindow.setMinimumSize(800, 480);
        mainWindowState.manage(mainWindow);
    });

    powerMonitor.on('resume', () => {
        isSuspend = false;
        mainWindow.webContents.send('os-resume');
    });

    powerMonitor.on('suspend', () => {
        isSuspend = true;
    });

    if (isOsx) {
        app.setAboutPanelOptions({
            applicationName: pkg.name,
            applicationVersion: pkg.version,
            copyright: 'Made with 💖 by wildfiechat. \n https://github.com/wildfirechat/vue-pc-chat',
            version: pkg.version
        });
    }

    [imagesCacheDir, voicesCacheDir].map(e => {
        if (!fs.existsSync(e)) {
            fs.mkdirSync(e);
        }
    });

    mainWindow.webContents.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/603.3.8 (KHTML, like Gecko) Version/10.1.2 Safari/603.3.8');
    createMenu();
    regShortcut();
};

app.setName(pkg.name);
app.dock && app.dock.setIcon(icon);

if (!app.requestSingleInstanceLock()) {
    console.log('only allow start one instance!')
    app.quit()
}

app.on('second-instance', () => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.focus()
        mainWindow.show()
    }
})

function registerLocalResourceProtocol() {
    protocol.registerFileProtocol('local-resource', (request, callback) => {
        const url = request.url.replace(/^local-resource:\/\//, '')
        // Decode URL to prevent errors when loading filenames with UTF-8 chars or chars like "#"
        const decodedUrl = decodeURI(url) // Needed in case URL contains spaces
        try {
            return callback(decodedUrl)
        } catch (error) {
            console.error('ERROR: registerLocalResourceProtocol: Could not get file path:', error)
        }
    })
}

app.on('ready', () => {
        createMainWindow();

        registerLocalResourceProtocol();

        screenshots = new Screenshots()
        globalShortcut.register('ctrl+shift+a', () => {
            isMainWindowFocusedWhenStartScreenshot = mainWindow.isFocused();
            screenshots.startCapture()
        });
        // 点击确定按钮回调事件
        screenshots.on('ok', (e, {viewer}) => {
            if (isMainWindowFocusedWhenStartScreenshot) {
                mainWindow.webContents.send('screenshots-ok');
            }
            console.log('capture', viewer)
        })
        // 点击取消按钮回调事件
        screenshots.on('cancel', () => {
            // console.log('capture', 'cancel1')
        })
        screenshots.on('cancel', e => {
            // 执行了preventDefault
            // 点击取消不会关闭截图窗口
            // e.preventDefault()
            // console.log('capture', 'cancel2')
        })
        // 点击保存按钮回调事件
        screenshots.on('save', (e, {viewer}) => {
            console.log('capture', viewer)
        })
        session.defaultSession.webRequest.onBeforeSendHeaders(
            (details, callback) => {
                // 可根据实际需求，配置 Origin，默认置为空
                details.requestHeaders.Origin = '';
                callback({cancel: false, requestHeaders: details.requestHeaders});
            }
        );
        try {
            updateTray()
        } catch (e) {
            // do nothing
        }
    }
);

// app.on('window-all-closed', () => {
//     if (process.platform !== 'darwin') {
//         app.quit()
//     }
// })

app.on('before-quit', () => {
    // Fix issues #14
    forceQuit = true;

    if (!tray) return;
    // if (!isOsx) {
    tray.destroy();
    // }
});
app.on('activate', e => {
    if (!mainWindow.isVisible()) {
        mainWindow.show();
    }
});

function disconnectAndQuit() {
    global.sharedObj.proto.disconnect(0);
    var now = new Date();
    var exitTime = now.getTime() + 500;
    while (true) {
        now = new Date();
        if (now.getTime() > exitTime)
            break;
    }
    app.quit();
}

function clearBlink() {
    if (blink) {
        clearInterval(blink)
    }
    blink = null
}

function execBlink(flag, _interval) {
    let interval = _interval ? _interval : 500;
    let icons;
    icons = [`${workingDir}/images/tray.png`,
        `${workingDir}/images/Remind_icon.png`];

    let count = 0;
    if (flag) {
        if (blink) {
            return;
        }
        blink = setInterval(function () {
            toggleTrayIcon(icons[count++]);
            count = count > 1 ? 0 : 1;
        }, interval);
    } else {
        clearBlink();
        toggleTrayIcon(icons[0]);
    }

}

function toggleTrayIcon(icon) {
    tray.setImage(icon);
}

