// ==UserScript==
// @name         General Custom Icons
// @namespace    https://nidushan.com
// @version      2.4.1
// @description  Custom tab titles and persistent favicons for PassPay and PayManager pages
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   mailto:jas@nortronic.com
// @match        https://betaling.passpay.no/*
// @match        https://paymanager.logos.dk/*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/General%20Custom%20Icons.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/General%20Custom%20Icons.user.js
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const INSTANCE_KEY = '__generalCustomIconsInitialized';
    const HISTORY_PATCH_KEY = '__generalCustomIconsHistoryPatched';

    if (window[INSTANCE_KEY]) return;
    window[INSTANCE_KEY] = true;

    const HEAD_WAIT_TIMEOUT_MS = 10 * 1000;
    const ROUTE_SETTLE_MS = 150;

    const PAGE_CONFIG = [
        {
            host: 'betaling.passpay.no',
            pathRegex: /^\/locations(\/|$)/,
            title: 'Locations',
            emoji: '📍'
        },
        {
            host: 'betaling.passpay.no',
            pathRegex: /^\/search(\/|$)/,
            title: 'Search',
            emoji: '🔍'
        },
        {
            host: 'betaling.passpay.no',
            pathRegex: /^\/administration(\/|$)/,
            title: 'Admin',
            emoji: '⚙️'
        },
        {
            host: 'betaling.passpay.no',
            pathRegex: /^\/place-administration(\/|$)/,
            title: 'Loc-Admin',
            emoji: '📌'
        },
        {
            host: 'betaling.passpay.no',
            pathRegex: /^\/vehicles(\/|$)/,
            title: 'Car',
            emoji: '🚗'
        },
        {
            host: 'betaling.passpay.no',
            pathRegex: /^\/bookings(\/|$)/,
            title: 'Booking',
            emoji: '📅'
        },
        {
            host: 'betaling.passpay.no',
            pathRegex: /^\/payments(\/|$)/,
            title: 'Payments',
            emoji: '💳'
        },
        {
            host: 'betaling.passpay.no',
            pathRegex: /^\/site-administration(\/|$)/,
            title: 'Site-Admin',
            emoji: '🛠️'
        },
        {
            host: 'paymanager.logos.dk',
            pathRegex: /^\/transactions(\/|$)/,
            title: 'Transactions',
            emoji: '🧾'
        },
        {
            host: 'paymanager.logos.dk',
            pathRegex: /^\/terminals(\/|$)/,
            title: 'Terminals',
            emoji: '📟'
        },
        {
            host: 'paymanager.logos.dk',
            pathRegex: /^\/parking(\/|$)/,
            title: 'Parking',
            emoji: '🅿️'
        },
        {
            host: 'paymanager.logos.dk',
            pathRegex: /^\/files(\/|$)/,
            title: 'Files',
            emoji: '📂'
        },
        {
            host: 'paymanager.logos.dk',
            pathRegex: /^\/user_administration(\/|$)/,
            title: 'User-Admin',
            emoji: '🛡️'
        }
    ];

    const nativeTitlesByPath = new Map();

    let currentConfig = null;
    let currentFaviconHref = null;
    let defaultNativeTitle = '';
    let lastUrl = location.href;
    let lastAppliedKey = '';
    let observedHead = null;
    let headObserver = null;
    let documentObserver = null;
    let headWaitObserver = null;
    let headWaitTimer = null;
    const pendingHeadCallbacks = [];
    let routeTimer = null;

    function getConfigForCurrentPage() {
        return PAGE_CONFIG.find(config =>
            location.hostname === config.host &&
            config.pathRegex.test(location.pathname)
        ) || null;
    }

    function getRouteKey() {
        return `${location.hostname}${location.pathname}`;
    }

    function rememberNativeTitle(forcedConfig = currentConfig) {
        const title = document.title;

        if (!title || (forcedConfig && title === forcedConfig.title)) return;

        nativeTitlesByPath.set(getRouteKey(), title);

        if (!defaultNativeTitle) {
            defaultNativeTitle = title;
        }
    }

    function clearHeadWait() {
        if (headWaitObserver) {
            headWaitObserver.disconnect();
            headWaitObserver = null;
        }

        if (headWaitTimer !== null) {
            clearTimeout(headWaitTimer);
            headWaitTimer = null;
        }
    }

    function finishHeadWait(found) {
        const callbacks = pendingHeadCallbacks.splice(0);

        clearHeadWait();

        if (found) callbacks.forEach(callback => callback());
    }

    function whenHeadReady(callback) {
        if (document.head) {
            callback();
            return;
        }

        pendingHeadCallbacks.push(callback);

        if (headWaitObserver) return;

        headWaitObserver = new MutationObserver(() => {
            if (document.head) finishHeadWait(true);
        });

        headWaitObserver.observe(document, {
            childList: true,
            subtree: true
        });

        headWaitTimer = window.setTimeout(() => {
            finishHeadWait(Boolean(document.head));
        }, HEAD_WAIT_TIMEOUT_MS);
    }

    function createEmojiSvgFavicon(emoji) {
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
                <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-size="52">
                    ${emoji}
                </text>
            </svg>
        `.trim();

        return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    function removeCustomFavicons() {
        document.querySelectorAll(
            'link[data-userscript-favicon="true"]'
        ).forEach(link => link.remove());
    }

    function addFavicon(rel, href) {
        const link = document.createElement('link');

        link.rel = rel;
        link.href = href;

        if (rel === 'icon' || rel === 'shortcut icon') {
            link.type = 'image/svg+xml';
        }

        link.setAttribute('data-userscript-favicon', 'true');
        document.head.appendChild(link);
    }

    function applyFavicon(config) {
        if (!config || !document.head) return;

        const href = createEmojiSvgFavicon(config.emoji);

        currentFaviconHref = href;

        removeCustomFavicons();

        addFavicon('icon', href);
        addFavicon('shortcut icon', href);
        addFavicon('apple-touch-icon', href);
    }

    function faviconIsCorrect() {
        if (!currentFaviconHref) return false;

        const customIcons = Array.from(document.querySelectorAll(
            'link[data-userscript-favicon="true"]'
        ));

        if (
            customIcons.length !== 3 ||
            customIcons.some(
                icon => icon.getAttribute('href') !== currentFaviconHref
            )
        ) {
            return false;
        }

        const icons = document.querySelectorAll('link[rel~="icon"]');
        const lastIcon = icons[icons.length - 1];

        return Boolean(
            lastIcon &&
            lastIcon.dataset.userscriptFavicon === 'true' &&
            lastIcon.getAttribute('href') === currentFaviconHref
        );
    }

    function enforceCurrentSettings() {
        if (!currentConfig || !document.head) return;

        if (document.title !== currentConfig.title) {
            document.title = currentConfig.title;
        }

        if (!faviconIsCorrect()) {
            applyFavicon(currentConfig);
        }
    }

    function disconnectHeadObserver() {
        if (headObserver) {
            headObserver.disconnect();
            headObserver = null;
        }

        observedHead = null;
    }

    function observeCurrentHead() {
        if (!document.head) return;

        disconnectHeadObserver();
        observedHead = document.head;

        headObserver = new MutationObserver(() => {
            if (!currentConfig) return;

            rememberNativeTitle(currentConfig);
            enforceCurrentSettings();
        });

        headObserver.observe(document.head, {
            attributes: true,
            attributeFilter: [
                'data-userscript-favicon',
                'href',
                'rel'
            ],
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    function observeHeadReplacement() {
        if (!document.documentElement) return;

        if (documentObserver) {
            documentObserver.disconnect();
        }

        documentObserver = new MutationObserver(() => {
            if (!currentConfig || document.head === observedHead) return;

            whenHeadReady(() => {
                observeCurrentHead();
                enforceCurrentSettings();
            });
        });

        documentObserver.observe(document.documentElement, {
            childList: true
        });
    }

    function stopEnforcement(previousConfig) {
        disconnectHeadObserver();
        currentFaviconHref = null;
        removeCustomFavicons();

        if (previousConfig && document.title === previousConfig.title) {
            document.title =
                nativeTitlesByPath.get(getRouteKey()) ||
                defaultNativeTitle ||
                '';
        }
    }

    function applySettings(force = false) {
        const config = getConfigForCurrentPage();
        const key = config
            ? `${location.hostname}${location.pathname}|${config.title}`
            : '';

        if (!config) {
            if (currentConfig) {
                const previousConfig = currentConfig;

                currentConfig = null;
                lastAppliedKey = '';
                stopEnforcement(previousConfig);
            }
            return;
        }

        if (key !== lastAppliedKey) {
            rememberNativeTitle(currentConfig);
            currentConfig = config;
            lastAppliedKey = key;
        }

        whenHeadReady(() => {
            if (force || document.head !== observedHead || !headObserver) {
                observeCurrentHead();
            }

            enforceCurrentSettings();
        });
    }

    function scheduleApplySettings(delay = ROUTE_SETTLE_MS, force = false) {
        if (routeTimer !== null) {
            clearTimeout(routeTimer);
        }

        routeTimer = window.setTimeout(() => {
            routeTimer = null;
            applySettings(force);
        }, delay);
    }

    function handleUrlChange() {
        if (location.href === lastUrl) return;

        lastUrl = location.href;
        scheduleApplySettings();
    }

    function hookHistoryNavigation() {
        if (history[HISTORY_PATCH_KEY]) return;

        history[HISTORY_PATCH_KEY] = true;

        for (const methodName of ['pushState', 'replaceState']) {
            const originalMethod = history[methodName];

            history[methodName] = function () {
                const result = originalMethod.apply(this, arguments);

                handleUrlChange();
                return result;
            };
        }

        window.addEventListener('popstate', handleUrlChange);
        window.addEventListener('hashchange', handleUrlChange);
    }

    function suspendEnforcement() {
        if (routeTimer !== null) {
            clearTimeout(routeTimer);
            routeTimer = null;
        }

        clearHeadWait();
        pendingHeadCallbacks.length = 0;
        disconnectHeadObserver();

        if (documentObserver) {
            documentObserver.disconnect();
            documentObserver = null;
        }
    }

    hookHistoryNavigation();

    whenHeadReady(() => {
        rememberNativeTitle(null);
        observeHeadReplacement();
        applySettings(true);
    });

    window.addEventListener('pagehide', suspendEnforcement);
    window.addEventListener('pageshow', () => {
        whenHeadReady(() => {
            observeHeadReplacement();
            applySettings(true);
        });
    });

})();
