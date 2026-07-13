// Vercel's prebuilt packager deduplicates identical functions with directory
// symlinks. Non-elevated Windows may reject them with EPERM; for this packaging
// process only, materialize the same directory contents instead.
const fs = require('node:fs')
const path = require('node:path')

const originalPromiseSymlink = fs.promises.symlink.bind(fs.promises)
fs.promises.symlink = async function symlinkWithCopyFallback(target, destination, type) {
  try {
    return await originalPromiseSymlink(target, destination, type)
  } catch (error) {
    if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error
    const source = path.resolve(path.dirname(String(destination)), String(target))
    const stat = await fs.promises.stat(source)
    if (!stat.isDirectory()) throw error
    await fs.promises.cp(source, destination, { recursive: true, errorOnExist: true, force: false })
  }
}

const originalSymlink = fs.symlink.bind(fs)
fs.symlink = function symlinkCallbackFallback(target, destination, type, callback) {
  if (typeof type === 'function') {
    callback = type
    type = undefined
  }
  return originalSymlink(target, destination, type, async (error) => {
    if (!error) return callback(null)
    if (process.platform !== 'win32' || error.code !== 'EPERM') return callback(error)
    try {
      const source = path.resolve(path.dirname(String(destination)), String(target))
      const stat = await fs.promises.stat(source)
      if (!stat.isDirectory()) return callback(error)
      await fs.promises.cp(source, destination, { recursive: true, errorOnExist: true, force: false })
      callback(null)
    } catch (copyError) {
      callback(copyError)
    }
  })
}
