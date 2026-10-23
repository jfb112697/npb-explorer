// NPB adaptation of Robert Orr's SEAGER (Baseball Prospectus, Nov. 8, 2023).
// Learn swing value and called-strike probability by count and location within
// each season. All hitters are graded against the same season-wide model.
const CELLS = 100
const BINS = 12 * CELLS
const PRIOR = 20
const MIN_LOCAL = 10

export function decisionBin(x, y, balls, strikes) {
  const values = [x, y, balls, strikes]
  if (values.some((v) => v == null || String(v).trim() === '' || !Number.isFinite(Number(v)))) return null
  const [px, py, b, s] = values.map(Number)
  if (px < 0 || px > 200 || py < 0 || py > 250 || !Number.isInteger(b) || !Number.isInteger(s) || b < 0 || b > 3 || s < 0 || s > 2) return null
  const cell = Math.min(9, Math.floor(px / 20)) + 10 * Math.min(9, Math.floor(py / 25))
  return (b * 3 + s) * CELLS + cell
}

export function newDecisionModel() {
  return {
    swings: new Uint32Array(BINS), takes: new Uint32Array(BINS), called: new Uint32Array(BINS),
    net: new Int32Array(BINS * 12), term: new Float64Array(BINS), endings: new Uint32Array(BINS),
  }
}

export function observeDecision(model, player, bin, swing, called, to, runs) {
  const from = Math.floor(bin / CELLS)
  const counts = player.get(bin) ?? [0, 0] // swings, takes
  counts[swing ? 0 : 1]++
  player.set(bin, counts)
  if (swing) {
    model.swings[bin]++
    model.net[bin * 12 + from]--
    if (to < 0) { model.term[bin] += runs; model.endings[bin]++ }
    else model.net[bin * 12 + to]++
  } else {
    model.takes[bin]++
    if (called) model.called[bin]++
  }
}

export function priceDecisions(model, countValues, mean, walkRuns) {
  const swingRuns = new Float64Array(BINS)
  const totals = Array.from({ length: 12 }, () => ({ sw: 0, rv: 0, tk: 0, cs: 0 }))
  for (let bin = 0; bin < BINS; bin++) {
    let rv = model.term[bin] - mean * model.endings[bin]
    for (let c = 0; c < 12; c++) rv += model.net[bin * 12 + c] * countValues[c]
    swingRuns[bin] = rv
    const t = totals[Math.floor(bin / CELLS)]
    t.sw += model.swings[bin]; t.rv += rv; t.tk += model.takes[bin]; t.cs += model.called[bin]
  }
  return Array.from({ length: BINS }, (_, bin) => {
    const count = Math.floor(bin / CELLS), cell = bin % CELLS
    const t = totals[count]
    if (!t.sw || !t.tk) return null
    let sw = 0, rv = 0, tk = 0, cs = 0, localSw = 0, localTk = 0
    // Smooth adjacent grid cells, with more weight on the pitch's own location.
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = cell % 10 + dx, y = Math.floor(cell / 10) + dy
      if (x < 0 || x > 9 || y < 0 || y > 9) continue
      const k = count * CELLS + y * 10 + x
      const weight = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1)
      sw += weight * model.swings[k]; rv += weight * swingRuns[k]
      tk += weight * model.takes[k]; cs += weight * model.called[k]
      localSw += model.swings[k]; localTk += model.takes[k]
    }
    // Do not invent a location's swing value when neither action has support.
    if (localSw < MIN_LOCAL || localTk < MIN_LOCAL) return null
    const swingValue = (rv + PRIOR * t.rv / t.sw) / (sw + PRIOR)
    const strikeProbability = (cs + PRIOR * t.cs / t.tk) / (tk + PRIOR)
    const balls = Math.floor(count / 3), strikes = count % 3
    const ballValue = (balls === 3 ? walkRuns - mean : countValues[count + 3]) - countValues[count]
    const strikeValue = (strikes === 2 ? -mean : countValues[count + 1]) - countValues[count]
    const takeValue = strikeProbability * strikeValue + (1 - strikeProbability) * ballValue
    return swingValue - takeValue
  })
}

export function gradeDecisions(player, deltas) {
  const result = { sgTake: 0, sgHitTake: 0, sgGoodTake: 0, sgGoodSwing: 0, sgN: 0 }
  for (const [bin, [swings, takes]] of player) {
    const delta = deltas[bin]
    if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 1e-12) continue
    result.sgN += swings + takes
    result.sgTake += takes
    if (delta > 0) { result.sgHitTake += takes; result.sgGoodSwing += swings }
    else result.sgGoodTake += takes
  }
  return result
}
