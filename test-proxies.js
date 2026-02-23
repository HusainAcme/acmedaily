const fs = require('fs');

const feeds = [
    "https://openai.com/blog/rss.xml",
    "https://www.anthropic.com/rss.xml",
    "https://devops.com/feed/"
];

const proxies = [
    { name: "allorigins", url: "https://api.allorigins.win/get?url=", useJson: true },
    { name: "corsproxy", url: "https://corsproxy.io/?", useJson: false },
    { name: "codetabs", url: "https://api.codetabs.com/v1/proxy?quest=", useJson: false },
    { name: "thingproxy", url: "https://thingproxy.freeboard.io/fetch/", useJson: false }
];

fs.writeFileSync('proxy-results.txt', '');

async function test() {
    for (const proxy of proxies) {
        fs.appendFileSync('proxy-results.txt', `\nTesting proxy: ${proxy.name}\n`);
        for (const feed of feeds) {
            const target = proxy.url + encodeURIComponent(feed);
            try {
                const r = await fetch(target, { signal: AbortSignal.timeout(10000) });
                if (!r.ok) {
                    fs.appendFileSync('proxy-results.txt', `  [FAIL] ${feed}: HTTP ${r.status}\n`);
                    continue;
                }
                let text;
                if (proxy.useJson) {
                    const j = await r.json();
                    text = j.contents;
                } else {
                    text = await r.text();
                }
                if (text && (text.includes("<rss") || text.includes("<feed") || text.includes("<xml"))) {
                    fs.appendFileSync('proxy-results.txt', `  [OK]   ${feed} (length: ${text.length})\n`);
                } else {
                    fs.appendFileSync('proxy-results.txt', `  [BAD]  ${feed}: Not XML\n`);
                }
            } catch (err) {
                fs.appendFileSync('proxy-results.txt', `  [ERR]  ${feed}: ${err.message}\n`);
            }
        }
    }
}

test();
