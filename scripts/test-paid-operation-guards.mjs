import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const allowedAnthropic = new Set([
  path.normalize('src/lib/intent-compiler/compile-commercial-search-plan.ts'),
  path.normalize('backend_mirror/agents/data_extractor.py'),
  path.normalize('backend_mirror/agents/web_researcher.py'),
  path.normalize('backend_mirror/semantic_intelligence.py'),
])
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.py'])
const ignored = new Set(['node_modules', '.next', '.git', '.vercel', '__pycache__'])
const failures = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(absolute)
    else if (extensions.has(path.extname(entry.name))) inspect(absolute)
  }
}

function inspect(absolute) {
  const relative = path.normalize(path.relative(root, absolute))
  const text = fs.readFileSync(absolute, 'utf8')
  if (text.includes('https://api.anthropic.com/v1/messages') && !allowedAnthropic.has(relative)) {
    failures.push(`unapproved Anthropic call: ${relative}`)
  }
  if (/https:\/\/api\.openai\.com/i.test(text)) {
    failures.push(`OpenAI endpoint present: ${relative}`)
  }
  if (
    text.includes("fetch('/api/claude-enrich-batch'") ||
    text.includes('fetch("/api/claude-enrich-batch"')
  ) {
    failures.push(`retired unmetered enrichment invoked: ${relative}`)
  }
}

walk(path.join(root, 'src'))
walk(path.join(root, 'backend_mirror'))

const compiler = fs.readFileSync(
  path.join(root, 'src/lib/intent-compiler/compile-commercial-search-plan.ts'),
  'utf8',
)
if (compiler.indexOf('await meter.reserve') < 0 || compiler.indexOf('await meter.reserve') > compiler.indexOf("fetch('https://api.anthropic.com")) {
  failures.push('compiler does not reserve before Anthropic execution')
}

const extractor = fs.readFileSync(path.join(root, 'backend_mirror/agents/data_extractor.py'), 'utf8')
if (!extractor.includes('Anthropic extraction requires an atomic cost governor')) {
  failures.push('extractor lacks fail-closed governor guard')
}

const researcher = fs.readFileSync(path.join(root, 'backend_mirror/agents/web_researcher.py'), 'utf8')
if (!researcher.includes('Anthropic query generation requires an atomic cost governor')) {
  failures.push('query generator lacks fail-closed governor guard')
}

const semantic = fs.readFileSync(path.join(root, 'backend_mirror/semantic_intelligence.py'), 'utf8')
if (!semantic.includes('semantic interpretation requires an atomic cost governor')) {
  failures.push('semantic interpreter lacks fail-closed governor guard')
}
if (
  semantic.indexOf('governor.reserve(') < 0 ||
  semantic.indexOf('governor.reserve(') > semantic.indexOf('https://api.anthropic.com/v1/messages')
) {
  failures.push('semantic interpreter does not reserve before Anthropic execution')
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Paid-operation guards: approved providers only; reserve-before-execute enforced')
