const { app, BrowserWindow, dialog, ipcMain, Menu, shell, protocol, nativeImage } = require('electron')
const fs = require('node:fs')
const http = require('node:http')
const dgram = require('node:dgram')
const crypto = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { Readable } = require('node:stream')

const isDev = !app.isPackaged
let mainWindow
let transferServer
let transferSession
let discoveryServer
let exifrModulePromise
let heicConvertModulePromise
const previewCache = new Map()
const contentHashCache = new Map()
const DISCOVERY_PORT = 55723
const MEDIA_EXTENSIONS = new Set(['.avif', '.heic', '.heif', '.jpeg', '.jpg', '.png', '.webp', '.m4v', '.3gp', '.mkv', '.mov', '.mp4', '.webm'])

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'motionshelf-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

app.setName('MotionShelf')
// Live Photo opens from a trusted desktop click and should be able to start
// its original audio immediately, just like the Photos app.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

function isPrivateIPv4(address) {
  const parts = String(address).split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [first, second] = parts
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces()
  const virtualPattern = /virtual|vmware|virtualbox|vbox|hyper[- ]?v|wsl|docker|loopback|bluetooth|tap|tun|zerotier|tailscale|wireguard|hamachi/i
  const preferredPattern = /wi[- ]?fi|wlan|ethernet|以太网|无线|局域网/i
  const candidates = []
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivateIPv4(entry.address)) continue
      let score = preferredPattern.test(name) ? 100 : 50
      if (virtualPattern.test(name)) score -= 80
      candidates.push({ address: entry.address, name, score })
    }
  }
  return candidates.sort((a, b) => b.score - a.score).map(({ address }) => address)
}

function getLanAddress() {
  return getLanAddresses()[0] || '127.0.0.1'
}

function mediaRange(rangeHeader, totalSize) {
  if (!rangeHeader || !/^bytes=\d*-\d*$/.test(rangeHeader)) return null
  const [startText, endText] = rangeHeader.replace('bytes=', '').split('-')
  let start = startText ? Number(startText) : Math.max(0, totalSize - Number(endText || 0))
  let end = endText ? Number(endText) : totalSize - 1
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= totalSize) return 'invalid'
  end = Math.min(end, totalSize - 1)
  return { start, end }
}

async function serveMediaRequest(request) {
  const filePath = new URL(request.url).searchParams.get('path')
  if (!filePath) return new Response('Missing path', { status: 400 })
  let stat
  try {
    stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) return new Response('Not found', { status: 404 })
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const range = mediaRange(request.headers.get('range'), stat.size)
  if (range === 'invalid') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
  const start = range ? range.start : 0
  const end = range ? range.end : Math.max(0, stat.size - 1)
  const length = Math.max(0, end - start + 1)
  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Length': String(length),
    'Content-Type': mimeType(filePath),
    'Last-Modified': stat.mtime.toUTCString(),
  }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`
  if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers })
  const stream = fs.createReadStream(filePath, { start, end })
  return new Response(Readable.toWeb(stream), { status: range ? 206 : 200, headers })
}

function safeName(value) {
  const original = path.basename(value || '手机文件')
  return original.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || '手机文件'
}

function uniqueTarget(directory, name) {
  const extension = path.extname(name)
  const stem = path.basename(name, extension)
  let candidate = path.join(directory, name)
  let index = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, stem + '-' + index + extension)
    index += 1
  }
  return candidate
}

async function contentHash(filePath, size, modified) {
  const stat = size === undefined || modified === undefined ? await fs.promises.stat(filePath) : null
  const actualSize = size ?? stat.size
  const actualModified = modified ?? stat.mtimeMs
  const cacheKey = `${filePath}:${actualSize}:${actualModified}`
  const cached = contentHashCache.get(cacheKey)
  if (cached) return cached
  const digest = await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
  contentHashCache.set(cacheKey, digest)
  return digest
}

async function findDuplicateByContent(rootDirectory, candidatePath, candidateSize, candidateHash) {
  const candidates = []
  const resolvedCandidate = path.resolve(candidatePath)
  const visit = (directory) => {
    let entries
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === '.MotionShelfTrash' || entry.name.startsWith('.motionshelf-')) continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) visit(target)
        continue
      }
      if (path.resolve(target) === resolvedCandidate) continue
      if (!MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      try {
        const stat = fs.statSync(target)
        if (stat.isFile() && stat.size === candidateSize) candidates.push({ path: target, size: stat.size, modified: stat.mtimeMs })
      } catch {}
    }
  }
  visit(path.resolve(rootDirectory))
  for (const candidate of candidates) {
    try {
      if (await contentHash(candidate.path, candidate.size, candidate.modified) === candidateHash) return candidate.path
    } catch {}
  }
  return null
}

function mediaKind(name) {
  const extension = path.extname(name).toLowerCase()
  if (['.mov', '.mp4', '.m4v', '.3gp', '.avi', '.mkv', '.webm'].includes(extension)) return 'video'
  return 'photo'
}

function mimeType(name) {
  const extension = path.extname(name).toLowerCase()
  const types = {
    '.avif': 'image/avif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.m4v': 'video/x-m4v',
    '.3gp': 'video/3gpp',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  }
  return types[extension] || 'application/octet-stream'
}

function isoDate(value) {
  if (!value) return undefined
  let date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime()) && typeof value === 'string') {
    const exifDate = value.match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
    if (exifDate) date = new Date(`${exifDate[1]}-${exifDate[2]}-${exifDate[3]}T${exifDate[4]}:${exifDate[5]}:${exifDate[6]}`)
  }
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function numberOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value)) {
    if (value.length === 1) return numberOrUndefined(value[0])
    if (value.length === 2) {
      const numerator = numberOrUndefined(value[0])
      const denominator = numberOrUndefined(value[1])
      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) return numerator / denominator
    }
    return undefined
  }
  if (typeof value === 'object') {
    const numerator = value.numerator ?? value.num
    const denominator = value.denominator ?? value.den
    if (numerator !== undefined && denominator !== undefined) {
      const top = numberOrUndefined(numerator)
      const bottom = numberOrUndefined(denominator)
      if (Number.isFinite(top) && Number.isFinite(bottom) && bottom !== 0) return top / bottom
    }
  }
  if (typeof value === 'string') {
    const ratio = value.trim().match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*\/\s*(-?(?:\d+(?:\.\d+)?|\.\d+))/)
    if (ratio) {
      const top = Number(ratio[1])
      const bottom = Number(ratio[2])
      if (Number.isFinite(top) && Number.isFinite(bottom) && bottom !== 0) return top / bottom
    }
  }
  const number = Number(value)
  if (Number.isFinite(number)) return number
  if (typeof value === 'string') {
    const match = value.match(/[-+]?(?:\d+(?:\.\d+)?|\.\d+)/)
    if (match) {
      const parsed = Number(match[0])
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function textOrUndefined(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function orientationText(value) {
  const labels = { 1: '标准', 2: '水平翻转', 3: '旋转 180°', 4: '垂直翻转', 5: '转置', 6: '顺时针 90°', 7: '横向转置', 8: '逆时针 90°' }
  const numeric = numberOrUndefined(value)
  return labels[numeric] || textOrUndefined(value)
}

function whiteBalanceText(value) {
  const numeric = numberOrUndefined(value)
  if (numeric === 0) return '自动'
  if (numeric === 1) return '手动'
  return textOrUndefined(value)
}

function coordinateOrUndefined(value, reference) {
  let coordinate
  if (Array.isArray(value) && value.length >= 3) {
    const degrees = numberOrUndefined(value[0])
    const minutes = numberOrUndefined(value[1])
    const seconds = numberOrUndefined(value[2])
    if (Number.isFinite(degrees) && Number.isFinite(minutes) && Number.isFinite(seconds)) coordinate = Math.abs(degrees) + Math.abs(minutes) / 60 + Math.abs(seconds) / 3600
  } else {
    coordinate = numberOrUndefined(value)
  }
  if (!Number.isFinite(coordinate)) return undefined
  return /[SW]/i.test(String(reference || '')) ? -Math.abs(coordinate) : coordinate
}

function parseIso6709(value) {
  if (typeof value !== 'string') return {}
  const coordinates = value.match(/([+-](?:\d{2,3}(?:\.\d+)?))([+-](?:\d{3}(?:\.\d+)?))/)
  if (!coordinates) return {}
  return { latitude: Number(coordinates[1]), longitude: Number(coordinates[2]) }
}

function captureTypeFromRaw(raw = {}) {
  const text = Object.entries(raw)
    .filter(([key, value]) => typeof value === 'string' && /(type|mode|description|software|title|name)/i.test(key))
    .map(([key, value]) => `${key} ${value}`)
    .join(' ')
    .toLowerCase()
  if (/(slo.?mo|slow.?motion|slowmotion|慢动作|慢速)/i.test(text)) return 'slow-motion'
  if (/(time.?lapse|timelapse|延时摄影|延时)/i.test(text)) return 'time-lapse'
  if (/(cinematic|电影效果|电影模式)/i.test(text)) return 'cinematic'
  if (/(screen.?record|录屏|屏幕录制)/i.test(text)) return 'screen-recording'
  if (/(spatial|空间视频|沉浸视频)/i.test(text)) return 'spatial'
  return undefined
}

function normaliseMetadata(raw = {}) {
  const isoLocation = parseIso6709(raw.location || raw.Location || raw.GPSCoordinates || raw['com.apple.quicktime.location.ISO6709'] || raw['QuickTime:LocationISO6709'])
  const latitude = coordinateOrUndefined(raw.latitude ?? raw.GPSLatitude ?? isoLocation.latitude, raw.GPSLatitudeRef)
  const longitude = coordinateOrUndefined(raw.longitude ?? raw.GPSLongitude ?? isoLocation.longitude, raw.GPSLongitudeRef)
  return {
    make: textOrUndefined(raw.Make, raw.make, raw.DeviceManufacturer, raw.CameraManufacturer, raw['com.apple.quicktime.make'], raw['QuickTime:Make']),
    model: textOrUndefined(raw.Model, raw.model, raw.CameraModelName, raw.DeviceModelName, raw.HostComputer, raw['com.apple.quicktime.model'], raw['QuickTime:Model']),
    date: isoDate(raw.DateTimeOriginal || raw.CreateDate || raw.DateCreated || raw.MediaCreateDate || raw.CreationDate || raw.ModifyDate || raw['com.apple.quicktime.creationdate'] || raw['QuickTime:CreateDate']),
    latitude,
    longitude,
    focalLength: numberOrUndefined(raw.FocalLength),
    focalLength35mm: numberOrUndefined(raw.FocalLengthIn35mmFormat),
    fNumber: numberOrUndefined(raw.FNumber ?? raw.ApertureValue),
    exposureTime: numberOrUndefined(raw.ExposureTime ?? raw.ShutterSpeedValue),
    iso: numberOrUndefined(raw.ISO ?? raw.ISOSpeedRatings),
    exposureBias: numberOrUndefined(raw.ExposureCompensation ?? raw.ExposureBiasValue),
    lensModel: textOrUndefined(raw.LensModel, raw.LensID, raw.LensMake),
    width: numberOrUndefined(raw.ExifImageWidth || raw.ImageWidth || raw.PixelXDimension),
    height: numberOrUndefined(raw.ExifImageHeight || raw.ImageHeight || raw.PixelYDimension),
    orientation: orientationText(raw.Orientation),
    software: textOrUndefined(raw.Software),
    whiteBalance: whiteBalanceText(raw.WhiteBalance),
    captureType: captureTypeFromRaw(raw),
  }
}

async function extractMetadata(filePath) {
  try {
    exifrModulePromise ||= import('exifr')
    const loaded = await exifrModulePromise
    const exifr = loaded.default || loaded
    const options = { xmp: true, gps: true, tiff: true, exif: true, ifd0: true, iptc: true, translateValues: false, reviveValues: true, silentErrors: true }
    let raw = await exifr.parse(filePath, options)
    const exifOnly = await exifr.parse(filePath, { ...options, xmp: false, iptc: false })
    raw = { ...(exifOnly || {}), ...(raw || {}) }
    // A few Android camera builds make the appended MP4 trailer visible to
    // metadata readers. Retry against the clean still-image portion so the
    // camera, capture time and GPS fields are retained.
    if (!raw || Object.keys(raw).length === 0) {
      const extension = path.extname(filePath).toLowerCase()
      if (['.jpg', '.jpeg', '.heic', '.heif'].includes(extension)) {
        const buffer = await fs.promises.readFile(filePath)
        const embeddedStart = findEmbeddedMotionVideoStart(buffer)
        if (embeddedStart !== undefined) raw = await exifr.parse(buffer.subarray(0, embeddedStart), options)
      }
    }
    return normaliseMetadata(raw || {})
  } catch {
    return {}
  }
}

async function createPreview(filePath, size, modified, options = {}) {
  const extension = path.extname(filePath).toLowerCase()
  if (!['.avif', '.heic', '.heif', '.jpeg', '.jpg', '.png', '.webp'].includes(extension)) return undefined
  const preserveDimensions = options.preserveDimensions === true
  const maxWidth = Number.isFinite(options.maxWidth) ? Math.max(800, Math.round(options.maxWidth)) : 1600
  const quality = Number.isFinite(options.quality) ? Math.max(70, Math.min(96, Math.round(options.quality))) : 88
  const heicQuality = Number.isFinite(options.heicQuality) ? Math.max(0.8, Math.min(1, options.heicQuality)) : 0.9
  const variant = options.variant || 'thumbnail'
  const cacheKey = `${variant}-v4:${filePath}:${size}:${modified}:${preserveDimensions ? 'original' : maxWidth}:${quality}:${heicQuality}`
  const cached = previewCache.get(cacheKey)
  if (cached && fs.existsSync(cached)) return cached
  try {
    const previewDirectory = path.join(app.getPath('userData'), 'previews')
    fs.mkdirSync(previewDirectory, { recursive: true })
    const previewName = crypto.createHash('sha1').update(cacheKey).digest('hex') + '.jpg'
    const previewPath = path.join(previewDirectory, previewName)
    if (!fs.existsSync(previewPath)) {
      let image
      if (['.heic', '.heif'].includes(extension)) {
        heicConvertModulePromise ||= import('heic-convert')
        const loaded = await heicConvertModulePromise
        const convert = loaded.default || loaded
        let buffer = await fs.promises.readFile(filePath)
        // Some Android HEIC Motion Photos append the MP4 after the still image.
        // heic-convert expects a clean HEIC container, so exclude that trailer
        // while keeping the original file unchanged on disk.
        const embeddedStart = findEmbeddedMotionVideoStart(buffer)
        if (embeddedStart !== undefined) buffer = buffer.subarray(0, embeddedStart)
        const output = await convert({ buffer, format: 'JPEG', quality: heicQuality })
        image = nativeImage.createFromBuffer(Buffer.from(output))
      } else {
        image = nativeImage.createFromPath(filePath)
      }
      if (!image || image.isEmpty()) return undefined
      const dimensions = image.getSize()
      const thumbnail = !preserveDimensions && dimensions.width > maxWidth ? image.resize({ width: maxWidth, quality: 'best' }) : image
      await fs.promises.writeFile(previewPath, thumbnail.toJPEG(quality))
    }
    previewCache.set(cacheKey, previewPath)
    return previewPath
  } catch {
    return undefined
  }
}

async function createDetailPreview(filePath, size, modified) {
  // A full-size HEIC/HEIF cannot be decoded consistently by Chromium on
  // Windows. Generate a full-pixel-dimension JPEG for the viewer while the
  // small thumbnail remains the only asset used by the grid.
  return createPreview(filePath, size, modified, { variant: 'detail', preserveDimensions: true, quality: 96, heicQuality: 1 })
}

// Android Motion Photos are commonly delivered in either of two forms:
// a JPEG/HEIC with an MP4 appended to the end, or a still image paired with
// a separate MP4.  The browser cannot seek into an MP4 hidden inside an
// image, so extract the embedded asset once, keep the original untouched,
// and let the renderer merge the two files into one Live Photo card.
function findEmbeddedMotionVideoStart(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) return undefined

  const isValidMp4Start = (start) => {
    if (!Number.isInteger(start) || start < 4 || start + 12 > buffer.length) return false
    if (buffer.toString('ascii', start + 4, start + 8) !== 'ftyp') return false
    const boxSize = buffer.readUInt32BE(start)
    return boxSize >= 16 && start + boxSize <= buffer.length
  }

  // GCamera:MicroVideoOffset is the number of bytes from the end of the
  // still file to the beginning of the embedded MP4.
  const xmpHead = buffer.toString('latin1', 0, Math.min(buffer.length, 768 * 1024))
  const offsetMatch = xmpHead.match(/MicroVideoOffset[^0-9]{0,80}(\d{3,})/i)
  if (offsetMatch) {
    const start = buffer.length - Number(offsetMatch[1])
    if (isValidMp4Start(start)) return start
  }

  // A small number of Android camera apps omit the XMP offset.  Fall back to
  // the last structurally valid `ftyp` box, which is the appended MP4.
  const ftyp = Buffer.from('ftyp', 'ascii')
  const candidates = []
  let cursor = 0
  while (cursor < buffer.length) {
    const index = buffer.indexOf(ftyp, cursor)
    if (index < 4) break
    const start = index - 4
    if (isValidMp4Start(start)) candidates.push(start)
    cursor = index + ftyp.length
  }
  return candidates.length ? candidates[candidates.length - 1] : undefined
}

async function extractEmbeddedMotionVideo(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (!['.jpg', '.jpeg', '.heic', '.heif'].includes(extension)) return null
  try {
    const buffer = await fs.promises.readFile(filePath)
    const start = findEmbeddedMotionVideoStart(buffer)
    if (start === undefined) return null
    const video = buffer.subarray(start)
    if (video.length < 16) return null
    const stem = path.basename(filePath, path.extname(filePath))
    const outputPath = uniqueTarget(path.dirname(filePath), `${stem}.motion.mp4`)
    await fs.promises.writeFile(outputPath, video)
    return { path: outputPath, name: path.basename(outputPath), size: video.length }
  } catch {
    return null
  }
}

async function scanMediaDirectory(directory) {
  const results = []
  const visit = (currentDirectory) => {
    if (results.length >= 500) return
    let entries
    try {
      entries = fs.readdirSync(currentDirectory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= 500 || entry.name.startsWith('.')) continue
      const target = path.join(currentDirectory, entry.name)
      if (entry.isDirectory()) {
        visit(target)
        continue
      }
      if (!MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
      try {
        const stat = fs.statSync(target)
        results.push({ name: entry.name, path: target, size: stat.size, modified: stat.mtimeMs, mime: mimeType(entry.name), kind: mediaKind(entry.name) })
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }
  visit(path.resolve(directory))
  const sorted = results.sort((a, b) => b.modified - a.modified)
  const sizeCounts = sorted.reduce((counts, item) => counts.set(item.size, (counts.get(item.size) || 0) + 1), new Map())
  const videoStems = new Set(sorted.filter((item) => item.kind === 'video').map((item) => path.basename(item.name, path.extname(item.name)).replace(/(?:[._ -](?:motion|live[ _-]?photo|motion[ _-]?photo|dynamic[ _-]?photo))$/i, '').toLowerCase()))
  // Avoid starting hundreds of HEIC conversions and EXIF parses at once.
  // A small worker pool keeps the UI responsive on low-core machines while
  // still using parallelism on desktop hardware.
  const cpuCount = os.cpus().length || 2
  const concurrency = Math.min(4, Math.max(1, Math.floor(cpuCount / 2)))
  const enriched = new Array(sorted.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < sorted.length) {
      const index = cursor
      cursor += 1
      const item = sorted[index]
      const stem = path.basename(item.name, path.extname(item.name)).replace(/(?:[._ -](?:motion|live[ _-]?photo|motion[ _-]?photo|dynamic[ _-]?photo))$/i, '').toLowerCase()
      const motionCandidate = item.kind === 'photo' && videoStems.has(stem)
      enriched[index] = {
        ...item,
        previewPath: await createPreview(item.path, item.size, item.modified),
        detailPreviewPath: motionCandidate ? await createDetailPreview(item.path, item.size, item.modified) : undefined,
        metadata: await extractMetadata(item.path),
        // Hash only same-sized scan candidates. Exact import and wireless
        // deduplication still hashes the incoming file, while ordinary
        // library browsing avoids rereading every large video from disk.
        contentHash: sizeCounts.get(item.size) > 1 ? await contentHash(item.path, item.size, item.modified) : undefined,
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sorted.length) }, worker))
  return enriched
}

async function importMediaFiles(libraryPath, sourcePaths = []) {
  const libraryRoot = path.resolve(libraryPath)
  const incomingPath = path.join(libraryRoot, 'Incoming')
  await fs.promises.mkdir(incomingPath, { recursive: true })
  const imported = []
  const duplicates = []
  const failed = []
  for (const sourceValue of [...new Set(sourcePaths)]) {
    const sourcePath = path.resolve(String(sourceValue || ''))
    try {
      if (!MEDIA_EXTENSIONS.has(path.extname(sourcePath).toLowerCase())) continue
      const stat = await fs.promises.stat(sourcePath)
      if (!stat.isFile()) continue
      const digest = await contentHash(sourcePath, stat.size, stat.mtimeMs)
      const relativeToLibrary = path.relative(libraryRoot, sourcePath)
      if (relativeToLibrary && !relativeToLibrary.startsWith('..') && !path.isAbsolute(relativeToLibrary)) {
        duplicates.push({ source: sourcePath, existing: sourcePath, contentHash: digest })
        continue
      }
      const duplicatePath = await findDuplicateByContent(libraryRoot, sourcePath, stat.size, digest)
      if (duplicatePath) {
        duplicates.push({ source: sourcePath, existing: duplicatePath, contentHash: digest })
        continue
      }
      const targetPath = uniqueTarget(incomingPath, safeName(path.basename(sourcePath)))
      await fs.promises.copyFile(sourcePath, targetPath)
      await fs.promises.utimes(targetPath, stat.atime, stat.mtime).catch(() => undefined)
      imported.push(targetPath)
    } catch (error) {
      failed.push({ path: sourcePath, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { imported, duplicates, failed, files: await scanMediaDirectory(incomingPath) }
}

function transferPage(token, transferUrl, language = 'zh-CN') {
  const safeToken = JSON.stringify(token)
  const english = language === 'en'
  const copy = english ? {
    title: 'Transfer to MotionShelf', heading: 'Send Live Photos to your computer', intro: 'Original files are transferred directly over Wi-Fi. Android Motion Photos are automatically combined with their embedded motion video.', choose: 'Choose photos and videos', chooseHint: 'Android can select an original Motion Photo; on iPhone, select matching HEIC and MOV files.', open: 'Open phone photos / files', hint: 'Keep your phone and computer on the same Wi-Fi. Android users can choose the original Motion Photo from Google Photos or Files; matching JPG/MP4 pairs are combined automatically.', wake: 'The transfer will request a screen wake lock; resume from the checkpoint after locking or reconnecting Wi-Fi.', awake: 'Screen kept awake during transfer', wakePaused: 'The system paused the wake lock; unlock to resume automatically', foreground: 'Keep this page in the foreground; unlock to resume from the checkpoint', checking: 'Checking progress', skipped: 'Already exists — skipped', done: 'Completed', transferring: 'Transferring {count} file(s)', complete: 'Transfer complete — you can return to the computer', paused: 'Transfer paused — tap below to resume from the checkpoint', offline: 'Network disconnected — reconnect Wi-Fi to continue', resume: 'Resume transfer', waiting: 'Waiting to transfer', pending: 'Unfinished transfer found — choose the same files to resume', reselect: 'Choose files again to resume', companion: 'Import original Live Photo assets with the MotionShelf iPhone companion', end: 'Return to MotionShelf to organize your files'
  } : {
    title: '传到 MotionShelf', heading: '把实况照片传到电脑', intro: '原始文件通过当前 Wi-Fi 直接传到你的电脑，不经过云端。Android Motion Photo 会自动提取内嵌动态视频并合并显示。', choose: '选择照片和视频', chooseHint: 'Android 可直接选择 Motion Photo 原图；iPhone 可多选同名 HEIC 与 MOV', open: '打开手机相册 / 文件', hint: '请保持手机和电脑连接到同一个 Wi-Fi。Android 请从 Google 相册或系统“文件”中选择原始 Motion Photo；如果手机导出为同名 JPG/MP4，MotionShelf 也会自动合并为一张实况照片。', wake: '传输开始后会请求保持屏幕唤醒；锁屏或断网后可从断点继续', awake: '传输期间已保持屏幕唤醒', wakePaused: '系统暂停了屏幕唤醒，解锁后会自动续传', foreground: '请暂时保持此页面在前台；解锁后可断点续传', checking: '正在检查进度', skipped: '已存在，已跳过', done: '已完成', transferring: '正在传输 {count} 个文件', complete: '传输完成，可以返回电脑继续整理', paused: '传输已暂停，点击下方按钮从断点继续', offline: '网络已断开，恢复 Wi-Fi 后可以继续', resume: '继续 / 恢复传输', waiting: '等待传输', pending: '检测到未完成的传输，请重新选择相同文件恢复进度', reselect: '重新选择并恢复传输', companion: '用 MotionShelf iPhone 伴侣导入 Live Photo 原始资源', end: '返回 MotionShelf 继续整理文件'
  }
  const companionLink = transferUrl ? 'motionshelf://transfer?url=' + encodeURIComponent(transferUrl) : ''
  const companionLinkHtml = companionLink ? '<a class="companion" href="' + companionLink + '">' + copy.companion + '</a>' : ''
  const clientScript = `
    const token = ${safeToken}
    const copy = ${JSON.stringify(copy)}
    const input = document.getElementById("files")
    const status = document.getElementById("status")
    const bar = document.getElementById("bar")
    const list = document.getElementById("files-list")
    const resume = document.getElementById("resume")
    const wakeState = document.getElementById("wake-state")
    const chunkSize = 4 * 1024 * 1024
    const progress = new Map()
    const rows = new Map()
    const identities = new WeakMap()
    let files = []
    let uploading = false
    let paused = false
    let wakeLock = null

    const fileId = (file) => identities.get(file) || (file.name + ":" + file.size + ":" + file.lastModified)
    const query = (values) => Object.entries(values).map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(value)).join("&")
    const totalBytes = () => files.reduce((sum, file) => sum + file.size, 0)

    function updateOverall() {
      const total = totalBytes()
      const sent = [...progress.values()].reduce((sum, value) => sum + value, 0)
      bar.style.width = (total ? Math.min(100, sent / total * 100) : 0) + "%"
    }

    function setRow(file, text) {
      const id = fileId(file)
      let row = rows.get(id)
      if (!row) {
        row = document.createElement("div")
        row.className = "file"
        const filename = document.createElement("span")
        filename.textContent = file.name
        const result = document.createElement("span")
        row.append(filename, result)
        list.appendChild(row)
        rows.set(id, row)
      }
      row.lastElementChild.textContent = text
    }

    async function keepAwake() {
      if (!("wakeLock" in navigator) || wakeLock) return
      try {
        wakeLock = await navigator.wakeLock.request("screen")
        wakeState.textContent = copy.awake
        wakeLock.addEventListener("release", () => {
          wakeLock = null
          if (uploading) wakeState.textContent = copy.wakePaused
        })
      } catch (_) {
        wakeState.textContent = copy.foreground
      }
    }

    async function getUploadStatus(file) {
      const url = "/upload-status?" + query({ token, uploadId: fileId(file), name: file.name, size: file.size })
      const response = await fetch(url, { cache: "no-store" })
      if (!response.ok) throw new Error("status failed")
      return response.json()
    }

    function sendChunk(file, offset, end) {
      return new Promise((resolve, reject) => {
        const url = "/upload-chunk?" + query({ token, uploadId: fileId(file), name: file.name, size: file.size, offset, total: files.length })
        const xhr = new XMLHttpRequest()
        xhr.open("POST", url)
        xhr.timeout = 45000
        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          progress.set(fileId(file), Math.min(file.size, offset + event.loaded))
          const percent = Math.round(Math.min(file.size, offset + event.loaded) / Math.max(1, file.size) * 100)
          setRow(file, percent + "%")
          updateOverall()
        }
        xhr.onload = () => {
          let body = {}
          try { body = JSON.parse(xhr.responseText || "{}") } catch (_) {}
          if ((xhr.status >= 200 && xhr.status < 300) || xhr.status === 409) resolve(body)
          else reject(new Error("HTTP " + xhr.status))
        }
        xhr.onerror = () => reject(new Error("network failed"))
        xhr.ontimeout = () => reject(new Error("network timeout"))
        xhr.send(file.slice(offset, end))
      })
    }

    async function uploadFile(file) {
      const id = fileId(file)
      setRow(file, copy.checking)
      const remote = await getUploadStatus(file)
      let offset = Math.max(0, Math.min(file.size, Number(remote.received) || 0))
      progress.set(id, offset)
      updateOverall()
      if (remote.complete) {
        progress.set(id, file.size)
        setRow(file, remote.duplicate ? copy.skipped : copy.done)
        return
      }
      while (offset < file.size) {
        const end = Math.min(file.size, offset + chunkSize)
        const result = await sendChunk(file, offset, end)
        const next = Number(result.received ?? result.expectedOffset)
        if (!Number.isFinite(next) || next < 0 || next === offset && end !== file.size) throw new Error("invalid offset")
        offset = Math.min(file.size, next)
        progress.set(id, offset)
        setRow(file, offset >= file.size ? (result.duplicate ? copy.skipped : copy.done) : Math.round(offset / Math.max(1, file.size) * 100) + "%")
        updateOverall()
      }
    }

    async function runQueue() {
      if (uploading || !files.length) return
      uploading = true
      paused = false
      resume.hidden = true
      await keepAwake()
      status.textContent = copy.transferring.replace("{count}", files.length)
      try {
        for (const file of files) await uploadFile(file)
        bar.style.width = "100%"
        status.textContent = copy.complete
        localStorage.removeItem("motionshelf-pending-uploads")
        if (wakeLock) await wakeLock.release()
      } catch (_) {
        paused = true
        status.textContent = navigator.onLine ? copy.paused : copy.offline
        resume.textContent = copy.resume
        resume.hidden = false
      } finally {
        uploading = false
      }
    }

    input.addEventListener("change", () => {
      files = [...input.files]
      if (!files.length) return
      list.replaceChildren()
      rows.clear()
      progress.clear()
      files.forEach((file, index) => {
        identities.set(file, file.name + ":" + file.size + ":" + file.lastModified + ":" + index)
        setRow(file, copy.waiting)
      })
      localStorage.setItem("motionshelf-pending-uploads", JSON.stringify(files.map((file) => ({ name: file.name, size: file.size, lastModified: file.lastModified }))))
      runQueue()
    })
    resume.addEventListener("click", () => files.length ? runQueue() : input.click())
    window.addEventListener("online", () => { if (paused) runQueue() })
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        keepAwake()
        if (paused) runQueue()
      }
    })
    try {
      const pending = JSON.parse(localStorage.getItem("motionshelf-pending-uploads") || "[]")
      if (pending.length) {
        status.textContent = copy.pending
        resume.textContent = copy.reselect
        resume.hidden = false
      }
    } catch (_) {}
  `
  return [
    '<!doctype html>',
    '<html lang="' + (english ? 'en' : 'zh-CN') + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + copy.title + '</title>',
    '<style>body{margin:0;background:#f4f7f4;color:#17201d;font:16px -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif}main{max-width:560px;margin:0 auto;padding:38px 22px 60px}h1{font-size:32px;letter-spacing:-.05em;margin:28px 0 10px}p{color:#6f7d76;line-height:1.7}.brand{display:flex;align-items:center;gap:9px;font-weight:700}.mark{display:grid;place-items:center;width:30px;height:30px;border-radius:10px;color:white;background:#2a8177}.drop{display:flex;flex-direction:column;align-items:center;gap:13px;margin-top:28px;padding:34px 22px;border:1.5px dashed #8dbdb2;border-radius:18px;background:white;text-align:center}.drop input{display:none}.btn,.resume{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;border:0;border-radius:11px;color:white;background:#2a8177;font:inherit;font-weight:600}.resume{width:100%;margin-top:14px}.resume[hidden]{display:none}.companion{display:block;margin-top:18px;padding:13px 14px;border-radius:12px;color:#246d64;background:#e8f3ee;font-size:13px;font-weight:600;text-align:center;text-decoration:none}.hint,.wake{margin-top:14px;color:#78867f;font-size:12px;line-height:1.6}.wake{display:flex;align-items:center;gap:7px}.wake:before{content:"";width:7px;height:7px;border-radius:50%;background:#4d9e91}.status{margin-top:20px;color:#2a8177;font-size:13px}.bar{height:7px;margin-top:12px;overflow:hidden;border-radius:10px;background:#e1ebe5}.bar i{display:block;width:0;height:100%;background:#2a8177;transition:width .15s}.files{display:flex;flex-direction:column;gap:8px;margin-top:16px}.file{display:flex;justify-content:space-between;gap:10px;padding:11px 12px;border-radius:9px;background:#eaf1ec;font-size:12px}.file span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file span:last-child{flex:none;color:#6f7d76}</style></head>',
    '<body><main><div class="brand"><span class="mark">✦</span><span>MotionShelf</span></div><h1>' + copy.heading + '</h1><p>' + copy.intro + '</p>',
    '<label class="drop"><strong>' + copy.choose + '</strong><span>' + copy.chooseHint + '</span><span class="btn">' + copy.open + '</span><input id="files" type="file" accept="image/*,video/*,.heic,.heif,.jpg,.jpeg,.mp4,.mov,.m4v,.3gp" multiple></label>',
    companionLinkHtml,
    '<div class="hint">' + copy.hint + '</div><div id="wake-state" class="wake">' + copy.wake + '</div><div id="status" class="status"></div><div class="bar"><i id="bar"></i></div><button id="resume" class="resume" hidden>' + copy.resume + '</button><div id="files-list" class="files"></div></main>',
    '<script>' + clientScript + '</script></body></html>',
  ].join('')
}

async function stopTransferServer() {
  if (discoveryServer) {
    const server = discoveryServer
    discoveryServer = null
    await new Promise((resolve) => {
      try { server.close(resolve) } catch { resolve() }
    })
  }
  if (!transferServer) return
  await new Promise((resolve) => transferServer.close(resolve))
  transferServer = null
  transferSession = null
}

function startDiscoveryResponder() {
  if (!transferSession) return
  const server = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  server.on('message', (message, remote) => {
    if (message.toString('utf8').trim() !== 'MOTIONSHELF_DISCOVER_V1' || !transferSession) return
    const payload = Buffer.from(JSON.stringify({
      service: 'motionshelf-transfer',
      version: 1,
      computerName: os.hostname(),
      platform: process.platform,
      url: transferSession.url,
      token: transferSession.token,
    }))
    server.send(payload, remote.port, remote.address)
  })
  server.on('error', (error) => console.error('MotionShelf discovery unavailable:', error.message))
  server.bind(DISCOVERY_PORT, '0.0.0.0', () => server.setBroadcast(true))
  discoveryServer = server
}

async function startTransferServer(libraryPath, language = 'zh-CN') {
  await stopTransferServer()
  const incomingPath = path.join(libraryPath, 'Incoming')
  fs.mkdirSync(incomingPath, { recursive: true })
  const token = crypto.randomBytes(18).toString('hex')
  let receivedBytes = 0
  let completedFiles = 0
  let totalFiles = 0
  const completedUploads = new Map()
  const finalizingHashes = new Map()

  const json = (response, statusCode, payload) => {
    response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(payload))
  }
  const uploadPartPath = (uploadId) => {
    const digest = crypto.createHash('sha256').update(uploadId).digest('hex')
    return path.join(incomingPath, '.motionshelf-' + digest + '.part')
  }
  const announceReceivedFile = async (targetPath, name) => {
    try {
      const stat = await fs.promises.stat(targetPath)
      const metadata = await extractMetadata(targetPath)
      const previewPath = await createPreview(targetPath, stat.size, stat.mtimeMs)
      const embeddedMotion = await extractEmbeddedMotionVideo(targetPath)
      const detailPreviewPath = mediaKind(name) === 'photo' ? await createDetailPreview(targetPath, stat.size, stat.mtimeMs) : undefined
      mainWindow?.webContents.send('transfer-file', {
        name,
        path: targetPath,
        previewPath,
        detailPreviewPath,
        size: stat.size,
        kind: mediaKind(name),
        metadata,
        contentHash: await contentHash(targetPath, stat.size, stat.mtimeMs),
      })
      if (embeddedMotion) {
        const motionMetadata = await extractMetadata(embeddedMotion.path)
        mainWindow?.webContents.send('transfer-file', {
          name: embeddedMotion.name,
          path: embeddedMotion.path,
          size: embeddedMotion.size,
          kind: 'video',
          metadata: motionMetadata,
        })
      }
    } catch (error) {
      console.error('Could not process received media:', error)
    }
  }

  transferServer = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://localhost')
    if (request.method === 'GET' && requestUrl.pathname === '/transfer') {
      if (requestUrl.searchParams.get('token') !== token) {
        response.writeHead(403)
        response.end('Invalid transfer session')
        return
      }
      mainWindow?.webContents.send('transfer-connected')
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(transferPage(token, transferSession?.url, transferSession?.language || 'zh-CN'))
      return
    }
    if (requestUrl.searchParams.get('token') !== token) {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/upload-status') {
      const uploadId = requestUrl.searchParams.get('uploadId') || ''
      const expectedSize = Math.max(0, Number(requestUrl.searchParams.get('size')) || 0)
      totalFiles = Math.max(totalFiles, Number(requestUrl.searchParams.get('total')) || 0)
      if (!uploadId || !expectedSize) {
        json(response, 400, { ok: false, error: 'Invalid upload identity' })
        return
      }
      const suppliedHash = String(requestUrl.searchParams.get('sha256') || '').toLowerCase()
      void (async () => {
        const completed = completedUploads.get(uploadId)
        if (completed && completed.size === expectedSize && (!/^[a-f0-9]{64}$/.test(suppliedHash) || !completed.contentHash || completed.contentHash === suppliedHash)) {
          json(response, 200, { ok: true, received: expectedSize, complete: true, duplicate: Boolean(completed.duplicate) })
          return
        }
        if (/^[a-f0-9]{64}$/.test(suppliedHash)) {
          const duplicatePath = await findDuplicateByContent(libraryPath, uploadPartPath(uploadId), expectedSize, suppliedHash)
          if (duplicatePath) {
            completedUploads.set(uploadId, { path: duplicatePath, size: expectedSize, name: safeName(requestUrl.searchParams.get('name')), duplicate: true, contentHash: suppliedHash })
            completedFiles += 1
            const duplicateName = safeName(requestUrl.searchParams.get('name'))
            mainWindow?.webContents.send('transfer-duplicate', { name: duplicateName, path: duplicatePath, contentHash: suppliedHash })
            mainWindow?.webContents.send('transfer-progress', { receivedBytes, completedFiles, totalFiles, currentFile: duplicateName })
            json(response, 200, { ok: true, received: expectedSize, complete: true, duplicate: true })
            return
          }
        }
        const partPath = uploadPartPath(uploadId)
        let received = 0
        try { received = Math.min(expectedSize, fs.statSync(partPath).size) } catch (_) {}
        json(response, 200, { ok: true, received, complete: false })
      })().catch((error) => {
        console.error('Could not inspect upload status:', error)
        if (!response.headersSent) json(response, 500, { ok: false, error: 'Could not inspect upload' })
      })
      return
    }

    if (request.method === 'POST' && requestUrl.pathname === '/upload-chunk') {
      const uploadId = requestUrl.searchParams.get('uploadId') || ''
      const name = safeName(requestUrl.searchParams.get('name'))
      const expectedSize = Math.max(0, Number(requestUrl.searchParams.get('size')) || 0)
      const requestedOffset = Math.max(0, Number(requestUrl.searchParams.get('offset')) || 0)
      totalFiles = Math.max(totalFiles, Number(requestUrl.searchParams.get('total')) || 0)
      if (!uploadId || !expectedSize || requestedOffset > expectedSize) {
        json(response, 400, { ok: false, error: 'Invalid chunk metadata' })
        return
      }
      const completed = completedUploads.get(uploadId)
      if (completed && completed.size === expectedSize) {
        json(response, 200, { ok: true, received: expectedSize, complete: true })
        return
      }
      const partPath = uploadPartPath(uploadId)
      let currentSize = 0
      try { currentSize = fs.statSync(partPath).size } catch (_) {}
      if (currentSize !== requestedOffset) {
        json(response, 409, { ok: false, expectedOffset: Math.min(currentSize, expectedSize), received: Math.min(currentSize, expectedSize) })
        return
      }
      const chunks = []
      let chunkBytes = 0
      let rejected = false
      request.on('data', (chunk) => {
        chunkBytes += chunk.length
        if (chunkBytes > 8 * 1024 * 1024 || currentSize + chunkBytes > expectedSize) {
          rejected = true
          request.destroy()
          return
        }
        chunks.push(chunk)
      })
      request.on('end', async () => {
        if (rejected || !chunkBytes) {
          if (!response.headersSent) json(response, 413, { ok: false, error: 'Invalid chunk size' })
          return
        }
        try {
          await fs.promises.appendFile(partPath, Buffer.concat(chunks))
          const nextOffset = currentSize + chunkBytes
          receivedBytes += chunkBytes
          mainWindow?.webContents.send('transfer-progress', { receivedBytes, completedFiles, totalFiles, currentFile: name })
          if (nextOffset < expectedSize) {
            json(response, 200, { ok: true, received: nextOffset, complete: false })
            return
          }
          const digest = await contentHash(partPath, expectedSize, (await fs.promises.stat(partPath)).mtimeMs)
          const previousFinalizer = finalizingHashes.get(digest)
          if (previousFinalizer) await previousFinalizer
          let releaseFinalizer
          const currentFinalizer = new Promise((resolve) => { releaseFinalizer = resolve })
          finalizingHashes.set(digest, currentFinalizer)
          let duplicatePath
          let targetPath
          try {
            duplicatePath = await findDuplicateByContent(libraryPath, partPath, expectedSize, digest)
            targetPath = duplicatePath
            if (duplicatePath) {
              await fs.promises.unlink(partPath)
            } else {
              targetPath = uniqueTarget(incomingPath, name)
              await fs.promises.rename(partPath, targetPath)
            }
          } finally {
            if (finalizingHashes.get(digest) === currentFinalizer) finalizingHashes.delete(digest)
            releaseFinalizer()
          }
          completedUploads.set(uploadId, { path: targetPath, size: expectedSize, name, duplicate: Boolean(duplicatePath), contentHash: digest })
          completedFiles += 1
          mainWindow?.webContents.send('transfer-progress', { receivedBytes, completedFiles, totalFiles, currentFile: name })
          json(response, 201, { ok: true, received: expectedSize, complete: true, duplicate: Boolean(duplicatePath), sha256: digest })
          if (duplicatePath) mainWindow?.webContents.send('transfer-duplicate', { name, path: duplicatePath, contentHash: digest })
          else void announceReceivedFile(targetPath, name)
        } catch (error) {
          console.error('Could not store upload chunk:', error)
          if (!response.headersSent) json(response, 500, { ok: false, error: 'Could not store chunk' })
        }
      })
      request.on('error', () => {
        if (!response.headersSent) json(response, 500, { ok: false, error: 'Connection interrupted' })
      })
      return
    }

    if (request.method !== 'POST' || requestUrl.pathname !== '/upload') {
      response.writeHead(404)
      response.end('Not found')
      return
    }

    // Backwards compatibility for a transfer page that was already open when
    // the desktop app updated. New pages use resumable /upload-chunk requests.
    const name = safeName(requestUrl.searchParams.get('name'))
    totalFiles = Math.max(totalFiles, Number(requestUrl.searchParams.get('total')) || 0)
    const targetPath = uniqueTarget(incomingPath, name)
    const writeStream = fs.createWriteStream(targetPath)
    let fileBytes = 0
    request.on('data', (chunk) => {
      fileBytes += chunk.length
      receivedBytes += chunk.length
      mainWindow?.webContents.send('transfer-progress', { receivedBytes, completedFiles, totalFiles, currentFile: name })
    })
    request.on('aborted', () => writeStream.destroy())
    request.pipe(writeStream)
    writeStream.on('finish', async () => {
      completedFiles += 1
      mainWindow?.webContents.send('transfer-progress', { receivedBytes, completedFiles, totalFiles, currentFile: name })
      response.writeHead(201, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
      void announceReceivedFile(targetPath, name)
    })
    writeStream.on('error', () => {
      response.writeHead(500)
      response.end(JSON.stringify({ ok: false }))
    })
  })

  await new Promise((resolve) => transferServer.listen(0, '0.0.0.0', resolve))
  const address = transferServer.address()
  const host = getLanAddress()
  transferSession = {
    token,
    host,
    port: address.port,
    url: 'http://' + host + ':' + address.port + '/transfer?token=' + token,
    incomingPath,
    language,
  }
  startDiscoveryResponder()
  return transferSession
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    title: 'MotionShelf',
    backgroundColor: '#f4f7f4',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173/')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

ipcMain.handle('start-transfer-session', (_event, libraryPath, language) => startTransferServer(libraryPath, language))
ipcMain.handle('stop-transfer-session', () => stopTransferServer())
ipcMain.handle('scan-directory', (_event, directory) => scanMediaDirectory(directory))
ipcMain.handle('create-detail-preview', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !filePath.trim()) return null
  try {
    const stat = await fs.promises.stat(filePath)
    if (!stat.isFile()) return null
    return createDetailPreview(filePath, stat.size, stat.mtimeMs)
  } catch {
    return null
  }
})
ipcMain.handle('import-media-files', (_event, libraryPath, paths = []) => importMediaFiles(libraryPath, paths))
ipcMain.handle('delete-media-files', async (_event, libraryPath, paths = []) => {
  if (typeof libraryPath !== 'string' || !libraryPath.trim()) return { deleted: [], failed: [{ path: '', error: '媒体库位置无效' }] }
  const libraryRoot = path.resolve(libraryPath)
  const trashRoot = path.join(libraryRoot, '.MotionShelfTrash')
  await fs.promises.mkdir(trashRoot, { recursive: true })
  const candidates = [...new Set((Array.isArray(paths) ? paths : []).filter((value) => typeof value === 'string').map((value) => path.resolve(value)))]
  const deleted = []
  const failed = []
  const trashEntries = []
  for (const target of candidates) {
    const relativeToTrash = path.relative(trashRoot, target)
    if (!relativeToTrash.startsWith('..') && !path.isAbsolute(relativeToTrash)) {
      failed.push({ path: target, error: '不能直接删除回收站中的文件' })
      continue
    }
    try {
      if (!fs.existsSync(target)) {
        deleted.push(target)
        trashEntries.push({ original: target, trash: null })
        continue
      }
      const stat = await fs.promises.lstat(target)
      if (!stat.isFile()) {
        failed.push({ path: target, error: '只允许删除单个媒体文件' })
        continue
      }
      const destination = uniqueTarget(trashRoot, `${Date.now()}-${path.basename(target)}`)
      try {
        await fs.promises.rename(target, destination)
      } catch (renameError) {
        // A library on another volume may not support rename; retain the same
        // recoverable semantics with a copy followed by an unlink.
        await fs.promises.copyFile(target, destination)
        try {
          await fs.promises.unlink(target)
        } catch (unlinkError) {
          await fs.promises.rm(destination, { force: true }).catch(() => undefined)
          throw unlinkError
        }
      }
      deleted.push(target)
      trashEntries.push({ original: target, trash: destination })
    } catch (error) {
      failed.push({ path: target, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { deleted, failed, trashEntries }
})
ipcMain.handle('restore-media-files', async (_event, libraryPath, entries = []) => {
  if (typeof libraryPath !== 'string' || !libraryPath.trim()) return { restored: [], failed: [{ path: '', error: '媒体库位置无效' }] }
  const libraryRoot = path.resolve(libraryPath)
  const trashRoot = path.join(libraryRoot, '.MotionShelfTrash')
  const restored = []
  const failed = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    const original = typeof entry?.original === 'string' ? path.resolve(entry.original) : ''
    const trash = typeof entry?.trash === 'string' ? path.resolve(entry.trash) : ''
    const relativeTrash = trash ? path.relative(trashRoot, trash) : '..'
    const relativeOriginalToTrash = original ? path.relative(trashRoot, original) : '..'
    if (!original || !trash || (!relativeOriginalToTrash.startsWith('..') && !path.isAbsolute(relativeOriginalToTrash)) || !relativeTrash || relativeTrash.startsWith('..') || path.isAbsolute(relativeTrash)) {
      failed.push({ path: original || String(entry?.original || ''), error: '恢复路径无效' })
      continue
    }
    try {
      if (!fs.existsSync(trash)) {
        failed.push({ path: original, error: '回收站中的文件不存在' })
        continue
      }
      const stat = await fs.promises.lstat(trash)
      if (!stat.isFile()) {
        failed.push({ path: original, error: '回收站项目不是文件' })
        continue
      }
      await fs.promises.mkdir(path.dirname(original), { recursive: true })
      const destination = fs.existsSync(original) ? uniqueTarget(path.dirname(original), path.basename(original)) : original
      try {
        await fs.promises.rename(trash, destination)
      } catch {
        await fs.promises.copyFile(trash, destination)
        await fs.promises.unlink(trash)
      }
      restored.push({ original, from: trash, to: destination })
    } catch (error) {
      failed.push({ path: original, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { restored, failed }
})
ipcMain.handle('open-recycle-bin', async (_event, libraryPath) => {
  try {
    if (typeof libraryPath === 'string' && libraryPath.trim()) {
      const target = path.join(path.resolve(libraryPath), '.MotionShelfTrash')
      await fs.promises.mkdir(target, { recursive: true })
      const error = await shell.openPath(target)
      return { ok: !error, error: error || null }
    }
    if (process.platform === 'win32') {
      await shell.openExternal('shell:RecycleBinFolder')
      return { ok: true, error: null }
    }
    const target = process.platform === 'darwin' ? path.join(os.homedir(), '.Trash') : os.homedir()
    const error = await shell.openPath(target)
    return { ok: !error, error: error || null }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})
ipcMain.handle('open-usb-importer', async () => {
  if (process.platform === 'darwin') {
    const error = await shell.openPath('/System/Library/CoreServices/Image Capture.app')
    return { ok: !error, error: error || null }
  }
  if (process.platform === 'win32') {
    try {
      await shell.openExternal('ms-photos:')
      return { ok: true, error: null }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
  return { ok: false, error: '当前系统没有可用的系统照片导入工具' }
})

ipcMain.handle('choose-directory', async (_event, options = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title || '选择文件夹',
    buttonLabel: options.buttonLabel || '选择此文件夹',
    properties: ['openDirectory', 'createDirectory'],
  })

  return {
    canceled: result.canceled,
    path: result.canceled ? null : result.filePaths[0] || null,
  }
})

ipcMain.handle('reveal-path', async (_event, targetPath) => {
  if (typeof targetPath !== 'string' || !targetPath) return false
  shell.showItemInFolder(targetPath)
  return true
})

app.whenReady().then(() => {
  protocol.handle('motionshelf-media', serveMediaRequest)
  Menu.setApplicationMenu(null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (transferServer) transferServer.close()
})
