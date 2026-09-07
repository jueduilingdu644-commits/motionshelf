const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('motionShelf', {
  platform: process.platform,
  selectDirectory: (options) => ipcRenderer.invoke('choose-directory', options),
  openUsbImporter: () => ipcRenderer.invoke('open-usb-importer'),
  revealPath: (targetPath) => ipcRenderer.invoke('reveal-path', targetPath),
  startTransferSession: (libraryPath, language) => ipcRenderer.invoke('start-transfer-session', libraryPath, language),
  stopTransferSession: () => ipcRenderer.invoke('stop-transfer-session'),
  scanDirectory: (directory) => ipcRenderer.invoke('scan-directory', directory),
  createDetailPreview: (filePath) => ipcRenderer.invoke('create-detail-preview', filePath),
  importMediaFiles: (libraryPath, paths) => ipcRenderer.invoke('import-media-files', libraryPath, paths),
  deleteFiles: (libraryPath, paths) => ipcRenderer.invoke('delete-media-files', libraryPath, paths),
  restoreFiles: (libraryPath, entries) => ipcRenderer.invoke('restore-media-files', libraryPath, entries),
  openRecycleBin: (libraryPath) => ipcRenderer.invoke('open-recycle-bin', libraryPath),
  onTransferProgress: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('transfer-progress', listener)
    return () => ipcRenderer.removeListener('transfer-progress', listener)
  },
  onTransferFile: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('transfer-file', listener)
    return () => ipcRenderer.removeListener('transfer-file', listener)
  },
  onTransferConnected: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('transfer-connected', listener)
    return () => ipcRenderer.removeListener('transfer-connected', listener)
  },
  onTransferDuplicate: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('transfer-duplicate', listener)
    return () => ipcRenderer.removeListener('transfer-duplicate', listener)
  },
})
