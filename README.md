# HouseSigma Listings Scraper

Extract and collect HouseSigma property listing data fast and reliably. Gather addresses, prices, bedrooms, bathrooms, property types, and listing URLs at scale. Ideal for market research, competitive analysis, and real estate intelligence.

## Features

- **Comprehensive listings** — Capture key property details in a clean, structured dataset
- **Automatic pagination** — Keep collecting until your target count is reached
- **Configurable limits** — Control volume with results and page caps
- **Ready for analysis** — Use the output for reporting, dashboards, or BI tools

## Use Cases

### Market Intelligence
Monitor listing volume and price movements across neighborhoods. Build trend datasets for forecasting and market monitoring.

### Lead Generation
Identify new listings quickly and compile them for outreach or CRM enrichment. Prioritize opportunities based on price and property type.

### Comparative Analysis
Compare pricing, property types, and listing density across regions. Support investment decisions with consistent data.

### Portfolio Research
Evaluate comparable properties for valuation and acquisition research. Create benchmarks across property categories.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | `https://housesigma.com/on/listings/newly-listed/` | Listings page to start collecting from |
| `results_wanted` | Integer | No | `20` | Maximum number of listings to collect |
| `max_pages` | Integer | No | `20` | Maximum number of pages to visit |
| `proxyConfiguration` | Object | No | `{ "useApifyProxy": false }` | Proxy settings for more reliable collection |

---

## Output Data

Each item in the dataset contains:

| Field | Type | Description |
|-------|------|-------------|
| `address` | String | Listing address or display name |
| `price` | String | Listing price |
| `bedrooms` | String | Number of bedrooms when available |
| `bathrooms` | String | Number of bathrooms when available |
| `propertyType` | String | Property type category |
| `url` | String | Listing URL |

---

## Usage Examples

### Basic Extraction

Collect the latest listings from the default page:

```json
{
  "startUrl": "https://housesigma.com/on/listings/newly-listed/",
  "results_wanted": 20,
  "max_pages": 10
}
```

### Targeted Collection

Start from a specific listings page and collect more results:

```json
{
  "startUrl": "https://housesigma.com/on/listings/newly-listed/",
  "results_wanted": 100,
  "max_pages": 25
}
```

### Stable Runs with Proxy

Use proxy settings for higher reliability:

```json
{
  "startUrl": "https://housesigma.com/on/listings/newly-listed/",
  "results_wanted": 50,
  "max_pages": 15,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

---

## Sample Output

```json
{
  "address": "123 Example St, Toronto, ON",
  "price": "$899,000",
  "bedrooms": "3",
  "bathrooms": "2",
  "propertyType": "Detached",
  "url": "https://housesigma.com/on/home/123-example-street"
}
```

---

## Tips for Best Results

### Start with Popular Pages
- Use active listing pages to ensure consistent results
- Avoid stale or empty categories

### Balance Speed and Volume
- Begin with `results_wanted` set to `20` for quick validation
- Increase limits gradually for production runs

### Keep Runs Reliable
- Use proxies if you experience blocked requests
- Space out larger runs to respect rate limits

---

## Proxy Configuration

For more reliable collection on protected sites:

```json
{
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

---

## Integrations

Connect your data with:

- **Google Sheets** — Track listings and pricing trends
- **Airtable** — Build searchable real estate databases
- **Slack** — Get notifications for new listings
- **Webhooks** — Stream data to your systems
- **Make** — Automate downstream workflows
- **Zapier** — Trigger actions from new records

### Export Formats

- **JSON** — For APIs and custom workflows
- **CSV** — For spreadsheets and analysis
- **Excel** — For reporting and dashboards
- **XML** — For legacy integrations

---

## Frequently Asked Questions

### How many listings can I collect?
You can collect as many as are available. Use `results_wanted` and `max_pages` to control volume.

### Do I need a starting URL?
No. A default listings page is provided, but you can specify a different listings page for targeted collection.

### What if some fields are missing?
Some listings may not include all details. Missing fields are returned as empty values.

### Can I collect data from multiple regions?
Yes. Run separate tasks with different `startUrl` values to cover multiple regions or categories.

### Will this work for large runs?
Yes, but use reasonable limits and proxies to keep runs stable.

### Can I schedule daily collection?
Yes. Use Apify schedules to run the actor automatically.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with website terms of service and applicable laws. Use data responsibly and respect rate limits.
