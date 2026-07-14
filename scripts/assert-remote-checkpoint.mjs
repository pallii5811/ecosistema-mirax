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

export function parseGitHubRepository(remoteUrl) {
  const value = String(remoteUrl || '').trim()
  const match = value.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i)
  if (!match) throw new Error('REMOTE_CHECKPOINT_UNSUPPORTED_ORIGIN')
  return `${match[1]}/${match[2]}`
}

function githubRemoteHead(repository, branch) {
  return execFileSync('gh', [
    'api', `repos/${repository}/git/ref/heads/${branch}`, '--jq', '.object.sha',
  ], {
    encoding: 'utf8', timeout: 20_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

export function assertCurrentHeadIsRemoteCheckpoint() {
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error('REMOTE_CHECKPOINT_INVALID_BRANCH')
  const head = git(['rev-parse', 'HEAD'])
  if (git(['status', '--porcelain', '--untracked-files=normal'])) {
    return validateRemoteCheckpoint({ branch, head, remoteHead: head, dirty: true })
  }

  // The authenticated GitHub API is authoritative and avoids blocking a
  // release on a slow `git fetch`. Keep fetch as a portable fallback.
  let remoteHead
  try {
    const repository = parseGitHubRepository(git(['config', '--get', 'remote.origin.url']))
    remoteHead = githubRemoteHead(repository, branch)
  } catch (apiError) {
    try {
      git(['fetch', '--quiet', 'origin', branch])
      remoteHead = git(['rev-parse', `refs/remotes/origin/${branch}`])
    } catch (fetchError) {
      const apiDetail = String(apiError?.stderr || apiError?.message || 'API failed').split('\n')[0].slice(0, 120)
      const fetchDetail = String(fetchError?.stderr || fetchError?.message || 'fetch failed').split('\n')[0].slice(0, 120)
      throw new Error(`REMOTE_CHECKPOINT_VERIFY_FAILED:api=${apiDetail};fetch=${fetchDetail}`)
    }
  }
  return validateRemoteCheckpoint({ branch, head, remoteHead, dirty: false })
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
