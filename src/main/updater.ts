import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import pkg from '../../package.json'

/**
 * Auto-update via electron-updater. Active ONLY in packaged builds AND only when a
 * publish target is configured (package.json `appConfig.publish`). Otherwise a no-op,
 * so dev sessions and unpublished apps never reach for an update server.
 */
export function initAutoUpdate(): void {
  const publish = (pkg.appConfig as { publish?: unknown }).publish
  if (!app.isPackaged || !publish) return
  autoUpdater.checkForUpdatesAndNotify().catch(() => {
    /* offline / no release yet — ignore */
  })
}
