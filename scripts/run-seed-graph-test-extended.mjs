import { seedExtendedGraphTest } from './seed-graph-test-extended.mjs'

const ids = await seedExtendedGraphTest()
console.log('seeded extended test graph', Object.keys(ids).length, 'entities')
