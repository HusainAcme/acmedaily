import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  CATEGORIES,
  SOURCES as SOURCE_DATA,
  REFRESH_INTERVAL_MINUTES,
  STALE_AFTER_MINUTES,
} from "./sources.js";

// Feeds are gathered server-side by scripts/fetch-feeds.mjs on a schedule and
// published as a static file, so there is no CORS proxy in the request path.
const FEEDS_URL = `${import.meta.env.BASE_URL}feeds.json`;

// Corporate logo, served from public/ so the path survives the /acmedaily/ base.
const LOGO_URL = `${import.meta.env.BASE_URL}acmelogo.png`;

// How often an open tab re-checks the published file for a newer build.
const POLL_INTERVAL_MS = 5 * 60 * 1000;
// Ignore a focus-triggered re-check if we already looked this recently.
const FOCUS_RECHECK_AFTER_MS = 60 * 1000;
// Cadence for re-rendering relative timestamps ("32m ago") so they stay true.
const CLOCK_TICK_MS = 30 * 1000;


// ── FAVICON HELPER ───────────────────────────────────────────────────────────
const Favicon = ({ domain }) => (
  <img
    src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
    alt=""
    style={{ width: '1em', height: '1em', borderRadius: '4px', objectFit: 'contain', verticalAlign: 'middle', display: 'inline-block' }}
  />
);

// The source list itself lives in sources.js so the Node prefetch script can
// import it too; the logo element is the one browser-only part, added here.
const SOURCES = SOURCE_DATA.map(s => ({ ...s, logo: <Favicon domain={s.domain} /> }));
const SOURCE_BY_ID = Object.fromEntries(SOURCES.map(s => [s.id, s]));

// Articles carry only a sourceId. If a feed is retired between a published
// feeds.json and a deploy, render it neutrally rather than crashing on undefined.
const UNKNOWN_SOURCE = { id: "unknown", label: "Unknown", cat: "all", color: "#6b7280", bg: "#f0f0f0", logo: null };
const sourceOf = a => SOURCE_BY_ID[a.sourceId] ?? UNKNOWN_SOURCE;

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
    --paper: #faf8f4;
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
    background: var(--paper); color: var(--ink);
    padding: 18px 24px 16px;
    border-bottom: 4px solid var(--ms);
  }
  .masthead-inner { max-width: 1280px; margin: 0 auto; }
  .masthead-eye {
    font: 500 9px/1 var(--font-mono); letter-spacing: 3px;
    text-transform: uppercase; color: var(--muted); margin-bottom: 14px;
  }
  /* Corporate mark on the left, publication name on the right. */
  .masthead-lockup { display: flex; align-items: center; gap: 22px; }
  .masthead-logo { height: 54px; width: auto; flex-shrink: 0; display: block; }
  .masthead-rule { width: 1px; align-self: stretch; background: var(--rule); flex-shrink: 0; }
  .masthead-text { min-width: 0; }
  .masthead-title {
    font: 900 clamp(24px,4.4vw,46px)/1 var(--font-serif); letter-spacing: -1px; color: var(--ink);
  }
  .masthead-title em { font-style: italic; color: var(--ms); }
  .masthead-sub {
    font: 400 9px/1 var(--font-mono); letter-spacing: 2px;
    color: var(--muted); text-transform: uppercase; margin-top: 9px;
  }

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

  .nav-actions {
    display: flex; align-items: center; gap: 12px; flex-shrink: 0;
    padding-left: 16px; margin-left: 8px; border-left: 1px solid var(--rule);
  }
  .date-stamp { font: 400 9px/1 var(--font-mono); color: var(--muted); letter-spacing: 0.5px; white-space: nowrap; }

  /* ── FRESHNESS ──────────────────────────────────────────── */
  .fresh {
    display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
    white-space: nowrap; line-height: 1;
    /* Capped so an unusually long readout can never squeeze out the tabs. */
    max-width: 160px; overflow: hidden;
  }
  .fresh-main {
    font: 500 9px/1 var(--font-mono); letter-spacing: 0.5px; text-transform: uppercase;
    color: var(--ink2); display: flex; align-items: center; gap: 5px;
  }
  .fresh-next { font: 400 8px/1 var(--font-mono); letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted); }
  .fresh-pip {
    width: 6px; height: 6px; border-radius: 50%; background: #22c55e;
    box-shadow: 0 0 5px #22c55e; flex-shrink: 0;
  }
  .fresh.is-checking .fresh-pip { animation: blink 1s infinite; }
  .fresh.is-stale .fresh-main { color: #92620a; }
  .fresh.is-stale .fresh-pip { background: #f59e0b; box-shadow: 0 0 5px #f59e0b; }
  .fresh.is-error .fresh-main { color: #b91c1c; }
  .fresh.is-error .fresh-pip { background: #ef4444; box-shadow: 0 0 5px #ef4444; animation: none; }
  .fresh-flash {
    color: #0a8f08; font: 600 8px/1 var(--font-mono); letter-spacing: 1px; text-transform: uppercase;
    animation: fadeflash 2.5s ease forwards;
  }
  @keyframes fadeflash { 0% { opacity: 0; } 12% { opacity: 1; } 75% { opacity: 1; } 100% { opacity: 0; } }

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

  /* ── AI WEEKLY REVIEW ───────────────────────────────────── */
  .wk { background: var(--white); border-bottom: 1px solid var(--rule); }
  .wk-inner { max-width: 1280px; margin: 0 auto; padding: 22px 24px 24px; }
  .wk-top {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 16px; flex-wrap: wrap; margin-bottom: 12px;
  }
  .wk-eyebrow {
    font: 600 9px/1 var(--font-mono); letter-spacing: 2.5px; text-transform: uppercase;
    color: var(--ms); display: flex; align-items: center; gap: 8px;
  }
  .wk-spark { font-size: 11px; }
  .wk-meta { font: 400 9px/1 var(--font-mono); color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
  .wk-sample {
    font: 600 8px/1 var(--font-mono); letter-spacing: 1px; text-transform: uppercase;
    background: #fff8e1; border: 1px solid #f6d860; color: #856404;
    padding: 3px 7px; border-radius: 3px;
  }
  .wk-headline {
    font: 900 clamp(19px,2.4vw,27px)/1.25 var(--font-serif);
    letter-spacing: -0.4px; color: var(--ink); margin-bottom: 8px; max-width: 46ch;
  }
  .wk-intro {
    font: 300 13px/1.65 var(--font-sans); color: var(--ink2);
    max-width: 72ch; margin-bottom: 20px;
  }
  .wk-themes {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 20px; border-top: 1px solid var(--rule); padding-top: 18px;
  }
  .wk-theme { min-width: 0; }
  .wk-num {
    font: 500 9px/1 var(--font-mono); color: var(--ms);
    letter-spacing: 1px; margin-bottom: 7px; display: block;
  }
  .wk-theme-title { font: 700 14px/1.35 var(--font-serif); color: var(--ink); margin-bottom: 7px; }
  .wk-theme-sum { font: 300 11.5px/1.6 var(--font-sans); color: var(--muted); margin-bottom: 10px; }
  .wk-links { display: flex; flex-direction: column; gap: 5px; }
  .wk-link {
    font: 400 10px/1.4 var(--font-sans); color: var(--ink2); text-decoration: none;
    display: flex; gap: 6px; align-items: baseline; transition: color 0.15s;
  }
  .wk-link:hover { color: var(--ms); }
  .wk-link-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; transform: translateY(-1px); }
  .wk-link-title {
    overflow: hidden; text-overflow: ellipsis; display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }

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
    .wk-inner { padding: 20px 20px 22px; }
    .art-grid { grid-template-columns: repeat(2, 1fr); }
    /* Partner bar: allow horizontal scroll, but items still fit in a bar */
    .partner-bar-inner { min-width: max-content; }
    
    .hero { flex-direction: row; }
    .hero-img-container { width: 50%; height: auto; }
    .hero-content { width: 50%; }
  }

  /* Mobile: < 768px */
  @media (max-width: 767px) {
    /* Masthead: the side-by-side lockup stacks and centres. */
    .masthead { padding: 14px 12px 12px; text-align: center; }
    .masthead-eye { margin-bottom: 10px; }
    .masthead-lockup { flex-direction: column; gap: 12px; }
    .masthead-logo { height: 42px; margin: 0 auto; }
    .masthead-rule { width: 56px; height: 1px; align-self: center; }
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
    .nav-actions { gap: 8px; padding-left: 8px; margin-left: 4px; }
    .cat-tabs { overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .cat-tabs::-webkit-scrollbar { display: none; }
    .cat-tab { padding: 0 10px; font-size: 9px; }
    /* The full date goes, but the freshness readout stays — knowing how old
       the data is matters more on mobile, not less. */
    .date-stamp { display: none; }
    .fresh-main { font-size: 8px; gap: 4px; }
    .fresh-next { font-size: 7px; }
    .refresh-btn { padding: 7px 10px; }
    .refresh-btn .refresh-label { display: none; }

    /* Weekly review: single column, tighter */
    .wk-inner { padding: 16px 12px 18px; }
    .wk-themes { grid-template-columns: 1fr; gap: 18px; }
    .wk-intro { margin-bottom: 16px; }

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

  @media (prefers-reduced-motion: reduce) {
    .fresh-pip, .fresh-flash { animation: none !important; }
    .fresh-flash { opacity: 1; }
  }
`;

// ── HELPERS ───────────────────────────────────────────────────────────────────
// `now` is threaded in from a ticking clock so these labels stay accurate on a
// tab that has been open for hours, instead of freezing at render time.
function timeAgo(dateStr, now = Date.now()) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return "";
  const s = (now - d) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Local wall-clock time of the refresh, e.g. "14:32".
function formatClock(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

// Date range the weekly review covers, e.g. "5 Aug – 12 Aug".
function weekPeriod(w) {
  const fmt = d => {
    const date = new Date(d);
    return isNaN(date) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };
  const from = fmt(w.periodStart);
  const to = fmt(w.periodEnd);
  return from && to ? `${from} – ${to}` : "";
}

// Compact duration for the countdown and the staleness readout: "18m", "2h 05m".
function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 60000));
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
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
function Sidebar({ articles }) {
  const cats = CATEGORIES.filter(c => c.id !== "all");
  const maxCat = Math.max(...cats.map(c => articles.filter(a => a.catId === c.id).length), 1);

  // No useMemo here: React Compiler cannot preserve a manual memo around this
  // expression, and it auto-memoizes the plain version anyway.
  const topSources = SOURCES
    .map(s => ({ ...s, count: articles.filter(a => a.sourceId === s.id).length }))
    .filter(s => s.count > 0)
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 12);

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
  const [weekly, setWeekly] = useState(null);

  // Freshness state, all driven by the published file rather than by this tab.
  const [generatedAt, setGeneratedAt] = useState(null);   // when the data was gathered
  const [intervalMinutes, setIntervalMinutes] = useState(REFRESH_INTERVAL_MINUTES);
  const [checking, setChecking] = useState(false);        // a re-check is in flight
  const [loadError, setLoadError] = useState(null);
  const [flash, setFlash] = useState(null);               // null | "new" | "current"
  const [now, setNow] = useState(() => Date.now());

  const lastCheckedRef = useRef(0);
  const generatedAtRef = useRef(null);

  // Ticking clock: keeps "32m ago" and the countdown honest without re-fetching.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, []);

  // `manual` distinguishes a button press (reset paging, always show feedback)
  // from a background poll (leave the reader's position alone).
  const loadFeeds = useCallback(async ({ manual = false } = {}) => {
    setChecking(true);
    if (manual) setSpinning(true);
    lastCheckedRef.current = Date.now();

    try {
      // Cache-bust so an open tab is not served the copy it already has.
      const res = await fetch(`${FEEDS_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data.articles)) throw new Error("malformed feed file");

      const isFirstLoad = generatedAtRef.current === null;
      const isNewer = data.generatedAt !== generatedAtRef.current;
      generatedAtRef.current = data.generatedAt;

      setGeneratedAt(data.generatedAt);
      setIntervalMinutes(data.intervalMinutes || REFRESH_INTERVAL_MINUTES);
      setFailed((data.failed || []).map(f => f.label || f));
      setWeekly(data.weekly ?? null);
      setLoadError(null);

      if (isNewer) {
        setArticles(data.articles);
        // Only a manual refresh resets paging — a background poll must not
        // yank someone back up the page while they are reading.
        if (manual) setVisibleCount(24);
        // The first load is not "news", it is just the page appearing.
        if (!isFirstLoad) setFlash("new");
      } else if (manual) {
        setFlash("current");
      }
    } catch (err) {
      // Readers get a plain sentence; the underlying reason (a 404, an HTML
      // error page parsed as JSON, a dropped connection) goes to the console
      // where it is actually useful.
      console.warn("[acmedaily] feed load failed:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
      setChecking(false);
      setSpinning(false);
    }
  }, []);

  useEffect(() => { loadFeeds(); }, [loadFeeds]);

  // Clear the flash after its animation finishes.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  // Background poll for a newer published build.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") loadFeeds();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [loadFeeds]);

  // Re-check when the tab comes back to the foreground, or when the network
  // returns — the two moments when what is on screen is most likely stale.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastCheckedRef.current < FOCUS_RECHECK_AFTER_MS) return;
      loadFeeds();
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("online", recheck);
    return () => {
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("online", recheck);
    };
  }, [loadFeeds]);

  // Derived freshness readout.
  const freshness = useMemo(() => {
    if (loadError) return { state: "error", label: "Update failed", detail: "Retrying shortly" };
    if (!generatedAt) return { state: "loading", label: "Loading…", detail: "" };

    const age = now - new Date(generatedAt).getTime();
    const dueIn = intervalMinutes * 60000 - age;
    const stale = age > STALE_AFTER_MINUTES * 60000;

    return {
      state: stale ? "stale" : "ok",
      label: `Updated ${formatClock(generatedAt)}`,
      detail: stale
        ? `${formatDuration(age)} old`
        : dueIn > 0
          ? `Next in ${formatDuration(dueIn)}`
          : "Next update due",
      ageLabel: timeAgo(generatedAt, now),
    };
  }, [generatedAt, intervalMinutes, now, loadError]);

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

  // Per-category counts
  const catCounts = useMemo(() =>
    CATEGORIES.reduce((acc, c) => { acc[c.id] = articles.filter(a => a.catId === c.id).length; return acc; }, {}),
    [articles]);

  const hero = filtered[0];
  const heroSrc = hero ? sourceOf(hero) : null;
  const today = new Date(now).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const todayCount = articles.filter(a => a.date && (now - new Date(a.date)) < 86400000).length;

  return (
    <>
      <style>{styles}</style>
      <div className="app">

        {/* Masthead */}
        <div className="masthead">
          <div className="masthead-inner">
            <div className="masthead-eye">Software Team · Tech Intelligence Feed</div>
            <div className="masthead-lockup">
              <img
                className="masthead-logo"
                src={LOGO_URL}
                width="605"
                height="166"
                alt="Almoayyed Computers Middle East"
              />
              <div className="masthead-rule" />
              <div className="masthead-text">
                <div className="masthead-title">ACME <em>AI Daily</em></div>
                <div className="masthead-sub">AI · Microsoft · Cloud · DevOps · Enterprise · Security — Live</div>
              </div>
            </div>
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

              <div
                className={`fresh is-${freshness.state}${checking ? " is-checking" : ""}`}
                title={generatedAt
                  ? `Feeds gathered ${new Date(generatedAt).toLocaleString()} (${freshness.ageLabel}). Rebuilt every ${intervalMinutes} minutes.`
                  : "Loading published feeds…"}
              >
                <span className="fresh-main">
                  <span className="fresh-pip" />
                  {flash && !loadError
                    ? <span className="fresh-flash">{flash === "new" ? "New articles" : "Up to date"}</span>
                    : freshness.label}
                </span>
                {freshness.detail && <span className="fresh-next">{freshness.detail}</span>}
              </div>

              <button
                className={`refresh-btn ${spinning ? "spin" : ""}`}
                onClick={() => loadFeeds({ manual: true })}
                disabled={checking}
                aria-label="Check for newer articles"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
                <span className="refresh-label">Refresh</span>
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
                    <span style={{ color: sourceOf(a).color, fontSize: 7 }}>●</span>
                    <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 8 }}>[{sourceOf(a).label}]</span>
                    {a.title.slice(0, 75)}{a.title.length > 75 ? "…" : ""}
                    <span className="t-sep">◆</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* AI Weekly Review */}
        {weekly && (
          <div className="wk">
            <div className="wk-inner">
              <div className="wk-top">
                <span className="wk-eyebrow">
                  <span className="wk-spark">✦</span> The Week in AI · ACME AI Agent
                </span>
                <span className="wk-meta">
                  {weekly.sample && <span className="wk-sample">Sample — not generated</span>}
                  {!weekly.sample && `${weekly.articleCount} articles · ${weekPeriod(weekly)}`}
                </span>
              </div>

              <div className="wk-headline">{weekly.headline}</div>
              {weekly.intro && <div className="wk-intro">{weekly.intro}</div>}

              {weekly.themes?.length > 0 && (
                <div className="wk-themes">
                  {weekly.themes.map((t, i) => (
                    <div key={i} className="wk-theme">
                      <span className="wk-num">{String(i + 1).padStart(2, "0")}</span>
                      <div className="wk-theme-title">{t.title}</div>
                      <div className="wk-theme-sum">{t.summary}</div>
                      <div className="wk-links">
                        {(t.articles || []).map(a => {
                          const src = SOURCE_BY_ID[a.sourceId] ?? UNKNOWN_SOURCE;
                          return (
                            <a
                              key={a.link}
                              className="wk-link"
                              href={a.link}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <span className="wk-link-dot" style={{ background: src.color }} />
                              <span className="wk-link-title">{a.title}</span>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="page">
          {loadError && (
            <div className="warn">
              {articles.length > 0
                ? "⚠ Could not fetch the latest feed — showing the last data this tab loaded"
                : "⚠ Could not load the feed. The next scheduled update should restore it; check the browser console for details."}
            </div>
          )}
          {!loadError && freshness.state === "stale" && (
            <div className="warn">
              ⚠ Feed data is {freshness.detail} — the scheduled update has not run as expected
            </div>
          )}
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
                  {loading
                    ? "Fetching feeds…"
                    : `${todayCount} new today · ${filtered.length} shown${generatedAt ? ` · refreshed ${freshness.ageLabel}` : ""}`}
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
                      ) : (
                        <div className="hero-ph" style={{ background: heroSrc.color }}>
                          <div className="ph-grid" />
                          <div className="ph-logo" style={{ fontSize: 48 }}>{heroSrc.logo}</div>
                          <div className="ph-name" style={{ fontSize: 16 }}>{heroSrc.label}</div>
                        </div>
                      )}
                    </div>
                    <div className="hero-content">
                      <div className="hero-kicker" style={{ color: heroSrc.color }}>
                        <span>{heroSrc.logo} {heroSrc.label}</span>
                        <span className="h-kl" />
                        <span style={{ color: "var(--muted)" }}>
                          Top Story · {CATEGORIES.find(c => c.id === hero.catId)?.label}
                        </span>
                      </div>
                      <div className="hero-title">{hero.title}</div>
                      {hero.desc && <div className="hero-excerpt">{hero.desc}</div>}
                      <div className="hero-meta">
                        <span style={{ color: heroSrc.color }}>● {heroSrc.label}</span>
                        <span className="m-sep">·</span>
                        <span>{timeAgo(hero.date, now)}</span>
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

            <Sidebar articles={articles} />
          </div>
        </div>
      </div>
    </>
  );

  function renderArticleCard(a) {
    const src = sourceOf(a);
    return (
      <a key={a.id} className="art-card" href={a.link} target="_blank" rel="noopener noreferrer" style={{ "--src-color": src.color }}>
        <div className="art-thumbnail">
          {a.image ? (
            <img className="art-img" src={a.image} alt="" loading="lazy" onError={e => { e.target.style.display = "none"; }} />
          ) : (
            <div className="art-ph" style={{ background: src.color }}>
              <div className="ph-grid" />
              <div className="ph-logo">{src.logo}</div>
              <div className="ph-name">{src.label}</div>
            </div>
          )}
          <span className="art-arr">↗</span>
        </div>
        <div className="art-body">
          <div className="art-src" style={{ color: src.color }}>
            <span className="a-dot" style={{ background: src.color }} />
            {src.label}
            <span style={{ color: "var(--muted)", marginLeft: 4, fontWeight: 400 }}>
              {CATEGORIES.find(c => c.id === a.catId)?.icon}
            </span>
          </div>
          <div className="art-title" title={a.title}>{a.title}</div>
          {a.desc && <div className="art-desc" title={a.desc}>{a.desc}</div>}
          <div className="art-meta">{timeAgo(a.date, now)}</div>
        </div>
      </a>
    );
  }
}
