const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'hostlist-compiler-config.json');
const lockPath = path.join(__dirname, 'sources-lock.json');

// Concurrency pool to limit parallel requests and avoid rate limits
async function processInPool(urls, concurrency, fn) {
    const results = {};
    const queue = [...urls];
    
    async function worker() {
        while (queue.length > 0) {
            const url = queue.shift();
            results[url] = await fn(url);
        }
    }
    
    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);
    return results;
}

// Fetch metadata for a URL using HEAD or GET with Range
async function fetchMetadata(url) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout
    
    const headers = {
        'User-Agent': 'Mozilla/5.0 (GitHub Action; adguard-filter-list)'
    };
    
    try {
        console.log(`Checking: ${url}`);
        let res = await fetch(url, {
            method: 'HEAD',
            headers: headers,
            signal: controller.signal
        });
        
        // If HEAD is blocked or returns a failure status, try GET with Range: bytes=0-0
        if (!res.ok || res.status === 405 || res.status === 403) {
            res = await fetch(url, {
                method: 'GET',
                headers: {
                    ...headers,
                    'Range': 'bytes=0-0'
                },
                signal: controller.signal
            });
        }
        
        clearTimeout(timeoutId);
        
        const etag = res.headers.get('etag') || '';
        const lastModified = res.headers.get('last-modified') || '';
        const contentLength = res.headers.get('content-length') || '';
        
        return {
            etag: etag.trim(),
            lastModified: lastModified.trim(),
            contentLength: contentLength.trim(),
            status: res.status
        };
    } catch (err) {
        clearTimeout(timeoutId);
        console.warn(`[Warning] Failed to fetch metadata for ${url}: ${err.message}`);
        // Return unique fallback so that we trigger a compile on network error,
        // ensuring we don't get stuck on stale lists.
        return {
            etag: `error-${Date.now()}`,
            lastModified: '',
            contentLength: '',
            error: err.message
        };
    }
}

async function main() {
    // Read and parse hostlist-compiler-config.json
    if (!fs.existsSync(configPath)) {
        console.error(`Error: Configuration file not found at ${configPath}`);
        process.exit(1);
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const urls = [];
    
    // Extract all remote source URLs
    if (config.sources && Array.isArray(config.sources)) {
        for (const src of config.sources) {
            if (typeof src.source === 'string') {
                if (src.source.startsWith('http://') || src.source.startsWith('https://')) {
                    urls.push(src.source);
                } else if (src.source === '../oisd.txt') {
                    // Map local OISD file back to its source URL
                    urls.push('https://big.oisd.nl/');
                }
            }
        }
    }
    
    // Deduplicate URLs
    const uniqueUrls = [...new Set(urls)];
    console.log(`Found ${uniqueUrls.length} unique remote source list(s) to verify.`);
    
    // Fetch all metadata in parallel with limited concurrency to avoid 429 rate limiting
    const concurrency = 8;
    const newMetadata = await processInPool(uniqueUrls, concurrency, fetchMetadata);
    
    // Load existing lock file
    let oldMetadata = {};
    if (fs.existsSync(lockPath)) {
        try {
            oldMetadata = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        } catch (err) {
            console.warn(`[Warning] Could not parse existing lock file: ${err.message}`);
        }
    }
    
    // Compare new metadata with locked metadata
    let changed = false;
    const changesList = [];
    
    for (const url of uniqueUrls) {
        const oldVal = oldMetadata[url];
        const newVal = newMetadata[url];
        
        if (!oldVal) {
            changed = true;
            changesList.push(`[New source] ${url}`);
        } else if (
            oldVal.etag !== newVal.etag ||
            oldVal.lastModified !== newVal.lastModified ||
            oldVal.contentLength !== newVal.contentLength
        ) {
            changed = true;
            changesList.push(`[Updated source] ${url}`);
            console.log(`Changes detected for ${url}:`);
            if (oldVal.etag !== newVal.etag) console.log(`  ETag: ${oldVal.etag} -> ${newVal.etag}`);
            if (oldVal.lastModified !== newVal.lastModified) console.log(`  Last-Modified: ${oldVal.lastModified} -> ${newVal.lastModified}`);
            if (oldVal.contentLength !== newVal.contentLength) console.log(`  Content-Length: ${oldVal.contentLength} -> ${newVal.contentLength}`);
        }
    }
    
    console.log('\n--- Summary of Verification ---');
    if (changed) {
        console.log(`Changes detected in ${changesList.length} source(s):`);
        changesList.forEach(c => console.log(` - ${c}`));
    } else {
        console.log('No changes detected. All sources are up-to-date.');
    }
    
    // Handle command line flags
    const args = process.argv.slice(2);
    const shouldUpdate = args.includes('--update') || args.includes('-u');
    
    if (shouldUpdate) {
        fs.writeFileSync(lockPath, JSON.stringify(newMetadata, null, 2), 'utf8');
        console.log(`Successfully updated lock file at ${lockPath}`);
    }
    
    // Output GITHUB_OUTPUT parameters if running in GitHub Actions
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput) {
        fs.appendFileSync(githubOutput, `changed=${changed}\n`, 'utf8');
        console.log(`Written changed=${changed} to GITHUB_OUTPUT.`);
    }
}

main().catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
