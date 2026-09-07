import { describe, expect, it } from 'vitest'

describe('MotionShelf language selection', () => {
  it('uses English for a non-Chinese system locale', async () => {
    const i18n = await import('./i18n').catch(() => undefined)

    expect(i18n?.resolveLanguage('system', ['en-US'])).toBe('en')
  })

  it('uses Chinese for any Chinese system locale', async () => {
    const i18n = await import('./i18n').catch(() => undefined)

    expect(i18n?.resolveLanguage('system', ['zh-Hant-HK', 'en-US'])).toBe('zh-CN')
  })

  it('honors an explicit language choice regardless of the system locale', async () => {
    const i18n = await import('./i18n').catch(() => undefined)

    expect(i18n?.resolveLanguage('en', ['zh-CN'])).toBe('en')
    expect(i18n?.resolveLanguage('zh-CN', ['en-US'])).toBe('zh-CN')
  })

  it('falls back to the key when a translation is missing', async () => {
    const i18n = await import('./i18n').catch(() => undefined)

    expect(i18n?.translate('en', 'missing.translation.key')).toBe('missing.translation.key')
  })
})
