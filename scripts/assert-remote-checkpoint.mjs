#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function validateRemoteCheckpoint({ branch, head, remoteHead, dirty }) {
  if (!branch || branch === 'HEAD') throw new Error('REMOTE_CHECKPOINT_DETACHED_HEAD')
  if (dirty) throw new Error('REMOTE_CHECKPOINT_DIRTY_WORKTREE')
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error('REMOTE_CHECKPOINT_INVALID_BRANCH')
  if (!/^[a-f0-9]{40}$/.test(head || '') || !/^[a-f0-9]{40}$/.test(remoteHead || '')) {
    throw new Error('REMOTE_CHECKPOINT_INVALID_SHA')
  }
  if (head !== remoteHead) throw new Error(`REMOTE_CHECKPOINT_NOT_PUSHED:${head.slice(0, 12)}!=${remoteHead.slice(0, 12)}`)
  return { ok: true, branch, head }
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function assertCurrentHeadIsRemoteCheckpoint() {
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error('REMOTE_CHECKPOINT_INVALID_BRANCH')
  const head = git(['rev-parse', 'HEAD'])
  if (git(['status', '--porcelain', '--untracked-files=normal'])) {
    return validateRemoteCheckpoint({ branch, head, remoteHead: head, dirty: true })
  }
  try {
    git(['fetch', '--quiet', 'origin', branch])
  } catch (error) {
    const detail = String(error?.stderr || error?.message || 'fetch failed').split('\n')[0].slice(0, 240)
    throw new Error(`REMOTE_CHECKPOINT_FETCH_FAILED:${detail}`)
  }
  return validateRemoteCheckpoint({
    branch,
    head,
    remoteHead: git(['rev-parse', `refs/remotes/origin/${branch}`]),
    dirty: false,
  })
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    console.log(JSON.stringify(assertCurrentHeadIsRemoteCheckpoint()))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
