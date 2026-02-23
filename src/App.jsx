import { useState, useEffect, useCallback, useMemo } from "react";

const CODETABS = "https://api.codetabs.com/v1/proxy?quest=";
const CORSPROXY = "https://corsproxy.io/?";
const THINGPROXY = "https://thingproxy.freeboard.io/fetch/";

// Parse raw RSS/Atom XML into a list of article objects
function parseRSSXML(xmlText, src) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "text/xml");
  const items = Array.from(doc.querySelectorAll("item, entry")).slice(0, 8);
  return items.map(item => {
    const getText = tag => item.getElementsByTagName(tag)[0]?.textContent?.trim() || "";
    const title = getText("title");
    const link =
      item.getElementsByTagName("link")[0]?.getAttribute("href") ||
      getText("link");
    const description = getText("description") || getText("summary") || getText("content");
    const pubDate = getText("pubDate") || getText("published") || getText("updated");

    // Image: try media:content, enclosure, itunes:image, og:image encoded in content
    const mediaContent = item.getElementsByTagNameNS("http://search.yahoo.com/mrss/", "content")[0];
    const enclosure = item.getElementsByTagName("enclosure")[0];
    const itunesImage = item.getElementsByTagNameNS("http://www.itunes.com/dtds/podcast-1.0.dtd", "image")[0];
    let image =
      mediaContent?.getAttribute("url") ||
      enclosure?.getAttribute("url") ||
      itunesImage?.getAttribute("href") ||
      null;

    if (!image) {
      // Sometimes images are just inside a <media:thumbnail> tag without namespace prefix working well
      const thumbnail = item.getElementsByTagName("media:thumbnail")[0];
      if (thumbnail) image = thumbnail.getAttribute("url");
    }

    if (!image && description) {
      // try extracting img src from description html
      const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) image = imgMatch[1];
    }

    if (!image && IMAGE_CACHE.has(link)) {
      image = IMAGE_CACHE.get(link);
    }

    return {
      id: (link || title) + src.id,
      title: title.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#8217;/g, "'").replace(/&#8220;/g, '"').replace(/&#8221;/g, '"'),
      desc: stripHtml(description),
      link,
      image,
      imageLoading: !image && !IMAGE_CACHE.has(link),
      date: pubDate,
      sourceId: src.id,
      catId: src.cat,
      source: src,
    };
  }).filter(a => a.title && a.link);
}

// Fetch an RSS feed through a given proxy base URL.
async function fetchViaProxy(proxyUrl, feedUrl) {
  const url = proxyUrl + encodeURIComponent(feedUrl);
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}


// ── CATEGORIES ──────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: "all", label: "All News", icon: "📰", color: "#0d0d0d" },
  { id: "ai", label: "AI & LLMs", icon: "🤖", color: "#10a37f" },
  { id: "microsoft", label: "Microsoft", icon: "⊞", color: "#0078d4" },
  { id: "cloud", label: "Cloud", icon: "☁", color: "#ff9900" },
  { id: "devops", label: "DevOps", icon: "⚙", color: "#ff6b35" },
  { id: "enterprise", label: "Enterprise", icon: "🏢", color: "#607d8b" },
  { id: "security", label: "Security", icon: "🔐", color: "#cc0000" },
];

// ── FAVICON HELPER ───────────────────────────────────────────────────────────
const Favicon = ({ domain }) => (
  <img
    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
    alt=""
    style={{ width: '1em', height: '1em', borderRadius: '4px', objectFit: 'contain', verticalAlign: 'middle', display: 'inline-block' }}
  />
);

// ── SOURCES ──────────────────────────────────────────────────────────────────
const SOURCES = [
  // AI & LLMs
  { id: "openai", cat: "ai", label: "OpenAI", short: "OAI", url: "https://openai.com/blog/rss.xml", color: "#10a37f", bg: "#e8f7f3", logo: <Favicon domain="openai.com" /> },
  { id: "anthropic", cat: "ai", label: "Anthropic", short: "AC", url: "https://hnrss.org/newest?q=Anthropic", color: "#b05c2a", bg: "#f7ede5", logo: <Favicon domain="anthropic.com" /> },
  { id: "vergeai", cat: "ai", label: "The Verge AI", short: "VG", url: "https://www.theverge.com/rss/index.xml", color: "#e5192b", bg: "#fdeaeb", logo: <Favicon domain="theverge.com" /> },
  { id: "tcai", cat: "ai", label: "TechCrunch AI", short: "TC", url: "https://techcrunch.com/category/artificial-intelligence/feed/", color: "#0a8f08", bg: "#e7f4e7", logo: <Favicon domain="techcrunch.com" /> },
  // Microsoft
  { id: "msai", cat: "microsoft", label: "Microsoft AI", short: "MS", url: "https://blogs.microsoft.com/ai/feed/", color: "#0078d4", bg: "#e5f2fc", logo: <Favicon domain="microsoft.com" /> },
  { id: "azure", cat: "microsoft", label: "Azure", short: "AZ", url: "https://azure.microsoft.com/en-us/blog/feed/", color: "#0089d6", bg: "#e5f2fc", logo: <Favicon domain="azure.microsoft.com" /> },
  { id: "github", cat: "microsoft", label: "GitHub", short: "GH", url: "https://github.blog/all.atom", color: "#24292f", bg: "#f0f0f0", logo: <Favicon domain="github.com" /> },
  { id: "m365", cat: "microsoft", label: "M365 / Copilot", short: "M3", url: "https://www.microsoft.com/en-us/microsoft-365/blog/feed/", color: "#5c2d91", bg: "#f0eaf8", logo: <Favicon domain="microsoft.com" /> },
  // Cloud
  { id: "aws", cat: "cloud", label: "AWS", short: "AWS", url: "https://aws.amazon.com/blogs/aws/feed/", color: "#ff9900", bg: "#fff5e5", logo: <Favicon domain="aws.amazon.com" /> },
  { id: "gcloud", cat: "cloud", label: "Google Cloud", short: "GC", url: "https://feeds.feedburner.com/GoogleCloudPlatformBlog", color: "#4285f4", bg: "#eaf1ff", logo: <Favicon domain="cloud.google.com" /> },
  { id: "awssec", cat: "cloud", label: "AWS Security", short: "AWSs", url: "https://aws.amazon.com/blogs/security/feed/", color: "#e8691c", bg: "#fff0e8", logo: <Favicon domain="aws.amazon.com" /> },
  // DevOps
  { id: "devopsdotcom", cat: "devops", label: "DevOps.com", short: "DO", url: "https://devops.com/feed/", color: "#ff6b35", bg: "#fff0ea", logo: <Favicon domain="devops.com" /> },
  { id: "thenewstack", cat: "devops", label: "The New Stack", short: "NS", url: "https://thenewstack.io/feed/", color: "#1a1a2e", bg: "#eaeaf3", logo: <Favicon domain="thenewstack.io" /> },
  { id: "docker", cat: "devops", label: "Docker", short: "DK", url: "https://www.docker.com/blog/feed/", color: "#2496ed", bg: "#e8f3fc", logo: <Favicon domain="docker.com" /> },
  { id: "redhat", cat: "devops", label: "Red Hat", short: "RH", url: "https://www.redhat.com/en/rss/blog", color: "#cc0000", bg: "#fdeaea", logo: <Favicon domain="redhat.com" /> },
  // Enterprise
  { id: "cisco", cat: "enterprise", label: "Cisco", short: "CS", url: "https://blogs.cisco.com/feed", color: "#049fd9", bg: "#e5f6fd", logo: <Favicon domain="cisco.com" /> },
  { id: "adobe", cat: "enterprise", label: "Adobe", short: "AD", url: "https://blog.adobe.com/en/publish/feed.xml", color: "#fa0f00", bg: "#fde8e8", logo: <Favicon domain="adobe.com" /> },
  { id: "hpe", cat: "enterprise", label: "HPE", short: "HP", url: "https://hnrss.org/newest?q=Hewlett+Packard+Enterprise", color: "#01a982", bg: "#e5f7f3", logo: <Favicon domain="hpe.com" /> },
  { id: "veeam", cat: "enterprise", label: "Veeam", short: "VM", url: "https://www.veeam.com/blog/feed/", color: "#007db8", bg: "#e5f2f9", logo: <Favicon domain="veeam.com" /> },
  // Security
  { id: "paloalto", cat: "security", label: "Palo Alto", short: "PA", url: "https://www.paloaltonetworks.com/blog/feed/", color: "#fa582d", bg: "#fff0eb", logo: <Favicon domain="paloaltonetworks.com" /> },
  { id: "fortinet", cat: "security", label: "Fortinet", short: "FT", url: "https://www.fortinet.com/blog/rss.xml", color: "#ee3124", bg: "#fdecea", logo: <Favicon domain="fortinet.com" /> },
  { id: "krebs", cat: "security", label: "Krebs on Security", short: "KB", url: "https://krebsonsecurity.com/feed/", color: "#333", bg: "#f0f0f0", logo: <Favicon domain="krebsonsecurity.com" /> },
];

const POWER_FEATURES = [
  { id: "teams", icon: "💬", color: "#6264a7", bg: "#eef0f9", label: "Teams Alerts", desc: "Auto-post breaking news to your channel", badge: "Power Automate" },
  { id: "powerbi", icon: "📊", color: "#f2c811", bg: "#fef9e7", label: "Trends Dashboard", desc: "Live topic & source analytics in Power BI", badge: "Power BI" },
  { id: "powerapps", icon: "📌", color: "#742774", bg: "#f5ecf5", label: "Bookmarks", desc: "Tag & save articles via Power Apps", badge: "Power Apps" },
  { id: "digest", icon: "📧", color: "#0066ff", bg: "#e8f0ff", label: "Weekly Digest", desc: "Auto-email digest to department heads", badge: "Power Automate" },
];

// ── IMAGE FETCH QUEUE ────────────────────────────────────────────────────────
const IMAGE_CACHE = new Map();
const FETCH_QUEUE = [];
let isQueueRunning = false;

async function processImageCacheQueue(onUpdate) {
  if (isQueueRunning) return;
  isQueueRunning = true;

  while (FETCH_QUEUE.length > 0) {
    const batch = FETCH_QUEUE.splice(0, 5);
    await Promise.all(batch.map(async (item) => {
      const { id, link } = item;
      try {
        const proxyUrl = CODETABS + encodeURIComponent(link);
        const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error("fetch failed");
        const html = await r.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        let img = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
          doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
          doc.querySelector('article img, .post-thumbnail img, .featured-image img')?.getAttribute('src');

        if (img && img.startsWith('/')) {
          const urlObj = new URL(link);
          img = urlObj.origin + img;
        }

        IMAGE_CACHE.set(link, img || null);
        onUpdate(id, img || null);
      } catch (e) {
        IMAGE_CACHE.set(link, null);
        onUpdate(id, null);
      }
    }));
  }

  isQueueRunning = false;
}

// ─────────────────────────────────────────────────────────────────────────────

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,400&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --ink:   #0d0d0d;
    --ink2:  #2c2c2c;
    --muted: #6b7280;
    --light: #f5f3ef;
    --white: #ffffff;
    --rule:  #e2ddd6;
    --ms:    #0078d4;
    --font-serif: 'Playfair Display', Georgia, serif;
    --font-sans:  'IBM Plex Sans', sans-serif;
    --font-mono:  'IBM Plex Mono', monospace;
  }

  body { background: var(--light); }
  .app { font-family: var(--font-sans); background: var(--light); min-height: 100vh; color: var(--ink); }

  /* ── MASTHEAD ─────────────────────────────────────────── */
  .masthead {
    background: var(--ink); color: #fff;
    padding: 16px 24px 12px; text-align: center;
    border-bottom: 4px solid var(--ms);
  }
  .masthead-eye {
    font: 500 9px/1 var(--font-mono); letter-spacing: 3px;
    text-transform: uppercase; color: rgba(255,255,255,0.35); margin-bottom: 8px;
  }
  .masthead-title {
    font: 900 clamp(24px,5vw,58px)/1 var(--font-serif); letter-spacing: -1px;
  }
  .masthead-title em { font-style: italic; color: var(--ms); }
  .masthead-divider {
    display: flex; align-items: center; gap: 16px; margin-top: 8px; justify-content: center;
  }
  .masthead-line { flex: 1; max-width: 100px; height: 1px; background: rgba(255,255,255,0.12); }
  .masthead-sub { font: 400 9px/1 var(--font-mono); letter-spacing: 2px; color: rgba(255,255,255,0.3); text-transform: uppercase; }

  /* ── PARTNER LOGOS BAR ──────────────────────────────────── */
  .partner-bar {
    background: var(--white); border-bottom: 1px solid var(--rule);
    overflow-x: auto; scrollbar-width: none;
  }
  .partner-bar::-webkit-scrollbar { display: none; }
  .partner-bar-inner {
    max-width: 1280px; margin: 0 auto; padding: 0 24px;
    display: flex; align-items: center; gap: 0; min-width: max-content;
  }
  .partner-label {
    font: 600 8px/1 var(--font-mono); letter-spacing: 2px; text-transform: uppercase;
    color: var(--muted); padding: 10px 16px 10px 0; border-right: 1px solid var(--rule);
    margin-right: 16px; white-space: nowrap; flex-shrink: 0;
  }
  .partner-logo {
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 8px 14px; border-right: 1px solid var(--rule); cursor: pointer;
    transition: background 0.15s, border-bottom-color 0.15s; flex-shrink: 0; min-width: 90px;
    border-bottom: 2px solid transparent;
  }
  .partner-logo:hover { background: var(--light); border-bottom-color: var(--partner-color, var(--ms)); }
  .partner-logo.active { background: var(--light); border-bottom-color: var(--partner-color, var(--ms)); }
  .partner-logo-icon {
    width: 28px; height: 28px; border-radius: 6px; display: flex; align-items: center;
    justify-content: center; font-size: 14px; border: 1px solid var(--rule);
  }
  .partner-logo-name { font: 600 9px/1 var(--font-sans); color: var(--muted); text-transform: none; letter-spacing: 0.2px; white-space: nowrap; }
  .partner-logo.active .partner-logo-name { color: var(--ink); }

  /* ── CATEGORY NAV ───────────────────────────────────────── */
  .cat-nav {
    background: var(--white); border-bottom: 3px solid var(--ink);
    position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  .cat-nav-inner {
    max-width: 1280px; margin: 0 auto; padding: 0 24px;
    display: flex; align-items: stretch; justify-content: space-between; height: 46px;
  }
  .cat-tabs { display: flex; overflow-x: auto; scrollbar-width: none; }
  .cat-tabs::-webkit-scrollbar { display: none; }
  .cat-tab {
    display: flex; align-items: center; gap: 6px; padding: 0 16px;
    font: 600 10px/1 var(--font-sans); text-transform: uppercase; letter-spacing: 0.6px;
    cursor: pointer; border: none; background: transparent; color: var(--muted);
    border-bottom: 3px solid transparent; margin-bottom: -3px;
    transition: color 0.15s; white-space: nowrap; flex-shrink: 0;
  }
  .cat-tab:hover { color: var(--ink); }
  .cat-tab.active { color: var(--ink); }
  .cat-icon { font-size: 12px; }
  .cat-count {
    padding: 1px 5px; border-radius: 8px;
    font: 500 8px/14px var(--font-mono); background: var(--light); color: var(--muted);
  }
  .cat-tab.active .cat-count { color: #fff; }

  .nav-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .date-stamp { font: 400 9px/1 var(--font-mono); color: var(--muted); letter-spacing: 0.5px; white-space: nowrap; }
  .refresh-btn {
    background: var(--ink); color: #fff; border: none; padding: 7px 14px; border-radius: 2px;
    font: 600 8px/1 var(--font-mono); letter-spacing: 1.5px; text-transform: uppercase;
    cursor: pointer; display: flex; align-items: center; gap: 5px; transition: opacity 0.2s; white-space: nowrap;
  }
  .refresh-btn:hover { opacity: 0.75; }
  .refresh-btn.spin svg { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── TICKER ─────────────────────────────────────────────── */
  .ticker { background: var(--ms); height: 28px; display: flex; align-items: center; overflow: hidden; }
  .ticker-badge {
    background: var(--ink); color: #fff; height: 100%; padding: 0 14px;
    font: 600 8px/1 var(--font-mono); letter-spacing: 2px; text-transform: uppercase;
    display: flex; align-items: center; flex-shrink: 0; white-space: nowrap;
  }
  .ticker-scroll { flex: 1; overflow: hidden; }
  .ticker-track { display: flex; gap: 48px; white-space: nowrap; padding-left: 32px; animation: scrolltick 80s linear infinite; }
  @keyframes scrolltick { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  .t-item { font: 400 11px/1 var(--font-sans); color: #fff; opacity: 0.9; display: flex; align-items: center; gap: 8px; }
  .t-sep { opacity: 0.3; font-size: 8px; }

  /* ── POWER PLATFORM BANNER ──────────────────────────────── */
  .pp-banner { background: var(--ink); }
  .pp-inner { max-width: 1280px; margin: 0 auto; display: grid; grid-template-columns: repeat(4,1fr); }
  .pp-card {
    padding: 14px 18px; border-right: 1px solid rgba(255,255,255,0.07);
    display: flex; gap: 10px; align-items: flex-start; cursor: pointer;
    transition: background 0.15s;
  }
  .pp-card:last-child { border-right: none; }
  .pp-card:hover { background: rgba(255,255,255,0.04); }
  .pp-icon { width: 34px; height: 34px; border-radius: 6px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 15px; }
  .pp-body {}
  .pp-badge { font: 500 7px/1 var(--font-mono); letter-spacing: 1px; text-transform: uppercase; color: rgba(255,255,255,0.3); margin-bottom: 4px; }
  .pp-label { font: 600 12px/1 var(--font-sans); color: #fff; margin-bottom: 3px; }
  .pp-desc { font: 300 10px/1.5 var(--font-sans); color: rgba(255,255,255,0.4); }
  .pp-action { font: 600 8px/1 var(--font-mono); letter-spacing: 1px; text-transform: uppercase; margin-top: 7px; display: inline-flex; align-items: center; gap: 3px; }

  /* ── PAGE LAYOUT ────────────────────────────────────────── */
  .page { max-width: 1280px; margin: 0 auto; padding: 0 24px; }

  .shell {
    display: grid; grid-template-columns: 1fr 268px; gap: 0; margin: 20px 0 48px;
    background: var(--white); border: 1px solid var(--rule); border-radius: 2px; overflow: hidden;
  }
  .col-main { border-right: 1px solid var(--rule); min-width: 0; }

  /* Issue bar */
  .issue-bar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 20px; background: var(--light); border-bottom: 1px solid var(--rule);
  }
  .issue-l { font: 400 9px/1 var(--font-mono); color: var(--muted); text-transform: uppercase; letter-spacing: 1px; }
  .issue-r { display: flex; align-items: center; gap: 6px; font: 400 9px/1 var(--font-mono); color: var(--muted); }
  .live-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 5px #22c55e; animation: blink 2s infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }

  /* Hero */
  .hero {
    display: flex; flex-direction: column;
    border: 1px solid var(--rule); border-radius: 8px; margin-bottom: 24px;
    text-decoration: none; color: inherit; cursor: pointer; transition: box-shadow 0.2s, transform 0.2s;
    overflow: hidden; background: var(--white);
  }
  .hero:hover { box-shadow: 0 8px 16px rgba(0,0,0,0.06); transform: translateY(-2px); }
  .hero-img-container { width: 100%; aspect-ratio: 16/9; background: var(--light); position: relative; }
  .hero-img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hero-content { padding: 24px; flex: 1; display: flex; flex-direction: column; justify-content: center; }
  .hero-kicker {
    font: 600 9px/1 var(--font-mono); letter-spacing: 2px; text-transform: uppercase;
    margin-bottom: 14px; display: flex; align-items: center; gap: 8px;
  }
  .hero-title { font: 900 clamp(20px, 4vw, 28px)/1.2 var(--font-serif); letter-spacing: -0.5px; margin-bottom: 12px; }
  .hero-excerpt { font: 300 13px/1.65 var(--font-sans); color: var(--ink2); margin-bottom: 16px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .hero-meta { display: flex; gap: 8px; align-items: center; font: 400 9px/1 var(--font-mono); color: var(--muted); text-transform: uppercase; margin-top: auto; }
  .m-sep { color: var(--rule); }

  /* Section Headers */
  .cat-group-header {
    background: var(--light); padding: 8px 16px; margin: 32px 0 16px;
    display: inline-flex; align-items: center; gap: 8px; border-radius: 0 4px 4px 0;
    font: 600 11px/1 var(--font-sans); text-transform: uppercase; letter-spacing: 1px; color: var(--ink);
    border-left: 4px solid var(--cat-color);
  }
  .cgh-count { font: 400 9px/1 var(--font-mono); color: var(--muted); background: var(--white); padding: 2px 6px; border-radius: 4px; margin-left: 8px; }

  /* Article grid */
  .art-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px; }
  .art-card {
    border: 1px solid var(--rule); border-radius: 8px; border-top: 3px solid var(--src-color);
    text-decoration: none; color: inherit; display: flex; flex-direction: column; cursor: pointer;
    transition: box-shadow 0.2s, transform 0.2s; background: var(--white); overflow: hidden; position: relative;
  }
  .art-card:hover { box-shadow: 0 6px 12px rgba(0,0,0,0.05); transform: translateY(-2px); }
  .art-card:hover .art-arr { opacity: 1; transform: translate(0, 0); }
  .art-thumbnail { width: 100%; height: 140px; background: var(--light); position: relative; }
  .art-img { width: 100%; height: 100%; object-fit: cover; }
  .art-body { padding: 16px; flex: 1; display: flex; flex-direction: column; }
  .art-arr { position: absolute; top: 12px; right: 12px; font-size: 11px; color: rgba(255,255,255,0.8); opacity: 0; transform: translate(-4px, 4px); transition: all 0.2s; background: rgba(0,0,0,0.3); width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 50%; backdrop-filter: blur(4px); }
  .art-src { display: inline-flex; align-items: center; gap: 5px; font: 600 8px/1 var(--font-mono); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  .a-dot { width: 5px; height: 5px; border-radius: 50%; }
  .art-title { font: 700 14px/1.3 var(--font-serif); color: var(--ink); margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .art-desc { font: 300 11px/1.5 var(--font-sans); color: var(--muted); margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; flex: 1; }
  .art-meta { font: 400 8px/1 var(--font-mono); color: var(--muted); text-transform: uppercase; letter-spacing: .5px; margin-top: auto; }

  /* Load More */
  .load-more-wrap { display: flex; justify-content: center; padding: 16px 0 32px; border-top: 1px solid var(--rule); margin-top: 16px; }
  .load-more-btn {
    background: var(--white); border: 1px solid var(--rule); padding: 10px 24px; border-radius: 20px;
    font: 600 9px/1 var(--font-mono); text-transform: uppercase; letter-spacing: 1.5px; color: var(--ink);
    cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.02);
  }
  .load-more-btn:hover { border-color: var(--ms); color: var(--ms); box-shadow: 0 4px 8px rgba(0,120,212,0.1); transform: translateY(-1px); }

  /* Shimmer & Placeholders */
  .img-shimmer {
    width: 100%; height: 100%;
    background: linear-gradient(90deg, var(--light) 25%, #e2ddd6 50%, var(--light) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  .ph-grid {
    position: absolute; inset: 0; opacity: 0.15;
    background-image: linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px);
    background-size: 20px 20px; z-index: 0;
  }
  .ph-logo { font-size: 32px; z-index: 1; margin-bottom: 8px; display: block; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.15)); }
  .ph-name { font: 600 12px/1 var(--font-sans); color: #fff; z-index: 1; letter-spacing: 0.5px; text-align: center; padding: 0 10px; }
  .art-ph, .hero-ph { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; overflow: hidden; }

  /* ── SIDEBAR ────────────────────────────────────────────── */
  .sidebar { }
  .sb { padding: 16px 14px; border-bottom: 1px solid var(--rule); }
  .sb-head {
    font: 600 8px/1 var(--font-mono); text-transform: uppercase; letter-spacing: 2px;
    color: var(--muted); margin-bottom: 12px; display: flex; align-items: center; gap: 8px;
  }
  .sb-head::after { content:''; flex:1; height:1px; background: var(--rule); }

  /* Category bars */
  .cat-bars { display: flex; flex-direction: column; gap: 9px; }
  .cat-bar-row { display: flex; flex-direction: column; gap: 3px; }
  .cat-bar-top { display: flex; justify-content: space-between; }
  .cb-name { font: 500 10px/1 var(--font-sans); color: var(--ink2); }
  .cb-num { font: 400 10px/1 var(--font-mono); color: var(--muted); }
  .bar-track { height: 3px; background: var(--rule); border-radius: 2px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease; }

  /* Partner list */
  .partner-list { display: flex; flex-direction: column; }
  .pl-item {
    display: flex; align-items: center; gap: 8px; padding: 7px 0;
    border-bottom: 1px solid var(--rule); cursor: pointer; transition: color 0.15s;
  }
  .pl-item:last-child { border-bottom: none; }
  .pl-item:hover .pl-name { color: var(--ms); }
  .pl-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .pl-name { font: 400 11px/1 var(--font-sans); color: var(--ink2); flex: 1; }
  .pl-cat { font: 400 8px/1 var(--font-mono); color: var(--muted); }
  .pl-count { font: 400 9px/1 var(--font-mono); color: var(--muted); }

  /* Teams CTA */
  .teams-cta { background: #f0f3ff; }
  .cta-desc { font: 300 11px/1.6 var(--font-sans); color: var(--muted); margin-bottom: 10px; }
  .teams-btn {
    width: 100%; background: #6264a7; color: #fff; border: none; padding: 8px;
    border-radius: 2px; font: 600 9px/1 var(--font-mono); letter-spacing: 1.5px;
    text-transform: uppercase; cursor: pointer; display: flex; align-items: center;
    justify-content: center; gap: 6px; transition: opacity 0.2s;
  }
  .teams-btn:hover { opacity: .85; }

  /* MS Resource links */
  .res-links { display: flex; flex-direction: column; }
  .res-link {
    display: flex; align-items: center; gap: 8px; padding: 8px 0;
    border-bottom: 1px solid var(--rule); text-decoration: none; color: var(--ink2);
    cursor: pointer; transition: color 0.15s;
  }
  .res-link:last-child { border-bottom: none; }
  .res-link:hover { color: var(--ms); }
  .res-ico { width: 24px; height: 24px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
  .res-body { flex: 1; }
  .res-name { font: 500 11px/1 var(--font-sans); }
  .res-sub { font: 300 9px/1 var(--font-mono); color: var(--muted); margin-top: 2px; }
  .res-arr { font-size: 10px; color: var(--muted); }

  /* Skeleton */
  .skel { background: var(--rule); border-radius: 2px; animation: sh 1.5s infinite; }
  @keyframes sh { 0%,100%{opacity:.5} 50%{opacity:1} }

  /* Warn banner */
  .warn { margin: 12px 0 -8px; padding: 7px 12px; background: #fff8e1; border: 1px solid #f6d860; border-radius: 2px; font: 400 9px/1.4 var(--font-mono); color: #856404; letter-spacing: .5px; }

  /* ── RESPONSIVE ─────────────────────────────────────────────────────────── */

  /* Desktop: > 1200px — keep existing layout; sidebar visible */
  @media (min-width: 1201px) {
    .hero { flex-direction: row; }
    .hero-img-container { width: 50%; height: auto; }
    .hero-content { width: 50%; }
  }

  /* Tablet: 768px – 1200px */
  @media (max-width: 1200px) and (min-width: 768px) {
    .shell { grid-template-columns: 1fr; }
    .sidebar { display: none; }
    .pp-inner { grid-template-columns: 1fr 1fr; }
    .pp-card { border-bottom: 1px solid rgba(255,255,255,0.07); }
    .art-grid { grid-template-columns: repeat(2, 1fr); }
    /* Partner bar: allow horizontal scroll, but items still fit in a bar */
    .partner-bar-inner { min-width: max-content; }
    
    .hero { flex-direction: row; }
    .hero-img-container { width: 50%; height: auto; }
    .hero-content { width: 50%; }
  }

  /* Mobile: < 768px */
  @media (max-width: 767px) {
    /* Masthead */
    .masthead { padding: 12px 12px 10px; }
    .masthead-title { font-size: clamp(22px, 8vw, 36px); letter-spacing: -0.5px; }
    .masthead-sub { font-size: 8px; letter-spacing: 1px; }

    /* Partner bar: horizontal scroll with hidden scrollbar */
    .partner-bar { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .partner-bar-inner {
      min-width: max-content;
      padding: 0 12px;
      display: flex;
      flex-wrap: nowrap;
    }
    .partner-label { display: none; }
    .partner-logo { min-width: 70px; padding: 6px 10px; }

    /* Category tabs: horizontal scroll, no scrollbar */
    .cat-nav-inner { padding: 0 8px; gap: 4px; }
    .cat-tabs { overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .cat-tabs::-webkit-scrollbar { display: none; }
    .cat-tab { padding: 0 10px; font-size: 9px; }
    .date-stamp { display: none; }

    /* Power Platform banner: 1 column */
    .pp-inner {
      grid-template-columns: 1fr;
      /* Force all 4 cards to stack */
    }
    .pp-card { border-right: none; border-bottom: 1px solid rgba(255,255,255,0.07); }
    .pp-card:last-child { border-bottom: none; }

  /* Article grid: 1 column */
    .art-grid { grid-template-columns: 1fr; }
    .art-card { border-right: 1px solid var(--rule); }
    .hero { flex-direction: column; }
    .hero-img-container { width: 100%; aspect-ratio: 16/9; }
    .hero-content { width: 100%; padding: 16px; }

    /* Main layout shell */
    .shell { grid-template-columns: 1fr; }
    .sidebar { display: none; }
    .page { padding: 0 10px; }

    /* Issue bar */
    .issue-bar { flex-direction: column; align-items: flex-start; gap: 4px; padding: 8px 12px; }
  }
`;

// ── HELPERS ───────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  const s = (Date.now() - d) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function stripHtml(h = "") {
  return h.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
}

// ── MS RESOURCES ──────────────────────────────────────────────────────────────
const MS_RES = [
  { name: "Copilot Studio", sub: "Build custom copilots", ico: "🤖", bg: "#e5f2fc", color: "#0078d4" },
  { name: "Azure OpenAI", sub: "GPT-4o on Azure", ico: "☁", bg: "#e5f2fc", color: "#0089d6" },
  { name: "Power Platform", sub: "Admin center", ico: "⚡", bg: "#f5ecf5", color: "#742774" },
  { name: "GitHub Copilot", sub: "AI pair programmer", ico: "◎", bg: "#f0f0f0", color: "#24292f" },
  { name: "Partner Hub", sub: "MS Partner resources", ico: "🤝", bg: "#e5f2fc", color: "#0078d4" },
];

// ── SIDEBAR ───────────────────────────────────────────────────────────────────
function Sidebar({ articles, activeCat }) {
  const cats = CATEGORIES.filter(c => c.id !== "all");
  const maxCat = Math.max(...cats.map(c => articles.filter(a => a.catId === c.id).length), 1);

  const topSources = useMemo(() =>
    SOURCES.map(s => ({ ...s, count: articles.filter(a => a.sourceId === s.id).length }))
      .filter(s => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 12),
    [articles]);

  return (
    <div className="sidebar">
      {/* Category breakdown */}
      <div className="sb">
        <div className="sb-head">By Category</div>
        <div className="cat-bars">
          {cats.map(c => {
            const count = articles.filter(a => a.catId === c.id).length;
            return (
              <div key={c.id} className="cat-bar-row">
                <div className="cat-bar-top">
                  <span className="cb-name">{c.icon} {c.label}</span>
                  <span className="cb-num">{count}</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(count / maxCat) * 100}%`, background: c.color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Partner sources */}
      <div className="sb">
        <div className="sb-head">Partner Sources</div>
        <div className="partner-list">
          {topSources.map(s => (
            <div key={s.id} className="pl-item">
              <span className="pl-dot" style={{ background: s.color }} />
              <span className="pl-name">{s.label}</span>
              <span className="pl-cat">{CATEGORIES.find(c => c.id === s.cat)?.icon}</span>
              <span className="pl-count">{s.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Teams CTA */}
      <div className="sb teams-cta">
        <div className="sb-head" style={{ color: "#6264a7" }}>Quick Action</div>
        <div className="cta-desc">Share today's top story to your Teams software channel</div>
        <button className="teams-btn">💬 Share to Teams</button>
      </div>

      {/* MS Resources */}
      <div className="sb">
        <div className="sb-head">Microsoft Resources</div>
        <div className="res-links">
          {MS_RES.map(r => (
            <div key={r.name} className="res-link">
              <div className="res-ico" style={{ background: r.bg, color: r.color }}>{r.ico}</div>
              <div className="res-body">
                <div className="res-name">{r.name}</div>
                <div className="res-sub">{r.sub}</div>
              </div>
              <span className="res-arr">→</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── APP ───────────────────────────────────────────────────────────────────────
export default function TechHub() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [activeCat, setActiveCat] = useState("all");
  const [activeSource, setActiveSource] = useState("all");
  const [failed, setFailed] = useState([]);
  const [visibleCount, setVisibleCount] = useState(24);

  const fetchAll = useCallback(async () => {
    setSpinning(true);
    const errs = [];
    const results = await Promise.allSettled(
      SOURCES.map(async (src) => {
        let xmlText = null;
        // Primary: codetabs
        try {
          xmlText = await fetchViaProxy(CODETABS, src.url);
        } catch {
          // Fallback 1: corsproxy
          try {
            xmlText = await fetchViaProxy(CORSPROXY, src.url);
          } catch {
            // Fallback 2: thingproxy
            try {
              xmlText = await fetchViaProxy(THINGPROXY, src.url);
            } catch {
              errs.push(src.label);
              return [];
            }
          }
        }
        try {
          return parseRSSXML(xmlText, src);
        } catch {
          errs.push(src.label);
          return [];
        }
      })
    );
    const all = results
      .filter(r => r.status === "fulfilled")
      .flatMap(r => r.value)
      .filter(a => a.title)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    setArticles(all);
    setFailed(errs);
    setLoading(false);
    setSpinning(false);
    setVisibleCount(24); // reset on refresh

    // Enqueue missing images
    all.forEach(a => {
      if (a.imageLoading && !IMAGE_CACHE.has(a.link) && !FETCH_QUEUE.some(q => q.link === a.link)) {
        FETCH_QUEUE.push({ id: a.id, link: a.link });
      }
    });

    processImageCacheQueue((id, img) => {
      setArticles(prev => prev.map(pa => pa.id === id ? { ...pa, image: img || pa.image, imageLoading: false } : pa));
    });
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Handle Category/Source Changes - Reset pagination
  const handleCatChange = (catId) => {
    setActiveCat(catId);
    setActiveSource("all");
    setVisibleCount(24);
  };

  const handleSourceChange = (srcId, srcCat) => {
    if (activeSource === srcId) {
      setActiveSource("all");
      setActiveCat("all");
    } else {
      setActiveSource(srcId);
      setActiveCat(srcCat);
    }
    setVisibleCount(24);
  };

  // Compute visible articles
  const filtered = useMemo(() => {
    let list = articles;
    if (activeCat !== "all") list = list.filter(a => a.catId === activeCat);
    if (activeSource !== "all") list = list.filter(a => a.sourceId === activeSource);

    // Limit to 6 articles per source max in the filtered feed to ensure variety
    const sourceCounts = {};
    list = list.filter(a => {
      sourceCounts[a.sourceId] = (sourceCounts[a.sourceId] || 0) + 1;
      return sourceCounts[a.sourceId] <= 6;
    });

    return list;
  }, [articles, activeCat, activeSource]);

  const pagedList = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  // Sources for current category
  const stripSources = activeCat === "all" ? SOURCES : SOURCES.filter(s => s.cat === activeCat);

  // Per-category counts
  const catCounts = useMemo(() =>
    CATEGORIES.reduce((acc, c) => { acc[c.id] = articles.filter(a => a.catId === c.id).length; return acc; }, {}),
    [articles]);

  const hero = filtered[0];
  const rest = filtered.slice(1);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const todayCount = articles.filter(a => (Date.now() - new Date(a.date)) < 86400000).length;

  return (
    <>
      <style>{styles}</style>
      <div className="app">

        {/* Masthead */}
        <div className="masthead">
          <div className="masthead-eye">Software Team · Tech Intelligence Feed</div>
          <div className="masthead-title">ACME <em>AI Daily</em></div>
          <div className="masthead-divider">
            <div className="masthead-line" />
            <div className="masthead-sub">AI · Microsoft · Cloud · DevOps · Enterprise · Security — Live</div>
            <div className="masthead-line" />
          </div>
        </div>

        {/* Partner logos bar */}
        <div className="partner-bar">
          <div className="partner-bar-inner">
            <div className="partner-label">Partners</div>
            {SOURCES.map(s => (
              <div
                key={s.id}
                className={`partner-logo ${activeSource === s.id ? "active" : ""}`}
                style={{ "--partner-color": s.color }}
                onClick={() => handleSourceChange(s.id, s.cat)}
                title={s.label}
              >
                <div className="partner-logo-icon" style={{ background: s.bg, color: s.color }}>{s.logo}</div>
                <div className="partner-logo-name">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Category Nav */}
        <div className="cat-nav">
          <div className="cat-nav-inner">
            <div className="cat-tabs">
              {CATEGORIES.map(c => (
                <button
                  key={c.id}
                  className={`cat-tab ${activeCat === c.id ? "active" : ""}`}
                  style={activeCat === c.id ? { borderBottomColor: c.color, color: c.id === "all" ? "var(--ink)" : c.color } : {}}
                  onClick={() => handleCatChange(c.id)}
                >
                  <span className="cat-icon">{c.icon}</span>
                  {c.label}
                  <span className="cat-count"
                    style={activeCat === c.id ? { background: c.color === "#0d0d0d" ? "var(--ink)" : c.color } : {}}>
                    {c.id === "all" ? articles.length : catCounts[c.id] || 0}
                  </span>
                </button>
              ))}
            </div>
            <div className="nav-actions">
              <span className="date-stamp">{today}</span>
              <button className={`refresh-btn ${spinning ? "spin" : ""}`} onClick={fetchAll}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Ticker */}
        {articles.length > 0 && (
          <div className="ticker">
            <div className="ticker-badge">Live</div>
            <div className="ticker-scroll">
              <div className="ticker-track">
                {[...articles.slice(0, 14), ...articles.slice(0, 14)].map((a, i) => (
                  <span key={i} className="t-item">
                    <span style={{ color: a.source.color, fontSize: 7 }}>●</span>
                    <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 8 }}>[{a.source.label}]</span>
                    {a.title.slice(0, 75)}{a.title.length > 75 ? "…" : ""}
                    <span className="t-sep">◆</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Power Platform Banner */}
        <div className="pp-banner">
          <div className="pp-inner">
            {POWER_FEATURES.map(f => (
              <div key={f.id} className="pp-card">
                <div className="pp-icon" style={{ background: f.bg, color: f.color }}>{f.icon}</div>
                <div className="pp-body">
                  <div className="pp-badge">{f.badge}</div>
                  <div className="pp-label">{f.label}</div>
                  <div className="pp-desc">{f.desc}</div>
                  <div className="pp-action" style={{ color: f.color }}>Configure →</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="page">
          {failed.length > 0 && (
            <div className="warn">⚠ Feeds unavailable: {failed.join(", ")} — other sources loading fine</div>
          )}

          <div className="shell">
            <div className="col-main">
              {/* Issue bar */}
              <div className="issue-bar">
                <span className="issue-l">{today}</span>
                <span className="issue-r">
                  <span className="live-dot" />
                  {loading ? "Fetching feeds…" : `${todayCount} new today · ${filtered.length} total articles`}
                </span>
              </div>

              {loading ? (
                <div style={{ padding: 28 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ marginBottom: 26 }}>
                      <div className="skel" style={{ width: 90, height: 9, marginBottom: 12 }} />
                      <div className="skel" style={{ width: "78%", height: 26, marginBottom: 8 }} />
                      <div className="skel" style={{ width: "55%", height: 26, marginBottom: 14 }} />
                      <div className="skel" style={{ width: "100%", height: 12, marginBottom: 6 }} />
                      <div className="skel" style={{ width: "70%", height: 12 }} />
                    </div>
                  ))}
                </div>
              ) : !hero ? (
                <div style={{ padding: 28, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>
                  No articles found. Try selecting a different category or refreshing.
                </div>
              ) : (
                <>
                  {/* Hero */}
                  <a className="hero" href={hero.link} target="_blank" rel="noopener noreferrer">
                    <div className="hero-img-container">
                      {hero.image ? (
                        <img className="hero-img" src={hero.image} alt="" onError={e => { e.target.style.display = "none"; }} />
                      ) : hero.imageLoading ? (
                        <div className="img-shimmer" />
                      ) : (
                        <div className="hero-ph" style={{ background: hero.source.color }}>
                          <div className="ph-grid" />
                          <div className="ph-logo" style={{ fontSize: 48 }}>{hero.source.logo}</div>
                          <div className="ph-name" style={{ fontSize: 16 }}>{hero.source.label}</div>
                        </div>
                      )}
                    </div>
                    <div className="hero-content">
                      <div className="hero-kicker" style={{ color: hero.source.color }}>
                        <span>{hero.source.logo} {hero.source.label}</span>
                        <span className="h-kl" />
                        <span style={{ color: "var(--muted)" }}>
                          Top Story · {CATEGORIES.find(c => c.id === hero.catId)?.label}
                        </span>
                      </div>
                      <div className="hero-title">{hero.title}</div>
                      {hero.desc && <div className="hero-excerpt">{hero.desc}</div>}
                      <div className="hero-meta">
                        <span style={{ color: hero.source.color }}>● {hero.source.label}</span>
                        <span className="m-sep">·</span>
                        <span>{timeAgo(hero.date)}</span>
                        <span className="m-sep">·</span>
                        <span>Read full story →</span>
                      </div>
                    </div>
                  </a>

                  {/* Grid / Groups */}
                  {activeCat === "all" ? (
                    CATEGORIES.filter(c => c.id !== "all").map(cat => {
                      const catArts = pagedList.slice(1).filter(a => a.catId === cat.id);
                      if (catArts.length === 0) return null;
                      return (
                        <div key={cat.id}>
                          <div className="cat-group-header" style={{ "--cat-color": cat.color }}>
                            <span>{cat.icon}</span> {cat.label}
                            <span className="cgh-count">{catArts.length}</span>
                          </div>
                          <div className="art-grid">
                            {catArts.map(a => renderArticleCard(a))}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="art-grid">
                      {pagedList.slice(1).map(a => renderArticleCard(a))}
                    </div>
                  )}

                  {/* Load More */}
                  {hasMore && (
                    <div className="load-more-wrap">
                      <button className="load-more-btn" onClick={() => setVisibleCount(v => v + 24)}>
                        Load More Articles
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <Sidebar articles={articles} activeCat={activeCat} />
          </div>
        </div>
      </div>
    </>
  );

  function renderArticleCard(a) {
    return (
      <a key={a.id} className="art-card" href={a.link} target="_blank" rel="noopener noreferrer" style={{ "--src-color": a.source.color }}>
        <div className="art-thumbnail">
          {a.image ? (
            <img className="art-img" src={a.image} alt="" onError={e => { e.target.style.display = "none"; }} />
          ) : a.imageLoading ? (
            <div className="img-shimmer" />
          ) : (
            <div className="art-ph" style={{ background: a.source.color }}>
              <div className="ph-grid" />
              <div className="ph-logo">{a.source.logo}</div>
              <div className="ph-name">{a.source.label}</div>
            </div>
          )}
          <span className="art-arr">↗</span>
        </div>
        <div className="art-body">
          <div className="art-src" style={{ color: a.source.color }}>
            <span className="a-dot" style={{ background: a.source.color }} />
            {a.source.label}
            <span style={{ color: "var(--muted)", marginLeft: 4, fontWeight: 400 }}>
              {CATEGORIES.find(c => c.id === a.catId)?.icon}
            </span>
          </div>
          <div className="art-title" title={a.title}>{a.title}</div>
          {a.desc && <div className="art-desc" title={a.desc}>{a.desc}</div>}
          <div className="art-meta">{timeAgo(a.date)}</div>
        </div>
      </a>
    );
  }
}
