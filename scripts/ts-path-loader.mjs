import path from 'path'
import { pathToFileURL, fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2)
    const base = path.join(ROOT, 'src', rel)
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      try {
        const candidate = base.endsWith('.ts') || base.endsWith('.tsx') ? base : base + ext
        return nextResolve(pathToFileURL(candidate).href, context)
      } catch {
        /* try next */
      }
    }
    const withTs = base.endsWith('.ts') || base.endsWith('.tsx') ? base : `${base}.ts`
    return nextResolve(pathToFileURL(withTs).href, context)
  }
  return nextResolve(specifier, context)
}
