## Selected API
- Endpoint: `https://housesigma.com/bkv2/api/search/homepage/recommendlist_v2`
- Method: `POST`
- Auth: Bearer token from `POST /bkv2/api/init/accesstoken/new` + encrypted payload (AES-CTR + RSA-OAEP)
- Pagination: `page` + `page_size` in encrypted payload
- Fields available: `id_listing`, `ml_num`, `id_address`, `address`, `address_navigation`, `price`, `price_int`, `price_abbr`, `photo_url`, `house_type_name`, `house_style`, `bedroom`, `bedroom_plus`, `bedroom_string`, `washroom`, `municipality_name`, `province`, `community_name`, `parking`, `house_area`, `land`, `map`, `list_status`, `scores`, `analytics`, `tags`, `text`, `open_house_date`, `brokerage_text`, `postal_code`, `date_added`, `date_update`, `date_end`, `date_sold_report`, and others.
- Fields currently exposed by actor output: `url`, `address`, `price`, `bedrooms`, `bathrooms`, `propertyType`, `mlsNumber`, `listingId`, `listStatus`, `photoUrl`, `municipality`, `province`, `priceInt`, `raw`, `_source`, `_listing_type`
- Field count: API response has 30+ useful fields per listing (actor exposes 16 top-level fields and keeps full cleaned `raw` object)

## Gallery API (Optional Enrichment)
- Endpoint: `https://housesigma.com/bkv2/api/listing/info/photos`
- Method: `POST`
- Auth: Bearer token from `POST /bkv2/api/init/accesstoken/new`
- Payload: `{ "id_listing": "<listing-id>" }`
- Why selected: returns `picture.photo_list` directly and is significantly lighter than `/listing/info/detail_v2`.
- Usage in actor: only when `includeGallery` is enabled, to keep default runs fully fast.

## URLScan Evidence
- URLScan search used: `https://urlscan.io/api/v1/search/?q=domain:housesigma.com`
- Scan reviewed: `019d52db-1b27-74db-97ff-002afc76cad4` (April 3, 2026)
- Observed high-value endpoints:
  - `POST /bkv2/api/init/app` (app bootstrap config)
  - `POST /bkv2/api/init/accesstoken/new` (token + secret bootstrap)
  - `POST /bkv2/api/init/config/homepage` (recommendation type metadata)
  - `POST /bkv2/api/search/homepage/recommendlist_v2` (primary listing data)
  - `POST /bkv2/api/listing/info/photos` (listing gallery photos by `id_listing`)

## Candidate Scoring
- `recommendlist_v2`: JSON direct (+30), >15 fields (+25), no account login needed (+20), pagination (+15), extends existing fields (+10) = **100**
- `init/app`: JSON direct (+30), rich config (+25), no login (+20), no listing pagination (+0), does not directly replace listing extraction (+0) = **75** (supporting endpoint only)
- `stats/homepage`: JSON direct (+30), some metrics (+10), no login (+20), no listing pagination (+0), weak field overlap (+0) = **60** (not primary listings)

## Rejected Weaker Sources
- HTML-only parsing: less stable and lower field coverage than API.
- JSON-LD only: sparse fields compared to `recommendlist_v2`.
- `__NEXT_DATA__`: not needed because direct API flow already returns richer listing payloads.

## Implementation Notes
- Actor remains HTTP-first for primary extraction.
- Browser crawler is retained only as a fallback path.
