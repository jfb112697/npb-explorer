import assert from 'node:assert/strict'
import test from 'node:test'
import { decisionBin, gradeDecisions, newDecisionModel, observeDecision, priceDecisions } from './seager.mjs'
import { batValues, buildLeague, seagerValue, STAT } from '../src/lib/stats.ts'

test('uses the two distinct denominators in Orr’s formula', () => {
  const counts = gradeDecisions(new Map([[0, [30, 10]], [1, [20, 40]]]), [0.1, -0.1])
  assert.deepEqual(counts, { sgTake: 50, sgHitTake: 10, sgGoodTake: 40, sgGoodSwing: 30, sgN: 100 })
  assert.equal(seagerValue(counts), 40 / 70 - 10 / 50)
  assert.equal(seagerValue(gradeDecisions(new Map([[0, [30, 0]], [1, [0, 40]]]), [1, -1])), 40 / 70)
  assert.equal(seagerValue(gradeDecisions(new Map([[0, [0, 10]], [1, [20, 0]]]), [1, -1])), null)
})

test('missing data, unsupported cells and undefined rates are unavailable', () => {
  assert.equal(seagerValue({}), null)
  assert.equal(seagerValue({ sgN: 5, sgGoodSwing: 5 }), null)
  const counts = gradeDecisions(new Map([[0, [5, 5]], [1, [5, 5]], [2, [5, 5]]]), [null, 0, NaN])
  assert.equal(counts.sgN, 0)
  assert.equal(seagerValue(counts), null)
  assert.equal(priceDecisions(newDecisionModel(), Array(12).fill(0), 0.25, 0.55)[0], null)
})

test('zero and negative values are retained', () => {
  assert.equal(seagerValue({ sgN: 4, sgTake: 2, sgHitTake: 1, sgGoodTake: 1, sgGoodSwing: 1 }), 0)
  assert.equal(seagerValue({ sgN: 5, sgTake: 4, sgHitTake: 3, sgGoodTake: 1, sgGoodSwing: 1 }), -0.25)
})

test('location and count validation preserves zero coordinates and separates counts', () => {
  assert.equal(decisionBin('0', '0', '0', '0'), 0)
  assert.equal(decisionBin(200, 250, 3, 2), 1199)
  assert.equal(decisionBin(100, 125, 0, 2) - decisionBin(100, 125, 0, 0), 200)
  for (const invalid of ['', ' ', 'None', undefined, NaN, -1, 201]) assert.equal(decisionBin(invalid, 100, 0, 0), null)
  assert.equal(decisionBin(100, 100, '', 0), null)
  assert.equal(decisionBin(100, 100, 1.5, 0), null)
})

test('two-strike protection and a three-ball walk change the optimal action', () => {
  const model = newDecisionModel(), player = new Map()
  const values = Array(12).fill(0)
  // Equal swing outcomes at each count, worth -0.15 runs before count value.
  // All takes are called strikes. Only a two-strike take ends the PA.
  for (const strikes of [0, 2]) {
    const bin = decisionBin(100, 125, 0, strikes)
    for (let i = 0; i < 20; i++) {
      observeDecision(model, player, bin, true, false, -1, 0.1)
      observeDecision(model, player, bin, false, true, -1, 0)
    }
  }
  // On three balls, taking a sure ball is worth a walk, even with positive swing RV.
  const walkBin = decisionBin(100, 125, 3, 0)
  for (let i = 0; i < 20; i++) {
    observeDecision(model, player, walkBin, true, false, -1, 0.4)
    observeDecision(model, player, walkBin, false, false, -1, 0)
  }
  values[2] = 0.1
  const deltas = priceDecisions(model, values, 0.25, 0.55)
  assert.ok(deltas[decisionBin(100, 125, 0, 0)] < 0)
  assert.ok(deltas[decisionBin(100, 125, 0, 2)] > 0)
  assert.ok(deltas[walkBin] < 0)
})

test('called-strike probability changes take value at the same count', () => {
  const model = newDecisionModel(), player = new Map(), values = Array(12).fill(0)
  const ballBin = decisionBin(20, 25, 0, 2), strikeBin = decisionBin(180, 225, 0, 2)
  for (let i = 0; i < 100; i++) for (const [bin, called] of [[ballBin, false], [strikeBin, true]]) {
    observeDecision(model, player, bin, true, false, -1, 0.1)
    observeDecision(model, player, bin, false, called, -1, 0)
  }
  const deltas = priceDecisions(model, values, 0.25, 0.55)
  assert.ok(deltas[ballBin] < 0)
  assert.ok(deltas[strikeBin] > 0)
})

test('SEAGER flows through batting values and the existing top-left Hitting group', () => {
  const b = { g: 1, pa: 4, ab: 4, sgN: 10, sgTake: 5, sgHitTake: 1, sgGoodTake: 4, sgGoodSwing: 3 }
  const file = { season: 2026, games: { 1: 1 }, players: [{ id: 1, t: 1, pos: 'SS', b }] }
  const league = buildLeague(file, () => 'CL')
  assert.equal(batValues(b, league, 'CL').seager, 4 / 7 - 1 / 5)
  assert.equal(batValues({ pa: 4, ab: 4 }, league, 'CL').seager, null)
  assert.equal(STAT['bat.seager'].group, 'Advanced')
  assert.equal(STAT['bat.seager'].rail, true)
  assert.equal(STAT['bat.seager'].better, 'high')
})
