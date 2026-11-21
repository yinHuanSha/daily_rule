import { decodeTree } from './model.ts'
import type { TreeState } from './model.ts'

export interface SyncSnapshot { revision: string; state: TreeState }
export interface SyncCheckpoint { digest: string; revision: string; at: string }
export type SyncAction = 'same' | 'upload' | 'download' | 'choose' | 'create'
export interface SyncPreview {
  local: TreeState
  remote: SyncSnapshot | null
  digest: string
  remoteDigest?: string
  action: SyncAction
}

// decodeTree gives objects a stable field order across C++ and JavaScript exports.
export async function archiveDigest(state: TreeState): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(decodeTree(state)))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('')
}

export async function compareArchives(local: TreeState, remote: SyncSnapshot | null,
                                      checkpoint: SyncCheckpoint | null): Promise<SyncPreview> {
  const digest = await archiveDigest(local)
  if (!remote) return { local, remote, digest, action: 'create' }
  const remoteDigest = await archiveDigest(remote.state)
  let action: SyncAction = 'choose'
  if (digest === remoteDigest) action = 'same'
  else if (checkpoint?.digest === remoteDigest) action = 'upload'
  else if (checkpoint?.digest === digest) action = 'download'
  return { local, remote, digest, remoteDigest, action }
}

interface SyncPorts {
  getLocal(): Promise<TreeState>
  getRemote(): Promise<SyncSnapshot | null>
  putRemote(state: TreeState, expectedRevision: string | null): Promise<string>
  replaceLocal(next: TreeState, expected: TreeState): Promise<void>
}

export async function applySync(preview: SyncPreview, direction: 'upload' | 'download', ports: SyncPorts,
                                recheckRemote: boolean): Promise<SyncCheckpoint> {
  let revision: string
  let digest: string
  if (direction === 'upload') {
    if (await archiveDigest(await ports.getLocal()) !== preview.digest)
      throw new Error('手机档案已变化，请重新同步并核对。')
    revision = await ports.putRemote(preview.local, preview.remote?.revision ?? null)
    digest = preview.digest
  } else {
    const remote = preview.remote
    if (!remote || !preview.remoteDigest) throw new Error('云端档案尚未建立。')
    if (recheckRemote && (await ports.getRemote())?.revision !== remote.revision)
      throw new Error('云端档案已变化，请重新同步并核对。')
    await ports.replaceLocal(remote.state, preview.local)
    revision = remote.revision
    digest = preview.remoteDigest
  }
  return { revision, digest, at: new Date().toISOString() }
}
