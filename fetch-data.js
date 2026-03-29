#!/usr/bin/env node
/**
 * fetch-data.js v2 — STOCKPILE Data Fetcher
 *
 * Uses EIA LEGACY SERIES IDs via /v2/seriesid/ (backward-compat route).
 * These IDs are documented at eia.gov/dnav/pet/ and are stable.
 *
 * UNIT TRUTH:
 *   Stocks          → Thousand Barrels (absolute inventory level)
 *   Product Supplied → Thousand Barrels PER DAY (already a daily rate!)
 *   Days of Supply   = Stocks ÷ Product_Supplied   (NO ÷7 !!!)
 *
 * Usage: EIA_API_KEY=xxxxx node fetch-data.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = process.env.EIA_API_KEY;
if (!API_KEY) {
  console.error('ERROR: Set EIA_API_KEY env var. Free key: https://www.eia.gov/opendata/register.php');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT   = path.join(DATA_DIR, 'latest.json');
const BASELINE = '2026-02-27';

/*
 * Verified series IDs from:
 *   Stocks:   https://www.eia.gov/dnav/pet/pet_stoc_wstk_dcu_nus_w.htm
 *   Supplied: https://www.eia.gov/dnav/pet/pet_sum_sndw_dcus_nus_w.htm
 */
const SERIES = [
  { id:'crude_excl_spr', name:'Crude Oil (Excl. SPR)',
    stock:'PET.WCESTUS1.W',   cons:'PET.WCRFPUS2.W' },
  { id:'crude_incl_spr', name:'Crude Oil (Incl. SPR)',
    stock:'PET.WCRSTUS1.W',   cons:'PET.WCRFPUS2.W' },
  { id:'gasoline',       name:'Motor Gasoline',
    stock:'PET.WGTSTUS1.W',   cons:'PET.WGFUPUS2.W' },
  { id:'distillate',     name:'Distillate / Diesel',
    stock:'PET.WDISTUS1.W',   cons:'PET.WDIUPUS2.W' },
  { id:'jet_fuel',       name:'Jet Fuel (Kerosene)',
    stock:'PET.WKJSTUS1.W',   cons:'PET.WKJUPUS2.W' },
  { id:'propane',        name:'Propane/Propylene',
    stock:'PET.WPRSTUS1.W',   cons:'PET.WPRUP_NUS_2.W' },
  { id:'residual',       name:'Residual Fuel Oil',
    stock:'PET.WRESTUS1.W',   cons:'PET.WREUPUS2.W' },
];

// ─── helpers ─────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {headers:{'Accept':'application/json'}}, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); }});
    }).on('error', reject);
  });
}

async function pull(seriesId, n = 104) {
  const url = `https://api.eia.gov/v2/seriesid/${seriesId}?api_key=${API_KEY}&length=${n}&sort[0][column]=period&sort[0][direction]=desc`;
  const j = await get(url);
  if (!j.response?.data?.length) throw new Error(`Empty: ${seriesId}`);
  return j.response.data
    .map(d => ({ period: d.period, value: parseFloat(d.value) }))
    .filter(d => !isNaN(d.value));
}

function nearest(arr, date) {
  const t = new Date(date).getTime();
  return arr.reduce((best, d) =>
    Math.abs(new Date(d.period).getTime() - t) <
    Math.abs(new Date(best.period).getTime() - t) ? d : best
  );
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function robustBaselineFromSeries(stocks, cons, baselineDate, currentDays) {
  const cMap = Object.fromEntries(cons.map(d => [d.period, d.value]));
  const baselineStockPoint = nearest(stocks, baselineDate);
  const baselineCons = cMap[baselineStockPoint.period];

  const recentDays = stocks.slice(0, 26)
    .map(d => {
      const c = cMap[d.period];
      if (!c || c <= 0) return null;
      return d.value / c;
    })
    .filter(v => Number.isFinite(v));

  const recentMedian = median(recentDays);

  let baselineDays = (baselineCons && baselineCons > 0)
    ? baselineStockPoint.value / baselineCons
    : (recentMedian || currentDays);

  // Guard against outlier baseline points caused by tiny denominator glitches.
  if (recentMedian && (baselineDays > recentMedian * 4 || baselineDays < recentMedian * 0.25)) {
    baselineDays = recentMedian;
  }

  return {
    baselineStocks: baselineStockPoint.value,
    baselinePeriod: baselineStockPoint.period,
    baselineDays,
  };
}

// ─── main ────────────────────────────────────────────────────
async function main() {
  console.log('STOCKPILE fetcher v2 — legacy series IDs, correct units');
  console.log(`${new Date().toISOString()}  baseline=${BASELINE}\n`);

  const results = {}, histories = {};
  let latestPeriod = '';

  for (const s of SERIES) {
    try {
      const stocks = await pull(s.stock); await sleep(100);
      const cons   = await pull(s.cons);  await sleep(100);

      const curS = stocks[0].value;           // thousand barrels
      const prvS = stocks[1]?.value ?? curS;
      const curC = cons[0].value;             // thousand barrels PER DAY
      const per  = stocks[0].period;
      if (per > latestPeriod) latestPeriod = per;

      // *** THE FIX: no ÷7 — product supplied is already kb/d ***
      const days = curS / curC;

      // 2-year average as proxy for 5-year
      const avgS = stocks.reduce((a,d)=>a+d.value,0) / stocks.length;

      // history (matched by period)
      const cMap = Object.fromEntries(cons.map(d=>[d.period, d.value]));
      const hist = stocks.slice(0,52).reverse().map(d => ({
        week: d.period,
        value: Math.round((d.value / (cMap[d.period]||curC)) * 10) / 10,
      }));

      // baseline from actual data, with outlier guard
      const baseline = robustBaselineFromSeries(stocks, cons, BASELINE, days);

      results[s.id] = {
        stocks: curS,
        dailyConsumption: Math.round(curC),
        daysOfSupply: Math.round(days*10)/10,
        prevWeekStocks: prvS,
        fiveYrAvg: Math.round(avgS),
        pctVsFiveYr: Math.round(((curS-avgS)/avgS)*1000)/10,
        baselineStocks: baseline.baselineStocks,
        baselineDays: Math.round(baseline.baselineDays*10)/10,
        baselinePeriod: baseline.baselinePeriod,
        period: per,
      };
      histories[s.id] = hist;

      console.log(`✓ ${s.id.padEnd(18)} ${days.toFixed(1).padStart(5)}d  stk=${curS.toLocaleString()} kb  cons=${curC.toLocaleString()} kb/d  base=${baseline.baselineDays.toFixed(1)}d`);
    } catch(e) {
      console.error(`✗ ${s.id}: ${e.message}`);
    }
  }

  // natural gas
  try {
    const ng = await pull('NG.NW2_EPG0_SWO_R48_BCF.W');
    const cur = ng[0].value, prv = ng[1]?.value ?? cur;
    const dailyUse = 78.5; // Bcf/d US avg
    const bPt = nearest(ng, BASELINE);
    const avg = ng.reduce((a,d)=>a+d.value,0)/ng.length;
    results.natgas = {
      stocks: cur, dailyConsumption: dailyUse,
      daysOfSupply: Math.round((cur/dailyUse)*10)/10,
      prevWeekStocks: prv,
      fiveYrAvg: Math.round(avg),
      pctVsFiveYr: Math.round(((cur-avg)/avg)*1000)/10,
      baselineStocks: bPt.value,
      baselineDays: Math.round((bPt.value/dailyUse)*10)/10,
      baselinePeriod: bPt.period,
      period: ng[0].period,
    };
    histories.natgas = ng.slice(0,52).reverse().map(d=>({
      week:d.period, value:Math.round((d.value/dailyUse)*10)/10,
    }));
    console.log(`✓ natgas             ${(cur/dailyUse).toFixed(1).padStart(5)}d  ${cur} Bcf`);
  } catch(e) { console.error(`✗ natgas: ${e.message}`); }

  // write
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
  const out = {
    timestamp: latestPeriod, fetchedAt: new Date().toISOString(),
    baselineDate: BASELINE, commodities: results, histories,
    meta: {
      source:'EIA API v2 via /v2/seriesid/',
      formula:'Days = Stocks(kb) ÷ ProductSupplied(kb/d)  — NO divide-by-7',
      seriesIds: Object.fromEntries(SERIES.map(s=>[s.id,{stock:s.stock,cons:s.cons}])),
    },
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${Object.keys(results).length} commodities → ${OUTPUT}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
