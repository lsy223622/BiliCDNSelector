# BiliCDNSelector

[简体中文](README.md) | [English](README.en.md)

[![CI](https://github.com/lsy223622/BiliCDNSelector/actions/workflows/ci.yml/badge.svg)](https://github.com/lsy223622/BiliCDNSelector/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-00aeec.svg)](LICENSE)
[![Install userscript](https://img.shields.io/badge/Install-userscript-00aeec.svg)](https://raw.githubusercontent.com/lsy223622/BiliCDNSelector/main/BiliCDNSelector.user.js)

BiliCDNSelector is a userscript that benchmarks and selects CDN routes for Bilibili web videos. It derives a set of domestic official UPOS candidates from the current video's valid signed URL, benchmarks them with small Range requests, and places better-performing routes ahead of the player's native fallbacks.

This project is not affiliated with or endorsed by Bilibili.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. [Install BiliCDNSelector](https://raw.githubusercontent.com/lsy223622/BiliCDNSelector/main/BiliCDNSelector.user.js).
3. Disable other userscripts that rewrite Bilibili playback URLs.
4. Open or refresh a Bilibili video page.

`@updateURL` points to this repository's `main` branch.

## Route selection

Bilibili's playurl API may supply only a small native CDN set. The script retains those exact URLs and derives 14 domestic CDN candidates from a compatible ordinary signed UPOS URL by changing only the hostname. The path, query order, escaping, and signature stay byte-for-byte intact. It then tests two 256 KiB Ranges per route serially and ranks routes using health metrics including success rate and worst completion time. Native Bilibili URLs remain in the playback fallback chain.

The presets are Ali, Alib, Alio1, Cos, Cosb, Coso1, HW, HWB, HWO1, 08c, 08h, 08ct, TF-HW, and TF-TX. The panel offers Auto, Bilibili Original, and each domestic route. If a manual route cannot be generated safely, playback keeps the native URLs.

A complete successful benchmark can cover up to 16 routes: 14 presets and two native routes. At two 256 KiB Ranges each, that is about 8 MiB. Transfers are lower with fewer candidates or cached results. Successful results are cached for four hours, failed results for 15 minutes, and the preferred route receives lightweight verification at most once every 15 minutes. Background probing does not block initial playback. The panel's Retest action forces a new test of relevant routes.

## Safety and privacy

- Only compatible ordinary UPOS URLs can be synthesis donors. Akamai, PCDN, MCDN, IP, 302 style, and special-port routes cannot serve as donors.
- The script never synthesizes Akamai URLs. API-provided Akamai and other native URLs remain available for playback fallback.
- If all synthetic routes fail, the original Bilibili primary and backup order is restored.
- Local storage contains settings, panel position, and per-host health summaries, never complete signed media URLs, credentials, cookies, or tokens.
- The script sends no telemetry or network statistics.

The userscript uses `@grant none` and matches `https://www.bilibili.com/*` and `https://m.bilibili.com/*`. Desktop Chromium with Tampermonkey is the primary target.

## Local development

Node.js 18 or newer is required. There are no runtime dependencies:

```bash
npm run check
npm test
```

`BiliCDNSelector.user.js` is directly installable. `BiliCDNSelector.test.js` covers URLs, safety, benchmark caching, and browser interception. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Never paste a complete signed media URL into an issue.

## Credits and license

This project is based on [stabruriss/bilibili-accelerator](https://github.com/stabruriss/bilibili-accelerator), which provides the browser interception, candidate routing, benchmarking, ranking, fallback, and UI foundation. The domestic CDN host catalog was derived from [bggRGjQaUbCoE/PiliPlus](https://github.com/bggRGjQaUbCoE/PiliPlus), specifically `lib/models/common/video/cdn_type.dart`.

[MIT](LICENSE) © 2026 stabruriss. The upstream copyright notice is preserved.
