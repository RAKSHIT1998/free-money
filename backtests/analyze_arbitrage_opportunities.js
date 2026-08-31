// Run this manually: node analyze_arbitrage_opportunities.js
//
// Reads cross_exchange_opportunities.json (written by crossExchangeArbitrageAgent.js
// every time a real candidate spread clears the threshold) and summarizes it
// honestly: how often real opportunities actually occur, how long they last, and
// how big they are. Built specifically to answer whether transfer-based execution
// (10-60+ min for a Binance withdrawal to land) could ever realistically catch one —
// see crossExchangeTransferArbitrageAgent.js's header and the 2026-08-31 finding
// (a real ~16s-long ZEC/PUMP opportunity) that prompted this.
//
// "Event" here means: consecutive log records for the SAME asset, each within
// EVENT_GAP_MS of the previous one, are one continuous real-world opportunity (the
// scanner logs it again every ~2s scan cycle while it's still crossed) — not
// EVENT_GAP_MS+1 unrelated re-detections.
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'cross_exchange_opportunities.json');
const EVENT_GAP_MS = 10000; // records for the same asset >10s apart are separate events

function loadOpportunities() {
  if (!fs.existsSync(LOG_PATH)) {
    console.log(`No opportunity log yet at ${LOG_PATH} — nothing has cleared the threshold since logging started.`);
    process.exit(0);
  }
  const parsed = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));
  return Array.isArray(parsed.opportunities) ? parsed.opportunities : [];
}

function groupIntoEvents(records) {
  const byAsset = {};
  for (const r of records) {
    (byAsset[r.asset] = byAsset[r.asset] || []).push(r);
  }

  const events = [];
  for (const [asset, recs] of Object.entries(byAsset)) {
    recs.sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
    let current = null;
    for (const r of recs) {
      const t = new Date(r.observedAt).getTime();
      if (current && t - current.lastTime <= EVENT_GAP_MS) {
        current.records.push(r);
        current.lastTime = t;
      } else {
        if (current) events.push(current);
        current = { asset, records: [r], firstTime: t, lastTime: t };
      }
    }
    if (current) events.push(current);
  }
  events.sort((a, b) => a.firstTime - b.firstTime);
  return events;
}

function main() {
  const records = loadOpportunities();
  if (records.length === 0) {
    console.log('Opportunity log exists but is empty.');
    return;
  }

  const events = groupIntoEvents(records);
  const sortedByTime = [...records].sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
  const firstSeen = new Date(sortedByTime[0].observedAt);
  const lastSeen = new Date(sortedByTime[sortedByTime.length - 1].observedAt);
  const spanHours = (lastSeen - firstSeen) / 3600000;

  console.log(`=== Cross-exchange arbitrage opportunity log ===`);
  console.log(`Log spans: ${firstSeen.toISOString()} -> ${lastSeen.toISOString()} (${spanHours.toFixed(1)}h)`);
  console.log(`Raw records: ${records.length}  |  Distinct events: ${events.length}`);
  console.log(`Rate: ${(events.length / Math.max(spanHours, 0.01)).toFixed(3)} events/hour  (~${(events.length / Math.max(spanHours, 0.01) * 24).toFixed(2)}/day)`);
  console.log();

  console.log('=== Per-event detail ===');
  for (const e of events) {
    const durationS = (e.lastTime - e.firstTime) / 1000;
    const spreads = e.records.map(r => r.netSpreadPct * 100);
    const maxSpread = Math.max(...spreads);
    const assetsInEvent = new Set(e.records.map(r => `${r.buyExchange}->${r.sellExchange}`));
    console.log(
      `${new Date(e.firstTime).toISOString()}  ${e.asset.padEnd(8)} ` +
      `duration=${durationS.toFixed(0)}s  ticks=${e.records.length}  ` +
      `maxNetSpread=${maxSpread.toFixed(3)}%  route(s)=${[...assetsInEvent].join(',')}`
    );
  }
  console.log();

  const durations = events.map(e => (e.lastTime - e.firstTime) / 1000);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const maxDuration = Math.max(...durations);

  console.log('=== Summary ===');
  console.log(`Average event duration: ${avgDuration.toFixed(1)}s`);
  console.log(`Longest event duration: ${maxDuration.toFixed(1)}s`);
  console.log(`Shortest event duration: ${Math.min(...durations).toFixed(1)}s`);

  const KNOWN_MIN_WITHDRAWAL_MINUTES = 10;
  const survivable = durations.filter(d => d >= KNOWN_MIN_WITHDRAWAL_MINUTES * 60).length;
  console.log(
    `\nEvents that lasted >= ${KNOWN_MIN_WITHDRAWAL_MINUTES} minutes (the fastest realistic Binance ` +
    `withdrawal): ${survivable} / ${events.length}` +
    (survivable === 0 ? ' — none. Transfer-based execution could not have captured any of these.' : '')
  );
}

main();
