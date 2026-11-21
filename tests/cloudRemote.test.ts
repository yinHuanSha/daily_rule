import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyState } from '../src/model.ts'
import { readRemote, writeRemote } from '../src/cloudRemote.ts'

const config = { location: 'example/personal-archive' }
const repo = { full_name: config.location, default_branch: 'main', private: true }
const sha = 'a'.repeat(40)
const state = emptyState()

test('requests refuse a public repo, block redirected credentials and never PUT', async t => {
  let count = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    count++
    assert.equal(url, 'https://api.github.com/repos/example/personal-archive')
    assert.equal(init.redirect, 'error')
    assert.equal(init.method, 'GET')
    return Response.json({ ...repo, private: false })
  })
  await assert.rejects(writeRemote(config, 'sample', state, null), /私有仓库/)
  assert.equal(count, 1)
})

test('an absent file can be created, and an immutable blob is used when GitHub omits inline data', async t => {
  const replies = [
    Response.json(repo), new Response(null, {status: 404}), Response.json(repo),
    Response.json({content: {sha}}, {status: 201}), Response.json(repo),
    Response.json({type: 'file', encoding: 'none', sha, size: 1200000}),
    Response.json({sha, encoding: 'base64', content: Buffer.from(JSON.stringify(state)).toString('base64')}),
  ]
  const urls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    urls.push(String(url))
    if (init.method === 'PUT') {
      const payload = JSON.parse(init.body)
      assert.equal(payload.sha, undefined)
      assert.equal(payload.branch, 'main')
      assert.deepEqual(JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8')), state)
    }
    return replies.shift()
  })
  assert.equal(await readRemote(config, 'sample'), null)
  assert.equal(await writeRemote(config, 'sample', state, null), sha)
  assert.deepEqual(await readRemote(config, 'sample'), {revision: sha, state})
  assert.ok(urls.at(-1)?.endsWith('/git/blobs/' + sha))
  assert.equal(replies.length, 0)
})

test('overwrites send the preview revision and a stale write is not retried', async t => {
  let puts = 0
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (init.method === 'GET') return Response.json(repo)
    assert.equal(JSON.parse(init.body).sha, sha)
    puts++
    return new Response(null, {status: 409})
  })
  await assert.rejects(writeRemote(config, 'sample', state, sha), /重新同步/)
  assert.equal(puts, 1)
})
