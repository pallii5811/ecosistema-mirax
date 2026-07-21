/**
 * DEPRECATED false holdout — replaced by scripts/eval-commercial-intent-holdout.ts
 * This script always exits 1 to prevent accidental certification.
 */
console.error(
  'test-commercial-intent-paraphrase-suite.ts is retired (false holdout). ' +
    'Use: npx tsx scripts/eval-commercial-intent-holdout.ts --dataset blind',
)
process.exit(1)
