import { ChangeEvent, DragEvent, createContext, memo, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  ArrowRight,
  ArrowCounterClockwise,
  ArrowLeft,
  CaretDown,
  Check,
  CheckSquare,
  CircleNotch,
  CloudArrowUp,
  Copy,
  DeviceMobile,
  FolderOpen,
  Folders,
  GearSix,
  HardDrives,
  Heart,
  ImageSquare,
  Info,
  MagnifyingGlass,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  MapPin,
  Moon,
  Play,
  Plus,
  QrCode,
  SlidersHorizontal,
  Sparkle,
  Stack,
  Sun,
  Tag,
  Trash,
  Translate,
  VideoCamera,
  WarningCircle,
  WifiHigh,
  X,
} from '@phosphor-icons/react'
import QRCode from 'qrcode'
import { AppLanguage, LanguageMode, resolveLanguage, translate } from './i18n'

type Screen = 'onboarding' | 'library'
type LibraryTab = 'all' | 'live' | 'videos' | 'favorites' | 'trash' | 'settings'
type VideoSubtype = 'normal' | 'slow-motion' | 'time-lapse' | 'cinematic' | 'screen-recording' | 'spatial'

type MediaMetadata = {
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
  captureType?: VideoSubtype
}

type MediaCard = {
  id: string
  title: string
  date: string
  place: string
  device: string
  type: 'photo' | 'live' | 'motion' | 'video'
  tone: string
  selected?: boolean
  src?: string
  originalSrc?: string
  previewSrc?: string
  detailSrc?: string
  mime?: string
  motionSrc?: string
  videoSubtype?: VideoSubtype
  metadata?: MediaMetadata
  contentHash?: string
  sourcePaths?: string[]
}

type TrashRecord = {
  id: string
  item: MediaCard
  deletedAt: string
  entries: Array<{ original: string; trash: string | null }>
}

type OriginRect = { left: number; top: number; width: number; height: number; radius: number }

const tabLabels: Record<LibraryTab, string> = {
  all: '全部媒体',
  live: '实况照片',
  videos: '视频',
  favorites: '收藏',
  trash: '回收站',
  settings: '设置',
}

const videoSubtypeLabels: Record<VideoSubtype, string> = {
  normal: '视频',
  'slow-motion': '慢动作',
  'time-lapse': '延时摄影',
  cinematic: '电影效果',
  'screen-recording': '屏幕录制',
  spatial: '空间视频',
}

const videoSubtypeOrder: VideoSubtype[] = ['normal', 'slow-motion', 'time-lapse', 'cinematic', 'screen-recording', 'spatial']

const I18nContext = createContext<{ language: AppLanguage; t: (key: string) => string }>({ language: 'zh-CN', t: (key) => key })

function useI18n() {
  return useContext(I18nContext)
}

function App() {
  const persistedPath = window.localStorage.getItem('motionshelf.libraryPath') || ''
  const initialScreen: Screen = new URLSearchParams(window.location.search).get('view') === 'library' || persistedPath ? 'library' : 'onboarding'
  const [screen, setScreen] = useState<Screen>(initialScreen)
  const [libraryPath, setLibraryPath] = useState(persistedPath)
  const [mediaItems, setMediaItems] = useState<MediaCard[]>([])
  const [trashItems, setTrashItems] = useState<TrashRecord[]>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem('motionshelf.trashItems') || '[]')
      return Array.isArray(stored)
        ? stored
          .filter((record) => record && typeof record.id === 'string' && record.item)
          .map((record) => ({ ...record, entries: Array.isArray(record.entries) ? record.entries.filter((entry: { original?: unknown; trash?: unknown }) => typeof entry?.original === 'string') : [] }))
        : []
    } catch {
      return []
    }
  })
  const [storageName, setStorageName] = useState('选择一个文件夹')
  const [isPickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<'library' | 'import'>('library')
  const [isImportMenuOpen, setImportMenuOpen] = useState(false)
  const [isUsbGuideOpen, setUsbGuideOpen] = useState(false)
  const [isUsbReviewOpen, setUsbReviewOpen] = useState(false)
  const [usbCandidates, setUsbCandidates] = useState<MediaCard[]>([])
  const [usbFolderName, setUsbFolderName] = useState('')
  const [activeTab, setActiveTab] = useState<LibraryTab>('all')
  const [isTabPending, startTabTransition] = useTransition()
  const [videoSubtypeFilter, setVideoSubtypeFilter] = useState<VideoSubtype | 'all'>('all')
  const [query, setQuery] = useState('')
  const [selectedMedia, setSelectedMedia] = useState<MediaCard | null>(null)
  const [selectedOrigin, setSelectedOrigin] = useState<OriginRect | null>(null)
  const [viewerDirection, setViewerDirection] = useState<'next' | 'previous' | null>(null)
  const [viewerToken, setViewerToken] = useState(0)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem('motionshelf.favoriteIds') || '[]')
      return new Set(Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : [])
    } catch {
      return new Set()
    }
  })
  const [isImporting, setImporting] = useState(false)
  const [isDark, setDark] = useState(() => window.localStorage.getItem('motionshelf.theme') === 'dark')
  const [autoPlayLivePhotos, setAutoPlayLivePhotos] = useState(() => window.localStorage.getItem('motionshelf.autoPlayLivePhotos') !== 'false')
  const [adaptivePerformance, setAdaptivePerformance] = useState(() => window.localStorage.getItem('motionshelf.adaptivePerformance') !== 'false')
  const [languageMode, setLanguageMode] = useState<LanguageMode>(() => {
    const stored = window.localStorage.getItem('motionshelf.languageMode')
    return stored === 'zh-CN' || stored === 'en' || stored === 'system' ? stored : 'system'
  })
  const language = resolveLanguage(languageMode, navigator.languages?.length ? navigator.languages : [navigator.language])
  const i18n = useMemo(() => ({ language, t: (key: string) => translate(language, key) }), [language])
  const t = i18n.t
  const languageRef = useRef(language)
  languageRef.current = language
  const [performanceReduced, setPerformanceReduced] = useState(false)
  const [transferSession, setTransferSession] = useState<{ token: string; host: string; port: number; url: string; incomingPath: string } | null>(null)
  const [transferQr, setTransferQr] = useState('')
  const [transferProgress, setTransferProgress] = useState({ receivedBytes: 0, completedFiles: 0, totalFiles: 0, currentFile: '' })
  const [phoneConnected, setPhoneConnected] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteConfirmIds, setDeleteConfirmIds] = useState<string[] | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const selectedMediaId = selectedMedia?.id

  useEffect(() => {
    const item = selectedMedia
    const sourcePath = item?.sourcePaths?.[0]
    if (!item || !sourcePath || item.detailSrc || !window.motionShelf?.createDetailPreview) return
    let cancelled = false
    void window.motionShelf.createDetailPreview(sourcePath).then((detailPath) => {
      if (cancelled || !detailPath) return
      const detailSrc = mediaSource(detailPath)
      setMediaItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, detailSrc } : candidate))
      setSelectedMedia((current) => current?.id === item.id ? { ...current, detailSrc } : current)
    })
    return () => { cancelled = true }
  }, [selectedMediaId])

  useEffect(() => {
    window.localStorage.setItem('motionshelf.favoriteIds', JSON.stringify([...favoriteIds]))
  }, [favoriteIds])

  useEffect(() => {
    window.localStorage.setItem('motionshelf.trashItems', JSON.stringify(trashItems.slice(0, 200)))
  }, [trashItems])

  useEffect(() => {
    window.localStorage.setItem('motionshelf.autoPlayLivePhotos', String(autoPlayLivePhotos))
  }, [autoPlayLivePhotos])

  useEffect(() => {
    window.localStorage.setItem('motionshelf.theme', isDark ? 'dark' : 'light')
  }, [isDark])

  useEffect(() => {
    window.localStorage.setItem('motionshelf.adaptivePerformance', String(adaptivePerformance))
  }, [adaptivePerformance])

  useEffect(() => {
    window.localStorage.setItem('motionshelf.languageMode', languageMode)
    document.documentElement.lang = language
    document.title = 'MotionShelf'
  }, [language, languageMode])

  // Sample the renderer only while the app is visible.  A low core/memory
  // budget or sustained frame times above ~24ms switches off the expensive
  // blur/glow layers, while all media and interactions remain available.
  useEffect(() => {
    if (!adaptivePerformance) {
      setPerformanceReduced(false)
      return
    }
    const nav = navigator as Navigator & { deviceMemory?: number }
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const lowHardware = (Number.isFinite(nav.hardwareConcurrency) && nav.hardwareConcurrency <= 4) || (nav.deviceMemory !== undefined && nav.deviceMemory <= 4) || prefersReducedMotion
    let frames = 0
    let startedAt = performance.now()
    let animationFrame = 0
    let mounted = true
    const sample = () => {
      frames += 1
      if (mounted) animationFrame = window.requestAnimationFrame(sample)
    }
    const evaluate = () => {
      const now = performance.now()
      const elapsed = now - startedAt
      const averageFrame = frames > 0 ? elapsed / frames : 0
      if (mounted) setPerformanceReduced(lowHardware || averageFrame > 24)
      frames = 0
      startedAt = now
    }
    animationFrame = window.requestAnimationFrame(sample)
    const interval = window.setInterval(evaluate, 1800)
    return () => {
      mounted = false
      window.cancelAnimationFrame(animationFrame)
      window.clearInterval(interval)
    }
  }, [adaptivePerformance])

  useEffect(() => {
    if (!window.motionShelf) return
    const disposeProgress = window.motionShelf.onTransferProgress((payload) => {
      setTransferProgress({ receivedBytes: payload.receivedBytes, completedFiles: payload.completedFiles, totalFiles: payload.totalFiles || 0, currentFile: payload.currentFile || '' })
      setImporting(!(payload.totalFiles && payload.completedFiles >= payload.totalFiles))
    })
    const disposeConnected = window.motionShelf.onTransferConnected(() => setPhoneConnected(true))
    const duplicateNames: string[] = []
    let duplicateTimer: number | undefined
    const disposeDuplicate = window.motionShelf.onTransferDuplicate((payload) => {
      duplicateNames.push(payload.name)
      if (duplicateTimer !== undefined) window.clearTimeout(duplicateTimer)
      duplicateTimer = window.setTimeout(() => {
        const names = [...new Set(duplicateNames)]
        duplicateNames.length = 0
        window.alert(languageRef.current === 'en' ? `${names.length} duplicate item(s) were skipped. One computer copy was kept:\n\n${names.map((name) => `· ${name}`).join('\n')}` : `检测到 ${names.length} 个重复项目，已跳过导入并保留电脑中的一个样本：\n\n${names.map((name) => `· ${name}`).join('\n')}`)
      }, 280)
    })
    const disposeFile = window.motionShelf.onTransferFile((payload) => {
      setPhoneConnected(true)
      const item: MediaCard = {
        id: payload.path,
        title: payload.name.replace(/\.[^/.]+$/, ''),
        date: formatMediaDate(payload.metadata?.date, '刚刚导入', languageRef.current),
        place: formatMediaPlace(payload.metadata, languageRef.current),
        device: formatMediaDevice(payload.metadata, languageRef.current),
        type: payload.kind,
        tone: 'tone-lake',
        src: mediaSource(payload.previewPath || payload.path),
        originalSrc: mediaSource(payload.path),
        previewSrc: payload.previewPath ? mediaSource(payload.previewPath) : undefined,
        detailSrc: payload.detailPreviewPath ? mediaSource(payload.detailPreviewPath) : undefined,
        mime: mimeFromName(payload.name),
        videoSubtype: payload.kind === 'video' ? classifyVideoSubtype(payload.name, payload.metadata) : undefined,
        metadata: payload.metadata,
        contentHash: payload.contentHash,
        sourcePaths: [payload.path],
      }
      setMediaItems((current) => mergeMediaCards(current, item))
    })
    return () => {
      disposeProgress()
      disposeConnected()
      disposeDuplicate()
      if (duplicateTimer !== undefined) window.clearTimeout(duplicateTimer)
      disposeFile()
      void window.motionShelf?.stopTransferSession()
    }
  }, [])

  useEffect(() => {
    if (!window.motionShelf || screen !== 'library' || !libraryPath) return
    const incomingPath = `${libraryPath.replace(/[\\/]+$/, '')}/Incoming`
    void window.motionShelf.scanDirectory(incomingPath).then((files) => {
      const imported = files.map((file, index) => pathToMediaCard(file, index))
      if (!imported.length) return
      setMediaItems((current) => imported.reduce((items, item) => mergeMediaCards(items, item), current))
    })
  }, [libraryPath, screen])

  useEffect(() => {
    if (!transferSession) {
      setTransferQr('')
      return
    }
    void QRCode.toDataURL(transferSession.url, {
      width: 250,
      margin: 1,
      color: { dark: '#17201d', light: '#ffffff' },
    }).then(setTransferQr)
  }, [transferSession])

  const selectFolder = async (mode: 'library' | 'import') => {
    if (window.motionShelf) {
      const result = await window.motionShelf.selectDirectory({
        title: mode === 'library' ? (language === 'en' ? 'Choose MotionShelf Library Location' : '选择 MotionShelf 媒体库存储位置') : t('选择手机照片文件夹'),
        buttonLabel: mode === 'library' ? (language === 'en' ? 'Use This Location' : '使用此位置') : t('选择文件夹'),
      })
      if (result.canceled || !result.path) return
      const folder = result.path.split(/[\\/]/).filter(Boolean).pop() || result.path
      if (mode === 'library') {
        setStorageName(folder)
        setLibraryPath(result.path)
        window.localStorage.setItem('motionshelf.libraryPath', result.path)
      } else {
        setScreen('library')
        setImporting(true)
        const candidates = await window.motionShelf.scanDirectory(result.path)
        const resultImport = await window.motionShelf.importMediaFiles(libraryPath, candidates.map((file) => file.path))
        const imported = resultImport.files.map((file, index) => pathToMediaCard(file, index))
        if (imported.length) {
          setMediaItems((current) => imported.reduce((items, item) => mergeMediaCards(items, item), current))
        }
        if (resultImport.duplicates.length) window.alert(language === 'en' ? `These duplicates were skipped and the existing copies were kept:\n\n${resultImport.duplicates.map((item) => `· ${item.source.split(/[\\/]/).pop() || item.source}`).join('\n')}` : `检测到以下重复项目，已跳过导入并保留原有样本：\n\n${resultImport.duplicates.map((item) => `· ${item.source.split(/[\\/]/).pop() || item.source}`).join('\n')}`)
        window.setTimeout(() => setImporting(false), 600)
      }
      return
    }
    setPickerMode(mode)
    setPickerOpen(true)
  }

  const startPhoneTransfer = async () => {
    if (!libraryPath || !window.motionShelf) return
    setImportMenuOpen(false)
    setTransferProgress({ receivedBytes: 0, completedFiles: 0, totalFiles: 0, currentFile: '' })
    setPhoneConnected(false)
    const session = await window.motionShelf.startTransferSession(libraryPath, language)
    setTransferSession(session)
  }

  const rescanLibrary = async () => {
    if (!window.motionShelf || !libraryPath || isImporting) return
    setImporting(true)
    try {
      const files = await window.motionShelf.scanDirectory(libraryPath)
      const scanned = files.map((file, index) => pathToMediaCard(file, index)).reduce<MediaCard[]>((items, item) => mergeMediaCards(items, item), [])
      setMediaItems(scanned)
    } catch (error) {
      window.alert(`${language === 'en' ? 'Could not scan the library' : '扫描媒体库失败'}：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setImporting(false)
    }
  }

  const stopPhoneTransfer = async () => {
    await window.motionShelf?.stopTransferSession()
    setTransferSession(null)
    setPhoneConnected(false)
    setImporting(false)
  }

  const updateVideoSubtype = (id: string, videoSubtype: VideoSubtype) => {
    setMediaItems((current) => current.map((item) => item.id === id ? { ...item, videoSubtype } : item))
    setSelectedMedia((current) => current?.id === id ? { ...current, videoSubtype } : current)
  }

  const toggleFavorite = (id: string) => {
    setFavoriteIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const originFromElement = (element: HTMLElement | null): OriginRect | null => {
    if (!element) return null
    const visual = element.querySelector('.media-visual') || element
    const rect = visual.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, radius: 13 }
  }

  const enterSelectionMode = () => {
    setSelectedIds(new Set())
    setSelectionMode(true)
  }

  const exitSelectionMode = () => {
    setSelectedIds(new Set())
    setSelectionMode(false)
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllFiltered = () => {
    setSelectedIds(new Set(filteredMedia.map((item) => item.id)))
  }

  const requestDeleteItems = (ids: string[]) => {
    const uniqueIds = [...new Set(ids)].filter((id) => mediaItems.some((item) => item.id === id))
    if (uniqueIds.length) setDeleteConfirmIds(uniqueIds)
  }

  const deleteSelected = () => {
    if (!selectedIds.size || isDeleting) return
    requestDeleteItems([...selectedIds])
  }

  const performDelete = async () => {
    const requestedIds = deleteConfirmIds || []
    if (!requestedIds.length || isDeleting) return
    setDeleteConfirmIds(null)
    setIsDeleting(true)
    const selectedItems = mediaItems.filter((item) => requestedIds.includes(item.id))
    const paths = [...new Set(selectedItems.flatMap((item) => item.sourcePaths || []))]
    try {
      if (!window.motionShelf || !paths.length) {
        window.alert(language === 'en' ? 'These items do not have local files and cannot be deleted from the app.' : '这些媒体没有对应的本地文件，无法从应用中删除。')
        return
      }
      const result = await window.motionShelf.deleteFiles(libraryPath, paths)
      const deletedPathSet = new Set(result.deleted)
      const deletedIds = new Set(selectedItems
        .filter((item) => (item.sourcePaths || []).length > 0 && (item.sourcePaths || []).every((filePath) => deletedPathSet.has(filePath)))
        .map((item) => item.id))
      const deletedAt = new Date().toISOString()
      const entryByOriginal = new Map((result.trashEntries || []).map((entry) => [entry.original, entry.trash]))
      const deletedRecords = selectedItems.filter((item) => deletedIds.has(item.id)).map((item, index) => {
        const sourcePaths = item.sourcePaths || []
        const entries = sourcePaths.map((original) => ({ original, trash: entryByOriginal.get(original) || null }))
        const previewPath = entries[0]?.trash || null
        const motionPath = entries[1]?.trash || null
        return {
          id: `${item.id}-${Date.now()}-${index}`,
          item: { ...item, src: item.previewSrc || (previewPath ? mediaSource(previewPath) : undefined), originalSrc: previewPath ? mediaSource(previewPath) : item.originalSrc, motionSrc: motionPath ? mediaSource(motionPath) : undefined },
          deletedAt,
          entries,
        }
      })
      if (deletedRecords.length) setTrashItems((current) => [...deletedRecords, ...current].slice(0, 200))
      setMediaItems((current) => current.filter((item) => !deletedIds.has(item.id)))
      setFavoriteIds((current) => new Set([...current].filter((id) => !deletedIds.has(id))))
      setSelectedIds((current) => new Set([...current].filter((id) => !deletedIds.has(id))))
      if (selectedMedia && deletedIds.has(selectedMedia.id)) {
        setSelectedMedia(null)
        setSelectedOrigin(null)
        setViewerDirection(null)
      }
      if (result.failed.length || deletedIds.size < selectedItems.length) {
        const failedCount = Math.max(result.failed.length, selectedItems.length - deletedIds.size)
        window.alert(language === 'en' ? `${deletedIds.size} item(s) moved to Trash; ${failedCount} could not be deleted.` : `已移入回收站 ${deletedIds.size} 项，${failedCount} 项未能删除。`)
      } else if (selectionMode) {
        exitSelectionMode()
      }
    } catch (error) {
      window.alert(`${language === 'en' ? 'Delete failed' : '删除失败'}：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsDeleting(false)
    }
  }

  const restoreTrashRecord = async (record: TrashRecord) => {
    if (!window.motionShelf || !record.entries?.length || record.entries.some((entry) => !entry.trash)) {
      window.alert(language === 'en' ? 'This record is from an older version and cannot be restored in the app. Open the system Trash to restore it manually.' : '这条记录来自旧版本，无法在应用内恢复。请打开系统回收站手动恢复。')
      return
    }
    try {
      const result = await window.motionShelf.restoreFiles(libraryPath, record.entries)
      if (result.failed.length || result.restored.length !== record.entries.length) {
        window.alert(language === 'en' ? `${result.restored.length} file(s) restored; ${result.failed.length || record.entries.length - result.restored.length} could not be restored.` : `已恢复 ${result.restored.length} 个文件，仍有 ${result.failed.length || record.entries.length - result.restored.length} 个文件未能恢复。`)
        return
      }
      const restoredByOriginal = new Map(result.restored.map((entry) => [entry.original, entry.to]))
      const sourcePaths = record.entries.map((entry) => restoredByOriginal.get(entry.original) || entry.original)
      const restoredItem: MediaCard = {
        ...record.item,
        sourcePaths,
        src: record.item.previewSrc || (sourcePaths[0] ? mediaSource(sourcePaths[0]) : record.item.src),
        originalSrc: sourcePaths[0] ? mediaSource(sourcePaths[0]) : record.item.originalSrc,
        motionSrc: sourcePaths[1] ? mediaSource(sourcePaths[1]) : record.item.motionSrc,
      }
      setMediaItems((current) => current.some((item) => item.id === restoredItem.id) ? current : [restoredItem, ...current])
      setTrashItems((current) => current.filter((item) => item.id !== record.id))
    } catch (error) {
      window.alert(`${language === 'en' ? 'Restore failed' : '恢复失败'}：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const openMediaViewer = (item: MediaCard, element: HTMLElement) => {
    setSelectedOrigin(originFromElement(element))
    setViewerDirection(null)
    setViewerToken(0)
    setSelectedMedia(item)
  }

  const navigateViewer = (offset: -1 | 1) => {
    if (!selectedMedia || filteredMedia.length < 2) return
    const currentIndex = filteredMedia.findIndex((item) => item.id === selectedMedia.id)
    if (currentIndex < 0) return
    const nextIndex = (currentIndex + offset + filteredMedia.length) % filteredMedia.length
    const nextItem = filteredMedia[nextIndex]
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-media-id]')).find((element) => element.dataset.mediaId === nextItem.id) || null
    setSelectedOrigin(originFromElement(target))
    setViewerDirection(offset > 0 ? 'next' : 'previous')
    setViewerToken((value) => value + 1)
    setSelectedMedia(nextItem)
  }

  const jumpViewer = (index: number) => {
    if (!selectedMedia || index < 0 || index >= filteredMedia.length) return
    const nextItem = filteredMedia[index]
    if (nextItem.id === selectedMedia.id) return
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-media-id]')).find((element) => element.dataset.mediaId === nextItem.id) || null
    setSelectedOrigin(originFromElement(target))
    setViewerDirection(index > filteredMedia.findIndex((item) => item.id === selectedMedia.id) ? 'next' : 'previous')
    setViewerToken((value) => value + 1)
    setSelectedMedia(nextItem)
  }

  const startFolderImport = () => {
    setImportMenuOpen(false)
    void selectFolder('import')
  }

  const startUsbGuide = () => {
    setImportMenuOpen(false)
    setUsbGuideOpen(true)
  }

  const openSystemUsbImporter = async () => {
    const result = await window.motionShelf?.openUsbImporter()
    if (result && !result.ok) {
      window.alert(language === 'en' ? 'Could not open the system importer. Open Image Capture or Photos manually.' : '无法打开系统导入工具，请手动打开“图像捕捉”或“照片”应用。')
    }
  }

  const openSystemRecycleBin = async () => {
    const result = await window.motionShelf?.openRecycleBin(libraryPath)
    if (result && !result.ok) window.alert(language === 'en' ? 'Could not open the MotionShelf Trash folder. Open .MotionShelfTrash from the library location.' : '无法打开 MotionShelf 回收站文件夹，请从媒体库位置中打开 .MotionShelfTrash。')
  }

  const chooseUsbFolder = async () => {
    if (!window.motionShelf) {
      setUsbGuideOpen(false)
      setPickerMode('import')
      setPickerOpen(true)
      return
    }
    const result = await window.motionShelf.selectDirectory({
      title: language === 'en' ? 'Choose the folder imported over USB' : '选择 USB 导入后的照片文件夹',
      buttonLabel: language === 'en' ? 'Scan This Folder' : '扫描这个文件夹',
    })
    if (result.canceled || !result.path) return
    setUsbFolderName(result.path.split(/[\\/]/).filter(Boolean).pop() || result.path)
    setImporting(true)
    const files = await window.motionShelf.scanDirectory(result.path)
    const candidates = files
      .map((file, index) => pathToMediaCard(file, index))
      .reduce<MediaCard[]>((items, item) => mergeMediaCards(items, item), [])
      .map((item) => ({ ...item, selected: true }))
    setUsbCandidates(candidates)
    setImporting(false)
    setUsbGuideOpen(false)
    setUsbReviewOpen(true)
  }

  const toggleUsbCandidate = (id: string) => {
    setUsbCandidates((current) => current.map((item) => item.id === id ? { ...item, selected: !item.selected } : item))
  }

  const confirmUsbImport = async () => {
    const selected = usbCandidates.filter((item) => item.selected)
    if (!selected.length) return
    if (!window.motionShelf || !libraryPath) return
    setImporting(true)
    try {
      const paths = [...new Set(selected.flatMap((item) => item.sourcePaths || []))]
      const result = await window.motionShelf.importMediaFiles(libraryPath, paths)
      const imported = result.files.map((file, index) => pathToMediaCard(file, index))
      setScreen('library')
      setMediaItems((current) => imported.reduce((items, item) => mergeMediaCards(items, item), current))
      setUsbReviewOpen(false)
      setUsbCandidates([])
      if (result.duplicates.length) window.alert(language === 'en' ? `These duplicates were skipped and the existing copies were kept:\n\n${result.duplicates.map((item) => `· ${item.source.split(/[\\/]/).pop() || item.source}`).join('\n')}` : `检测到以下重复项目，已跳过导入并保留原有样本：\n\n${result.duplicates.map((item) => `· ${item.source.split(/[\\/]/).pop() || item.source}`).join('\n')}`)
      if (result.failed.length) window.alert(language === 'en' ? `${result.failed.length} file(s) failed to import. Check file permissions.` : `${result.failed.length} 个文件导入失败，请检查文件权限。`)
    } finally {
      setImporting(false)
    }
  }

  const handleFolderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const relative = file.webkitRelativePath || file.name
    const folder = relative.split('/')[0] || file.name
    if (pickerMode === 'library') {
      setStorageName(folder)
      setLibraryPath(folder)
      window.localStorage.setItem('motionshelf.libraryPath', folder)
    } else {
      beginImport(folder, event.target.files)
    }
    setPickerOpen(false)
  }

  const beginImport = (folderName = '手机照片', files?: FileList | null) => {
    setScreen('library')
    setImporting(true)
    window.setTimeout(() => setImporting(false), 1800)
    if (folderName && !libraryPath) {
      setLibraryPath('MotionShelf Library')
    }
    const pathToPersist = libraryPath || 'MotionShelf Library'
    window.localStorage.setItem('motionshelf.libraryPath', pathToPersist)
    if (files?.length) {
      const imported = Array.from(files)
        .filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/') || /\.(heic|heif|jpg|jpeg|png|avif|mov|mp4|m4v)$/i.test(file.name))
        .slice(0, 60)
        .map((file, index) => fileToMediaCard(file, index))
      if (imported.length) setMediaItems((current) => imported.reduce((items, item) => mergeMediaCards(items, item), current))
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) beginImport(file.name, event.dataTransfer.files)
  }

  const filteredMedia = useMemo(() => {
    const matchesTab = (item: MediaCard) => {
      if (activeTab === 'all') return true
      if (activeTab === 'live') return item.type === 'live' || item.type === 'motion'
      if (activeTab === 'videos') return item.type === 'video'
      return favoriteIds.has(item.id)
    }
    const normalized = query.trim().toLowerCase()
    return mediaItems.filter((item) => {
      const matchesQuery = !normalized || `${item.title} ${item.place} ${item.device}`.toLowerCase().includes(normalized)
      const matchesVideoSubtype = activeTab !== 'videos' || videoSubtypeFilter === 'all' || (item.videoSubtype || 'normal') === videoSubtypeFilter
      return matchesTab(item) && matchesVideoSubtype && matchesQuery
    })
  }, [activeTab, favoriteIds, mediaItems, query, videoSubtypeFilter])

  const handleTabChange = (tab: LibraryTab) => {
    if (tab === activeTab) return
    startTabTransition(() => setActiveTab(tab))
  }

  const viewerIndex = selectedMedia ? filteredMedia.findIndex((item) => item.id === selectedMedia.id) : -1

  if (screen === 'onboarding') {
    return (
      <I18nContext.Provider value={i18n}><div className={`app-shell${isDark ? ' dark' : ''}${performanceReduced ? ' performance-reduced' : ''}`}>
        <Onboarding
          storageName={storageName}
          libraryPath={libraryPath}
          onChoose={() => selectFolder('library')}
          onCreate={() => beginImport('MotionShelf Library')}
          onToggleTheme={() => setDark((value) => !value)}
          isDark={isDark}
          onOpenExisting={() => selectFolder('library')}
        />
        {isPickerOpen && <FolderPicker mode={pickerMode} onChange={handleFolderChange} onClose={() => setPickerOpen(false)} />}
      </div></I18nContext.Provider>
    )
  }

  return (
    <I18nContext.Provider value={i18n}><div className={`app-shell${isDark ? ' dark' : ''}${performanceReduced ? ' performance-reduced' : ''}`}>
      <div className="workspace">
        <Sidebar activeTab={activeTab} onTabChange={handleTabChange} libraryPath={libraryPath} trashCount={trashItems.length} onChangeLibrary={() => selectFolder('library')} onSettings={() => handleTabChange('settings')} />
        <main className="main-pane">
          <header className="topbar">
            <div className="breadcrumbs"><span>{activeTab === 'settings' ? t('设置') : t('媒体库')}</span><CaretDown size={13} weight="bold" /><span className="muted">{t(tabLabels[activeTab])}</span></div>
            <div className="topbar-actions">
              {activeTab === 'settings' ? <span className="topbar-context">{t('应用设置')}</span> : <>
              <label className="search-box">
                <MagnifyingGlass size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索照片、地点或设备')} />
                <kbd>⌘ K</kbd>
              </label>
              <div className="import-menu-wrap">
                <button className="primary-button compact" aria-haspopup="menu" aria-expanded={isImportMenuOpen} onClick={() => setImportMenuOpen((value) => !value)}><Plus size={16} weight="bold" />{t('导入')}</button>
                {isImportMenuOpen && <div className="import-menu" role="menu">
                  <button role="menuitem" onClick={startPhoneTransfer}><QrCode size={18} /><span><strong>{t('用手机扫码导入')}</strong><small>{t('重新生成二维码，继续传照片')}</small></span><ArrowRight size={15} /></button>
                  <button role="menuitem" onClick={startUsbGuide}><DeviceMobile size={18} /><span><strong>{t('通过 USB 导入 Live Photo')}</strong><small>{t('连接 iPhone，保留原始照片与动态视频')}</small></span><ArrowRight size={15} /></button>
                  <button role="menuitem" onClick={startFolderImport}><FolderOpen size={18} /><span><strong>{t('从电脑选择文件夹')}</strong><small>{t('导入已经复制到电脑的文件')}</small></span><ArrowRight size={15} /></button>
                </div>}
              </div>
              {!selectionMode && mediaItems.length > 0 && <button className="secondary-button compact selection-entry" onClick={enterSelectionMode}><CheckSquare size={16} />{t('选择')}</button>}
              {selectionMode && <div className="selection-toolbar"><span>{language === 'en' ? `${selectedIds.size} selected` : `已选 ${selectedIds.size} 项`}</span><button className="text-button compact" onClick={selectAllFiltered}>{t('全选当前列表')}</button><button className="secondary-button compact danger-button" disabled={!selectedIds.size || isDeleting} onClick={deleteSelected}><Trash size={16} />{isDeleting ? t('删除中…') : t('删除')}</button><button className="text-button compact" onClick={exitSelectionMode}>{t('完成')}</button></div>}
              </>}
            </div>
          </header>

          <section className={`content-scroll${isTabPending ? ' is-tab-pending' : ''}`}>
            {activeTab === 'settings' ? <SettingsPanel libraryPath={libraryPath} languageMode={languageMode} isDark={isDark} autoPlayLivePhotos={autoPlayLivePhotos} adaptivePerformance={adaptivePerformance} performanceReduced={performanceReduced} isImporting={isImporting} onChangeLanguage={setLanguageMode} onToggleTheme={() => setDark((value) => !value)} onToggleAutoPlay={() => setAutoPlayLivePhotos((value) => !value)} onToggleAdaptivePerformance={() => setAdaptivePerformance((value) => !value)} onChangeLibrary={() => void selectFolder('library')} onRescan={() => void rescanLibrary()} /> : <>
            <div className="content-heading">
              <div>
                <p className="eyebrow">{activeTab === 'all' ? t('你的媒体库') : t('智能筛选')}</p>
                <h1>{t(tabLabels[activeTab])}</h1>
                <p className="heading-copy">{t('按拍摄时间、地点和设备自动整理。实况照片会以完整资产呈现。')}</p>
              </div>
              <button className="filter-button"><SlidersHorizontal size={16} />{t('筛选')} <CaretDown size={13} /></button>
            </div>

            {activeTab === 'trash' ? <TrashPanel items={trashItems} onOpenSystem={openSystemRecycleBin} onRestore={restoreTrashRecord} /> : <>
            {activeTab === 'videos' && <VideoTypeFilters items={mediaItems} value={videoSubtypeFilter} onChange={setVideoSubtypeFilter} />}

            {isImporting && <ImportProgress />}

            {transferSession && <EmptyLibrary onStartTransfer={startPhoneTransfer} onChooseFolder={() => selectFolder('import')} transferSession={transferSession} transferQr={transferQr} transferProgress={transferProgress} phoneConnected={phoneConnected} onStopTransfer={stopPhoneTransfer} />}
            {!transferSession && mediaItems.length === 0 && <EmptyLibrary onStartTransfer={startPhoneTransfer} onChooseFolder={() => selectFolder('import')} transferSession={transferSession} transferQr={transferQr} transferProgress={transferProgress} phoneConnected={phoneConnected} onStopTransfer={stopPhoneTransfer} />}
            {mediaItems.length > 0 && (
              <>
                <div className="summary-row">
                  <div className="summary-chip"><Stack size={17} />{language === 'en' ? `${mediaItems.length} file${mediaItems.length === 1 ? '' : 's'}` : `${mediaItems.length} 个文件`}</div>
                  <div className="summary-chip"><Sparkle size={17} />{mediaItems.filter((item) => item.type === 'live' || item.type === 'motion').length ? (language === 'en' ? `${mediaItems.filter((item) => item.type === 'live' || item.type === 'motion').length} Live Photo${mediaItems.filter((item) => item.type === 'live' || item.type === 'motion').length === 1 ? '' : 's'}` : `${mediaItems.filter((item) => item.type === 'live' || item.type === 'motion').length} 个实况照片`) : t('实况照片待识别')}</div>
                </div>

                <div className="media-grid">
                  {filteredMedia.map((item) => <MemoMediaTile key={item.id} item={item} selectionMode={selectionMode} selected={selectedIds.has(item.id)} onToggle={() => toggleSelected(item.id)} isFavorite={favoriteIds.has(item.id)} onOpen={(element) => openMediaViewer(item, element)} />)}
                  {!filteredMedia.length && <EmptySearch query={query} onClear={() => setQuery('')} />}
                </div>

                <div className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
                  <CloudArrowUp size={21} />
                  <span>{t('把手机照片文件夹拖到这里，继续导入')}</span>
                  <button onClick={() => selectFolder('import')}>{t('选择文件夹')}</button>
                </div>
              </>
            )}
            </>}
            </>}
          </section>
        </main>
      </div>

      {selectedMedia && <FullscreenMediaViewer item={selectedMedia} items={filteredMedia} activeIndex={viewerIndex} navigationDirection={viewerDirection} navigationToken={viewerToken} isFavorite={favoriteIds.has(selectedMedia.id)} autoPlayLivePhotos={autoPlayLivePhotos} origin={selectedOrigin} onClose={() => { setSelectedMedia(null); setSelectedOrigin(null); setViewerDirection(null) }} onNavigateBy={navigateViewer} onNavigateTo={jumpViewer} onRequestDelete={() => requestDeleteItems([selectedMedia.id])} onToggleFavorite={() => toggleFavorite(selectedMedia.id)} onChangeVideoSubtype={(videoSubtype) => updateVideoSubtype(selectedMedia.id, videoSubtype)} />}
      {deleteConfirmIds && <DeleteConfirmModal count={deleteConfirmIds.length} onCancel={() => setDeleteConfirmIds(null)} onConfirm={() => void performDelete()} />}
      {isPickerOpen && <FolderPicker mode={pickerMode} onChange={handleFolderChange} onClose={() => setPickerOpen(false)} />}
      {isUsbGuideOpen && <UsbImportGuide platform={window.motionShelf?.platform || 'darwin'} onClose={() => setUsbGuideOpen(false)} onOpenSystem={openSystemUsbImporter} onChooseFolder={chooseUsbFolder} />}
      {isUsbReviewOpen && <UsbReviewModal folderName={usbFolderName} candidates={usbCandidates} onToggle={toggleUsbCandidate} onClose={() => setUsbReviewOpen(false)} onConfirm={confirmUsbImport} onChooseAgain={chooseUsbFolder} />}
    </div></I18nContext.Provider>
  )
}

function Onboarding({ storageName, libraryPath, onChoose, onCreate, onToggleTheme, isDark, onOpenExisting }: {
  storageName: string
  libraryPath: string
  onChoose: () => void
  onCreate: () => void
  onToggleTheme: () => void
  isDark: boolean
  onOpenExisting: () => void
}) {
  const { language, t } = useI18n()
  return (
    <div className="onboarding-page">
      <div className="onboarding-topbar">
        <div className="brand-lockup"><div className="brand-mark"><Sparkle size={17} weight="fill" /></div><span>MotionShelf</span></div>
        <button className="icon-button subtle" aria-label={t('切换主题')} onClick={onToggleTheme}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
      </div>

      <div className="onboarding-grid">
        <section className="welcome-copy">
          <p className="eyebrow">{t('本地照片管理')}</p>
          <h1>{language === 'en' ? <>Bring your phone<br /><em>memories</em> home.</> : <>把手机里的<br /><em>时刻</em>收进来。</>}</h1>
          <p className="welcome-description">{t('MotionShelf 会保留原始文件，识别实况照片，再用时间、地点和设备帮你整理。')}</p>
          <div className="trust-row"><span><Check size={14} weight="bold" />{t('原始文件不改动')}</span><span><Check size={14} weight="bold" />{t('本地优先')}</span><span><Check size={14} weight="bold" />{t('支持动态照片')}</span></div>
        </section>

        <section className="setup-card">
          <div className="card-topline"><div className="step-index">01</div><span>{t('先设置媒体库')}</span></div>
          <h2>{t('照片要放在哪里？')}</h2>
          <p>{t('这是 MotionShelf 的主文件夹。之后导入的照片和视频都会保存在这里。')}</p>

          <button className="folder-choice" onClick={onChoose}>
            <div className="folder-icon"><HardDrives size={22} weight="duotone" /></div>
            <div className="folder-copy"><strong>{storageName === '选择一个文件夹' ? t(storageName) : storageName}</strong><span>{libraryPath || t('请选择一个本地文件夹或外置硬盘')}</span></div>
            <FolderOpen size={18} className="folder-arrow" />
          </button>

          <div className="storage-note"><Info size={15} /><span>{t('建议选择空间充足、长期连接的磁盘。')}</span></div>
          <button className="primary-button full" disabled={!libraryPath} onClick={onCreate}>{libraryPath ? t('创建媒体库') : t('先选择存储位置')}<ArrowRight size={17} weight="bold" /></button>
          <button className="text-button" onClick={onOpenExisting}>{t('打开已有媒体库')}</button>
        </section>
      </div>

      <div className="onboarding-footer"><span>macOS · Windows</span><span>{t('你的照片，留在你的设备上')}</span></div>
    </div>
  )
}

function UsbImportGuide({ platform, onClose, onOpenSystem, onChooseFolder }: {
  platform: 'darwin' | 'win32' | 'linux'
  onClose: () => void
  onOpenSystem: () => void | Promise<void>
  onChooseFolder: () => void | Promise<void>
}) {
  const { language, t } = useI18n()
  const isMac = platform === 'darwin'
  const systemName = isMac ? (language === 'en' ? 'Image Capture' : '图像捕捉') : platform === 'win32' ? 'Photos / Apple Devices' : (language === 'en' ? 'System photo importer' : '系统照片导入工具')
  return <div className="modal-backdrop usb-modal-backdrop" role="dialog" aria-modal="true">
    <section className="usb-guide-dialog">
      <button className="modal-close" onClick={onClose} aria-label={t('关闭')}><X size={18} /></button>
      <div className="usb-guide-icon"><DeviceMobile size={27} weight="duotone" /><span><Check size={11} weight="bold" /></span></div>
      <p className="eyebrow">{t('有线导入')}</p>
      <h2>{t('用 USB 保留完整 Live Photo')}</h2>
      <p className="usb-guide-intro">{t('通过系统导入原始照片和动态视频，避免网页选择器把 Live Photo 压缩成单张 JPEG。')}</p>

      <div className="usb-steps">
        <div className="usb-step"><span>1</span><div><strong>{t('连接并信任 iPhone')}</strong><p>{t('用 USB 线连接电脑，解锁 iPhone，在提示出现时点“信任”。')}</p></div></div>
        <div className="usb-step"><span>2</span><div><strong>{language === 'en' ? `Choose photos in ${systemName}` : `在 ${systemName} 中选择照片`}</strong><p>{isMac ? (language === 'en' ? 'Choose the Live Photos you need and import them into an easy-to-find folder.' : '选择需要的 Live Photo，导入到一个容易找到的文件夹。') : (language === 'en' ? 'Open the photo import view, select the Live Photos you need, and import them into a computer folder.' : '打开照片导入界面，选择需要的 Live Photo，并导入到电脑文件夹。')}</p></div></div>
        <div className="usb-step"><span>3</span><div><strong>{t('回到 MotionShelf 确认')}</strong><p>{t('选择刚才的文件夹，应用会预览照片、识别同名 MOV，并让你勾选后再加入媒体库。')}</p></div></div>
      </div>

      <div className="usb-guide-note"><HardDrives size={17} /><span>{isMac ? (language === 'en' ? 'Keep the original format; a Live Photo is usually saved as a matching photo and MOV.' : '请在系统导入工具中保留原始格式；Live Photo 通常会以同名照片和 MOV 共同保存。') : (language === 'en' ? 'Windows Photos shows one Live Photo as two items. Select the matching .HEIC and .MOV, for example IMG_8913.HEIC and IMG_8913.MOV.' : 'Windows“照片”会把一张 Live Photo 显示成两个项目，请同时勾选同名的 .HEIC 和 .MOV，例如 IMG_8913.HEIC 与 IMG_8913.MOV。')}</span></div>
      <div className="usb-guide-actions">
        <button className="secondary-button" onClick={() => void onOpenSystem()}><FolderOpen size={17} />{language === 'en' ? `Open ${systemName}` : `打开 ${systemName}`}</button>
        <button className="primary-button" onClick={() => void onChooseFolder()}><ImageSquare size={17} />{t('我已导入，选择文件夹')}<ArrowRight size={16} /></button>
      </div>
      <button className="text-button usb-guide-cancel" onClick={onClose}>{t('稍后再做')}</button>
    </section>
  </div>
}

function UsbReviewModal({ folderName, candidates, onToggle, onClose, onConfirm, onChooseAgain }: {
  folderName: string
  candidates: MediaCard[]
  onToggle: (id: string) => void
  onClose: () => void
  onConfirm: () => void
  onChooseAgain: () => void | Promise<void>
}) {
  const { language, t } = useI18n()
  const selectedCount = candidates.filter((item) => item.selected).length
  const incompleteCount = candidates.filter((item) => item.type === 'photo' && !candidates.some((candidate) => candidate.type === 'video' && mediaBaseName(candidate.title) === mediaBaseName(item.title))).length
  return <div className="modal-backdrop usb-modal-backdrop" role="dialog" aria-modal="true">
    <section className="usb-review-dialog">
      <div className="usb-review-header"><div><p className="eyebrow">{t('USB 导入预览')}</p><h2>{t('选择要加入媒体库的照片')}</h2><p>{folderName || t('已选文件夹')} · {language === 'en' ? `${candidates.length} media item${candidates.length === 1 ? '' : 's'} found` : `找到 ${candidates.length} 个媒体项目`}</p></div><button className="modal-close" onClick={onClose} aria-label={t('关闭')}><X size={18} /></button></div>
      {incompleteCount > 0 && <div className="usb-review-warning"><WarningCircle size={17} /><span>{language === 'en' ? `${incompleteCount} photo(s) have no matching MOV. Select both files in Windows Photos or the item will be imported as a still image.` : `有 ${incompleteCount} 张照片没有找到同名 MOV。Live Photo 需要同时从 Windows“照片”中勾选照片和视频，否则只能作为静态图片导入。`}</span></div>}
      {candidates.length ? <div className="usb-review-grid">{candidates.map((item) => <button key={item.id} className={item.selected ? 'usb-review-card selected' : 'usb-review-card'} onClick={() => onToggle(item.id)} aria-pressed={item.selected}>
        <div className={`usb-review-visual ${item.tone}`}>
          {item.src && item.type === 'video' && <video src={item.src} muted playsInline preload="metadata" />}
          {item.src && item.type !== 'video' && <img src={item.src} alt="" />}
          {!item.src && <div className="visual-glow" />}
          {item.type === 'live' && <span className="type-badge">LIVE</span>}
          {item.type === 'motion' && <span className="type-badge">LIVE</span>}
          {item.type === 'video' && <span className="type-badge">{videoSubtypeLabels[item.videoSubtype || 'normal']}</span>}
          <span className="usb-check">{item.selected ? <Check size={13} weight="bold" /> : null}</span>
        </div>
        <div className="usb-review-meta"><strong>{item.title}</strong><span>{item.type === 'live' || item.type === 'motion' ? t('实况照片 · 图片 + 视频') : item.type === 'video' ? t(videoSubtypeLabels[item.videoSubtype || 'normal']) : incompleteCount > 0 && !candidates.some((candidate) => candidate.type === 'video' && mediaBaseName(candidate.title) === mediaBaseName(item.title)) ? t('照片 · 缺少同名 MOV') : t('照片')} · {item.date}</span></div>
      </button>)}</div> : <div className="usb-review-empty"><FolderOpen size={28} /><strong>{t('这个文件夹里没有找到照片或视频')}</strong><span>{t('请确认系统导入工具已经完成导入，再选择正确的文件夹。')}</span><button className="secondary-button" onClick={() => void onChooseAgain()}>{t('重新选择文件夹')}</button></div>}
      <div className="usb-review-footer"><span>{language === 'en' ? `${selectedCount} selected` : `已选择 ${selectedCount} 项`}</span><div><button className="secondary-button" onClick={onClose}>{t('取消')}</button><button className="primary-button" disabled={!selectedCount} onClick={onConfirm}>{t('导入选中项目')}<ArrowRight size={16} /></button></div></div>
    </section>
  </div>
}

function FolderPicker({ mode, onChange, onClose }: { mode: 'library' | 'import'; onChange: (event: ChangeEvent<HTMLInputElement>) => void; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="folder-picker">
        <button className="modal-close" onClick={onClose} aria-label={t('关闭')}><X size={18} /></button>
        <div className="picker-icon"><FolderOpen size={24} weight="duotone" /></div>
        <h2>{mode === 'library' ? t('选择媒体库存储位置') : t('选择手机照片文件夹')}</h2>
        <p>{mode === 'library' ? t('浏览器原型会读取文件夹名称。桌面版将打开系统原生目录选择器。') : t('选择已经传到电脑的照片或视频文件夹。')}</p>
        <label className="picker-input">
          <Folders size={19} />
          <span>{t('浏览文件夹')}</span>
          <input type="file" onChange={onChange} {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
        </label>
        <button className="text-button" onClick={onClose}>{t('取消')}</button>
      </div>
    </div>
  )
}

function SettingsPanel({ libraryPath, languageMode, isDark, autoPlayLivePhotos, adaptivePerformance, performanceReduced, isImporting, onChangeLanguage, onToggleTheme, onToggleAutoPlay, onToggleAdaptivePerformance, onChangeLibrary, onRescan }: { libraryPath: string; languageMode: LanguageMode; isDark: boolean; autoPlayLivePhotos: boolean; adaptivePerformance: boolean; performanceReduced: boolean; isImporting: boolean; onChangeLanguage: (mode: LanguageMode) => void; onToggleTheme: () => void; onToggleAutoPlay: () => void; onToggleAdaptivePerformance: () => void; onChangeLibrary: () => void; onRescan: () => void }) {
  const { t } = useI18n()
  const libraryName = libraryPath.split(/[\\/]/).filter(Boolean).pop() || 'MotionShelf Library'
  return <section className="settings-page">
    <div className="settings-heading"><p className="eyebrow">{t('应用偏好')}</p><h1>{t('设置')}</h1><p>{t('调整 MotionShelf 的存储位置、外观、播放方式和性能策略。')}</p></div>
    <div className="settings-layout">
      <section className="settings-card"><div className="settings-card-heading"><div className="settings-card-icon"><HardDrives size={20} /></div><div><h2>{t('媒体库')}</h2><p>{t('所有导入的照片和视频都从这里读取。')}</p></div></div><div className="settings-path"><div><span>{t('当前媒体库')}</span><strong>{libraryName}</strong><small>{libraryPath || t('尚未选择存储位置')}</small></div><button className="secondary-button" onClick={onChangeLibrary}><FolderOpen size={16} />{t('更换位置')}</button></div><button className="settings-action" disabled={isImporting} onClick={onRescan}><div><strong>{isImporting ? t('正在扫描媒体库…') : t('重新扫描媒体库')}</strong><span>{t('读取新加入的文件，并刷新时间、地点和设备信息')}</span></div><ArrowRight size={17} /></button></section>
      <section className="settings-card"><div className="settings-card-heading"><div className="settings-card-icon"><Moon size={20} /></div><div><h2>{t('外观')}</h2><p>{t('选择适合当前环境的显示方式。')}</p></div></div><div className="settings-row"><div><strong>{t('深色模式')}</strong><span>{t('降低夜间查看时的亮度')}</span></div><button className={isDark ? 'settings-toggle active' : 'settings-toggle'} role="switch" aria-checked={isDark} onClick={onToggleTheme}><i /></button></div></section>
      <section className="settings-card"><div className="settings-card-heading"><div className="settings-card-icon"><Translate size={20} /></div><div><h2>{t('语言')}</h2><p>{t('根据系统语言自动选择，也可以固定使用中文或英文。')}</p></div></div><div className="language-options" role="group" aria-label={t('语言')}><button className={languageMode === 'system' ? 'language-option active' : 'language-option'} onClick={() => onChangeLanguage('system')}>{t('跟随系统')}</button><button className={languageMode === 'zh-CN' ? 'language-option active' : 'language-option'} onClick={() => onChangeLanguage('zh-CN')}>{t('中文')}</button><button className={languageMode === 'en' ? 'language-option active' : 'language-option'} onClick={() => onChangeLanguage('en')}>English</button></div></section>
      <section className="settings-card"><div className="settings-card-heading"><div className="settings-card-icon"><Sparkle size={20} /></div><div><h2>{t('播放')}</h2><p>{t('控制实况照片打开时的行为。')}</p></div></div><div className="settings-row"><div><strong>{t('打开实况照片时自动播放')}</strong><span>{t('关闭后可点击照片手动播放')}</span></div><button className={autoPlayLivePhotos ? 'settings-toggle active' : 'settings-toggle'} role="switch" aria-checked={autoPlayLivePhotos} onClick={onToggleAutoPlay}><i /></button></div></section>
      <section className="settings-card"><div className="settings-card-heading"><div className="settings-card-icon"><SlidersHorizontal size={20} /></div><div><h2>{t('性能')}</h2><p>{t('在设备负载较高时动态减少高成本视觉效果。')}</p></div></div><div className="settings-row"><div><strong>{t('自适应性能优化')}</strong><span>{!adaptivePerformance ? t('关闭后保持完整动画和特效') : performanceReduced ? t('当前已启用轻量模式，媒体功能不受影响') : t('已开启，设备状态良好时保持完整效果')}</span></div><button className={adaptivePerformance ? 'settings-toggle active' : 'settings-toggle'} role="switch" aria-checked={adaptivePerformance} onClick={onToggleAdaptivePerformance}><i /></button></div></section>
    </div>
  </section>
}

function Sidebar({ activeTab, onTabChange, libraryPath, trashCount, onChangeLibrary, onSettings }: { activeTab: LibraryTab; onTabChange: (tab: LibraryTab) => void; libraryPath: string; trashCount: number; onChangeLibrary: () => void; onSettings: () => void }) {
  const { t } = useI18n()
  const tabs: Array<{ id: LibraryTab; label: string; icon: typeof ImageSquare }> = [
    { id: 'all', label: t('全部媒体'), icon: ImageSquare },
    { id: 'live', label: t('实况照片'), icon: Sparkle },
    { id: 'videos', label: t('视频'), icon: VideoCamera },
    { id: 'favorites', label: t('收藏'), icon: Heart },
    { id: 'trash', label: t('回收站'), icon: Trash },
  ]
  return (
    <aside className="sidebar">
      <div className="brand-lockup sidebar-brand"><div className="brand-mark"><Sparkle size={16} weight="fill" /></div><span>MotionShelf</span></div>
      <div className="sidebar-section"><p className="sidebar-label">{t('媒体库')}</p>{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={activeTab === id ? 'nav-item active' : 'nav-item'} onClick={() => onTabChange(id)}><Icon size={18} weight={activeTab === id ? 'fill' : 'regular'} /><span>{label}</span>{id === 'trash' && trashCount > 0 && <span className="nav-count">{trashCount}</span>}</button>)}</div>
      <div className="sidebar-bottom"><button className="library-location" onClick={onChangeLibrary}><div className="location-icon"><HardDrives size={16} /></div><div><span>{t('媒体库位置')}</span><strong>{libraryPath.split(/[\\/]/).filter(Boolean).pop() || 'MotionShelf Library'}</strong></div><CaretDown size={15} /></button><button className={activeTab === 'settings' ? 'nav-item active' : 'nav-item'} onClick={onSettings}><GearSix size={18} weight={activeTab === 'settings' ? 'fill' : 'regular'} /><span>{t('设置')}</span></button></div>
    </aside>
  )
}

function EmptyLibrary({ onStartTransfer, onChooseFolder, transferSession, transferQr, transferProgress, phoneConnected, onStopTransfer }: {
  onStartTransfer: () => void
  onChooseFolder: () => void
  transferSession: { token: string; host: string; port: number; url: string; incomingPath: string } | null
  transferQr: string
  transferProgress: { receivedBytes: number; completedFiles: number; totalFiles: number; currentFile: string }
  phoneConnected: boolean
  onStopTransfer: () => void
}) {
  const { language, t } = useI18n()
  if (transferSession) {
    const progressPercent = transferProgress.totalFiles ? Math.min(100, (transferProgress.completedFiles / transferProgress.totalFiles) * 100) : 0
    return <section className="empty-library transfer-active"><div className="empty-illustration transfer-illustration"><QrCode size={38} weight="duotone" /></div><p className="eyebrow">{t('手机传输已开启')}</p><h2>{t('用手机扫描二维码')}</h2><p className="empty-copy">{t('手机和电脑连接到同一个 Wi-Fi 后，打开相机扫描二维码，Android Motion Photo 可直接选择原图；iPhone 也可选择同名照片和视频，直接传输并合并为实况照片。')}</p><div className="transfer-layout"><div className="qr-frame">{transferQr ? <img src={transferQr} alt={t('手机传输二维码')} /> : <div className="qr-placeholder"><CircleNotch size={22} className="spin" /></div>}</div><div className="transfer-info"><div className="transfer-info-row"><WifiHigh size={17} /><span>{t('局域网直连，不经过云端')}</span></div><div className="transfer-info-row"><DeviceMobile size={17} /><span>{t('支持断网、锁屏后恢复传输')}</span></div><div className="transfer-progress-copy"><strong>{transferProgress.completedFiles ? (language === 'en' ? `Received ${transferProgress.completedFiles}${transferProgress.totalFiles ? ` / ${transferProgress.totalFiles}` : ''} file${transferProgress.completedFiles === 1 ? '' : 's'}` : `已接收 ${transferProgress.completedFiles}${transferProgress.totalFiles ? ` / ${transferProgress.totalFiles}` : ''} 个文件`) : phoneConnected ? t('手机已连接，等待选择文件') : t('等待手机连接')}</strong><span>{transferProgress.currentFile || (phoneConnected ? t('请在手机传输页选择照片或视频') : t('扫码后在手机上选择想要传输的内容'))}</span></div><div className="transfer-progress-line"><i style={{ width: `${progressPercent}%` }} /></div><button className="secondary-button" onClick={onStopTransfer}>{t('结束传输')}</button></div></div><p className="transfer-footnote">{language === 'en' ? 'The transfer page tries to keep the phone awake. Unlock after a lock or Wi-Fi interruption to resume, or tap “Resume transfer”. If the QR code does not open, allow MotionShelf through the Windows firewall.' : '传输页会尽量保持手机屏幕唤醒；手动锁屏或 Wi-Fi 中断后，解锁可自动续传，也可以点击“继续 / 恢复传输”。若二维码无法打开，请检查 Windows 防火墙的局域网访问权限。'}</p></section>
  }
  return <section className="empty-library"><div className="empty-illustration"><DeviceMobile size={39} weight="duotone" /><QrCode size={26} weight="duotone" /></div><p className="eyebrow">{t('媒体库还是空的')}</p><h2>{t('先从手机导入你的照片')}</h2><p className="empty-copy">{t('你可以用手机扫描二维码，通过当前 Wi-Fi 直接传输照片和视频，也可以选择已经复制到电脑的文件夹。')}</p><div className="empty-actions"><button className="primary-button" onClick={onStartTransfer}><QrCode size={18} />{t('用手机扫码导入')}<ArrowRight size={17} weight="bold" /></button><button className="secondary-button" onClick={onChooseFolder}><FolderOpen size={17} />{t('从电脑选择文件夹')}</button></div><div className="empty-steps"><div><span>1</span><strong>{t('选择传输方式')}</strong><p>{t('手机扫码或选择电脑文件夹')}</p></div><div><span>2</span><strong>{t('选择照片和视频')}</strong><p>{t('原始文件直接传到媒体库')}</p></div><div><span>3</span><strong>{t('自动整理')}</strong><p>{t('识别时间、地点和设备信息')}</p></div></div></section>
}

function ImportProgress() {
  const { t } = useI18n()
  return <div className="import-progress"><div className="import-progress-icon"><CircleNotch size={18} className="spin" /></div><div className="import-progress-copy"><strong>{t('正在读取导入文件')}</strong><span>{t('正在保留原始文件，并准备解析可用的拍摄信息')}</span></div><div className="import-progress-state">{t('处理中')}</div></div>
}

function TrashPanel({ items, onOpenSystem, onRestore }: { items: TrashRecord[]; onOpenSystem: () => void | Promise<void>; onRestore: (record: TrashRecord) => void | Promise<void> }) {
  const { t } = useI18n()
  return <section className="trash-panel"><div className="trash-panel-header"><div><p className="eyebrow">{t('MotionShelf 回收站')}</p><h2>{t('最近删除')}</h2><p>{t('文件会先保存在媒体库内的回收站，恢复时会回到原来的文件夹。')}</p></div><button className="secondary-button" onClick={() => void onOpenSystem()}><FolderOpen size={16} />{t('打开回收站文件夹')}</button></div>{items.length ? <div className="trash-grid">{items.map((record) => { const item = record.item; const typeLabel = item.type === 'live' || item.type === 'motion' ? 'LIVE' : item.type === 'video' ? t(videoSubtypeLabels[item.videoSubtype || 'normal']) : t('照片'); const canRestore = Boolean(record.entries?.length && record.entries.every((entry) => entry.trash)); return <article key={record.id} className="trash-card"><div className={`${item.src ? 'trash-card-visual has-preview' : 'trash-card-visual'} ${item.tone}`}>{item.src && item.type === 'video' && <LazyVideoPreview src={item.src} />}{item.src && item.type !== 'video' && <img src={item.src} alt="" loading="lazy" decoding="async" />}{!item.src && <Trash size={25} weight="duotone" />}<span>{typeLabel}</span></div><div className="trash-card-meta"><div><strong>{item.title}</strong><span>{t(item.place)} · {formatMediaDate(record.deletedAt, t('刚刚删除'))}</span></div><button className="secondary-button compact trash-restore-button" disabled={!canRestore} onClick={() => void onRestore(record)}><ArrowCounterClockwise size={15} />{canRestore ? t('恢复') : t('系统恢复')}</button></div></article> })}</div> : <div className="trash-empty"><div><Trash size={28} /></div><strong>{t('回收站是空的')}</strong><span>{t('删除媒体后，它们会出现在这里。')}</span></div>}</section>
}

function DeleteConfirmModal({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  const { language, t } = useI18n()
  return <div className="modal-backdrop delete-confirm-backdrop" role="dialog" aria-modal="true" aria-label={t('确认删除')}><div className="delete-confirm-dialog"><button className="modal-close" onClick={onCancel} aria-label={t('取消删除')}><X size={18} /></button><div className="delete-confirm-icon"><Trash size={22} /></div><h2>{t('移到回收站？')}</h2><p>{language === 'en' ? `Move ${count} selected item${count === 1 ? '' : 's'} to Trash? Live Photos include both the still and motion video and can be restored later.` : `确定要移除选中的 ${count} 个媒体吗？实况照片会连同图片和动态视频一起处理，稍后可在 MotionShelf 回收站恢复。`}</p><div className="delete-confirm-actions"><button className="secondary-button" onClick={onCancel}>{t('取消')}</button><button className="primary-button delete-confirm-button" onClick={onConfirm}><Trash size={16} />{t('移到回收站')}</button></div></div></div>
}

function VideoTypeFilters({ items, value, onChange }: { items: MediaCard[]; value: VideoSubtype | 'all'; onChange: (value: VideoSubtype | 'all') => void }) {
  const { t } = useI18n()
  const videoItems = items.filter((item) => item.type === 'video')
  const countFor = (subtype: VideoSubtype) => videoItems.filter((item) => (item.videoSubtype || 'normal') === subtype).length
  return <div className="video-type-filters" aria-label={t('视频类型筛选')}>
    <button className={value === 'all' ? 'video-type-filter active' : 'video-type-filter'} onClick={() => onChange('all')}>{t('全部视频')} <span>{videoItems.length}</span></button>
    {videoSubtypeOrder.filter((subtype) => subtype !== 'normal' && countFor(subtype) > 0).map((subtype) => <button key={subtype} className={value === subtype ? 'video-type-filter active' : 'video-type-filter'} onClick={() => onChange(subtype)}>{t(videoSubtypeLabels[subtype])} <span>{countFor(subtype)}</span></button>)}
  </div>
}

function MediaTile({ item, selectionMode, selected, onToggle, isFavorite, onOpen }: { item: MediaCard; selectionMode: boolean; selected: boolean; onToggle: () => void; isFavorite: boolean; onOpen: (element: HTMLElement) => void }) {
  const { t } = useI18n()
  const typeLabel = item.type === 'live' || item.type === 'motion' ? 'LIVE' : item.type === 'video' ? t(videoSubtypeLabels[item.videoSubtype || 'normal']) : ''
  const isDynamic = item.type === 'live' || item.type === 'motion'
  return <button data-media-id={item.id} className={`${isDynamic ? 'media-tile dynamic-tile' : 'media-tile'}${selectionMode ? ' selecting' : ''}${selected ? ' selected' : ''}`} aria-pressed={selectionMode ? selected : undefined} onClick={(event) => selectionMode ? onToggle() : onOpen(event.currentTarget)}><div className={`media-visual ${item.tone}`}>
    {isDynamic && <LivePhotoPlayer item={item} variant="tile" />}
    {item.src && item.type === 'video' && <LazyVideoPreview className="media-file-preview" src={item.src} />}
    {item.src && item.type !== 'video' && !isDynamic && <img className="media-file-preview" src={item.src} alt="" loading="lazy" decoding="async" />}
    {!item.src && <div className="visual-glow" />}
    {item.type === 'video' && <span className="play-badge"><Play size={14} weight="fill" /></span>}
    {typeLabel && <span className="type-badge">{typeLabel}</span>}
    {isFavorite && <span className="favorite-badge" aria-label={t('已收藏')}><Heart size={13} weight="fill" /></span>}
    {selectionMode && <span className="selection-check" aria-hidden="true">{selected && <Check size={15} weight="bold" />}</span>}
    <span className="tile-shine" />
  </div><div className="media-meta"><div><strong>{item.title}</strong><span>{item.date}</span></div><span className="media-place"><MapPin size={13} />{item.place}</span></div></button>
}

// Keep stable media cards from re-rendering when only the active category,
// search field or transfer progress changes. The callbacks are intentionally
// ignored: they always target the same immutable item id in this tile.
const MemoMediaTile = memo(MediaTile, (previous, next) => previous.item === next.item && previous.selectionMode === next.selectionMode && previous.selected === next.selected && previous.isFavorite === next.isFavorite)

function LazyVideoPreview({ src, className = 'trash-card-preview' }: { src: string; className?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [nearViewport, setNearViewport] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!('IntersectionObserver' in window)) {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true)
        observer.disconnect()
      }
    }, { rootMargin: '320px 0px' })
    observer.observe(video)
    return () => observer.disconnect()
  }, [])

  return <video ref={videoRef} className={className} src={nearViewport ? src : undefined} muted playsInline preload={nearViewport ? 'metadata' : 'none'} />
}

function ProgressiveImage({ previewSrc, originalSrc, className, alt, draggable = false, loading = 'eager' }: { previewSrc: string; originalSrc?: string; className: string; alt: string; draggable?: boolean; loading?: 'eager' | 'lazy' }) {
  const [source, setSource] = useState(previewSrc)

  useEffect(() => {
    setSource(previewSrc)
    if (!originalSrc || originalSrc === previewSrc) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      const image = new Image()
      const promote = () => {
        if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) setSource(originalSrc)
      }
      image.onload = promote
      image.decoding = 'async'
      image.src = originalSrc
      if (typeof image.decode === 'function') void image.decode().then(promote).catch(() => undefined)
    }, loading === 'lazy' ? 240 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [previewSrc, originalSrc])

  return <img className={className} src={source} alt={alt} draggable={draggable} loading={loading} decoding="async" />
}

function LivePhotoPlayer({ item, variant, autoPlay = false, pauseWhenHidden = false, onPlayingChange }: { item: MediaCard; variant: 'tile' | 'fullscreen' | 'detail'; autoPlay?: boolean; pauseWhenHidden?: boolean; onPlayingChange?: (playing: boolean) => void }) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const holdTimer = useRef<number | null>(null)
  const skipNextClick = useRef(false)
  const [isPlaying, setPlaying] = useState(false)

  const startPlayback = () => {
    if (!item.motionSrc) return
    setPlaying(true)
    onPlayingChange?.(true)
    const video = videoRef.current
    if (!video) return
    // Live Photo audio must remain audible. Some Chromium builds preserve a
    // muted state from the thumbnail/media pipeline, so reset it explicitly.
    video.defaultMuted = false
    video.muted = false
    video.volume = 1
    video.currentTime = 0
    void video.play().catch(() => { setPlaying(false); onPlayingChange?.(false) })
  }

  const stopPlayback = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    const video = videoRef.current
    if (video) {
      video.pause()
      try { video.currentTime = 0 } catch { /* Ignore a media element that is still loading. */ }
    }
    setPlaying(false)
    onPlayingChange?.(false)
  }

  useEffect(() => {
    if (pauseWhenHidden) stopPlayback()
  }, [pauseWhenHidden])

  useEffect(() => {
    if (!autoPlay || !item.motionSrc) return
    const timer = window.setTimeout(startPlayback, 40)
    return () => window.clearTimeout(timer)
  }, [autoPlay, item.motionSrc])

  const startHold = (event: React.PointerEvent<HTMLDivElement>) => {
    if (variant === 'fullscreen' || !item.motionSrc || event.button > 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    holdTimer.current = window.setTimeout(() => {
      skipNextClick.current = true
      startPlayback()
    }, 220)
  }

  const endHold = () => {
    if (variant === 'fullscreen') return
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
    if (isPlaying) stopPlayback()
  }

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (skipNextClick.current) {
      event.preventDefault()
      event.stopPropagation()
      skipNextClick.current = false
      return
    }
    if (variant === 'fullscreen' && item.motionSrc) {
      if (isPlaying) stopPlayback()
      else startPlayback()
    }
  }

  return <div className={`live-photo-player ${variant === 'detail' ? 'detail-live-photo' : variant === 'fullscreen' ? 'fullscreen-live-photo' : 'tile-live-photo'} ${isPlaying ? 'is-playing' : ''}`} onPointerDown={startHold} onPointerUp={endHold} onPointerCancel={endHold} onClick={handleClick} onContextMenu={(event) => event.preventDefault()}>
    {item.src && <ProgressiveImage className="live-photo-image" previewSrc={item.src} originalSrc={variant === 'fullscreen' ? (item.detailSrc || item.originalSrc) : undefined} alt={item.title} draggable={false} loading={variant === 'tile' ? 'lazy' : 'eager'} />}
    {item.motionSrc && <video ref={videoRef} className="live-photo-video" src={item.motionSrc} playsInline preload={variant === 'fullscreen' ? 'auto' : variant === 'detail' ? 'metadata' : 'none'} muted={false} onLoadedMetadata={() => { const video = videoRef.current; if (video) { video.defaultMuted = false; video.muted = false; video.volume = 1 } }} onEnded={stopPlayback} />}
    {item.motionSrc && <span className="live-photo-hint"><Sparkle size={13} weight="fill" />{isPlaying ? t('正在播放') : t('按住播放')}</span>}
  </div>
}

function VideoPlayer({ src, preload = 'auto', pauseWhenHidden = false, onPlayingChange }: { src: string; preload?: 'auto' | 'metadata' | 'none'; pauseWhenHidden?: boolean; onPlayingChange?: (playing: boolean) => void }) {
  const { t } = useI18n()
  const [generation, setGeneration] = useState(0)
  const [isLoading, setLoading] = useState(true)
  const [hasError, setError] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (pauseWhenHidden) {
      videoRef.current?.pause()
      onPlayingChange?.(false)
    }
  }, [pauseWhenHidden])

  const handleEnded = () => {
    // Re-mount the media element at the first frame. This avoids Chromium
    // keeping a custom-protocol video in its ended/black frame state.
    setLoading(true)
    setGeneration((value) => value + 1)
  }

  return <div className="detail-video-player">
    <video ref={videoRef} key={`${src}-${generation}`} src={src} controls playsInline preload={preload} onLoadStart={() => { setLoading(true); setError(false); onPlayingChange?.(false) }} onLoadedData={() => setLoading(false)} onCanPlay={() => setLoading(false)} onWaiting={() => { setLoading(true); onPlayingChange?.(false) }} onPlaying={() => { setLoading(false); onPlayingChange?.(true) }} onPause={() => onPlayingChange?.(false)} onEnded={() => { onPlayingChange?.(false); handleEnded() }} onError={() => { setLoading(false); setError(true); onPlayingChange?.(false) }} />
    {isLoading && !hasError && <div className="video-loading-indicator"><CircleNotch size={18} className="spin" /><span>{t('正在准备视频…')}</span></div>}
    {hasError && <div className="video-error-indicator"><WarningCircle size={18} /><span>{t('视频暂时无法读取')}</span></div>}
  </div>
}

function FullscreenMediaViewer({ item, items, activeIndex, navigationDirection, navigationToken, isFavorite, autoPlayLivePhotos, origin, onClose, onNavigateBy, onNavigateTo, onRequestDelete, onToggleFavorite, onChangeVideoSubtype }: { item: MediaCard; items: MediaCard[]; activeIndex: number; navigationDirection: 'next' | 'previous' | null; navigationToken: number; isFavorite: boolean; autoPlayLivePhotos: boolean; origin: OriginRect | null; onClose: () => void; onNavigateBy: (offset: -1 | 1) => void; onNavigateTo: (index: number) => void; onRequestDelete: () => void; onToggleFavorite: () => void; onChangeVideoSubtype: (videoSubtype: VideoSubtype) => void }) {
  const { language, t } = useI18n()
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>('entering')
  const [stagePhase, setStagePhase] = useState<'entering' | 'open' | 'closing'>('entering')
  const [showInfo, setShowInfo] = useState(false)
  const [zoomScale, setZoomScale] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isMediaPlaying, setMediaPlaying] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const stageTimer = useRef<number | null>(null)
  const swipeStartX = useRef<number | null>(null)
  const panDrag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const panMoved = useRef(false)
  const panFrame = useRef<number | null>(null)
  const pendingPan = useRef({ x: 0, y: 0 })
  const panTarget = useRef<HTMLDivElement | null>(null)
  const navigateRef = useRef(onNavigateBy)
  const closeRef = useRef<() => void>(() => undefined)
  navigateRef.current = onNavigateBy
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight
  const stageWidth = Math.min(viewportWidth * 0.9, 1280)
  const stageHeight = Math.min(viewportHeight * 0.78, 820)
  const originCenterX = (origin?.left || viewportWidth / 2) + (origin?.width || 0) / 2
  const originCenterY = (origin?.top || viewportHeight / 2) + (origin?.height || 0) / 2
  const originScale = origin ? Math.max(origin.width / stageWidth, origin.height / stageHeight) : 0.42
  const viewerStyle = {
    '--origin-dx': `${originCenterX - viewportWidth / 2}px`,
    '--origin-dy': `${originCenterY - viewportHeight / 2}px`,
    '--origin-scale': originScale,
    '--origin-radius': `${origin?.radius || 13}px`,
    '--stage-width': `${stageWidth}px`,
    '--stage-height': `${stageHeight}px`,
  } as React.CSSProperties

  const closeViewer = () => {
    if (phase === 'closing') return
    if (stageTimer.current !== null) window.clearTimeout(stageTimer.current)
    setZoomScale(1)
    setShowInfo(false)
    setStagePhase('closing')
    setPhase('closing')
    closeTimer.current = window.setTimeout(onClose, 280)
  }
  closeRef.current = closeViewer

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setPhase('open'))
    stageTimer.current = window.setTimeout(() => setStagePhase('open'), 260)
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
      if (event.key === 'ArrowRight') navigateRef.current(1)
      if (event.key === 'ArrowLeft') navigateRef.current(-1)
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleKey)
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
      if (stageTimer.current !== null) window.clearTimeout(stageTimer.current)
      if (panFrame.current !== null) window.cancelAnimationFrame(panFrame.current)
    }
  }, [])

  const isDynamic = item.type === 'live' || item.type === 'motion'
  const label = isDynamic ? t('实况照片') : item.type === 'video' ? t(videoSubtypeLabels[item.videoSubtype || 'normal']) : t('照片')
  const stageNavigationClass = stagePhase === 'open' && navigationDirection ? ` nav-${navigationDirection}` : ''
  const canZoom = !isMediaPlaying
  const filmstripItems = useMemo(() => {
    if (items.length <= 17) return items.map((thumb, index) => ({ thumb, index }))
    const start = Math.max(0, Math.min(items.length - 17, activeIndex - 8))
    return items.slice(start, start + 17).map((thumb, offset) => ({ thumb, index: start + offset }))
  }, [items, activeIndex])
  const changeZoom = (delta: number) => setZoomScale((value) => Math.min(4, Math.max(0.5, Number((value + delta).toFixed(2)))))
  const resetZoom = () => { pendingPan.current = { x: 0, y: 0 }; setZoomScale(1); setPanOffset({ x: 0, y: 0 }) }
  const handleStageWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    // Chromium reports trackpad pinch as a ctrl/meta wheel event. Keeping the
    // gesture scoped to the stage avoids hijacking normal page scrolling.
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    event.stopPropagation()
    if (!canZoom) return
    changeZoom(event.deltaY > 0 ? -0.12 : 0.12)
  }
  useEffect(() => {
    setZoomScale(1)
    pendingPan.current = { x: 0, y: 0 }
    setPanOffset({ x: 0, y: 0 })
    setMediaPlaying(false)
  }, [item.id])
  useEffect(() => {
    if (zoomScale <= 1) {
      pendingPan.current = { x: 0, y: 0 }
      setPanOffset({ x: 0, y: 0 })
      return
    }
    const maxX = stageWidth * (zoomScale - 1) / 2
    const maxY = stageHeight * (zoomScale - 1) / 2
    setPanOffset((current) => ({ x: Math.max(-maxX, Math.min(maxX, current.x)), y: Math.max(-maxY, Math.min(maxY, current.y)) }))
  }, [zoomScale, stageWidth, stageHeight])

  const queuePan = (x: number, y: number, target: HTMLDivElement) => {
    const maxX = stageWidth * (zoomScale - 1) / 2
    const maxY = stageHeight * (zoomScale - 1) / 2
    pendingPan.current = { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
    panTarget.current = target
    if (panFrame.current !== null) return
    panFrame.current = window.requestAnimationFrame(() => {
      panFrame.current = null
      panTarget.current?.style.setProperty('--media-pan-x', `${pendingPan.current.x}px`)
      panTarget.current?.style.setProperty('--media-pan-y', `${pendingPan.current.y}px`)
    })
  }
  const handlePanStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (zoomScale <= 1 || !canZoom || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    panMoved.current = false
    panDrag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: panOffset.x, originY: panOffset.y }
  }
  const handlePanMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = panDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) panMoved.current = true
    queuePan(drag.originX + event.clientX - drag.startX, drag.originY + event.clientY - drag.startY, event.currentTarget)
  }
  const handlePanEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!panDrag.current || panDrag.current.pointerId !== event.pointerId) return
    event.stopPropagation()
    panDrag.current = null
    setPanOffset(pendingPan.current)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }
  const handleSwipeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    swipeStartX.current = event.clientX
  }
  const handleSwipeEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (swipeStartX.current === null) return
    const delta = event.clientX - swipeStartX.current
    swipeStartX.current = null
    if (Math.abs(delta) >= 56 && items.length > 1) {
      event.preventDefault()
      onNavigateBy(delta < 0 ? 1 : -1)
    }
  }
  return <div className={`fullscreen-viewer ${phase}`} style={viewerStyle} role="dialog" aria-modal="true" aria-label={`${label} ${item.title}`} onPointerDown={handleSwipeStart} onPointerUp={handleSwipeEnd} onClick={closeViewer}>
    <div className="fullscreen-viewer-top"><div className="fullscreen-title"><span>{label} · {activeIndex >= 0 ? `${activeIndex + 1} / ${items.length}` : ''}</span><strong>{item.title}</strong></div><div className="fullscreen-actions"><div className="viewer-zoom-controls" role="group" aria-label={t('缩放')}><button className="viewer-icon-button" disabled={!canZoom || zoomScale <= 0.5} onClick={(event) => { event.stopPropagation(); changeZoom(-0.25) }} aria-label={t('缩小')}><MagnifyingGlassMinus size={18} /></button><button className="viewer-zoom-value" disabled={!canZoom} onClick={(event) => { event.stopPropagation(); resetZoom() }} aria-label={t('重置缩放')}>{Math.round(zoomScale * 100)}%</button><button className="viewer-icon-button" disabled={!canZoom || zoomScale >= 4} onClick={(event) => { event.stopPropagation(); changeZoom(0.25) }} aria-label={t('放大')}><MagnifyingGlassPlus size={18} /></button></div><button className={isFavorite ? 'viewer-icon-button is-active' : 'viewer-icon-button'} onClick={(event) => { event.stopPropagation(); onToggleFavorite() }} aria-label={isFavorite ? t('取消收藏') : t('收藏')}><Heart size={19} weight={isFavorite ? 'fill' : 'regular'} /></button><button className="viewer-icon-button viewer-delete-button" onClick={(event) => { event.stopPropagation(); onRequestDelete() }} aria-label={t('删除当前照片')}><Trash size={18} /></button><button className="viewer-icon-button" onClick={(event) => { event.stopPropagation(); setShowInfo((value) => !value) }} aria-label={t('查看信息')}><Info size={19} /></button><button className="viewer-icon-button" onClick={(event) => { event.stopPropagation(); closeViewer() }} aria-label={t('关闭')}><X size={21} /></button></div></div>
    <div key={`${item.id}-${navigationToken}`} className={`fullscreen-media-stage ${stagePhase}${stageNavigationClass}${zoomScale > 1 && canZoom ? ' is-pannable' : ''}`} style={{ '--media-zoom': zoomScale, '--media-pan-x': `${panOffset.x}px`, '--media-pan-y': `${panOffset.y}px` } as React.CSSProperties} onWheel={handleStageWheel} onPointerDown={handlePanStart} onPointerMove={handlePanMove} onPointerUp={handlePanEnd} onPointerCancel={handlePanEnd} onClickCapture={(event) => { if (panMoved.current) { event.preventDefault(); event.stopPropagation(); panMoved.current = false } }} onClick={(event) => event.stopPropagation()}>
      {isDynamic && <LivePhotoPlayer item={item} variant="fullscreen" autoPlay={autoPlayLivePhotos && stagePhase === 'open'} pauseWhenHidden={stagePhase === 'closing'} onPlayingChange={setMediaPlaying} />}
      {!isDynamic && item.type === 'video' && item.src && <VideoPlayer src={item.src} preload="metadata" pauseWhenHidden={stagePhase === 'closing'} onPlayingChange={setMediaPlaying} />}
      {!isDynamic && item.type !== 'video' && item.src && <ProgressiveImage className="fullscreen-image" previewSrc={item.src} originalSrc={item.detailSrc || item.originalSrc} alt={item.title} />}
      {!item.src && <div className="visual-glow" />}
      {items.length > 1 && <><button className="viewer-nav-button viewer-nav-prev" onClick={() => onNavigateBy(-1)} aria-label={t('上一张')}><ArrowLeft size={20} /></button><button className="viewer-nav-button viewer-nav-next" onClick={() => onNavigateBy(1)} aria-label={t('下一张')}><ArrowRight size={20} /></button></>}
    </div>
    {showInfo && <div className="fullscreen-info-panel" onClick={(event) => event.stopPropagation()}><FullMetadata item={item} />{item.type === 'video' && <label className="detail-type-select"><span>{t('视频分类')}</span><select value={item.videoSubtype || 'normal'} onChange={(event) => onChangeVideoSubtype(event.target.value as VideoSubtype)}>{videoSubtypeOrder.map((subtype) => <option key={subtype} value={subtype}>{t(videoSubtypeLabels[subtype])}</option>)}</select></label>}</div>}
    <div className="fullscreen-caption"><div><strong>{item.title}</strong><span><MapPin size={13} />{t(item.place)} <i>·</i> {t(item.date)}</span></div>{isDynamic && <span className="fullscreen-live-tip">{t('点击播放 · 再次点击暂停')}</span>}</div>
    {items.length > 1 && <div className="viewer-filmstrip" onClick={(event) => event.stopPropagation()} aria-label={t('照片缩略图导航')}>{filmstripItems.map(({ thumb, index }) => <button key={thumb.id} className={index === activeIndex ? 'viewer-thumb active' : 'viewer-thumb'} onClick={() => onNavigateTo(index)} aria-label={`${language === 'en' ? 'Open photo' : '打开第'} ${index + 1} ${language === 'en' ? '' : '张照片'}`}>{thumb.src ? thumb.type === 'video' ? <video src={thumb.src} muted playsInline preload={Math.abs(index - activeIndex) <= 1 ? 'metadata' : 'none'} /> : <img src={thumb.src} alt="" loading="lazy" decoding="async" /> : <span className={`viewer-thumb-placeholder ${thumb.tone}`} />}{(thumb.type === 'live' || thumb.type === 'motion') && <span className="viewer-thumb-live">LIVE</span>}</button>)}</div>}
  </div>
}

function MediaDetails({ item, onClose, onChangeVideoSubtype }: { item: MediaCard; onClose: () => void; onChangeVideoSubtype: (videoSubtype: VideoSubtype) => void }) {
  const { t } = useI18n()
  const [showFullInfo, setShowFullInfo] = useState(false)
  const isDynamic = item.type === 'live' || item.type === 'motion'
  const videoLabel = t(videoSubtypeLabels[item.videoSubtype || 'normal'])
  const fileType = item.type === 'live' || item.type === 'motion' ? t('实况照片（图片 + 视频）') : item.type === 'video' ? `${videoLabel} · ${item.mime?.split('/').pop()?.toUpperCase() || item.title.split('.').pop()?.toUpperCase() || t('视频')}` : item.mime?.split('/').pop()?.toUpperCase() || item.title.split('.').pop()?.toUpperCase() || t('未读取')
  const parameterText = formatCameraParameters(item.metadata)
  return <div className="detail-drawer"><div className={`detail-preview ${item.tone}`}>
    {isDynamic && <LivePhotoPlayer item={item} variant="detail" />}
    {!isDynamic && item.src && item.type === 'video' && <VideoPlayer src={item.src} />}
    {!isDynamic && item.src && item.type !== 'video' && <img className="detail-file-preview" src={item.src} alt={item.title} />}
    {!item.src && <div className="visual-glow" />}
    {item.type !== 'photo' && !isDynamic && !item.src && <button className="detail-play"><Play size={21} weight="fill" /></button>}
    <button className="detail-close" onClick={onClose} aria-label={t('关闭详情')}><X size={18} /></button>
  </div><div className="detail-content"><div className="detail-header"><div><p className="eyebrow">{item.type === 'live' || item.type === 'motion' ? t('实况照片') : item.type === 'video' ? videoLabel : t('照片')}</p><h2>{item.title}</h2></div><button className="icon-button subtle"><Copy size={17} /></button></div><div className="detail-location"><MapPin size={16} /><span>{t(item.place)}</span><span className="detail-dot">·</span><span>{t(item.date)}</span></div>{isDynamic && <div className="detail-live-help"><Sparkle size={15} weight="fill" /><span>{t('按住照片播放动态，松开后回到静态封面')}</span></div>}{item.type === 'video' && <label className="detail-type-select"><span>{t('视频分类')}</span><select value={item.videoSubtype || 'normal'} onChange={(event) => onChangeVideoSubtype(event.target.value as VideoSubtype)}>{videoSubtypeOrder.map((subtype) => <option key={subtype} value={subtype}>{t(videoSubtypeLabels[subtype])}</option>)}</select></label>}<div className="detail-grid"><div><span>{t('设备')}</span><strong>{t(item.device)}</strong></div><div><span>{t('文件类型')}</span><strong>{fileType}</strong></div><div><span>{t('拍摄参数')}</span><strong>{t(parameterText)}</strong></div><div><span>{t('原始文件')}</span><strong>{t('已保留')}</strong></div></div>{showFullInfo && <FullMetadata item={item} />}<div className="detail-actions"><button className="secondary-button"><Tag size={16} />{t('添加标签')}</button><button className="secondary-button" onClick={() => setShowFullInfo((value) => !value)}><SlidersHorizontal size={16} />{showFullInfo ? t('收起完整信息') : t('查看完整信息')}</button></div></div></div>
}

function FullMetadata({ item }: { item: MediaCard }) {
  const { t } = useI18n()
  const metadata = item.metadata || {}
  const rows = [
    [t('拍摄时间'), metadata.date ? formatMediaDate(metadata.date, t('未读取')) : t(item.date)],
    [t('地点'), t(item.place)],
    [t('相机'), t(item.device)],
    [t('视频类型'), item.type === 'video' ? t(videoSubtypeLabels[item.videoSubtype || 'normal']) : item.type === 'live' || item.type === 'motion' ? t('实况照片') : t('照片')],
    [t('镜头'), metadata.lensModel || t('未读取')],
    [t('焦距'), Number.isFinite(metadata.focalLength) ? `${metadata.focalLength!.toFixed(1)} mm` : t('未读取')],
    [t('等效焦距'), Number.isFinite(metadata.focalLength35mm) ? `${metadata.focalLength35mm!.toFixed(1)} mm` : t('未读取')],
    [t('光圈'), Number.isFinite(metadata.fNumber) ? `f/${metadata.fNumber!.toFixed(2)}` : t('未读取')],
    [t('快门'), t(formatExposureTime(metadata.exposureTime))],
    ['ISO', Number.isFinite(metadata.iso) ? String(Math.round(metadata.iso!)) : t('未读取')],
    [t('曝光补偿'), Number.isFinite(metadata.exposureBias) ? `${metadata.exposureBias! > 0 ? '+' : ''}${metadata.exposureBias!.toFixed(1)} EV` : t('未读取')],
    [t('尺寸'), metadata.width && metadata.height ? `${Math.round(metadata.width)} × ${Math.round(metadata.height)}` : t('未读取')],
    [t('白平衡'), metadata.whiteBalance || t('未读取')],
    [t('方向'), metadata.orientation || t('未读取')],
    [t('写入软件'), metadata.software || t('未读取')],
  ]
  return <div className="detail-full-metadata"><p>{t('完整拍摄信息')}</p><div>{rows.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div></div>
}

function EmptySearch({ query, onClear }: { query: string; onClear: () => void }) {
  const { t } = useI18n()
  return <div className="empty-search"><div className="empty-search-icon"><MagnifyingGlass size={25} /></div><h3>{t('没有找到匹配的媒体')}</h3><p>{t('试试搜索其他地点、设备或照片名称。')}</p>{query && <button className="text-button" onClick={onClear}>{t('清除搜索')}</button>}</div>
}

function fileToMediaCard(file: File, index: number): MediaCard {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  const isVideo = file.type.startsWith('video/') || ['mov', 'mp4', 'm4v', '3gp'].includes(extension)
  const isMotion = /(^|[_-])mp([._-]|$)/i.test(file.name) || /(motion|live[ _-]?photo|motion[ _-]?photo|动态照片|实况)/i.test(file.name)
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(file.lastModified))
  const type: MediaCard['type'] = isVideo ? 'video' : isMotion ? 'live' : 'photo'
  const tone = ['tone-lake', 'tone-cloud', 'tone-rain', 'tone-night', 'tone-sea', 'tone-flower'][index % 6]
  const source = URL.createObjectURL(file)
  return { id: `import-${file.name}-${file.lastModified}`, title: file.name.replace(/\.[^/.]+$/, ''), date, place: '未记录地点', device: '未记录设备', type, videoSubtype: isVideo ? classifyVideoSubtype(file.name) : undefined, tone, src: source, originalSrc: source, mime: file.type, sourcePaths: [] }
}

function pathToMediaCard(file: { name: string; path: string; previewPath?: string; detailPreviewPath?: string; modified: number; mime: string; kind: 'photo' | 'video'; metadata?: MediaMetadata; contentHash?: string }, index: number): MediaCard {
  const isMotion = /(^|[_-])mp([._-]|$)/i.test(file.name) || /(motion|live[ _-]?photo|motion[ _-]?photo|动态照片|实况)/i.test(file.name)
  const date = formatMediaDate(file.metadata?.date, new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(file.modified)))
  const type: MediaCard['type'] = file.kind === 'video' ? 'video' : isMotion ? 'live' : 'photo'
  const tone = ['tone-lake', 'tone-cloud', 'tone-rain', 'tone-night', 'tone-sea', 'tone-flower'][index % 6]
  return { id: file.path, title: file.name.replace(/\.[^/.]+$/, ''), date, place: formatMediaPlace(file.metadata), device: formatMediaDevice(file.metadata), type, videoSubtype: file.kind === 'video' ? classifyVideoSubtype(file.name, file.metadata) : undefined, tone, src: mediaSource(file.previewPath || file.path), originalSrc: mediaSource(file.path), previewSrc: file.previewPath ? mediaSource(file.previewPath) : undefined, detailSrc: file.detailPreviewPath ? mediaSource(file.detailPreviewPath) : undefined, mime: file.mime, metadata: file.metadata, contentHash: file.contentHash, sourcePaths: [file.path] }
}

function mediaSource(filePath: string) {
  return 'motionshelf-media://file?path=' + encodeURIComponent(filePath)
}

function mimeFromName(name: string) {
  const extension = name.split('.').pop()?.toLowerCase()
  if (extension === 'heic') return 'image/heic'
  if (extension === 'heif') return 'image/heif'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'mov') return 'video/quicktime'
  if (extension === 'mp4') return 'video/mp4'
  if (extension === 'm4v') return 'video/x-m4v'
  if (extension === '3gp') return 'video/3gpp'
  return undefined
}

function classifyVideoSubtype(name: string, metadata?: MediaMetadata): VideoSubtype {
  if (metadata?.captureType) return metadata.captureType
  const text = `${name} ${metadata?.software || ''}`.toLowerCase().replace(/[_.-]+/g, ' ')
  if (/(slo mo|slow motion|slowmotion|slow mo|慢动作|慢速)/i.test(text)) return 'slow-motion'
  if (/(time lapse|timelapse|延时摄影|延时)/i.test(text)) return 'time-lapse'
  if (/(cinematic|电影效果|电影模式)/i.test(text)) return 'cinematic'
  if (/(screen recording|screenrecording|录屏|屏幕录制)/i.test(text)) return 'screen-recording'
  if (/(spatial|空间视频|沉浸视频)/i.test(text)) return 'spatial'
  return 'normal'
}

function formatMediaDate(value: string | undefined, fallback: string, language: AppLanguage = 'zh-CN') {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatMediaPlace(metadata?: MediaMetadata, language: AppLanguage = 'zh-CN') {
  if (metadata && Number.isFinite(metadata.latitude) && Number.isFinite(metadata.longitude)) {
    return `${metadata.latitude!.toFixed(5)}°, ${metadata.longitude!.toFixed(5)}°`
  }
  return language === 'en' ? 'No location' : '未记录地点'
}

function formatMediaDevice(metadata?: MediaMetadata, language: AppLanguage = 'zh-CN') {
  if (!metadata) return language === 'en' ? 'Unknown device' : '未记录设备'
  return [metadata.make, metadata.model].filter(Boolean).join(' · ') || (language === 'en' ? 'Unknown device' : '未记录设备')
}

function formatCameraParameters(metadata?: MediaMetadata) {
  if (!metadata) return '未读取'
  const values: string[] = []
  if (Number.isFinite(metadata.fNumber)) values.push(`f/${metadata.fNumber!.toFixed(2)}`)
  if (Number.isFinite(metadata.exposureTime) && metadata.exposureTime! > 0) values.push(formatExposureTime(metadata.exposureTime))
  if (Number.isFinite(metadata.iso)) values.push(`ISO ${Math.round(metadata.iso!)}`)
  if (Number.isFinite(metadata.focalLength)) values.push(`${metadata.focalLength!.toFixed(1)} mm`)
  if (Number.isFinite(metadata.exposureBias) && metadata.exposureBias !== 0) values.push(`${metadata.exposureBias! > 0 ? '+' : ''}${metadata.exposureBias!.toFixed(1)} EV`)
  return values.join(' · ') || '未读取'
}

function formatExposureTime(value?: number) {
  if (!Number.isFinite(value) || value! <= 0) return '未读取'
  return value! < 1 ? `1/${Math.max(1, Math.round(1 / value!))} s` : `${value!.toFixed(2)} s`
}

function mediaBaseName(title: string) {
  return title
    .replace(/\.[^/.]+$/, '')
    .replace(/(?:[._ -](?:motion|live[ _-]?photo|motion[ _-]?photo|motionphoto|dynamic[ _-]?photo|动态照片|实况))(?:[-_ ]?\d+)?$/i, '')
    .toLowerCase()
}

function mergeMediaCards(current: MediaCard[], incoming: MediaCard): MediaCard[] {
  const existingIndex = current.findIndex((item) => item.id === incoming.id)
  if (existingIndex >= 0) {
    const existing = current[existingIndex]
    const metadata = mergeMetadata(existing.metadata, incoming.metadata)
    const refreshed: MediaCard = {
      ...existing,
      ...incoming,
      metadata,
      date: formatMediaDate(metadata.date, incoming.date || existing.date),
      place: formatMediaPlace(metadata),
      device: formatMediaDevice(metadata),
      motionSrc: incoming.motionSrc || existing.motionSrc,
      originalSrc: incoming.originalSrc || existing.originalSrc,
      contentHash: incoming.contentHash || existing.contentHash,
      sourcePaths: [...new Set([...(existing.sourcePaths || []), ...(incoming.sourcePaths || [])])],
    }
    return current.map((item, index) => index === existingIndex ? refreshed : item)
  }
  if (incoming.contentHash && current.some((item) => item.contentHash === incoming.contentHash)) return current
  const incomingIsVideo = incoming.type === 'video'
  const pairIndex = current.findIndex((item) => mediaBaseName(item.title) === mediaBaseName(incoming.title) && (item.type === 'video') !== incomingIsVideo)
  if (pairIndex < 0) return [...current, incoming]
  const counterpart = current[pairIndex]
  const photo = incomingIsVideo ? counterpart : incoming
  const video = incomingIsVideo ? incoming : counterpart
  const metadata = mergeMetadata(video.metadata, photo.metadata)
  const merged: MediaCard = {
    ...photo,
    id: `${photo.id}+${video.id}`,
    type: 'live',
    motionSrc: video.src,
    metadata,
    date: formatMediaDate(metadata.date, photo.date),
    place: formatMediaPlace(metadata),
    device: formatMediaDevice(metadata),
    videoSubtype: video.videoSubtype || classifyVideoSubtype(video.title, metadata),
    sourcePaths: [...new Set([...(photo.sourcePaths || []), ...(video.sourcePaths || [])])],
  }
  return [...current.filter((_, index) => index !== pairIndex), merged]
}

function mergeMetadata(base?: MediaMetadata, preferred?: MediaMetadata): MediaMetadata {
  const merged: MediaMetadata = { ...(base || {}) }
  for (const [key, value] of Object.entries(preferred || {})) {
    if (value !== undefined && value !== null && value !== '') merged[key as keyof MediaMetadata] = value as never
  }
  return merged
}

function isAppleLivePhotoPair(photoTitle: string, videoTitle: string) {
  const photoExtension = photoTitle.split('.').pop()?.toLowerCase() || ''
  const videoExtension = videoTitle.split('.').pop()?.toLowerCase() || ''
  return videoExtension === 'mov' && ['heic', 'heif', 'jpg', 'jpeg'].includes(photoExtension)
}

export default App
