// ==UserScript==
// @name         General Custom Icons
// @namespace    https://nidushan.com
// @version      2.5.0
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
    const FAVICON_MARKER = 'data-userscript-favicon';
    const DISABLED_ICON_MARKER = 'data-userscript-favicon-disabled';
    const ORIGINAL_REL_ATTRIBUTE = 'data-userscript-favicon-original-rel';

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
    const failedFaviconHrefs = new Set();
    const faviconErrorBoundLinks = new WeakSet();
    let routeTimer = null;

    function normalizePathname(pathname = location.pathname) {
        const normalized = String(pathname || '/')
            .replace(/\/{2,}/g, '/')
            .replace(/\/+$/, '');

        return normalized || '/';
    }

    function getConfigForCurrentPage() {
        const pathname = normalizePathname();

        return PAGE_CONFIG.find(config =>
            location.hostname === config.host &&
            config.pathRegex.test(pathname)
        ) || null;
    }

    function getRouteKey() {
        return `${location.hostname}${normalizePathname()}`;
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
            `link[${FAVICON_MARKER}="true"]`
        ).forEach(link => link.remove());
    }

    function isIconRelationship(rel) {
        const tokens = String(rel || '')
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);

        return tokens.includes('icon') ||
            tokens.includes('apple-touch-icon') ||
            tokens.includes('apple-touch-icon-precomposed') ||
            tokens.includes('mask-icon');
    }

    function neutralizeConflictingFavicons() {
        if (!document.head) return;

        document.querySelectorAll('link[rel]').forEach(link => {
            if (link.getAttribute(FAVICON_MARKER) === 'true') return;

            const rel = link.getAttribute('rel');
            if (!isIconRelationship(rel)) return;

            if (!link.hasAttribute(ORIGINAL_REL_ATTRIBUTE)) {
                link.setAttribute(ORIGINAL_REL_ATTRIBUTE, rel);
            }

            link.setAttribute(DISABLED_ICON_MARKER, 'true');
            link.removeAttribute('rel');
        });
    }

    function restoreConflictingFavicons() {
        document.querySelectorAll(
            `link[${DISABLED_ICON_MARKER}="true"]`
        ).forEach(link => {
            const originalRel = link.getAttribute(ORIGINAL_REL_ATTRIBUTE);

            if (!link.hasAttribute('rel') && originalRel) {
                link.setAttribute('rel', originalRel);
            }

            link.removeAttribute(DISABLED_ICON_MARKER);
            link.removeAttribute(ORIGINAL_REL_ATTRIBUTE);
        });
    }

    function reportFaviconFailure(href) {
        if (failedFaviconHrefs.has(href)) return;

        failedFaviconHrefs.add(href);
        window.console?.warn?.(
            '[General Custom Icons] The configured favicon could not be loaded.'
        );
    }

    function handleFaviconError(event) {
        const link = event.currentTarget;
        const href = link?.getAttribute('href') || '';

        if (!href || href !== currentFaviconHref) return;

        reportFaviconFailure(href);
        currentFaviconHref = null;
        link.remove();
        restoreConflictingFavicons();
    }

    function getCanonicalFavicon() {
        const managedIcons = Array.from(document.querySelectorAll(
            `link[${FAVICON_MARKER}="true"]`
        ));
        let canonical = managedIcons.shift() || null;

        managedIcons.forEach(link => link.remove());

        if (!canonical) {
            canonical = document.createElement('link');
            canonical.setAttribute(FAVICON_MARKER, 'true');
            document.head.appendChild(canonical);
        }

        if (!faviconErrorBoundLinks.has(canonical)) {
            canonical.addEventListener('error', handleFaviconError);
            faviconErrorBoundLinks.add(canonical);
        }

        return canonical;
    }

    function applyFavicon(config) {
        if (!config || !document.head) return;

        const href = createEmojiSvgFavicon(config.emoji);

        if (failedFaviconHrefs.has(href)) return;

        currentFaviconHref = href;
        neutralizeConflictingFavicons();

        const canonical = getCanonicalFavicon();

        if (canonical.getAttribute('rel') !== 'icon') {
            canonical.setAttribute('rel', 'icon');
        }

        if (canonical.getAttribute('type') !== 'image/svg+xml') {
            canonical.setAttribute('type', 'image/svg+xml');
        }

        if (canonical.getAttribute('sizes') !== 'any') {
            canonical.setAttribute('sizes', 'any');
        }

        if (canonical.getAttribute('href') !== href) {
            canonical.setAttribute('href', href);
        }
    }

    function faviconIsCorrect() {
        if (!currentFaviconHref) return false;

        const customIcons = Array.from(document.querySelectorAll(
            `link[${FAVICON_MARKER}="true"]`
        ));

        if (
            customIcons.length !== 1 ||
            customIcons[0].getAttribute('href') !== currentFaviconHref ||
            customIcons[0].getAttribute('rel') !== 'icon' ||
            customIcons[0].getAttribute('type') !== 'image/svg+xml'
        ) {
            return false;
        }

        return !Array.from(document.querySelectorAll('link[rel]')).some(
            link =>
                link !== customIcons[0] &&
                isIconRelationship(link.getAttribute('rel'))
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
                FAVICON_MARKER,
                DISABLED_ICON_MARKER,
                ORIGINAL_REL_ATTRIBUTE,
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
        restoreConflictingFavicons();

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
            ? `${getRouteKey()}|${config.title}|${config.emoji}`
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
            currentFaviconHref = null;
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
