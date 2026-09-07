export {}

declare global {
  interface Window {
    motionShelf?: {
      platform: 'darwin' | 'win32' | 'linux'
      selectDirectory: (options?: { title?: string; buttonLabel?: string }) => Promise<{ canceled: boolean; path: string | null }>
      openUsbImporter: () => Promise<{ ok: boolean; error: string | null }>
      revealPath: (targetPath: string) => Promise<boolean>
      startTransferSession: (libraryPath: string, language?: 'zh-CN' | 'en') => Promise<{ token: string; host: string; port: number; url: string; incomingPath: string; language?: 'zh-CN' | 'en' }>
      stopTransferSession: () => Promise<void>
      scanDirectory: (directory: string) => Promise<Array<{ name: string; path: string; previewPath?: string; detailPreviewPath?: string; size: number; modified: number; mime: string; kind: 'photo' | 'video'; metadata?: MediaMetadata; contentHash?: string }>>
      createDetailPreview: (filePath: string) => Promise<string | null>
      importMediaFiles: (libraryPath: string, paths: string[]) => Promise<{ imported: string[]; duplicates: Array<{ source: string; existing: string; contentHash: string }>; failed: Array<{ path: string; error: string }>; files: Array<{ name: string; path: string; previewPath?: string; size: number; modified: number; mime: string; kind: 'photo' | 'video'; metadata?: MediaMetadata; contentHash?: string }> }>
      deleteFiles: (libraryPath: string, paths: string[]) => Promise<{ deleted: string[]; failed: Array<{ path: string; error: string }>; trashEntries: Array<{ original: string; trash: string | null }> }>
      restoreFiles: (libraryPath: string, entries: Array<{ original: string; trash: string | null }>) => Promise<{ restored: Array<{ original: string; from: string; to: string }>; failed: Array<{ path: string; error: string }> }>
      openRecycleBin: (libraryPath: string) => Promise<{ ok: boolean; error: string | null }>
      onTransferProgress: (callback: (payload: { receivedBytes: number; completedFiles: number; totalFiles?: number; currentFile?: string }) => void) => () => void
      onTransferFile: (callback: (payload: { name: string; path: string; previewPath?: string; detailPreviewPath?: string; size: number; kind: 'photo' | 'video'; metadata?: MediaMetadata; contentHash?: string }) => void) => () => void
      onTransferConnected: (callback: () => void) => () => void
      onTransferDuplicate: (callback: (payload: { name: string; path: string; contentHash?: string }) => void) => () => void
    }
  }
}

interface MediaMetadata {
  make?: string
  model?: string
  date?: string
  latitude?: number
  longitude?: number
  focalLength?: number
  focalLength35mm?: number
  fNumber?: number
  exposureTime?: number
  iso?: number
  exposureBias?: number
  lensModel?: string
  width?: number
  height?: number
  orientation?: string
  software?: string
  whiteBalance?: string
  captureType?: 'normal' | 'slow-motion' | 'time-lapse' | 'cinematic' | 'screen-recording' | 'spatial'
}
