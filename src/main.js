// HouseSigma property listings scraper - API-first with DOM fallback
import { Actor, log } from 'apify';
import { PlaywrightCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { webcrypto as crypto } from 'crypto';
import { inflateSync, inflateRawSync, gunzipSync } from 'zlib';
import { load as cheerioLoad } from 'cheerio';

const API_BASE = 'https://housesigma.com/bkv2/api';
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDQlOcjEbqprurl2xjoEP0QdjGI
rZhLVn5vzwCorG4+2AtSi4AAHjghSXM//ljqE5rA13gfTc58JvM6I75Dmqr5r5Vv
o57CAbxBXHsXu5ojtgvb5rOd2lrZeckwJL0Z7euvRsA/FjbFdGMcGeSJ8JoePq+H
0RFOt285bSb8hVq0LQIDAQAB
-----END PUBLIC KEY-----`;

const textEncoder = new TextEncoder();

const base64ToBytes = (b64) => Uint8Array.from(Buffer.from(b64 || '', 'base64'));
const bytesToBase64 = (buf) => Buffer.from(buf).toString('base64');
const nowTs = () => Math.floor(Date.now() / 1000).toString();

const tryInflate = (buf) => {
    try {
        return inflateSync(buf);
    } catch {
        // ignore
    }
    try {
        return inflateRawSync(buf);
    } catch {
        // ignore
    }
    try {
        return gunzipSync(buf);
    } catch {
        // ignore
    }
    return buf;
};

const toPositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.floor(parsed));
};

const stableStringify = (value) => {
    if (value === null || value === undefined) return 'null';
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    if (typeof value === 'object') {
        const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
    }
    return JSON.stringify(value);
};

const removeEmptyDeep = (value) => {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') return value.trim() === '' ? undefined : value;
    if (Array.isArray(value)) {
        const deduped = [];
        const seen = new Set();
        for (const item of value) {
            const cleaned = removeEmptyDeep(item);
            if (cleaned === undefined) continue;
            const hash = stableStringify(cleaned);
            if (seen.has(hash)) continue;
            seen.add(hash);
            deduped.push(cleaned);
        }
        return deduped.length ? deduped : undefined;
    }
    if (typeof value === 'object') {
        const cleanedObject = {};
        for (const [key, nested] of Object.entries(value)) {
            const cleaned = removeEmptyDeep(nested);
            if (cleaned !== undefined) {
                cleanedObject[key] = cleaned;
            }
        }
        return Object.keys(cleanedObject).length ? cleanedObject : undefined;
    }
    return value;
};

const normalizeListingRecord = (record) => {
    const cleaned = removeEmptyDeep(record);
    return cleaned && typeof cleaned === 'object' ? cleaned : null;
};

const createListingKey = (listing) => {
    const candidates = [
        listing?.listingId,
        listing?.mlsNumber,
        listing?.url,
        listing?.raw?.id_listing,
        listing?.raw?.ml_num,
    ];
    const best = candidates.find((v) => typeof v === 'string' || typeof v === 'number');
    if (best !== undefined && best !== null && String(best).trim() !== '') {
        return String(best).trim();
    }
    const fallback = {
        address: listing?.address || null,
        price: listing?.price || null,
        propertyType: listing?.propertyType || null,
        source: listing?._source || null,
        listingType: listing?._listing_type || null,
    };
    return stableStringify(fallback);
};

const deriveProvinceFromUrl = (url) => {
    try {
        const { pathname } = new URL(url);
        const seg = pathname.split('/').filter(Boolean)[0];
        return seg ? seg.toUpperCase() : null;
    } catch {
        return null;
    }
};

const extractListingSlug = (url) => {
    try {
        const { pathname } = new URL(url);
        const parts = pathname.split('/').filter(Boolean);
        const idx = parts.indexOf('listings');
        return idx >= 0 ? parts[idx + 1] || null : null;
    } catch {
        return null;
    }
};

const importPublicKey = async () => {
    const b64 = PUBLIC_KEY_PEM.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
    const der = base64ToBytes(b64);
    return crypto.subtle.importKey('spki', der, { name: 'RSA-OAEP', hash: 'SHA-1' }, false, ['encrypt']);
};

const importAesKey = async (secret) => {
    const keyStr = String(secret || '').padEnd(16, '*').slice(0, 16);
    return crypto.subtle.importKey('raw', textEncoder.encode(keyStr), { name: 'AES-CTR', length: 128 }, false, ['encrypt', 'decrypt']);
};

const aesEncrypt = async (plain, key, counter) => {
    const data = typeof plain === 'string' ? textEncoder.encode(plain) : textEncoder.encode(JSON.stringify(plain));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-CTR', counter, length: 128 }, key, data);
    return new Uint8Array(encrypted);
};

const aesDecrypt = async (cipherBytes, key, counter) => {
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 128 }, key, cipherBytes);
    return new Uint8Array(decrypted);
};

const rsaEncrypt = async (bytes, pubKey) => {
    const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, bytes);
    return new Uint8Array(encrypted);
};

const createApiClient = (proxyConfiguration) => {
    const getProxyUrl = () => proxyConfiguration?.newUrl?.();
    const baseHeaders = {
        'HS-Client-Type': 'desktop_v7',
        'HS-Client-Version': '7.21.152',
        Accept: 'application/json, text/plain, */*',
    };

    const post = async (path, { json, headers } = {}) => {
        const proxyUrl = getProxyUrl();
        return gotScraping.post(`${API_BASE}${path}`, {
            json: json ?? {},
            responseType: 'json',
            headers: { ...baseHeaders, ...(headers || {}) },
            proxyUrl,
        });
    };

    return { post };
};

const fetchAccessToken = async (api) => {
    const res = await api.post('/init/accesstoken/new');
    if (!res.body?.status) {
        throw new Error(`Access token request failed: ${res.body?.error?.message || 'Unknown error'}`);
    }
    const token = res.body?.data?.access_token;
    const secret = res.body?.data?.secret?.secret_key;
    return { token, secret };
};

const fetchHomepageConfig = async (api, token) => {
    const res = await api.post('/init/config/homepage', {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.body?.status) {
        throw new Error(`Homepage config request failed: ${res.body?.error?.message || 'Unknown error'}`);
    }
    return res.body?.data;
};

const resolveRecommendType = (config, slug) => {
    const list = Array.isArray(config?.recommendlist) ? config.recommendlist : [];
    if (slug) {
        const bySlug = list.find((r) => String(r.slug).toLowerCase() === String(slug).toLowerCase());
        if (bySlug) return { type: bySlug.type, matched: true };
    }
    const newlyListed = list.find((r) => String(r.slug).toLowerCase() === 'newly-listed');
    return { type: newlyListed?.type ?? 9, matched: false };
};

const buildListingUrl = (listing, province) => {
    const prov = (province || listing?.province || 'on').toLowerCase();
    const seoMunicipality = listing?.seo_municipality;
    const seoAddress = listing?.seo_address;
    const idAddress = listing?.id_address;
    if (seoMunicipality && seoAddress && idAddress) {
        return `https://housesigma.com/${prov}/${seoMunicipality}/${seoAddress}/home/${idAddress}/`;
    }
    if (idAddress) {
        return `https://housesigma.com/${prov}/home/${idAddress}/`;
    }
    return null;
};

const mapListing = (listing, { province, listingSlug }) => {
    const bedrooms = listing?.bedroom_string ?? listing?.bedroom ?? null;
    const bathrooms = listing?.washroom ?? null;
    const price = listing?.price ?? listing?.price_sold ?? listing?.price_abbr ?? null;
    return normalizeListingRecord({
        url: buildListingUrl(listing, province),
        address: listing?.address || listing?.address_navigation || null,
        price,
        bedrooms: bedrooms ?? null,
        bathrooms,
        propertyType: listing?.house_type_name || listing?.house_style || listing?.house_type || null,
        mlsNumber: listing?.ml_num || null,
        listingId: listing?.id_listing || null,
        listStatus: listing?.list_status?.text_full || listing?.list_status?.status || null,
        photoUrl: listing?.photo_url || null,
        municipality: listing?.municipality_name || null,
        province: listing?.province || province || null,
        priceInt: listing?.price_int ?? null,
        raw: listing,
        _source: 'housesigma.com',
        _listing_type: listingSlug || null,
    });
};

const extractGalleryImages = (detail) => {
    const primary = detail?.picture?.photo_list;
    const fallback = detail?.picture?.preview_photo_thumb_list;
    const candidates = Array.isArray(primary) && primary.length ? primary : fallback;
    if (!Array.isArray(candidates)) return [];

    const seen = new Set();
    const gallery = [];
    for (const url of candidates) {
        if (typeof url !== 'string') continue;
        const trimmed = url.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        gallery.push(trimmed);
    }
    return gallery;
};

const createEncryptionContext = async (secret) => ({
    pubKey: await importPublicKey(),
    aesKey: await importAesKey(secret),
});

const callEncryptedWithContext = async ({ api, token, path, payload, ctx }) => {
    const counter = crypto.getRandomValues(new Uint8Array(16));
    const ts = nowTs();
    const encryptedPayload = await aesEncrypt({ ...payload, hs_request_timestamp: ts }, ctx.aesKey, counter);
    const encryptedCtr = await rsaEncrypt(counter, ctx.pubKey);

    const res = await api.post(path, {
        json: {
            ctr: bytesToBase64(encryptedCtr),
            et_payload: bytesToBase64(encryptedPayload),
        },
        headers: {
            Authorization: `Bearer ${token}`,
            'Hs-Request-Timestamp': ts,
        },
    });

    if (!res.body?.status) {
        throw new Error(`Encrypted API request failed: ${res.body?.error?.message || 'Unknown error'}`);
    }

    const cipherResp = base64ToBytes(res.body?.data || '');
    const decrypted = await aesDecrypt(cipherResp, ctx.aesKey, counter);
    const inflated = tryInflate(decrypted);
    const text = Buffer.from(inflated).toString('utf8');
    return JSON.parse(text);
};

/**
 * Main entry point for the HouseSigma scraper actor.
 * Initializes the actor, processes input, and runs the crawler.
 */
async function main() {
    try {
        const input = await Actor.getInput() || {};
        const {
            results_wanted: resultsWantedRaw = 20,
            max_pages: maxPagesRaw = 20,
            startUrl,
            proxyConfiguration: proxyConfig,
        } = input;

        const RESULTS_WANTED = toPositiveInt(resultsWantedRaw, Number.MAX_SAFE_INTEGER);
        const MAX_PAGES = toPositiveInt(maxPagesRaw, 20);

        /**
         * Converts a relative URL to an absolute URL.
         * @param {string} href - The relative or absolute URL.
         * @param {string} base - The base URL.
         * @returns {string|null} The absolute URL or null if invalid.
         */
        const toAbs = (href, base = 'https://housesigma.com') => {
            try {
                return new URL(href, base).href;
            } catch {
                return null;
            }
        };

        const initial = startUrl ? [startUrl] : ['https://housesigma.com/on/listings/newly-listed/'];

        // Create proxy configuration (residential recommended for protected sites)
        const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig || (Actor.isAtHome() ? {
            useApifyProxy: true,
            apifyProxyGroups: ['RESIDENTIAL'],
        } : {
            useApifyProxy: false,
        }));

        let saved = 0;
        const globalSeenListingKeys = new Set();

        const runApiFirst = async () => {
            const api = createApiClient(proxyConfiguration);
            const { token, secret } = await fetchAccessToken(api);
            const config = await fetchHomepageConfig(api, token);
            const listingSlug = extractListingSlug(initial[0]) || 'newly-listed';
            const { type, matched } = resolveRecommendType(config, listingSlug);
            const province = deriveProvinceFromUrl(initial[0]) || 'ON';
            const ctx = await createEncryptionContext(secret);
            const galleryCache = new Map();

            const fetchGalleryForListing = async (idAddress) => {
                if (!idAddress || typeof idAddress !== 'string') return [];
                if (galleryCache.has(idAddress)) return galleryCache.get(idAddress);

                try {
                    const detail = await callEncryptedWithContext({
                        api,
                        token,
                        path: '/listing/info/detail_v2',
                        payload: {
                            lang: 'en_US',
                            province,
                            id_address: idAddress,
                            event_source: '',
                        },
                        ctx,
                    });
                    const gallery = extractGalleryImages(detail);
                    galleryCache.set(idAddress, gallery);
                    return gallery;
                } catch (error) {
                    log.debug(`Gallery fetch failed for ${idAddress}: ${error?.message || 'Unknown error'}`);
                    galleryCache.set(idAddress, []);
                    return [];
                }
            };

            if (!matched && startUrl) {
                log.warning(`Start URL slug "${listingSlug}" not recognized by config. Switching to secondary retrieval.`);
                return saved;
            }

            log.info(`Listing type resolved: slug=${listingSlug} type=${type} province=${province}`);

            for (let page = 1; page <= MAX_PAGES && saved < RESULTS_WANTED; page++) {
                const payload = {
                    type,
                    page,
                    page_size: 10,
                    province,
                    lang: 'en',
                };

                const data = await callEncryptedWithContext({
                    api,
                    token,
                    path: '/search/homepage/recommendlist_v2',
                    payload,
                    ctx,
                });

                const list = Array.isArray(data?.list) ? data.list : [];
                if (!list.length) break;

                const remaining = RESULTS_WANTED - saved;
                const batch = [];
                let galleryHits = 0;

                for (const item of list) {
                    let mapped = mapListing(item, { province, listingSlug });
                    if (!mapped) continue;

                    const galleryImages = await fetchGalleryForListing(item?.id_address);
                    if (galleryImages.length) {
                        galleryHits++;
                        mapped = normalizeListingRecord({
                            ...mapped,
                            photoUrl: mapped.photoUrl || galleryImages[0],
                            galleryImages,
                            galleryImageCount: galleryImages.length,
                        });
                        if (!mapped) continue;
                    }

                    const dedupeKey = createListingKey(mapped);
                    if (globalSeenListingKeys.has(dedupeKey)) continue;
                    globalSeenListingKeys.add(dedupeKey);
                    batch.push(mapped);
                    if (batch.length >= remaining) break;
                }

                if (batch.length) {
                    await Dataset.pushData(batch);
                    saved += batch.length;
                    log.info(`Page ${page} processed: saved ${batch.length}, withGallery ${galleryHits}, total ${saved}`);
                }
            }

            return saved;
        };

        /**
         * Extracts property data from JSON-LD structured data.
         * @param {CheerioStatic} $ - The Cheerio instance.
         * @returns {Object|null} Extracted property data or null.
         */
        const extractFromJsonLd = ($) => {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    for (const e of arr) {
                        if (!e) continue;
                        const type = e['@type'] || e.type;
                        if (type === 'RealEstateListing' || (Array.isArray(type) && type.includes('RealEstateListing'))) {
                            return {
                                address: e.address?.streetAddress || e.name || null,
                                price: e.offers?.price || null,
                                bedrooms: e.numberOfRooms || null,
                                bathrooms: e.numberOfBathroomsTotal || null,
                                propertyType: e['@type'] || null,
                                url: e.url || null,
                            };
                        }
                    }
                } catch {
                    // Ignore parsing errors
                }
            }
            return null;
        };

        /**
         * Extracts property listings from the page HTML.
         * @param {CheerioStatic} $ - The Cheerio instance.
         * @param {string} base - The base URL for resolving links.
         * @returns {Array} Array of extracted listings.
         */
        const extractListings = ($, base) => {
            const listings = [];
            // Try to extract from structured data first
            const jsonData = extractFromJsonLd($);
            if (jsonData) {
                listings.push(jsonData);
            }
            // Fallback to HTML parsing
            $('a[href*="/home/"]').each((_, el) => {
                const $el = $(el);
                const href = $el.attr('href');
                if (href && href.includes('/home/')) {
                    const url = toAbs(href, base);
                    const address = $el.text().trim();
                    // Look for nearby price
                    const $parent = $el.closest('div, article, li');
                    const price = $parent.find('[class*="price"], .price').text().trim() || $parent.find('strong').first().text().trim();
                    const bedroomsMatch = $parent.text().match(/(\d+)\s*bed/i);
                    const bedrooms = bedroomsMatch ? bedroomsMatch[1] : null;
                    const bathroomsMatch = $parent.text().match(/(\d+)\s*bath/i);
                    const bathrooms = bathroomsMatch ? bathroomsMatch[1] : null;
                    const propertyTypeMatch = $parent.text().match(/(Detached|Condo|Apartment|House)/i);
                    const propertyType = propertyTypeMatch ? propertyTypeMatch[1] : null;
                    listings.push({
                        url,
                        address: address || null,
                        price: price || null,
                        bedrooms,
                        bathrooms,
                        propertyType,
                    });
                }
            });
            return listings;
        };

        /**
         * Finds the next page URL for pagination.
         * @param {CheerioStatic} $ - The Cheerio instance.
         * @param {string} base - The base URL.
         * @returns {string|null} The next page URL or null.
         */
        const findNextPage = ($, base) => {
            const nextLink = $('a').filter((_, el) => /(next|»|>)/i.test($(el).text())).first().attr('href');
            return nextLink ? toAbs(nextLink, base) : null;
        };

        const crawler = new PlaywrightCrawler({
            proxyConfiguration,
            maxRequestRetries: 5,
            useSessionPool: true,
            sessionPoolOptions: {
                maxPoolSize: 5,
                sessionOptions: { maxUsageCount: 3 },
            },
            maxConcurrency: 2,
            requestHandlerTimeoutSecs: 120,
            navigationTimeoutSecs: 60,
            launchContext: {
                launchOptions: {
                    channel: 'chrome',
                },
            },
            
            // Fingerprint generation for stealth
            browserPoolOptions: {
                useFingerprints: true,
                fingerprintOptions: {
                    fingerprintGeneratorOptions: {
                        browsers: ['chrome'],
                        operatingSystems: ['windows', 'macos'],
                        devices: ['desktop'],
                    },
                },
            },
            
            // Pre-navigation hooks for resource blocking and stealth
            preNavigationHooks: [
                async ({ page }) => {
                    // Block heavy resources (keep stylesheets if needed for rendering)
                    await page.route('**/*', (route) => {
                        const type = route.request().resourceType();
                        const url = route.request().url();

                        // Block images, fonts, media, and common trackers
                        if (['image', 'font', 'media'].includes(type) ||
                            url.includes('google-analytics') ||
                            url.includes('googletagmanager') ||
                            url.includes('facebook') ||
                            url.includes('doubleclick') ||
                            url.includes('pinterest') ||
                            url.includes('adsense')) {
                            return route.abort();
                        }
                        return route.continue();
                    });

                    // Stealth: Hide webdriver property
                    await page.addInitScript(() => {
                        Object.defineProperty(navigator, 'webdriver', { get: () => false });
                    });
                },
            ],
            /**
             * Handles each crawled page.
             * @param {Object} params - The request handler parameters.
             * @param {Object} params.request - The request object.
             * @param {Page} params.page - The Playwright page instance.
             * @param {Function} params.enqueueLinks - Function to enqueue more links.
             * @param {Object} params.log - Logger instance.
             */
            async requestHandler({ request, page, enqueueLinks, log: crawlerLog }) {
                const pageNo = request.userData?.pageNo || 1;

                log.info(`Processing page ${pageNo}`);

                // Wait for page to fully load
                await page.waitForLoadState('domcontentloaded');
                await page.waitForLoadState('networkidle').catch(() => {});

                const content = await page.content();
                const $ = cheerioLoad(content);
                const listings = extractListings($, request.url);
                crawlerLog.info(`Page ${pageNo} processed. Candidates: ${listings.length}`);

                const remaining = RESULTS_WANTED - saved;
                const toPush = [];
                for (const item of listings) {
                    if (toPush.length >= remaining) break;
                    const normalized = normalizeListingRecord({
                        ...item,
                        _source: 'housesigma.com',
                    });
                    if (!normalized) continue;
                    const dedupeKey = createListingKey(normalized);
                    if (globalSeenListingKeys.has(dedupeKey)) continue;
                    globalSeenListingKeys.add(dedupeKey);
                    toPush.push(normalized);
                }
                if (toPush.length) {
                    await Dataset.pushData(toPush);
                    saved += toPush.length;
                }

                if (saved < RESULTS_WANTED && pageNo < MAX_PAGES) {
                    const next = findNextPage($, request.url);
                    if (next) {
                        await enqueueLinks({ urls: [next], userData: { pageNo: pageNo + 1 } });
                    }
                }
            },

            failedRequestHandler({ request, error }) {
                if (error?.message?.includes('403')) {
                    log.warning(`Blocked (403): ${request.url} - skipping`);
                } else {
                    log.error(`Request ${request.url} failed: ${error?.message || 'Unknown error'}`);
                }
            },
        });

        try {
            await runApiFirst();
        } catch {
            log.warning('Primary retrieval failed, switching to secondary path.');
        }

        if (saved === 0) {
            await crawler.run(initial.map((url) => ({ url, userData: { pageNo: 1 } })));
        }

        log.info(`Finished. Saved ${saved} items`);
    } catch (error) {
        log.error('Error in main function. Run failed.');
        throw error;
    }
}

// Initialize the actor and run main
await Actor.init();
await main().catch(() => {
    process.exit(1);
});

await Actor.exit();
