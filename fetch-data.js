#!/usr/bin/env node
/**
 * fetch-data.js — EIA API v2 Data Fetcher for STOCKPILE Dashboard
 *
 * Fetches weekly petroleum stocks, product supplied (consumption),
 * natural gas storage, and spot prices from the EIA API.
 * Computes days-of-supply and writes data/latest.json.
 *
 * Usage:
 *   EIA_API_KEY=your_key node fetch-data.js
 *
 * Designed to run in GitHub Actions on a cron schedule.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = process.env.EIA_API_KEY;
if (!API_KEY) {
  console.error('ERROR: EIA_API_KEY environment variable is required');
  console.error('Get a free key at: https://www.eia.gov/opendata/register.php');
  process.exit(1);
}

const EIA_BASE = 'https://api.eia.gov/v2';
const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'latest.json');
const BASELINE_DATE = '2026-02-27';

// ─── Commodity Definitions ───────────────────────────────────
const COMMODITIES = [
  {
    id: 'crude_excl_spr',
    name: 'Crude Oil (Excl. SPR)',
    stockPath: 'petroleum/stoc/wstk/data/',
    stockFacets: { product: ['EPC0'], process: ['SAE'], duoarea: ['NUS'] },
    consumptionPath: 'petroleum/sum/sndw/data/',
    consumptionFacets: { product: ['EPC0'], process: ['FPF'], duoarea: ['NUS'] },
    unit: 'thousand barrels',
    divisor: 1000, // display in millions
    fallbackDailyUse: 20100,
  },
  {
    id: 'crude_incl_spr',
    name: 'Crude Oil (Incl. SPR)',
    stockPath: 'petroleum/stoc/wstk/data/',
    stockFacets: { product: ['EPC0'], process: ['SAX'], duoarea: ['NUS'] },
    consumptionPath: 'petroleum/sum/sndw/data/',
    consumptionFacets: { product: ['EPC0'], process: ['FPF'], duoarea: ['NUS'] },
    unit: 'thousand barrels',
    divisor: 1000,
    fallbackDailyUse: 20100,
  },
  {
    id: 'gasoline',
    name: 'Motor Gasoline',
    stockPath: 'petroleum/stoc/wstk/data/',
    stockFacets: { product: ['EPM0'], process: ['SAE'], duoarea: ['NUS'] },
    consumptionPath: 'petroleum/sum/sndw/data/',
    consumptionFacets: { product: ['EPM0'], process: ['FPF'], duoarea: ['NUS'] },
    unit: 'thousand barrels',
    divisor: 1000,
    fallbackDailyUse: 8940,
  },
  {
    id: 'distillate',
    name: 'Distillate Fuel Oil',
    stockPath: 'petroleum/stoc/wstk/data/',
    stockFacets: { product: ['EPD0'], process: ['SAE'], duoarea: ['NUS'] },
    consumptionPath: 'petroleum/sum/sndw/data/',
    consumptionFacets: { product: ['EPD0'], process: ['FPF'], duoarea: ['NUS'] },
    unit: 'thousand barrels',
    divisor: 1000,
    fallbackDailyUse: 3860,
  },
  {
    id: 'jet_fuel',
    name: 'Jet Fuel (Kerosene-Type)',
    stockPath: 'petroleum/stoc/wstk/data/',
    stockFacets: { product: ['EPJK'], process: ['SAE'], duoarea: ['NUS'] },
    consumptionPath: 'petroleum/sum/sndw/data/',
    consumptionFacets: { product: ['EPJK'], process: ['FPF'], duoarea: ['NUS'] },
    unit: 'thousand barrels',
    divisor: 1000,
    fallbackDailyUse: 1710,
  },
  {
    id: 'propane',
    name: 'Propane/Propylene',
    stockPath: 'petroleum/stoc/wstk/data/',
    stockFacets: { product: ['EPLLPZ'], process: ['SAE'], duoarea: ['NUS'] },
    consumptionPath: 'petroleum/sum/sndw/data/',
    consumptionFacets: { product: ['EPLLPZ'], process: ['FPF'], duoarea: ['NUS'] },
    unit: 'thousand barrels',
    divisor: 1000,
    fallbackDailyUse: 1120,
  },
  {
    id: 'residual',
    name: 'Residual Fuel Oil',
    stockPath: 'petroleum/stoc/wstk/data/',
    stockFacets: { product: ['EPR0'], process: ['SAE'], duoarea: ['NUS'] },
    consumptionPath: 'petroleum/sum/sndw/data/',
    consumptionFacets: { product: ['EPR0'], process: ['FPF'], duoarea: ['NUS'] },
    unit: 'thousand barrels',
    divisor: 1000,
    fallbackDailyUse: 280,
  },
];

// ─── HTTP Helper ─────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}\nURL: ${url}\nBody: ${data.slice(0, 500)}`));
        }
      });
    }).on('error', reject);
  });
}

function buildURL(apiPath, facets, extraParams = {}) {
  let url = `${EIA_BASE}/${apiPath}?api_key=${API_KEY}&frequency=weekly&data[]=value`;

  // Add facets
  for (const [key, values] of Object.entries(facets)) {
    for (const val of values) {
      url += `&facets[${key}][]=${encodeURIComponent(val)}`;
    }
  }

  // Sort by period descending, get 60 weeks
  url += '&sort[0][column]=period&sort[0][direction]=desc';
  url += `&length=${extraParams.length || 60}`;

  return url;
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   STOCKPILE Data Fetcher v1.0        ║');
  console.log('║   EIA API v2 → data/latest.json      ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`API Key: ${API_KEY.slice(0, 4)}...${API_KEY.slice(-4)}\n`);

  const results = {};
  const histories = {};
  let latestPeriod = '';

  // ── Fetch each petroleum commodity ──
  for (const commodity of COMMODITIES) {
    console.log(`→ Fetching ${commodity.name}...`);

    try {
      // 1. Fetch stocks
      const stockURL = buildURL(commodity.stockPath, commodity.stockFacets);
      const stockData = await fetchJSON(stockURL);

      if (!stockData.response?.data?.length) {
        console.warn(`  ⚠ No stock data for ${commodity.id}`);
        continue;
      }

      const latest = stockData.response.data[0];
      const stocks = parseFloat(latest.value);
      const period = latest.period;
      if (period > latestPeriod) latestPeriod = period;

      const prevStocks = stockData.response.data.length > 1
        ? parseFloat(stockData.response.data[1].value)
        : stocks;

      // 2. Fetch product supplied (consumption)
      let dailyUse = commodity.fallbackDailyUse;
      try {
        const consURL = buildURL(commodity.consumptionPath, commodity.consumptionFacets, { length: 5 });
        const consData = await fetchJSON(consURL);
        if (consData.response?.data?.length) {
          const weeklySupplied = parseFloat(consData.response.data[0].value);
          if (weeklySupplied > 0) {
            dailyUse = weeklySupplied / 7;
          }
        }
      } catch (e) {
        console.warn(`  ⚠ Using fallback consumption for ${commodity.id}: ${e.message}`);
      }

      const daysOfSupply = stocks / dailyUse;

      // 3. Compute 5-year average (from the 52 weeks of data, approximate)
      const allStocks = stockData.response.data.map(d => parseFloat(d.value)).filter(v => !isNaN(v));
      const recentAvg = allStocks.length > 0
        ? allStocks.reduce((a, b) => a + b, 0) / allStocks.length
        : stocks;
      const pctVsFiveYr = ((stocks - recentAvg) / recentAvg) * 100;

      // 4. Build history for sparklines (days of supply over time)
      const history = stockData.response.data
        .slice(0, 52)
        .reverse()
        .map(d => ({
          week: d.period,
          value: Math.round((parseFloat(d.value) / dailyUse) * 10) / 10,
        }));

      results[commodity.id] = {
        stocks,
        dailyConsumption: Math.round(dailyUse),
        daysOfSupply: Math.round(daysOfSupply * 10) / 10,
        prevWeekStocks: prevStocks,
        fiveYrAvg: Math.round(recentAvg),
        pctVsFiveYr: Math.round(pctVsFiveYr * 10) / 10,
        // Baseline approximations (use first data point near baseline date)
        baselineStocks: stocks * 0.98, // placeholder — should find data from baseline week
        baselineDays: daysOfSupply * 1.02,
        period,
      };

      histories[commodity.id] = history;

      console.log(`  ✓ ${commodity.id}: ${daysOfSupply.toFixed(1)} days (${stocks.toLocaleString()} bbl)`);

      // Rate limit: 100ms between calls
      await new Promise(r => setTimeout(r, 150));

    } catch (e) {
      console.error(`  ✗ Failed ${commodity.id}: ${e.message}`);
    }
  }

  // ── Fetch Natural Gas Storage ──
  console.log('\n→ Fetching Natural Gas Storage...');
  try {
    const ngURL = `${EIA_BASE}/natural-gas/stor/wkly/data/?api_key=${API_KEY}&frequency=weekly&data[]=value&facets[process][]=SAY&sort[0][column]=period&sort[0][direction]=desc&length=60`;
    const ngData = await fetchJSON(ngURL);

    if (ngData.response?.data?.length) {
      const latest = parseFloat(ngData.response.data[0].value);
      const prev = ngData.response.data.length > 1 ? parseFloat(ngData.response.data[1].value) : latest;
      const dailyUse = 78.5; // Bcf/day approximate US winter consumption
      const allVals = ngData.response.data.map(d => parseFloat(d.value)).filter(v => !isNaN(v));
      const avg = allVals.reduce((a, b) => a + b, 0) / allVals.length;

      results.natgas = {
        stocks: latest,
        dailyConsumption: dailyUse,
        daysOfSupply: Math.round((latest / dailyUse) * 10) / 10,
        prevWeekStocks: prev,
        fiveYrAvg: Math.round(avg),
        pctVsFiveYr: Math.round(((latest - avg) / avg) * 100 * 10) / 10,
        baselineStocks: 2050,
        baselineDays: 26.1,
        period: ngData.response.data[0].period,
      };

      histories.natgas = ngData.response.data
        .slice(0, 52)
        .reverse()
        .map(d => ({
          week: d.period,
          value: Math.round((parseFloat(d.value) / dailyUse) * 10) / 10,
        }));

      console.log(`  ✓ natgas: ${results.natgas.daysOfSupply} days (${latest} Bcf)`);
    }
  } catch (e) {
    console.error(`  ✗ Failed natgas: ${e.message}`);
  }

  // ── Fetch Spot Prices ──
  console.log('\n→ Fetching Spot Prices...');
  const priceResults = [];
  const priceSeries = [
    { ticker: 'WTI', name: 'WTI Crude', series: 'RWTC' },
    { ticker: 'BRENT', name: 'Brent Crude', series: 'RBRTE' },
    { ticker: 'HH', name: 'Henry Hub NG', series: '' }, // different API path
  ];

  try {
    const priceURL = `${EIA_BASE}/petroleum/pri/spt/data/?api_key=${API_KEY}&frequency=daily&data[]=value&sort[0][column]=period&sort[0][direction]=desc&length=20`;
    const priceData = await fetchJSON(priceURL);

    if (priceData.response?.data) {
      // Group by series and get latest for each
      const byProduct = {};
      priceData.response.data.forEach(d => {
        const key = d.product || d.series || 'unknown';
        if (!byProduct[key]) byProduct[key] = [];
        byProduct[key].push(d);
      });

      // Map to our price tickers
      Object.entries(byProduct).forEach(([key, entries]) => {
        if (entries.length >= 2) {
          const curr = parseFloat(entries[0].value);
          const prev = parseFloat(entries[1].value);
          const change = curr - prev;
          priceResults.push({
            ticker: key.slice(0, 6),
            name: entries[0]['product-name'] || key,
            price: curr,
            change: Math.round(change * 100) / 100,
            pct: Math.round((change / prev) * 10000) / 100,
          });
        }
      });
    }
  } catch (e) {
    console.warn(`  ⚠ Prices fallback: ${e.message}`);
  }

  // ── Write Output ──
  console.log('\n→ Writing data/latest.json...');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const output = {
    timestamp: latestPeriod || new Date().toISOString().slice(0, 10),
    fetchedAt: new Date().toISOString(),
    baselineDate: BASELINE_DATE,
    commodities: results,
    histories: histories,
    prices: priceResults.length > 0 ? priceResults : undefined,
    meta: {
      source: 'U.S. Energy Information Administration (EIA) API v2',
      url: 'https://api.eia.gov/v2/',
      methodology: 'Days of Supply = Ending Stocks / (Weekly Product Supplied / 7)',
      coverage: 'U.S. national (all PAD Districts)',
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  const stats = Object.keys(results).length;
  console.log(`\n✓ Done! Wrote ${stats} commodities to ${OUTPUT_FILE}`);
  console.log(`  Latest period: ${latestPeriod}`);
  console.log(`  File size: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
