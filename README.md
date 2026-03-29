# STOCKPILE — Global Supply Monitor

Real-time dashboard tracking **days of remaining supply** for petroleum products, natural gas, and critical downstream commodities. Built for macro traders, policy analysts, and anyone tracking the 2026 supply crisis.

> Inspired by [@DanielleFong's request](https://x.com/DanielleFong) for "a map of the days of remaining stocks for diesel, gasoline, nurdles, urea and other downstream components of crude oil and CNG"

## Live Dashboard

**→ [thecobb.github.io/supply-dashboard](https://thecobb.github.io/supply-dashboard/)**

## What It Tracks

| Commodity | Source | Frequency | Metric |
|-----------|--------|-----------|--------|
| Crude Oil (excl. & incl. SPR) | EIA WPSR | Weekly | Days of supply, stocks, % vs 5yr avg |
| Motor Gasoline | EIA WPSR | Weekly | Days of supply, stocks, % vs baseline |
| Distillate/Diesel | EIA WPSR | Weekly | Days of supply, stocks, WoW change |
| Jet Fuel (Kerosene) | EIA WPSR | Weekly | Days of supply, stocks |
| Propane/Propylene | EIA WPSR | Weekly | Days of supply, stocks |
| Residual Fuel Oil | EIA WPSR | Weekly | Days of supply, stocks |
| Natural Gas (storage) | EIA Weekly NG | Weekly | Days of supply, Bcf in storage |
| Commodity prices (WTI, Brent, Henry Hub, RBOB, ULSD, Propane) | Yahoo Finance futures (fallback: EIA Spot) + proxies | ~30 min | Price ticker |

### Days of Supply Formula
```
Days of Supply = Ending Stocks ÷ (Weekly Product Supplied ÷ 7)
```

## Deploy on GitHub Pages (5 minutes)

### 1. Get a Free EIA API Key

1. Go to [eia.gov/opendata/register.php](https://www.eia.gov/opendata/register.php)
2. Register with your email
3. Copy your API key

### 2. Create Your Repository

```bash
# Clone this repo
git clone https://github.com/YOUR_USERNAME/supply-dashboard.git
cd supply-dashboard

# Or create fresh and copy files
mkdir supply-dashboard && cd supply-dashboard
# Copy all files from this project
```

### 3. Add Your API Key as a Secret

1. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `EIA_API_KEY`
4. Value: your EIA API key
5. Click **Add secret**

### 4. Enable GitHub Pages

1. Go to **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / `/(root)`
4. Save

### 5. Run the First Data Fetch

1. Go to **Actions** tab
2. Click **Update Supply Data** workflow
3. Click **Run workflow**
4. Wait ~30 seconds for it to complete

Your dashboard is now live at `https://YOUR_USERNAME.github.io/supply-dashboard/`

### Auto-Updates

The GitHub Actions workflow runs automatically:
- **Every 30 minutes** for ticker refresh
- **Daily** at midnight UTC
- **Wednesdays** at 4 PM UTC (after EIA petroleum data release)
- **Thursdays** at 6 PM UTC (after EIA natural gas storage release)

## Interactive Mode

The dashboard also supports **live client-side fetching**:

1. Open the dashboard in your browser
2. Paste your EIA API key in the input field at the bottom
3. Click **FETCH LIVE DATA**
4. Data refreshes directly from EIA (key stored in localStorage, never transmitted)

## Project Structure

```
supply-dashboard/
├── index.html              # Main dashboard (self-contained React + Recharts)
├── fetch-data.js           # Node.js data fetcher (runs in GitHub Actions)
├── data/
│   └── latest.json         # Pre-fetched data (auto-updated by Actions)
├── .github/
│   └── workflows/
│       └── update-data.yml # Cron job to refresh data
├── PRD.md                  # Product Requirements Document
└── README.md               # This file
```

## Data Sources (Gold Standard)

- **EIA Weekly Petroleum Status Report** — The definitive U.S. petroleum data source, released Wednesdays at 10:30 AM ET. Covers stocks, production, imports, exports, and product supplied for all major petroleum products.
- **EIA API v2** — Free, public REST API. No rate limits for reasonable use. Register at [eia.gov/opendata](https://www.eia.gov/opendata/).
- **EIA Weekly Natural Gas Storage Report** — Released Thursdays at 10:30 AM ET.
- **API Weekly Statistical Bulletin** — Published Tuesdays (18 hours before EIA). Paid subscription.
- **World Bank Commodity Prices** — Monthly fertilizer/chemical price data (urea, ammonia).

## Extending

### Add a new commodity

1. Add entry to `COMMODITY_CONFIG` in `index.html`
2. Add matching entry to `COMMODITIES` in `fetch-data.js`
3. Find the correct EIA API facets at [api.eia.gov/v2/petroleum](https://api.eia.gov/v2/petroleum)

### Add non-EIA data sources

The `fetch-data.js` script can be extended to pull from any API. For urea/ammonia, consider:
- [FRED API](https://fred.stlouisfed.org/docs/api/fred/) — Free, has fertilizer price indices
- [World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392) — Free commodity prices
- [Quandl/Nasdaq Data Link](https://data.nasdaq.com/) — Various commodity datasets

## License

MIT — Data from EIA is public domain (U.S. Government work).
