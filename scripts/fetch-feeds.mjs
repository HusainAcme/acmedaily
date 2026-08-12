#!/usr/bin/env node
// Prefetches every source server-side and writes public/feeds.json.
//
// This runs in GitHub Actions on a schedule, which is what lets the browser
// app skip CORS proxies entirely: it just loads one static JSON file. The
// `generatedAt` stamp written here is the "last refreshed" time the UI shows,
// so it reflects when the data was actually gathered — not when a tab asked.

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

import { SOURCES, REFRESH_INTERVAL_MINUTES } from "../src/sources.js";
import {
  generateWeeklySummary,
  buildSampleSummary,
  summaryIsFresh,
} from "./weekly-summary.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = resolve(ROOT, "public/feeds.json");
const IMAGE_CACHE_FILE = resolve(ROOT, ".cache/images.json");
const ARCHIVE_FILE = resolve(ROOT, ".cache/archive.json");

// An RSS feed only carries its publisher's most recent items — for a busy site
// like The Verge that is under a day. The weekly summary therefore cannot be
// built from one fetch; we accumulate across runs and keep three weeks.
const ARCHIVE_DAYS = 21;

const ITEMS_PER_FEED = 12;
const FEED_TIMEOUT_MS = 20000;
const FEED_ATTEMPTS = 2;
const IMAGE_TIMEOUT_MS = 10000;
const IMAGE_CONCURRENCY = 8;
const MAX_IMAGE_SCRAPES_PER_RUN = 120;
const NULL_IMAGE_RETRY_MS = 7 * 24 * 60 * 60 * 1000; // re-try a miss after a week

// Plain browser-ish headers. Several of these publishers reject the default
// Node user agent outright, which is a big part of why the client-side
// version saw feeds "unavailable".
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
});

// ── small helpers ────────────────────────────────────────────────────────────

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", bull: "•", copy: "©", reg: "®",
  trade: "™", eacute: "é", egrave: "è", uuml: "ü", ouml: "ö", auml: "ä",
};

function decodeEntities(s = "") {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function safeCodePoint(n) {
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

function stripHtml(h = "") {
  return decodeEntities(String(h).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// fast-xml-parser gives back a string for simple tags, but an object with a
// `#text` key when the tag also carries attributes. Normalise both.
function text(node) {
  if (node == null) return "";
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === "object") return text(node["#text"]);
  return String(node).trim();
}

function attr(node, name) {
  if (node == null) return "";
  if (Array.isArray(node)) {
    for (const n of node) {
      const v = attr(n, name);
      if (v) return v;
    }
    return "";
  }
  if (typeof node !== "object") return "";
  return node[`@_${name}`] ? String(node[`@_${name}`]).trim() : "";
}

function first(obj, ...keys) {
  for (const k of keys) {
    if (obj?.[k] != null) return obj[k];
  }
  return undefined;
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

async function fetchText(url, { timeout = FEED_TIMEOUT_MS, attempts = 1 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

// ── feed parsing ─────────────────────────────────────────────────────────────

function extractLink(item) {
  const raw = item.link;
  // Atom: <link rel="alternate" href="…" />, sometimes several per entry.
  for (const l of asArray(raw)) {
    if (typeof l === "object") {
      const rel = l["@_rel"];
      if (!rel || rel === "alternate") {
        const href = attr(l, "href");
        if (href) return href;
      }
    }
  }
  for (const l of asArray(raw)) {
    const href = attr(l, "href");
    if (href) return href;
  }
  const plain = text(raw);
  if (plain) return plain;
  return text(first(item, "guid", "id"));
}

function extractImage(item, description) {
  const candidates = [
    ...asArray(item["media:content"]).map(n => ({ url: attr(n, "url"), type: attr(n, "medium") || attr(n, "type") })),
    ...asArray(item["media:thumbnail"]).map(n => ({ url: attr(n, "url"), type: "image" })),
    ...asArray(item.enclosure).map(n => ({ url: attr(n, "url"), type: attr(n, "type") })),
    ...asArray(item["itunes:image"]).map(n => ({ url: attr(n, "href") || attr(n, "url"), type: "image" })),
  ];
  for (const c of candidates) {
    if (!c.url) continue;
    if (c.type && !/^image/i.test(c.type) && c.type !== "image") continue;
    return c.url;
  }
  // Last resort: an <img> embedded in the description/content HTML.
  const html = String(first(item, "content:encoded", "content", "description", "summary") ?? "");
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i) || String(description).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]) : null;
}

function parseFeed(xml, src) {
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel ?? doc?.["rdf:RDF"] ?? doc?.feed ?? {};
  const rawItems = asArray(first(channel, "item", "entry")).slice(0, ITEMS_PER_FEED);

  return rawItems
    .map(item => {
      const title = stripHtml(text(first(item, "title")));
      const link = decodeEntities(extractLink(item));
      const descriptionHtml = first(item, "description", "summary", "content:encoded", "content");
      const date = text(first(item, "pubDate", "published", "updated", "dc:date"));

      return {
        id: `${link || title}::${src.id}`,
        title,
        desc: stripHtml(text(descriptionHtml) || descriptionHtml).slice(0, 400),
        link,
        image: extractImage(item, descriptionHtml),
        date: normaliseDate(date),
        sourceId: src.id,
        catId: src.cat,
      };
    })
    .filter(a => a.title && a.link);
}

// Anthropic publishes no feed, so scrape the news index the same way the
// browser version did.
function parseAnthropicHTML(html, src) {
  const out = [];
  const blockRegex = /<a[^>]*href="(\/news\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const seen = new Set();
  let match;

  while ((match = blockRegex.exec(html)) !== null) {
    if (out.length >= ITEMS_PER_FEED) break;
    const link = "https://www.anthropic.com" + match[1];
    if (seen.has(link)) continue;

    const inner = match[2];
    const titleMatch = inner.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/);
    const title = titleMatch ? stripHtml(titleMatch[1]) : "";
    if (!title) continue;
    seen.add(link);

    const dateMatch = inner.match(/<time[^>]*datetime="([^"]+)"/) || inner.match(/<time[^>]*>([\s\S]*?)<\/time>/);
    const pMatch = inner.match(/<p[^>]*class="[^"]*body[^"]*"[^>]*>([\s\S]*?)<\/p>/) || inner.match(/<p[^>]*>([\s\S]*?)<\/p>/);

    out.push({
      id: `${link}::${src.id}`,
      title,
      desc: pMatch ? stripHtml(pMatch[1]).slice(0, 400) : "",
      link,
      image: null,
      date: normaliseDate(dateMatch ? stripHtml(dateMatch[1]) : ""),
      sourceId: src.id,
      catId: src.cat,
    });
  }
  return out;
}

// Emit ISO strings so the browser never has to guess at a format, and so
// unparseable dates become null rather than a silent NaN in the sort.
function normaliseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── image backfill ───────────────────────────────────────────────────────────

async function loadImageCache() {
  try {
    return JSON.parse(await readFile(IMAGE_CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function saveImageCache(cache) {
  await mkdir(dirname(IMAGE_CACHE_FILE), { recursive: true });
  await writeFile(IMAGE_CACHE_FILE, JSON.stringify(cache), "utf8");
}

// ── rolling archive ──────────────────────────────────────────────────────────

async function loadArchive() {
  try {
    const parsed = JSON.parse(await readFile(ARCHIVE_FILE, "utf8"));
    return { articles: parsed.articles ?? [], weekly: parsed.weekly ?? null };
  } catch {
    return { articles: [], weekly: null };
  }
}

async function saveArchive(store) {
  await mkdir(dirname(ARCHIVE_FILE), { recursive: true });
  await writeFile(ARCHIVE_FILE, JSON.stringify(store), "utf8");
}

// Fresh data wins field-by-field (an article may have gained an image since we
// first saw it), but anything already archived and still in window is kept even
// once it has scrolled off the publisher's feed.
function mergeArchive(existing, fresh, now) {
  const cutoff = now - ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
  const byId = new Map();
  for (const a of existing) byId.set(a.id, a);
  for (const a of fresh) byId.set(a.id, { ...byId.get(a.id), ...a });

  return [...byId.values()]
    .filter(a => a.date && Date.parse(a.date) >= cutoff)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

async function scrapeOgImage(link) {
  const html = await fetchText(link, { timeout: IMAGE_TIMEOUT_MS });
  const head = html.slice(0, 200000);
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = head.match(re);
    if (m?.[1]) {
      const url = decodeEntities(m[1].trim());
      if (!url) continue;
      if (url.startsWith("//")) return "https:" + url;
      if (url.startsWith("/")) return new URL(link).origin + url;
      if (/^https?:\/\//i.test(url)) return url;
    }
  }
  return null;
}

async function backfillImages(articles, cache) {
  const now = Date.now();
  const needed = [];

  for (const a of articles) {
    if (a.image) continue;
    const hit = cache[a.link];
    if (hit) {
      // A cached hit is reused forever; a cached miss is retried weekly in
      // case the publisher added an image after we first looked.
      if (hit.v) { a.image = hit.v; continue; }
      if (now - (hit.t ?? 0) < NULL_IMAGE_RETRY_MS) continue;
    }
    needed.push(a);
  }

  const budget = needed.slice(0, MAX_IMAGE_SCRAPES_PER_RUN);
  if (budget.length < needed.length) {
    console.log(`  images: ${needed.length} missing, scraping ${budget.length} this run (budget)`);
  }

  let cursor = 0;
  let found = 0;
  async function worker() {
    while (cursor < budget.length) {
      const a = budget[cursor++];
      let url = null;
      try {
        url = await scrapeOgImage(a.link);
      } catch {
        url = null;
      }
      cache[a.link] = { v: url, t: now };
      if (url) { a.image = url; found++; }
    }
  }

  await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, worker));
  return { attempted: budget.length, found };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  const failed = [];
  const perSource = {};

  console.log(`Fetching ${SOURCES.length} sources…`);

  const results = await Promise.all(
    SOURCES.map(async src => {
      try {
        const body = await fetchText(src.url, { attempts: FEED_ATTEMPTS });
        const items = src.isHtml ? parseAnthropicHTML(body, src) : parseFeed(body, src);
        if (items.length === 0) throw new Error("no items parsed");
        perSource[src.id] = items.length;
        console.log(`  ok   ${src.label.padEnd(20)} ${items.length} items`);
        return items;
      } catch (err) {
        perSource[src.id] = 0;
        failed.push({ id: src.id, label: src.label, reason: String(err?.message || err) });
        console.log(`  FAIL ${src.label.padEnd(20)} ${err?.message || err}`);
        return [];
      }
    })
  );

  // Exact-duplicate guard: some feeds repeat an entry, and a repeated id
  // would collide as a React key downstream.
  const byId = new Map();
  for (const a of results.flat()) {
    if (!byId.has(a.id)) byId.set(a.id, a);
  }

  const articles = [...byId.values()].sort((a, b) => {
    // Undated items sink to the bottom instead of scrambling the order.
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  });

  const cache = await loadImageCache();
  const img = await backfillImages(articles, cache);
  await saveImageCache(cache);

  // ── rolling archive + weekly summary ──────────────────────────────────────
  const now = Date.now();
  const store = await loadArchive();
  const archive = mergeArchive(store.articles, articles, now);
  console.log(`\nArchive: ${archive.length} articles (+${archive.length - store.articles.length} vs last run)`);

  const sourceLabels = Object.fromEntries(SOURCES.map(s => [s.id, s.label]));
  let weekly = store.weekly ?? null;

  if (summaryIsFresh(weekly, now)) {
    const ageDays = ((now - Date.parse(weekly.generatedAt)) / 86400000).toFixed(1);
    console.log(`  weekly: current summary is ${ageDays}d old — reusing`);
  } else {
    try {
      const fresh = await generateWeeklySummary(archive, { now, sourceLabels });
      if (fresh) weekly = fresh;
    } catch (err) {
      // Never fatal: a summary failure must not stop the site from publishing.
      console.log(`  weekly: generation failed (${err?.message || err}) — keeping previous summary`);
    }
    // Only stand in a sample when no key exists at all, so a real failure is
    // never disguised as placeholder content.
    if (!weekly && !process.env.ANTHROPIC_API_KEY) {
      weekly = buildSampleSummary(archive, { now, sourceLabels });
      if (weekly) console.log("  weekly: wrote sample placeholder (no API key configured)");
    }
  }

  await saveArchive({ articles: archive, weekly });

  const generatedAt = new Date(now).toISOString();
  const payload = {
    generatedAt,
    intervalMinutes: REFRESH_INTERVAL_MINUTES,
    counts: {
      articles: articles.length,
      sourcesOk: SOURCES.length - failed.length,
      sourcesTotal: SOURCES.length,
      archived: archive.length,
    },
    failed,
    perSource,
    weekly,
    articles,
  };

  await mkdir(dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload), "utf8");

  console.log(
    `\nWrote ${articles.length} articles from ${SOURCES.length - failed.length}/${SOURCES.length} sources ` +
    `(images: +${img.found}/${img.attempted} scraped) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
  );
  if (failed.length) console.log(`Failed sources: ${failed.map(f => f.label).join(", ")}`);

  // A partial feed is still worth publishing; a total wipeout is not.
  if (articles.length === 0) {
    console.error("No articles fetched at all — refusing to publish an empty feed.");
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
