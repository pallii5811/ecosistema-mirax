/**
 * Blocco 4 — unit tests: pipeline stages + outreach mapping
 */
import assert from 'node:assert/strict'
import {
  mergePipelineStage,
  outreachStatusToPipelineStage,
  sanitizePipelineStage,
  nextPipelineStage,
} from '../src/lib/pipeline-stages.ts'

assert.equal(sanitizePipelineStage('invalid'), 'nuovo')
assert.equal(outreachStatusToPipelineStage('sent', 'nuovo'), 'contattato')
assert.equal(outreachStatusToPipelineStage('sent', 'contattato'), null)
assert.equal(outreachStatusToPipelineStage('interested', 'contattato'), 'meeting')
assert.equal(outreachStatusToPipelineStage('not_interested', 'proposta'), 'perso')

assert.equal(mergePipelineStage('nuovo', 'contattato'), 'contattato')
assert.equal(mergePipelineStage('meeting', 'contattato'), 'meeting')
assert.equal(mergePipelineStage('proposta', 'perso'), 'perso')

assert.equal(nextPipelineStage('nuovo'), 'contattato')
assert.equal(nextPipelineStage('vinto'), null)

console.log('[test-block4-pipeline-stages] OK')
