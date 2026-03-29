#!/usr/bin/env node
/**
 * fetch-data.js v2 — STOCKPILE Data Fetcher
 *
 * Uses EIA LEGACY SERIES IDs via /v2/seriesid/ (backward-compat route).
 * These IDs are documented at eia.gov/dnav/pet/ and are stable.
 *
 * UNIT TRUTH:
 *   Stocks           → Thousand Barrels (absolute inventory level)
 *   Product Supplied → Thousand Barrels PER DAY (already a daily rate)
 *   Crude DoS        = Stocks ÷ 4-week avg Refinery Net Input (kb/d)
 *   Product DoS      = Stocks ÷ Product Supplied (kb/d) (NO ÷7)
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
  // Crude days-of-supply: stocks ÷ 4-week average refinery net input.
  { id:'crude_excl_spr', name:'Crude Oil (Excl. SPR)',
    stock:'PET.WCESTUS1.W',   cons:'PET.WCRRIUS2.W', denomMethod:'refinery_net_input_4wk_avg' },
  { id:'crude_incl_spr', name:'Crude Oil (Incl. SPR)',
    stock:'PET.WCRSTUS1.W',   cons:'PET.WCRRIUS2.W', denomMethod:'refinery_net_input_4wk_avg' },
  { id:'gasoline',       name:'Motor Gasoline',
    stock:'PET.WGTSTUS1.W',   cons:'PET.WGFUPUS2.W' },
  { id:'distillate',     name:'Distillate / Diesel',
    stock:'PET.WDISTUS1.W',   cons:'PET.WDIUPUS2.W' },
  { id:'jet_fuel',       name:'Jet Fuel (Kerosene)',
    stock:'PET.WKJSTUS1.W',   cons:'PET.WKJUPUS2.W' },
  { id:'propane',        name:'Propane/Propylene',
    stock:'PET.WPRSTUS1.W',   cons:'PET.WPRUP_NUS_2.W' },
  // Residual via facet endpoints (more reliable than legacy /seriesid route here).
  {
    id:'residual',       name:'Residual Fuel Oil',
    stockPath:'petroleum/stoc/wstk/data/',
    stockFacets:{ product:['EPR0'], process:['SAE'], duoarea:['NUS'] },
    consPath:'petroleum/sum/sndw/data/',
    consFacets:{ product:['EPR0'], process:['FPF'], duoarea:['NUS'] },
  },
];

const PRICE_SERIES = [
  { ticker:'WTI',   name:'WTI Crude',     yahoo:'CL=F', eia:'PET.RWTC.D' },
  { ticker:'BRENT', name:'Brent Crude',   yahoo:'BZ=F', eia:'PET.RBRTE.D' },
  { ticker:'HH',    name:'Henry Hub NG',  yahoo:'NG=F', eia:'NG.RNGWHHD.D' },
  { ticker:'RBOB',  name:'RBOB Gasoline', yahoo:'RB=F', eia:'PET.EER_EPMRU_PF4_RGC_DPG.D' },
  { ticker:'ULSD',  name:'ULSD Diesel',   yahoo:'HO=F', eia:'PET.EER_EPD2DXL0_PF4_RGC_DPG.D' },
  { ticker:'PROPN', name:'Propane',       yahoo:'B0=F', eia:'PET.EER_EPLLPA_PF4_RGC_DPG.D' },
];

// ─── helpers ─────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, {headers:{'Accept':'application/json', ...extraHeaders}}, res => {
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

async function pullByFacets(apiPath, facets, n = 104) {
  const facetParams = Object.entries(facets)
    .map(([k, vals]) => vals.map(v => `facets[${k}][]=${encodeURIComponent(v)}`).join('&'))
    .join('&');
  const url = `https://api.eia.gov/v2/${apiPath}?api_key=${API_KEY}&frequency=weekly&data[]=value&${facetParams}&sort[0][column]=period&sort[0][direction]=desc&length=${n}`;
  const j = await get(url);
  if (!j.response?.data?.length) throw new Error(`Empty: ${apiPath}`);
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

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

async function pullYahooFutures(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d`;
  const j = await get(url, { 'User-Agent': 'Mozilla/5.0' });
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error(`Empty yahoo chart: ${symbol}`);

  const closes = (result?.indicators?.quote?.[0]?.close || [])
    .map(v => Number(v))
    .filter(v => Number.isFinite(v));

  const meta = result.meta || {};
  let price = Number(meta.regularMarketPrice);
  if (!Number.isFinite(price) && closes.length) price = closes[closes.length - 1];
  if (!Number.isFinite(price)) throw new Error(`No price from yahoo: ${symbol}`);

  let prev = Number(meta.previousClose);
  if (!Number.isFinite(prev) || prev <= 0) prev = Number(meta.chartPreviousClose);
  if ((!Number.isFinite(prev) || prev <= 0) && closes.length >= 2) prev = closes[closes.length - 2];

  const change = (Number.isFinite(prev) && prev > 0) ? (price - prev) : 0;
  const pct = (Number.isFinite(prev) && prev > 0) ? ((change / prev) * 100) : 0;

  return { price, change, pct };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function robustBaselineFromSeries(stocks, denominatorByPeriod, baselineDate, currentDays) {
  const baselineStockPoint = nearest(stocks, baselineDate);
  const baselineDenominator = denominatorByPeriod[baselineStockPoint.period];

  const recentDays = stocks.slice(0, 26)
    .map(d => {
      const denom = denominatorByPeriod[d.period];
      if (!denom || denom <= 0) return null;
      return d.value / denom;
    })
    .filter(v => Number.isFinite(v));

  const recentMedian = median(recentDays);

  let baselineDays = (baselineDenominator && baselineDenominator > 0)
    ? baselineStockPoint.value / baselineDenominator
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
      const stocks = s.stockPath
        ? await pullByFacets(s.stockPath, s.stockFacets)
        : await pull(s.stock);
      await sleep(100);
      const cons = s.consPath
        ? await pullByFacets(s.consPath, s.consFacets)
        : await pull(s.cons);
      await sleep(100);

      const curS = stocks[0].value;           // thousand barrels
      const prvS = stocks[1]?.value ?? curS;
      const per  = stocks[0].period;
      if (per > latestPeriod) latestPeriod = per;

      let denominatorByPeriod = Object.fromEntries(cons.map(d => [d.period, d.value]));

      // Crude methodology alignment with EIA days-of-supply: 4-week avg refinery net input.
      if (s.denomMethod === 'refinery_net_input_4wk_avg') {
        const rolling4w = {};
        for (let i = 0; i < cons.length; i++) {
          const win = cons.slice(i, i + 4).map(d => d.value).filter(v => Number.isFinite(v) && v > 0);
          if (win.length > 0) rolling4w[cons[i].period] = win.reduce((a, b) => a + b, 0) / win.length;
        }
        denominatorByPeriod = rolling4w;
      }

      const curC = denominatorByPeriod[stocks[0].period] || cons[0].value;
      const days = curS / curC;

      // 2-year average as proxy for 5-year
      const avgS = stocks.reduce((a,d)=>a+d.value,0) / stocks.length;

      // history (matched by period)
      const hist = stocks.slice(0,52).reverse().map(d => ({
        week: d.period,
        value: Math.round((d.value / (denominatorByPeriod[d.period]||curC)) * 10) / 10,
      }));

      // baseline from actual data, with outlier guard
      const baseline = robustBaselineFromSeries(stocks, denominatorByPeriod, BASELINE, days);

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
    const ng = await pullByFacets('natural-gas/stor/wkly/data/', { process:['SAY'] });
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

  // spot prices (daily)
  const prices = [];
  try {
    console.log('\n→ Fetching spot prices (Yahoo futures primary, EIA fallback)...');
    for (const p of PRICE_SERIES) {
      try {
        // 1) Primary: free near-real-time futures from Yahoo chart endpoint.
        const y = await pullYahooFutures(p.yahoo);
        prices.push({
          ticker: p.ticker,
          name: p.name,
          price: y.price,
          change: round3(y.change),
          pct: Math.round(y.pct * 100) / 100,
          source: 'yahoo-futures',
          symbol: p.yahoo,
          seriesId: p.eia,
        });
        console.log(`  ✓ ${p.ticker}: ${y.price} (${y.change >= 0 ? '+' : ''}${round3(y.change)}) [yahoo]`);
      } catch (yErr) {
        // 2) Fallback: EIA daily spot.
        try {
          const data = await pull(p.eia, 5);
          await sleep(100);
          if (data.length >= 2) {
            const curr = data[0].value;
            const prev = data[1].value;
            const chg = curr - prev;
            prices.push({
              ticker: p.ticker,
              name: p.name,
              price: curr,
              change: round3(chg),
              pct: Math.round((chg / prev) * 10000) / 100,
              source: 'eia-spot-fallback',
              symbol: p.yahoo,
              seriesId: p.eia,
            });
            console.log(`  ✓ ${p.ticker}: ${curr} (${chg >= 0 ? '+' : ''}${round3(chg)}) [eia fallback]`);
          } else if (data.length === 1) {
            prices.push({
              ticker: p.ticker,
              name: p.name,
              price: data[0].value,
              change: 0,
              pct: 0,
              source: 'eia-spot-fallback',
              symbol: p.yahoo,
              seriesId: p.eia,
            });
            console.log(`  ✓ ${p.ticker}: ${data[0].value} (single point) [eia fallback]`);
          }
        } catch (eErr) {
          console.warn(`  ⚠ ${p.ticker}: yahoo=${yErr.message} | eia=${eErr.message}`);
        }
      }
    }
  } catch (e) {
    console.warn(`⚠ price fetch step failed: ${e.message}`);
  }

  // write
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true});
  const out = {
    timestamp: latestPeriod, fetchedAt: new Date().toISOString(),
    baselineDate: BASELINE, commodities: results, histories,
    prices: prices.length > 0 ? prices : undefined,
    meta: {
      source:'EIA API v2 via /v2/seriesid/',
      formula:'Crude: Stocks(kb) ÷ 4-week avg RefineryNetInput(kb/d); Products: Stocks(kb) ÷ ProductSupplied(kb/d)',
      seriesIds: Object.fromEntries(SERIES.map(s => [s.id, {
        stock: s.stock || null,
        cons: s.cons || null,
        stockPath: s.stockPath || null,
        consPath: s.consPath || null,
      }])),
    },
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${Object.keys(results).length} commodities → ${OUTPUT}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
