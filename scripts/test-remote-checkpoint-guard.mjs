#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { validateRemoteCheckpoint } from './assert-remote-checkpoint.mjs'

const sha = 'a'.repeat(40)
assert.deepEqual(validateRemoteCheckpoint({ branch: 'safety/mirax-v5', head: sha, remoteHead: sha, dirty: false }), {
  ok: true, branch: 'safety/mirax-v5', head: sha,
})
assert.throws(() => validateRemoteCheckpoint({ branch: 'HEAD', head: sha, remoteHead: sha, dirty: false }), /DETACHED/)
assert.throws(() => validateRemoteCheckpoint({ branch: 'safety/test', head: sha, remoteHead: sha, dirty: true }), /DIRTY/)
assert.throws(() => validateRemoteCheckpoint({ branch: 'safety/test', head: sha, remoteHead: 'b'.repeat(40), dirty: false }), /NOT_PUSHED/)
assert.throws(() => validateRemoteCheckpoint({ branch: 'bad branch', head: sha, remoteHead: sha, dirty: false }), /INVALID_BRANCH/)

for (const path of ['backend_mirror/scripts/deploy-staging.ps1', 'backend_mirror/scripts/deploy-staging.sh']) {
  const source = fs.readFileSync(path, 'utf8')
  assert.match(source, /assert-remote-checkpoint\.mjs/, `${path} must enforce a remote checkpoint`)
}
const powershell = fs.readFileSync('backend_mirror/scripts/deploy-staging.ps1', 'utf8')
assert.doesNotMatch(powershell, /systemctl restart mirax-worker-staging/)

console.log('remote checkpoint deploy guard: PASS')
