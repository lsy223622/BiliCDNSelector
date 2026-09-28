'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./BiliCDNSelector.user.js');

const COS =
    'https://upos-sz-mirrornative.bilivideo.com/upgcxcode/01/23/video.m4s?deadline=1&token=a%2Fb+x&orderid=0&orderid=1';
const AKAMAI =
    'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/01/23/video.m4s?deadline=1&hdnts=st=1~exp=2~acl=%2F*~hmac=abc+def';
const AUDIO_COS =
    'https://upos-sz-mirrornative.bilivideo.com/upgcxcode/04/56/audio.m4s?deadline=1&token=audio';

function health(
    host,
    {
        now = Date.now(),
        ok = true,
        successes = 2,
        attempts = 2,
        worstMs = 250,
        mbps = 20,
        ttfb = 80,
        verifiedAt = now
    } = {}
) {
    return {
        host,
        ok,
        successes,
        attempts,
        worstMs,
        medianMbps: mbps,
        medianTtfbMs: ttfb,
        sampledAt: now,
        verifiedAt
    };
}

function dashEntry(base, backups = []) {
    return {
        id: 80,
        baseUrl: base,
        base_url: base,
        backupUrl: backups.slice(),
        backup_url: backups.slice()
    };
}

test('safeSwapHost preserves the signed suffix byte-for-byte', () => {
    const swapped = core.safeSwapHost(
        COS,
        'upos-sz-mirrorali.bilivideo.com'
    );
    assert.equal(
        swapped,
        COS.replace(
            'upos-sz-mirrornative.bilivideo.com',
            'upos-sz-mirrorali.bilivideo.com'
        )
    );
    assert.equal(
        core.safeSwapHost(COS, 'upos-hz-mirrorakam.akamaized.net'),
        null
    );
    assert.equal(
        core.safeSwapHost(
            AKAMAI,
            'upos-sz-mirrornative.bilivideo.com'
        ),
        null
    );
});

test('media observation ignores analytics URLs that merely mention a fragment', () => {
    assert.equal(core.isObservableMediaRequest(COS), true);
    assert.equal(core.isObservableMediaRequest(AKAMAI), true);
    assert.equal(
        core.isObservableMediaRequest(
            'https://data.bilibili.com/log?url=video.m4s'
        ),
        false
    );
});

test('Akamai-only entries never synthesize a generic CDN URL', () => {
    const now = Date.now();
    const entry = dashEntry(AKAMAI, []);
    const payload = {
        code: 0,
        data: { dash: { video: [entry], audio: [] } }
    };
    const records = {
        'upos-sz-mirrornative.bilivideo.com': health(
            'upos-sz-mirrornative.bilivideo.com',
            { now, worstMs: 100 }
        )
    };

    core.transformPlayInfo(payload, records, now);

    assert.equal(entry.baseUrl, AKAMAI);
    assert.deepEqual(entry.backupUrl, []);
});

test('an Akamai-first entry uses its exact bilivideo backup as donor', () => {
    const entry = dashEntry(AKAMAI, [COS]);
    const payload = {
        code: 0,
        data: { dash: { video: [entry], audio: [] } }
    };

    core.transformPlayInfo(payload, {}, Date.now(), {
        safeHosts: ['upos-sz-mirrorali.bilivideo.com']
    });

    const ali = entry.backupUrl.find(
        url => core.hostOf(url) === 'upos-sz-mirrorali.bilivideo.com'
    );
    assert.equal(
        ali,
        COS.replace(
            'upos-sz-mirrornative.bilivideo.com',
            'upos-sz-mirrorali.bilivideo.com'
        )
    );
    assert.equal(ali.includes('hdnts='), false);
});

test('native Akamai can win without changing its signature string', () => {
    const now = Date.now();
    const entry = dashEntry(COS, [AKAMAI]);
    const payload = {
        code: 0,
        data: {
            dash: {
                video: [entry],
                audio: [dashEntry(AUDIO_COS, [])]
            }
        }
    };
    const records = {
        [core.hostOf(COS)]: health(core.hostOf(COS), {
            now,
            worstMs: 900,
            mbps: 5
        }),
        [core.hostOf(AKAMAI)]: health(core.hostOf(AKAMAI), {
            now,
            worstMs: 220,
            mbps: 18
        })
    };

    const result = core.transformPlayInfo(payload, records, now, {
        safeHosts: ['upos-sz-mirrornative.bilivideo.com']
    });

    assert.equal(result.winnerHost, core.hostOf(AKAMAI));
    assert.equal(entry.baseUrl, AKAMAI);
    assert.equal(entry.base_url, AKAMAI);
    assert.ok(entry.backupUrl.includes(COS));
    assert.equal(
        entry.baseUrl,
        'https://upos-hz-mirrorakam.akamaized.net/upgcxcode/01/23/video.m4s?deadline=1&hdnts=st=1~exp=2~acl=%2F*~hmac=abc+def'
    );

    // The audio track has no native Akamai URL, so it must not synthesize one.
    assert.equal(payload.data.dash.audio[0].baseUrl, AUDIO_COS);
    assert.equal(
        core
            .collectOriginals(payload.data.dash.audio[0])
            .some(url => core.isAkamaiHost(core.hostOf(url))),
        false
    );
});

test('manual domestic target preserves the signed suffix and original chain', () => {
    const aliHost = 'upos-sz-mirrorali.bilivideo.com';
    const expectedAli = COS.replace(core.hostOf(COS), aliHost);
    const entry = dashEntry(COS, [AKAMAI]);
    const payload = {
        code: 0,
        data: { dash: { video: [entry], audio: [] } }
    };

    const result = core.transformPlayInfo(payload, {}, Date.now(), {
        mode: 'manual',
        manualTarget: aliHost
    });

    assert.equal(result.changed, true);
    assert.equal(result.manualMatched, 1);
    assert.equal(result.manualMissed, 0);
    assert.equal(entry.baseUrl, expectedAli);
    assert.equal(entry.base_url, expectedAli);
    assert.equal(
        entry.baseUrl.slice(entry.baseUrl.indexOf('/upgcxcode/')),
        COS.slice(COS.indexOf('/upgcxcode/'))
    );
    assert.deepEqual(entry.backupUrl.slice(0, 2), [COS, AKAMAI]);
    assert.deepEqual(entry.backup_url, entry.backupUrl);
});

test('manual invalid target leaves the original entry unchanged', () => {
    for (const manualTarget of [
        'upos-hz-mirrorakam.akamaized.net',
        'evil.example',
        'https://upos-sz-mirrornative.bilivideo.com/path'
    ]) {
        const entry = dashEntry(COS, [AKAMAI]);
        const payload = {
            code: 0,
            data: { dash: { video: [entry], audio: [] } }
        };
        const before = JSON.stringify(payload);

        const result = core.transformPlayInfo(payload, {}, Date.now(), {
            mode: 'manual',
            manualTarget
        });

        assert.equal(result.changed, false, manualTarget);
        assert.equal(result.manualMatched, 0, manualTarget);
        assert.equal(result.manualMissed, 1, manualTarget);
        assert.equal(JSON.stringify(payload), before, manualTarget);
    }
});

test('cold cache keeps Bilibili original base and adds synthetic fallbacks last', () => {
    const entry = dashEntry(COS, [AKAMAI]);
    const payload = { code: 0, result: { dash: { video: [entry] } } };

    core.transformPlayInfo(payload, {}, Date.now(), {
        safeHosts: [
            'upos-sz-mirrornative.bilivideo.com',
            'upos-sz-mirrorali.bilivideo.com'
        ]
    });

    assert.equal(entry.baseUrl, COS);
    assert.deepEqual(entry.backupUrl.slice(0, 2), [
        AKAMAI,
        COS.replace(
            'upos-sz-mirrornative.bilivideo.com',
            'upos-sz-mirrorali.bilivideo.com'
        )
    ]);
});

test('all fresh probe failures preserve only the exact original chain', () => {
    const now = Date.now();
    const entry = dashEntry(COS, [AKAMAI]);
    const payload = {
        code: 0,
        result: { video_info: { dash: { video: [entry] } } }
    };
    const records = {
        [core.hostOf(COS)]: health(core.hostOf(COS), {
            now,
            ok: false,
            successes: 0
        }),
        [core.hostOf(AKAMAI)]: health(core.hostOf(AKAMAI), {
            now,
            ok: false,
            successes: 0
        }),
        'upos-sz-mirrorali.bilivideo.com': health(
            'upos-sz-mirrorali.bilivideo.com',
            { now, ok: false, successes: 0 }
        )
    };

    core.transformPlayInfo(payload, records, now, {
        safeHosts: ['upos-sz-mirrorali.bilivideo.com']
    });

    assert.equal(entry.baseUrl, COS);
    assert.deepEqual(entry.backupUrl, [AKAMAI]);
});

test('durl and nested durls are both transformed', () => {
    const now = Date.now();
    const ALI = COS.replace(
        'upos-sz-mirrornative.bilivideo.com',
        'upos-sz-mirrorali.bilivideo.com'
    );
    const payload = {
        code: 0,
        result: {
            durl: [{ url: COS, backup_url: [AKAMAI] }],
            durls: [
                {
                    durl: [{ url: COS, backupUrl: [AKAMAI] }]
                }
            ]
        }
    };
    const records = {
        'upos-sz-mirrorali.bilivideo.com': health(
            'upos-sz-mirrorali.bilivideo.com',
            { now, worstMs: 180 }
        )
    };

    const result = core.transformPlayInfo(payload, records, now, {
        safeHosts: ['upos-sz-mirrorali.bilivideo.com']
    });

    assert.equal(result.entryCount, 2);
    assert.equal(payload.result.durl[0].url, ALI);
    assert.equal(payload.result.durls[0].durl[0].url, ALI);
});

test('transforming twice is idempotent', () => {
    const now = Date.now();
    const entry = dashEntry(COS, [AKAMAI]);
    const payload = {
        code: 0,
        data: { dash: { video: [entry], audio: [] } }
    };
    const records = {
        [core.hostOf(COS)]: health(core.hostOf(COS), { now })
    };

    core.transformPlayInfo(payload, records, now);
    const once = JSON.stringify(payload);
    core.transformPlayInfo(payload, records, now);
    assert.equal(JSON.stringify(payload), once);
});

test('explicit PCDN is demoted behind official URLs', () => {
    const pcdn =
        'https://xy1x2x3x4xy.mcdn.bilivideo.cn:4483/upgcxcode/01/23/video.m4s?os=mcdn';
    const entry = dashEntry(pcdn, [COS, AKAMAI]);
    const payload = { code: 0, data: { dash: { video: [entry] } } };

    core.transformPlayInfo(payload, {}, Date.now(), { safeHosts: [] });

    assert.equal(entry.baseUrl, COS);
    assert.equal(entry.backupUrl.at(-1), pcdn);
});

test('unsupported/error payloads remain untouched', () => {
    const payload = {
        code: -404,
        data: { dash: { video: [dashEntry(COS, [AKAMAI])] } }
    };
    const before = JSON.stringify(payload);
    const result = core.transformPlayInfo(payload, {}, Date.now());
    assert.equal(result.changed, false);
    assert.equal(JSON.stringify(payload), before);
});

test('settings normalization accepts enabled flag and rejects unsafe routes', () => {
    assert.deepEqual(core.normalizeSettings(null, false), {
        version: 1,
        enabled: false,
        mode: 'auto',
        manualTarget: core.DOMESTIC_CDN_HOSTS[0],
        autoProbe: true
    });
    assert.equal(
        core.normalizeSettings({
            enabled: true,
            mode: 'auto',
            autoProbe: false
        }).autoProbe,
        false
    );
    assert.equal(
        core.normalizeSettings({
            enabled: true,
            mode: 'manual',
            manualTarget: 'evil.example'
        }).manualTarget,
        core.DOMESTIC_CDN_HOSTS[0]
    );
});

test('probe ages use compact minute, hour, and day buckets', () => {
    const now = 2_000_000_000_000;
    assert.equal(core.formatProbeAge(now - 59_999, now), '刚刚');
    assert.equal(
        core.formatProbeAge(now - 12 * 60 * 1000, now),
        '12 分钟前'
    );
    assert.equal(
        core.formatProbeAge(now - 7 * 60 * 60 * 1000, now),
        '7 小时前'
    );
    assert.equal(
        core.formatProbeAge(now - 3 * 24 * 60 * 60 * 1000, now),
        '3 天前'
    );
});

test('launcher position stays fully inside the viewport', () => {
    assert.deepEqual(core.defaultUiPosition(1200, 900), {
        x: 1152,
        y: 798
    });
    assert.deepEqual(
        core.clampUiPosition({ x: -50, y: 2000 }, 1200, 900),
        {
            x: core.UI_VIEWPORT_MARGIN,
            y:
                900 -
                core.UI_LAUNCHER_SIZE -
                core.UI_VIEWPORT_MARGIN
        }
    );
    assert.deepEqual(
        core.clampUiPosition({ x: 500.6, y: 400.4 }, 1200, 900),
        { x: 501, y: 400 }
    );
    assert.deepEqual(core.clampUiPosition(null, 40, 40), {
        x: 5,
        y: 5
    });
    assert.deepEqual(
        core.clampUiPosition({ x: 0, y: 0 }, 300, 200, 100, 50),
        {
            x: 108,
            y: 58
        }
    );
    assert.deepEqual(core.clampUiPosition(null, 30, 30), {
        x: 0,
        y: 0
    });
});

test('launcher drag threshold preserves small movements as clicks', () => {
    assert.equal(
        core.pointerMovedBeyondThreshold(10, 10, 12, 14),
        false
    );
    assert.equal(
        core.pointerMovedBeyondThreshold(10, 10, 13, 14),
        true
    );
    assert.equal(
        core.pointerMovedBeyondThreshold(10, 10, 30, 10),
        true
    );
});

test('a partially failed two-range probe is not promoted', () => {
    const record = core.aggregateProbeSamples('cdn.example', [
        {
            ok: true,
            mbps: 20,
            ttfbMs: 80,
            totalMs: 180
        },
        {
            ok: false,
            mbps: 0,
            ttfbMs: 0,
            totalMs: 6500
        }
    ]);
    assert.equal(record.successes, 1);
    assert.equal(record.attempts, 2);
    assert.equal(record.ok, false);
});

test('successful and failed health records use different cache lifetimes', () => {
    const now = 2_000_000_000_000;
    const host = core.hostOf(COS);

    assert.equal(
        core.isFreshHealth(
            health(host, {
                now: now - core.HEALTH_TTL_MS + 1
            }),
            now
        ),
        true
    );
    assert.equal(
        core.isFreshHealth(
            health(host, {
                now: now - core.HEALTH_TTL_MS - 1
            }),
            now
        ),
        false
    );
    assert.equal(
        core.isFreshHealth(
            health(host, {
                now: now - core.FAILED_HEALTH_TTL_MS + 1,
                ok: false,
                successes: 0
            }),
            now
        ),
        true
    );
    assert.equal(
        core.isFreshHealth(
            health(host, {
                now: now - core.FAILED_HEALTH_TTL_MS - 1,
                ok: false,
                successes: 0
            }),
            now
        ),
        false
    );
});

test('light verification is due without extending the full benchmark', () => {
    const now = 2_000_000_000_000;
    const sampledAt = now - 2 * 60 * 60 * 1000;
    const record = health(core.hostOf(COS), {
        now: sampledAt,
        verifiedAt:
            now - core.HEALTH_VERIFY_INTERVAL_MS + 1
    });

    assert.equal(core.needsHealthVerification(record, now), false);
    record.verifiedAt =
        now - core.HEALTH_VERIFY_INTERVAL_MS;
    assert.equal(core.needsHealthVerification(record, now), true);

    const legacy = { ...record };
    delete legacy.verifiedAt;
    assert.equal(core.verifiedAtOf(legacy, now), sampledAt);
    assert.equal(core.needsHealthVerification(legacy, now), true);
    assert.equal(record.sampledAt, sampledAt);
});

test('light verification promotes failures and significant slowdowns to a full probe', () => {
    const record = health(core.hostOf(COS), {
        worstMs: 200
    });
    assert.equal(core.verificationLimitMs(record), 750);
    assert.equal(
        core.isVerificationAcceptable(
            { ok: true, totalMs: 750 },
            record
        ),
        true
    );
    assert.equal(
        core.isVerificationAcceptable(
            { ok: true, totalMs: 751 },
            record
        ),
        false
    );
    assert.equal(
        core.isVerificationAcceptable(
            { ok: false, totalMs: 100 },
            record
        ),
        false
    );
});

test('adaptive work verifies the actual preferred host and retests only stale failures', () => {
    const now = 2_000_000_000_000;
    const old = now - core.HEALTH_VERIFY_INTERVAL_MS - 1;
    const cosHost = core.hostOf(COS);
    const aliHost = core.DOMESTIC_CDN_HOSTS[1];
    const hkHost = core.DOMESTIC_CDN_HOSTS[2];
    const routes = [
        { host: cosHost, url: COS },
        {
            host: aliHost,
            url: COS.replace(cosHost, aliHost)
        },
        {
            host: hkHost,
            url: COS.replace(cosHost, hkHost)
        }
    ];
    const records = {
        [cosHost]: health(cosHost, {
            now: old,
            verifiedAt: old,
            worstMs: 300
        }),
        [aliHost]: health(aliHost, {
            now: old,
            verifiedAt: old,
            ok: false,
            successes: 0
        }),
        [hkHost]: health(hkHost, {
            now: old,
            verifiedAt: now,
            worstMs: 100
        })
    };

    const work = core.planProbeWork(
        routes,
        records,
        now,
        cosHost
    );
    assert.equal(work.kind, 'adaptive');
    assert.equal(work.verifyRoute.host, cosHost);
    assert.deepEqual(
        work.routes.map(route => route.host),
        [aliHost]
    );

    records[cosHost].verifiedAt = now;
    records[aliHost] = health(aliHost, {
        now: now - 5 * 60 * 1000,
        verifiedAt: now - 5 * 60 * 1000,
        ok: false,
        successes: 0
    });
    assert.equal(
        core.planProbeWork(
            routes,
            records,
            now,
            cosHost
        ).kind,
        'none'
    );
    assert.equal(
        core.planProbeWork(
            routes,
            records,
            now,
            cosHost,
            true
        ).kind,
        'full'
    );
});

test('probe planning retains a cached winner from a later API backup', () => {
    const now = 2_000_000_000_000;
    const firstHost = 'upos-sz-mirror08c.bilivideo.com';
    const secondHost = 'upos-sz-mirror08h.bilivideo.com';
    const winnerHost = 'upos-sz-mirrorcos.bilivideo.com';
    const first = COS.replace(core.hostOf(COS), firstHost);
    const second = COS.replace(core.hostOf(COS), secondHost);
    const winner = COS.replace(core.hostOf(COS), winnerHost);
    const entry = dashEntry(first, [second, winner, AKAMAI]);
    const payload = {
        code: 0,
        data: { dash: { video: [entry], audio: [] } }
    };
    const records = {
        [firstHost]: health(firstHost, {
            now,
            worstMs: 1_000
        }),
        [secondHost]: health(secondHost, {
            now,
            worstMs: 900
        }),
        [winnerHost]: health(winnerHost, {
            now,
            verifiedAt:
                now - core.HEALTH_VERIFY_INTERVAL_MS - 1,
            worstMs: 100
        }),
        [core.hostOf(AKAMAI)]: health(core.hostOf(AKAMAI), {
            now,
            worstMs: 800
        })
    };

    const result = core.transformPlayInfo(payload, records, now, {
        safeHosts: []
    });
    assert.equal(result.winnerHost, winnerHost);
    assert.ok(
        result.probePlan.some(route => route.host === winnerHost)
    );

    const work = core.planProbeWork(
        result.probePlan,
        records,
        now,
        result.winnerHost
    );
    assert.equal(work.kind, 'adaptive');
    assert.equal(work.verifyRoute.host, winnerHost);
});

function fakeBrowserRoot(payload, settings = null) {
    const now = Date.now();
    const hosts = [
        core.hostOf(COS),
        core.hostOf(AKAMAI),
        ...core.DOMESTIC_CDN_HOSTS
    ];
    const cache = {
        version: 1,
        health: Object.fromEntries(
            hosts.map((host, index) => [
                host,
                health(host, {
                    now,
                    worstMs: 200 + index * 200,
                    mbps: 20 - index
                })
            ])
        )
    };
    const storage = new Map([
        ['biliCdnSelector.health.v1', JSON.stringify(cache)]
    ]);
    if (settings) {
        storage.set(
            'biliCdnSelector.settings.v1',
            JSON.stringify(settings)
        );
    }

    class FakeXHR {
        constructor() {
            this.readyState = 0;
            this.responseType = '';
            this._responseText = '';
        }

        open(_method, url) {
            this._url = url;
        }

        get responseText() {
            return this._responseText;
        }

        get response() {
            return this.responseType === 'json'
                ? JSON.parse(this._responseText)
                : this._responseText;
        }
    }

    const root = {
        fetch: async () =>
            new Response(JSON.stringify(structuredClone(payload)), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            }),
        XMLHttpRequest: FakeXHR,
        Response,
        Headers,
        AbortController,
        JSON,
        performance,
        console: { info() {} },
        document: undefined,
        location: {
            href: 'https://www.bilibili.com/video/BV1test',
            reload() {}
        },
        localStorage: {
            getItem(key) {
                return storage.get(key) ?? null;
            },
            setItem(key, value) {
                storage.set(key, String(value));
            },
            removeItem(key) {
                storage.delete(key);
            }
        },
        setTimeout,
        clearTimeout,
        addEventListener() {}
    };

    return { root, FakeXHR, storage };
}

function prepareProbeBrowser(root) {
    root.document = {
        hidden: false,
        documentElement: null,
        querySelector(selector) {
            return selector === 'video'
                ? {
                      paused: true,
                      seeking: false,
                      readyState: 4
                  }
                : null;
        }
    };
    const nativeSetTimeout = setTimeout;
    root.setTimeout = (callback, milliseconds, ...args) =>
        nativeSetTimeout(
            callback,
            Math.min(Number(milliseconds) || 0, 5),
            ...args
        );
    return nativeSetTimeout;
}

function ageHealthCache(storage, ageMs, legacy = false) {
    const key = 'biliCdnSelector.health.v1';
    const cache = JSON.parse(storage.get(key));
    const sampledAt = Date.now() - ageMs;
    for (const record of Object.values(cache.health)) {
        record.sampledAt = sampledAt;
        if (legacy) {
            delete record.verifiedAt;
        } else {
            record.verifiedAt = sampledAt;
        }
    }
    storage.set(key, JSON.stringify(cache));
    return sampledAt;
}

async function waitForProbeIdle(root, requestLog, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (
            requestLog.length &&
            root.__BiliCDNSelector &&
            !root.__BiliCDNSelector.status().probing
        ) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail('probe did not finish before timeout');
}

test('browser shell rewrites playurl fetch and XHR getter responses', async () => {
    const payload = {
        code: 0,
        data: {
            dash: {
                video: [dashEntry(AKAMAI, [COS])],
                audio: []
            }
        }
    };
    const { root } = fakeBrowserRoot(payload);
    core.install(root);

    const api =
        'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1test&cid=1';
    const fetched = await (await root.fetch(api)).json();
    assert.equal(fetched.data.dash.video[0].baseUrl, COS);
    assert.equal(fetched.data.dash.video[0].backupUrl[0], AKAMAI);

    const xhr = new root.XMLHttpRequest();
    xhr.open('GET', api);
    xhr._responseText = JSON.stringify(structuredClone(payload));
    xhr.readyState = 4;
    const fromXhr = JSON.parse(xhr.responseText);
    assert.equal(fromXhr.data.dash.video[0].baseUrl, COS);
    assert.equal(fromXhr.data.dash.video[0].backupUrl[0], AKAMAI);

    const jsonXhr = new root.XMLHttpRequest();
    jsonXhr.open('GET', api);
    jsonXhr._responseText = JSON.stringify(structuredClone(payload));
    jsonXhr.responseType = 'json';
    jsonXhr.readyState = 4;
    assert.equal(jsonXhr.response.data.dash.video[0].baseUrl, COS);
});

test('browser shell performs one light Range without extending the full cache', async () => {
    const payload = {
        code: 0,
        data: {
            dash: {
                video: [dashEntry(COS, [AKAMAI])],
                audio: []
            }
        }
    };
    const { root, storage } = fakeBrowserRoot(payload);
    const sampledAt = ageHealthCache(
        storage,
        core.HEALTH_VERIFY_INTERVAL_MS + 1000,
        true
    );
    prepareProbeBrowser(root);
    const requests = [];
    root.fetch = async (input, init) => {
        if (init?.headers?.Range) {
            requests.push({
                url: String(input),
                range: init.headers.Range
            });
            return new Response(new Uint8Array(256 * 1024), {
                status: 206
            });
        }
        return new Response('{}', { status: 200 });
    };

    core.install(root);
    root.__playinfo__ = structuredClone(payload);
    await waitForProbeIdle(root, requests);

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.includes(core.hostOf(COS)), true);
    assert.equal(requests[0].range, 'bytes=0-262143');
    const saved = JSON.parse(
        storage.get('biliCdnSelector.health.v1')
    ).health[core.hostOf(COS)];
    assert.equal(saved.sampledAt, sampledAt);
    assert.ok(saved.verifiedAt > sampledAt);
});

test('automatic testing can be off while a manual retest still runs', async () => {
    const payload = {
        code: 0,
        data: {
            dash: {
                video: [dashEntry(COS, [AKAMAI])],
                audio: []
            }
        }
    };
    const { root, storage } = fakeBrowserRoot(payload, {
        version: 1,
        enabled: true,
        mode: 'auto',
        manualTarget: core.DOMESTIC_CDN_HOSTS[0],
        autoProbe: false
    });
    storage.delete('biliCdnSelector.health.v1');
    prepareProbeBrowser(root);
    const requests = [];
    root.fetch = async (input, init) => {
        if (init?.headers?.Range) {
            requests.push(String(input));
        }
        return new Response('{}', { status: 200 });
    };

    core.install(root);
    root.__playinfo__ = structuredClone(payload);
    await new Promise(resolve => setTimeout(resolve, 30));

    assert.deepEqual(requests, []);
    assert.equal(root.__BiliCDNSelector.status().autoProbe, false);
    assert.equal(root.__BiliCDNSelector.status().probing, false);
    assert.equal(root.__BiliCDNSelector.retest(), true);
    await waitForProbeIdle(root, requests);
    assert.ok(requests.length > 0);
});

test('automatic testing requeues after a rapid off-on cycle', async () => {
    const payload = {
        code: 0,
        data: {
            dash: {
                video: [dashEntry(COS, [AKAMAI])],
                audio: []
            }
        }
    };
    const { root, storage } = fakeBrowserRoot(payload, {
        version: 1,
        enabled: true,
        mode: 'auto',
        manualTarget: core.DOMESTIC_CDN_HOSTS[0],
        autoProbe: true
    });
    storage.delete('biliCdnSelector.health.v1');
    prepareProbeBrowser(root);

    let markFirstStarted;
    const firstStarted = new Promise(resolve => {
        markFirstStarted = resolve;
    });
    let releaseFirst;
    const firstRelease = new Promise(resolve => {
        releaseFirst = resolve;
    });
    const requests = [];
    root.fetch = async (input, init) => {
        if (init?.headers?.Range) {
            requests.push(String(input));
            if (requests.length === 1) {
                markFirstStarted();
                await firstRelease;
            }
            return new Response(new Uint8Array(256 * 1024), {
                status: 206
            });
        }
        return new Response('{}', { status: 200 });
    };

    core.install(root);
    root.__playinfo__ = structuredClone(payload);
    await firstStarted;
    assert.equal(root.__BiliCDNSelector.setAutoProbe(false), true);
    assert.equal(root.__BiliCDNSelector.setAutoProbe(true), true);
    releaseFirst();
    await waitForProbeIdle(root, requests);

    assert.ok(requests.length > 1);
    assert.equal(root.__BiliCDNSelector.status().autoProbe, true);
    assert.equal(root.__BiliCDNSelector.status().probing, false);
});

test('an expired failed alternative is retested without rebenchmarking healthy routes', async () => {
    const payload = {
        code: 0,
        data: {
            dash: {
                video: [dashEntry(COS, [AKAMAI])],
                audio: []
            }
        }
    };
    const { root, storage } = fakeBrowserRoot(payload);
    ageHealthCache(
        storage,
        core.HEALTH_VERIFY_INTERVAL_MS + 1000
    );
    const cacheKey = 'biliCdnSelector.health.v1';
    const cache = JSON.parse(storage.get(cacheKey));
    const aliHost = core.DOMESTIC_CDN_HOSTS[1];
    cache.health[aliHost].ok = false;
    cache.health[aliHost].successes = 0;
    for (const [host, record] of Object.entries(cache.health)) {
        if (host !== core.hostOf(COS) && host !== aliHost) {
            record.verifiedAt = Date.now();
        }
    }
    storage.set(cacheKey, JSON.stringify(cache));
    prepareProbeBrowser(root);
    const requests = [];
    root.fetch = async (input, init) => {
        if (init?.headers?.Range) {
            requests.push({
                host: core.hostOf(String(input)),
                range: init.headers.Range
            });
            return new Response(new Uint8Array(256 * 1024), {
                status: 206
            });
        }
        return new Response('{}', { status: 200 });
    };

    core.install(root);
    root.__playinfo__ = structuredClone(payload);
    await waitForProbeIdle(root, requests);

    assert.deepEqual(
        requests.map(request => request.host),
        [core.hostOf(COS), aliHost, aliHost]
    );
    assert.deepEqual(
        requests.map(request => request.range),
        [
            'bytes=0-262143',
            'bytes=0-262143',
            'bytes=1048576-1310719'
        ]
    );
});

test('failed light verification escalates to one complete benchmark', async () => {
    const payload = {
        code: 0,
        data: {
            dash: {
                video: [dashEntry(COS, [AKAMAI])],
                audio: []
            }
        }
    };
    const { root, storage } = fakeBrowserRoot(payload);
    ageHealthCache(
        storage,
        core.HEALTH_VERIFY_INTERVAL_MS + 1000
    );
    prepareProbeBrowser(root);
    const requests = [];
    root.fetch = async (input, init) => {
        if (init?.headers?.Range) {
            requests.push({
                url: String(input),
                range: init.headers.Range
            });
            if (requests.length === 1) {
                return new Response('', { status: 503 });
            }
            return new Response(new Uint8Array(256 * 1024), {
                status: 206
            });
        }
        return new Response('{}', { status: 200 });
    };

    core.install(root);
    root.__playinfo__ = structuredClone(payload);
    await waitForProbeIdle(root, requests);

    assert.equal(requests.length, 1 + 2 * core.planFromCandidates(core.buildCandidates([COS, AKAMAI])).length);
    assert.equal(root.__BiliCDNSelector.status().phase, 'ready');
});

test('persisted original mode leaves intercepted playurl responses untouched', async () => {
    const payload = {
        code: 0,
        data: {
            dash: {
                video: [dashEntry(AKAMAI, [COS])],
                audio: []
            }
        }
    };
    const { root } = fakeBrowserRoot(payload, {
        version: 1,
        enabled: false,
        mode: 'auto',
        manualTarget: core.DOMESTIC_CDN_HOSTS[0]
    });
    core.install(root);

    const api =
        'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1test&cid=1';
    const fetched = await (await root.fetch(api)).json();
    assert.equal(fetched.data.dash.video[0].baseUrl, AKAMAI);
    assert.deepEqual(fetched.data.dash.video[0].backupUrl, [COS]);
    assert.equal(root.__BiliCDNSelector.status().enabled, false);
});

test('a safe manual route can re-enable the script from Bilibili original mode', () => {
    const payload = {
        code: 0,
        data: {
            dash: {
                video: [dashEntry(AKAMAI, [COS])],
                audio: []
            }
        }
    };
    const { root, storage } = fakeBrowserRoot(payload, {
        version: 1,
        enabled: false,
        mode: 'auto',
        manualTarget: core.DOMESTIC_CDN_HOSTS[0],
        autoProbe: false
    });
    core.install(root);

    assert.equal(root.__BiliCDNSelector.setAutoProbe(false), true);
    assert.equal(root.__BiliCDNSelector.status().phase, 'off');
    assert.equal(
        root.__BiliCDNSelector.setMode(
            'manual',
            core.DOMESTIC_CDN_HOSTS[1]
        ),
        true
    );
    assert.deepEqual(
        {
            enabled: root.__BiliCDNSelector.status().enabled,
            mode: root.__BiliCDNSelector.status().mode,
            manualTarget: root.__BiliCDNSelector.status().manualTarget,
            autoProbe: root.__BiliCDNSelector.status().autoProbe
        },
        {
            enabled: true,
            mode: 'manual',
            manualTarget: core.DOMESTIC_CDN_HOSTS[1],
            autoProbe: false
        }
    );
    assert.equal(
        JSON.parse(
            storage.get('biliCdnSelector.settings.v1')
        ).autoProbe,
        false
    );
});

test('manual routing can keep automatic health testing enabled', async () => {
    const payload = {
        code: 0,
        data: {
            dash: {
                video: [dashEntry(COS, [AKAMAI])],
                audio: []
            }
        }
    };
    const manualTarget = core.DOMESTIC_CDN_HOSTS[1];
    const { root, storage } = fakeBrowserRoot(payload, {
        version: 1,
        enabled: true,
        mode: 'manual',
        manualTarget,
        autoProbe: true
    });
    storage.delete('biliCdnSelector.health.v1');
    prepareProbeBrowser(root);
    const requests = [];
    root.fetch = async (input, init) => {
        if (init?.headers?.Range) {
            requests.push(String(input));
            return new Response(new Uint8Array(256 * 1024), {
                status: 206
            });
        }
        return new Response('{}', { status: 200 });
    };

    core.install(root);
    root.__playinfo__ = structuredClone(payload);
    await waitForProbeIdle(root, requests);

    assert.ok(requests.length > 0);
    assert.equal(
        core.hostOf(root.__playinfo__.data.dash.video[0].baseUrl),
        manualTarget
    );
    assert.equal(root.__BiliCDNSelector.status().mode, 'manual');
    assert.equal(root.__BiliCDNSelector.status().autoProbe, true);
});

test('a newer SPA playurl invalidates the old pending probe plan', async () => {
    const firstUrl = COS.replace('video.m4s', 'video-a.m4s');
    const secondUrl = COS.replace('video.m4s', 'video-b.m4s');
    const first = {
        code: 0,
        data: {
            dash: {
                video: [dashEntry(firstUrl, [])],
                audio: []
            }
        }
    };
    const second = {
        code: 0,
        data: {
            dash: {
                video: [dashEntry(secondUrl, [])],
                audio: []
            }
        }
    };
    const { root } = fakeBrowserRoot(first);
    root.localStorage.removeItem('biliCdnSelector.health.v1');
    root.document = {
        hidden: false,
        documentElement: null,
        querySelector(selector) {
            return selector === 'video'
                ? {
                      paused: true,
                      seeking: false,
                      readyState: 4
                  }
                : null;
        }
    };
    const nativeSetTimeout = setTimeout;
    root.setTimeout = (callback, milliseconds, ...args) =>
        nativeSetTimeout(
            callback,
            Math.min(Number(milliseconds) || 0, 5),
            ...args
        );
    const probedUrls = [];
    root.fetch = async (input, init) => {
        if (init?.headers?.Range) {
            probedUrls.push(String(input));
            return new Response(new Uint8Array(256 * 1024), {
                status: 206
            });
        }
        return new Response('{}', { status: 200 });
    };

    core.install(root);
    root.__playinfo__ = structuredClone(first);
    root.__playinfo__ = structuredClone(second);
    await new Promise(resolve => nativeSetTimeout(resolve, 120));

    assert.ok(probedUrls.length > 0);
    assert.equal(
        probedUrls.every(url => url.includes('video-b.m4s')),
        true
    );
    assert.equal(root.__BiliCDNSelector.status().probing, false);
});


test('domestic catalog contains exactly the specified 14 UPOS hosts', () => {
    const expected = [
        'upos-sz-mirrorali.bilivideo.com',
        'upos-sz-mirroralib.bilivideo.com',
        'upos-sz-mirroralio1.bilivideo.com',
        'upos-sz-mirrorcos.bilivideo.com',
        'upos-sz-mirrorcosb.bilivideo.com',
        'upos-sz-mirrorcoso1.bilivideo.com',
        'upos-sz-mirrorhw.bilivideo.com',
        'upos-sz-mirrorhwb.bilivideo.com',
        'upos-sz-mirrorhwo1.bilivideo.com',
        'upos-sz-mirror08c.bilivideo.com',
        'upos-sz-mirror08h.bilivideo.com',
        'upos-sz-mirror08ct.bilivideo.com',
        'upos-tf-all-hw.bilivideo.com',
        'upos-tf-all-tx.bilivideo.com'
    ];
    assert.equal(core.DOMESTIC_CDN_ROUTES.length, 14);
    assert.deepEqual(core.DOMESTIC_CDN_ROUTES.map(route => route.host), expected);
    assert.deepEqual(core.DOMESTIC_CDN_HOSTS, expected);
});


test('domestic synthesis preserves every signed suffix and native URL', () => {
    const donor = 'https://upos-sz-mirrornative.bilivideo.com/upgcxcode/a%2Fb/video.m4s?token=x%2By&n=1&n=2#part';
    const nativeAli = donor.replace('upos-sz-mirrornative', 'upos-sz-mirrorali').replace('token=x%2By', 'token=native');
    const candidates = core.buildCandidates([donor, nativeAli]);
    assert.equal(candidates.filter(candidate => candidate.original).length, 2);
    assert.equal(candidates.length, 15);
    assert.equal(new Set(candidates.map(candidate => candidate.host)).size, 15);
    for (const host of core.DOMESTIC_CDN_HOSTS) {
        const route = candidates.find(candidate => candidate.host === host);
        assert.ok(route, host);
        if (host === core.DOMESTIC_CDN_HOSTS[0]) {
            assert.equal(route.url, nativeAli);
            assert.equal(route.original, true);
        } else {
            assert.equal(route.url, donor.replace(core.hostOf(donor), host));
            assert.equal(route.synthetic, true);
        }
    }
});

test('unsafe native donors never produce domestic synthetic routes', () => {
    const path = '/upgcxcode/01/23/video.m4s?deadline=1&token=a%2Fb';
    const hosts = [
        'upos-hz-mirrorakam.akamaized.net',
        'xy1x2x3x4xy.mcdn.bilivideo.cn',
        '1.2.3.4',
        'node.szbdyd.com',
        'upos-sz-302.bilivideo.com',
        'upos-sz-mirrorali.bilivideo.com:8443',
        'media.bilivideo.com'
    ];
    for (const host of hosts) {
        const url = 'https://' + host + path;
        const candidates = core.buildCandidates([url]);
        assert.equal(candidates.some(candidate => candidate.synthetic), false, host);
    }
});


test('full domestic probe plan includes fourteen presets and two ordinary native routes', () => {
    const native1 = COS.replace(core.hostOf(COS), 'upos-sz-mirrornative1.bilivideo.com');
    const native2 = COS.replace(core.hostOf(COS), 'upos-sz-mirrornative2.bilivideo.com');
    const candidates = core.buildCandidates([native1, AKAMAI, native2]);
    const plan = core.planFromCandidates(candidates);
    const hosts = plan.map(route => route.host);
    assert.equal(hosts.length, 16);
    assert.equal(new Set(hosts).size, 16);
    assert.deepEqual(hosts.slice(0, 2), [core.hostOf(native1), core.hostOf(native2)]);
    assert.deepEqual(hosts.slice(2), core.DOMESTIC_CDN_HOSTS);
    assert.equal(hosts.includes(core.hostOf(AKAMAI)), false);
});


test('manual route definitions expose auto, original, and fourteen domestic presets', () => {
    const ids = core.ROUTE_DEFS.map(route => route.id);
    assert.deepEqual(ids.slice(0, 2), ['auto', 'original']);
    assert.deepEqual(ids.slice(2), core.DOMESTIC_CDN_HOSTS);
    assert.equal(new Set(ids).size, 16);
    assert.equal(core.normalizeSettings({ mode: 'manual', manualTarget: 'native-akamai' }).manualTarget, core.DOMESTIC_CDN_HOSTS[0]);
});


test('healthy domestic winner becomes playback base while native URLs remain fallbacks', () => {
    const now = Date.now();
    const winnerHost = core.DOMESTIC_CDN_HOSTS[5];
    const winnerUrl = COS.replace(core.hostOf(COS), winnerHost);
    const entry = dashEntry(COS, [AKAMAI]);
    const payload = { code: 0, data: { dash: { video: [entry] } } };
    const records = {
        [winnerHost]: health(winnerHost, { now, worstMs: 100 }),
        [core.hostOf(COS)]: health(core.hostOf(COS), { now, worstMs: 800 })
    };
    const result = core.transformPlayInfo(payload, records, now);
    assert.equal(result.winnerHost, winnerHost);
    assert.equal(entry.baseUrl, winnerUrl);
    assert.equal(entry.base_url, winnerUrl);
    assert.ok(entry.backupUrl.includes(COS));
    assert.ok(entry.backupUrl.includes(AKAMAI));
});

test('failed domestic routes restore the exact native playback chain', () => {
    const now = Date.now();
    const entry = dashEntry(COS, [AKAMAI]);
    const payload = { code: 0, data: { dash: { video: [entry] } } };
    const records = Object.fromEntries(core.DOMESTIC_CDN_HOSTS.map(host => [
        host,
        health(host, { now, ok: false, successes: 0 })
    ]));
    core.transformPlayInfo(payload, records, now);
    assert.equal(entry.baseUrl, COS);
    assert.deepEqual(entry.backupUrl, [AKAMAI]);
});

test('stable domestic health outranks a faster flaky route', () => {
    const now = Date.now();
    const candidates = core.buildCandidates([COS]);
    const fast = core.DOMESTIC_CDN_HOSTS[0];
    const stable = core.DOMESTIC_CDN_HOSTS[1];
    const records = {
        [fast]: health(fast, { now, successes: 1, attempts: 2, worstMs: 80, mbps: 200 }),
        [stable]: health(stable, { now, successes: 2, attempts: 2, worstMs: 300, mbps: 20 })
    };
    assert.equal(core.rankCandidates(candidates, records, now)[0].host, stable);
});

test('current video candidates can be reranked after benchmarking', () => {
    const now = Date.now();
    const payload = {
        code: 0,
        data: { dash: { video: [dashEntry(COS, [AKAMAI])] } }
    };
    const result = core.transformPlayInfo(payload, {}, now);
    const fast = core.DOMESTIC_CDN_HOSTS[0];
    const chosen = core.DOMESTIC_CDN_HOSTS[1];
    const records = {
        [fast]: health(fast, { now, worstMs: 500, mbps: 200 }),
        [chosen]: health(chosen, { now, worstMs: 100, mbps: 20 })
    };

    assert.equal(result.winnerHost, core.hostOf(COS));
    assert.equal(
        core.rankCandidates(result.selectionCandidates, records, now)[0].host,
        chosen
    );
});

test('fresh domestic cache avoids probing all fourteen routes again', () => {
    const now = Date.now();
    const routes = core.planFromCandidates(core.buildCandidates([COS, AKAMAI]));
    const records = Object.fromEntries(routes.map(route => [
        route.host,
        health(route.host, { now })
    ]));
    assert.equal(routes.length, 16);
    assert.equal(core.planProbeWork(routes, records, now, core.hostOf(COS)).kind, 'none');
    assert.equal(core.planProbeWork(routes, records, now, core.hostOf(COS), true).routes.length, 16);
});


test('all failed synthetic routes preserve native order even with a PCDN primary', () => {
    const now = Date.now();
    const pcdn = 'https://xy1x2x3x4xy.mcdn.bilivideo.cn:4483/upgcxcode/01/23/video.m4s?os=mcdn';
    const entry = dashEntry(pcdn, [COS, AKAMAI]);
    const payload = { code: 0, data: { dash: { video: [entry] } } };
    const records = Object.fromEntries(core.DOMESTIC_CDN_HOSTS.map(host => [
        host,
        health(host, { now, ok: false, successes: 0 })
    ]));
    core.transformPlayInfo(payload, records, now);
    assert.equal(entry.baseUrl, pcdn);
    assert.deepEqual(entry.backupUrl, [COS, AKAMAI]);
});


test('manual TF route uses a safe donor and leaves native fallback intact', () => {
    const host = core.DOMESTIC_CDN_HOSTS.at(-1);
    const entry = dashEntry(COS, [AKAMAI]);
    const payload = { code: 0, data: { dash: { video: [entry] } } };
    const result = core.transformPlayInfo(payload, {}, Date.now(), {
        mode: 'manual',
        manualTarget: host
    });
    assert.equal(result.manualMatched, 1);
    assert.equal(entry.baseUrl, COS.replace(core.hostOf(COS), host));
    assert.deepEqual(entry.backupUrl.slice(0, 2), [COS, AKAMAI]);

    const noDonor = dashEntry(AKAMAI, []);
    const second = { code: 0, data: { dash: { video: [noDonor] } } };
    const missed = core.transformPlayInfo(second, {}, Date.now(), {
        mode: 'manual',
        manualTarget: host
    });
    assert.equal(missed.manualMissed, 1);
    assert.equal(noDonor.baseUrl, AKAMAI);
    assert.deepEqual(noDonor.backupUrl, []);
});


test('failed synthetic pool restores native order despite a healthy native backup', () => {
    const now = Date.now();
    const entry = dashEntry(COS, [AKAMAI]);
    const payload = { code: 0, data: { dash: { video: [entry] } } };
    const records = Object.fromEntries(core.DOMESTIC_CDN_HOSTS.map(host => [
        host,
        health(host, { now, ok: false, successes: 0 })
    ]));
    records[core.hostOf(AKAMAI)] = health(core.hostOf(AKAMAI), {
        now,
        worstMs: 100
    });
    core.transformPlayInfo(payload, records, now);
    assert.equal(entry.baseUrl, COS);
    assert.deepEqual(entry.backupUrl, [AKAMAI]);
});

test('a failed domestic route enters cooldown without hiding a healthy route', () => {
    const now = Date.now();
    const failedHost = core.DOMESTIC_CDN_HOSTS[0];
    const healthyHost = core.DOMESTIC_CDN_HOSTS[1];
    const failed = core.aggregateProbeSamples(failedHost, [
        { ok: false, mbps: 0, ttfbMs: 0, totalMs: 6500 },
        { ok: false, mbps: 0, ttfbMs: 0, totalMs: 6500 }
    ], now);
    const healthy = core.aggregateProbeSamples(healthyHost, [
        { ok: true, mbps: 20, ttfbMs: 80, totalMs: 250 },
        { ok: true, mbps: 18, ttfbMs: 90, totalMs: 270 }
    ], now);
    assert.equal(failed.ok, false);
    assert.equal(healthy.ok, true);
    assert.equal(core.healthTtlMs(failed), core.FAILED_HEALTH_TTL_MS);
    assert.equal(core.healthTtlMs(healthy), core.HEALTH_TTL_MS);

    const entry = dashEntry(COS);
    const payload = { code: 0, data: { dash: { video: [entry] } } };
    const result = core.transformPlayInfo(payload, {
        [failedHost]: failed,
        [healthyHost]: healthy
    }, now);
    assert.equal(result.winnerHost, healthyHost);
    assert.equal(core.hostOf(entry.baseUrl), healthyHost);
    assert.ok(entry.backupUrl.includes(COS));
});
