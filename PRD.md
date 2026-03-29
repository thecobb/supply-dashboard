# PRD: Global Commodity Supply Stockpile Dashboard

## Extracted Tweet Context

**@DanielleFong** (3/28/26, 2:25 PM):
> "does anybody have a map of the days of remaining stocks for diesel, gasoline, nurdles, urea and other downstream components of crude oil and CNG?
> seems like a really important thing to know for the global macro trade.
> if anyone can suggest great data sources i can add to claudeberg"

**@IdaeanDaktyl** reply references `worldwarwatcher.com/#tab=economic` showing:
- WORLD WAR WATCHER — DAY 29 LIVE
- ECONOMIC IMPACT — BASELINE: 2026-02-27
- SUPPLY CRISIS indicators:
  - GAS.D Gasoline Supply: -5.2%, 26 days, PRE-WAR (Feb 27): 27.1
  - CRD.D Crude Supply (incl SPR): +1.4%, 44 days, PRE-WAR (Feb 27): 43.0

---

## 1. Product Vision

A real-time, GitHub Pages–deployed dashboard tracking **days of remaining supply** for petroleum products, petrochemical feedstocks, fertilizers, and other critical downstream commodities of crude oil and compressed/liquefied natural gas (CNG/LNG). Designed for macro traders, policy analysts, and supply-chain professionals.

## 2. Target Users

- Global macro traders and hedge fund analysts
- Energy/commodity policy researchers
- Supply chain risk managers
- Journalists covering energy security
- Anyone following the 2026 Iran conflict's economic impact

## 3. Tracked Commodities & Data Sources

### Tier 1: Petroleum Products (EIA API v2 — Gold Standard, Free)
| Commodity | EIA Series | Data Type | Frequency |
|-----------|-----------|-----------|-----------|
| **Crude Oil** (excl. SPR) | `petroleum/stoc/wstk` | Stocks (thousand barrels) | Weekly |
| **Crude Oil** (incl. SPR) | `petroleum/stoc/wstk` | Stocks (thousand barrels) | Weekly |
| **Motor Gasoline** | `petroleum/stoc/wstk` | Stocks (thousand barrels) | Weekly |
| **Distillate Fuel Oil** (diesel/heating) | `petroleum/stoc/wstk` | Stocks (thousand barrels) | Weekly |
| **Jet Fuel** (kerosene-type) | `petroleum/stoc/wstk` | Stocks (thousand barrels) | Weekly |
| **Propane/Propylene** | `petroleum/stoc/wstk` | Stocks (thousand barrels) | Weekly |
| **Residual Fuel Oil** | `petroleum/stoc/wstk` | Stocks (thousand barrels) | Weekly |

For **days of supply**: `petroleum/sum/sndw` — includes product supplied (consumption rate) to calculate `stocks ÷ daily consumption`.

### Tier 2: Natural Gas (EIA API v2 — Free)
| Commodity | EIA Series | Data Type | Frequency |
|-----------|-----------|-----------|-----------|
| **Natural Gas** | `natural-gas/stor/wkly` | Working gas in storage (Bcf) | Weekly |
| **LNG Imports** | `natural-gas/move/impc` | Imports by point of entry | Monthly |

### Tier 3: Petrochemical Feedstocks & Fertilizers (Proxy/Price Data)
| Commodity | Source | Metric | Access |
|-----------|--------|--------|--------|
| **Urea** (fertilizer) | Trading Economics / World Bank | Price (USD/T) as supply proxy | Free price data |
| **Ammonia** | World Bank Commodity Prices | Price (USD/T) | Free monthly |
| **Nurdles** (plastic pellets) | ICIS / Platts proxy via ethylene/naphtha prices | Price proxy | EIA naphtha stocks |
| **Ethylene** | EIA refinery production data | Production volumes | Monthly |
| **Naphtha** | EIA petroleum stocks | Stocks (thousand barrels) | Weekly |

### Tier 4: Context & Benchmarks
| Data | Source | Type |
|------|--------|------|
| **Crude Oil Price** (WTI/Brent) | EIA spot prices | Daily |
| **Natural Gas Price** (Henry Hub) | EIA spot prices | Daily |
| **Refinery Utilization** | EIA weekly supply | Weekly % |
| **5-Year Average Ranges** | EIA historical data | Calculated |

## 4. Architecture

```
┌─────────────────────────────────────────────┐
│            GitHub Pages (Static)             │
│                                              │
│  index.html ← React SPA + Recharts          │
│  data/latest.json ← Pre-fetched data        │
│  data/historical.json ← 1yr time series     │
│                                              │
├─────────────────────────────────────────────┤
│         GitHub Actions (Cron: 2x/day)       │
│                                              │
│  fetch-data.js → EIA API v2 calls           │
│  → Compute days-of-supply from              │
│    stocks ÷ (product_supplied / 7)          │
│  → Compute % vs 5-year avg                  │
│  → Write data/latest.json                   │
│  → git commit + push                        │
│                                              │
├─────────────────────────────────────────────┤
│              Data Sources                    │
│                                              │
│  EIA API v2 (api.eia.gov/v2/petroleum/...)  │
│  World Bank Commodity API (free)            │
│  FRED API (fertilizer price indices)        │
└─────────────────────────────────────────────┘
```

## 5. Key Calculations

### Days of Supply
```
days_of_supply = ending_stocks / (product_supplied_weekly / 7)
```
Where:
- `ending_stocks` = latest weekly inventory (thousand barrels)
- `product_supplied_weekly` = weekly implied demand (thousand barrels)
- Divide by 7 to get daily consumption rate

### % Change vs Baseline
```
pct_change = ((current - baseline) / baseline) × 100
```

### 5-Year Average Band
```
For each week-of-year, compute mean & ±1σ of stocks from past 5 years
```

## 6. Dashboard Panels

1. **Hero Bar**: Supply Crisis severity level, days since baseline (Feb 27, 2026)
2. **Stockpile Cards**: One per commodity — days of supply, stock level, % vs 5yr avg, sparkline
3. **Time Series Chart**: Interactive multi-line chart of days-of-supply for all Tier 1 products
4. **Supply Table**: Detailed table with stocks, product supplied, imports, exports
5. **Price Ticker**: Rolling commodity prices (WTI, Brent, Henry Hub, Urea, Ethylene)
6. **Geopolitical Context**: Strait of Hormuz flow status, refinery utilization

## 7. Refresh Strategy

- **GitHub Actions Cron**: Runs `fetch-data.js` at 00:00 UTC and 18:00 UTC (after EIA Wednesday release at ~15:30 UTC)
- **Client-side**: Dashboard fetches `data/latest.json` on load + optional EIA direct calls with user's API key
- **Fallback**: If Actions fail, dashboard can call EIA API directly (requires user to input API key)

## 8. Files to Implement

| File | Purpose |
|------|---------|
| `index.html` | Main dashboard — self-contained React + Recharts + Tailwind |
| `fetch-data.js` | Node.js script for GitHub Actions to fetch & compute all data |
| `.github/workflows/update-data.yml` | Cron workflow to auto-refresh data |
| `data/latest.json` | Current snapshot (generated by fetch-data.js) |
| `data/seed.json` | Seed data for initial deploy before first cron run |
| `README.md` | Setup & deployment instructions |
| `PRD.md` | This document |

## 9. Non-Goals (v1)

- No server-side backend (pure static + Actions)
- No paid API integrations (EIA is free; no Bloomberg/Platts)
- No real-time sub-minute streaming (EIA data is weekly)
- No user accounts or saved views
