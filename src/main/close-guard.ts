/**
 * Unsaved-changes guard. The renderer reports whether the in-memory project is dirty (and its
 * name); closing the window (or quitting) while dirty asks Save / Don't Save / Cancel. "Save"
 * hands the write back to the renderer (it owns the project state and the save-as dialog) and
 * only closes once that reports success. The same dialog is exposed to the renderer for its own
 * replace-project flows (open another project, new project).
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'

export type SaveChoice = 'save' | 'discard' | 'cancel'

let dirty = false
let projectName = ''

/** Pending save requests to the renderer, by token. */
const pendingSaves = new Map<number, (ok: boolean) => void>()
let nextToken = 1

export function registerCloseGuard(): void {
  ipcMain.on('proj:dirty', (_evt, d: boolean, name: string) => {
    dirty = !!d
    projectName = name ?? ''
  })
  ipcMain.handle('proj:askSave', (evt, action: string): Promise<SaveChoice> => {
    const win = BrowserWindow.fromWebContents(evt.sender)
    return askSave(win, action)
  })
  ipcMain.on('proj:saveResult', (_evt, token: number, ok: boolean) => {
    pendingSaves.get(token)?.(!!ok)
    pendingSaves.delete(token)
  })
}

async function askSave(win: BrowserWindow | null, action: string): Promise<SaveChoice> {
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: `Save changes to “${projectName || 'Untitled project'}” before ${action}?`,
    detail: "Your changes will be lost if you don't save them."
  }
  const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
  return res.response === 0 ? 'save' : res.response === 1 ? 'discard' : 'cancel'
}

/** Ask the renderer to save the project; resolves false if it couldn't (e.g. save-as cancelled). */
function requestRendererSave(win: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    const token = nextToken++
    pendingSaves.set(token, resolve)
    win.webContents.send('proj:saveRequest', token)
    // If the renderer goes away without answering, don't hang the close forever.
    win.webContents.once('destroyed', () => {
      if (pendingSaves.delete(token)) resolve(false)
    })
  })
}

/** Intercept the window's close while the project is dirty. */
export function installCloseGuard(win: BrowserWindow): void {
  let allowClose = false
  let asking = false
  win.on('close', (e) => {
    if (allowClose || !dirty) return
    e.preventDefault()
    if (asking) return
    asking = true
    void (async () => {
      try {
        const choice = await askSave(win, 'closing')
        if (choice === 'cancel') return
        if (choice === 'save' && !(await requestRendererSave(win))) return
        allowClose = true
        win.close()
      } finally {
        asking = false
      }
    })()
  })
}
