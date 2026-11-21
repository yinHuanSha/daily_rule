import { decodeTree, parseBackup, type TreeState } from './model.ts'

export interface CloudConfig {
  location: string
}

export interface RemoteSnapshot {
  revision: string
  state: TreeState
}

const api = 'https://api.github.com'
const maxBytes = 16 * 1024 * 1024
const isRevision = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[\da-f]{40}|[\da-f]{64})$/i.test(value)

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function request(path: string, token: string, body?: object) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const response = await fetch(api + path, {
      method: body ? 'PUT' : 'GET',
      redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    return { status: response.status, data: response.ok ? object(await response.json()) : {} }
  } catch {
    throw new Error('连接 GitHub 失败或超时。请检查网络，稍后再同步。')
  } finally {
    clearTimeout(timer)
  }
}

function failure(status: number): Error {
  if (status === 401) return new Error('GitHub 令牌已失效，请重新设置。')
  if (status === 403) return new Error('GitHub 暂时拒绝访问。请检查仓库权限或稍后再试。')
  if (status === 409 || status === 422) return new Error('云端版本已变化或写入受限。请重新同步并核对。')
  return new Error('GitHub 请求失败（HTTP ' + status + '）。')
}

async function repository(config: CloudConfig, secret: string) {
  const name = config.location.trim()
  const token = secret.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(name) ||
      ['.', '..'].includes(name.split('/')[1]) || name.toLowerCase() === 'yinhuansha/daily_rule') {
    throw new Error('请填写专门存放档案的私有仓库，格式为「账号/仓库名」。')
  }
  if (!token) throw new Error('请先设置该私有仓库的 GitHub 令牌。')
  const path = '/repos/' + name
  const { status, data } = await request(path, token)
  if (status === 404) throw new Error('找不到同步仓库，请检查名称和令牌的仓库授权。')
  if (status !== 200) throw failure(status)
  if (data.private !== true || typeof data.full_name !== 'string' || data.full_name.toLowerCase() !== name.toLowerCase() ||
      typeof data.default_branch !== 'string' || !data.default_branch) {
    throw new Error('请使用已验证的私有仓库。')
  }
  return { path, branch: data.default_branch, token }
}

function decodeContent(content: unknown): TreeState {
  if (typeof content !== 'string') throw new Error('云端档案内容缺失。')
  const base64 = content.replace(/\s+/g, '')
  if (base64.length > Math.ceil(maxBytes / 3) * 4) throw new Error('云端档案超过 16 MiB。')
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return parseBackup(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

export async function readRemote(config: CloudConfig, secret: string): Promise<RemoteSnapshot | null> {
  const { path, branch, token } = await repository(config, secret)
  const file = await request(path + '/contents/archive.json?ref=' + encodeURIComponent(branch), token)
  if (file.status === 404) return null
  if (file.status !== 200) throw failure(file.status)
  const entry = file.data
  if (entry?.type !== 'file' || !isRevision(entry.sha)) throw new Error('云端 archive.json 须为普通档案文件。')
  if (typeof entry.size === 'number' && entry.size > maxBytes) throw new Error('云端档案超过 16 MiB。')
  if (entry.encoding === 'base64') return { revision: entry.sha, state: decodeContent(entry.content) }
  // GitHub omits inline content above 1 MiB. Read the same immutable blob.
  const blob = await request(path + '/git/blobs/' + entry.sha, token)
  if (blob.status !== 200) throw failure(blob.status)
  if (blob.data?.sha !== entry.sha || blob.data.encoding !== 'base64') throw new Error('读取云端文件版本失败。')
  return { revision: entry.sha, state: decodeContent(blob.data.content) }
}

export async function writeRemote(config: CloudConfig, secret: string, state: TreeState, expectedRevision: string | null): Promise<string> {
  if (expectedRevision !== null && !isRevision(expectedRevision)) throw new Error('缺少有效的云端版本，请重新同步。')
  const bytes = new TextEncoder().encode(JSON.stringify(decodeTree(state)))
  if (bytes.length > maxBytes) throw new Error('本机档案超过 16 MiB。')
  const chunks: string[] = []
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
  const { path, branch, token } = await repository(config, secret)
  const result = await request(path + '/contents/archive.json', token, {
    message: '同步每日国策档案', content: btoa(chunks.join('')), branch,
    ...(expectedRevision === null ? {} : { sha: expectedRevision }),
  })
  if (result.status !== 200 && result.status !== 201) throw failure(result.status)
  const sha = object(result.data.content).sha
  if (!isRevision(sha)) throw new Error('请重新同步以核对写入结果。')
  return sha
}
