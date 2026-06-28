/**
 * Test Registro Opposizioni mock (Fase 1-B)
 * Run: node scripts/test-compliance-opposizioni.mjs
 */

import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

async function main() {
  process.chdir(root)
  process.env.REGISTRO_OPPOSIZIONI_MODE = 'mock'

  const { checkRegistroOpposizioni, checkOutreachCompliance } = await import(
    '../src/lib/compliance/registro-opposizioni.ts'
  )

  let passed = 0
  let failed = 0

  const blockedPhone = await checkRegistroOpposizioni({ channel: 'phone', target: '3399999999' })
  if (blockedPhone.status === 'blocked') {
    console.log('✓ Telefono test bloccato correttamente')
    passed += 1
  } else {
    console.error('✗ Telefono test doveva essere blocked, got', blockedPhone.status)
    failed += 1
  }

  const clearPhone = await checkRegistroOpposizioni({ channel: 'whatsapp', target: '3471234567' })
  if (clearPhone.status === 'clear') {
    console.log('✓ Telefono business clear')
    passed += 1
  } else {
    console.error('✗ Telefono business expected clear, got', clearPhone.status)
    failed += 1
  }

  const blockedEmail = await checkOutreachCompliance({
    channel: 'email',
    email: 'blocked-test@mirax.local',
  })
  if (blockedEmail?.status === 'blocked') {
    console.log('✓ Email test bloccata')
    passed += 1
  } else {
    console.error('✗ Email test expected blocked')
    failed += 1
  }

  const clearEmail = await checkOutreachCompliance({
    channel: 'email',
    email: 'info@azienda-valida.it',
  })
  if (clearEmail?.status === 'clear') {
    console.log('✓ Email B2B clear')
    passed += 1
  } else {
    console.error('✗ Email B2B expected clear')
    failed += 1
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
