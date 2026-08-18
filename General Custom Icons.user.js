// ==UserScript==
// @name         General Custom Icons
// @namespace    https://nidushan.com
// @version      2.2
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
            host: 'paymanager.logos.dk',
            pathRegex: /^\/transactions(\/|$)/,
            title: 'Transactions',
            emoji: '💳'
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
        }
    ];

    let currentConfig = null;
    let currentFaviconHref = null;
    let titleInterval = null;
    let faviconInterval = null;
    let headObserver = null;
    let lastUrl = location.href;
    let lastAppliedKey = '';

    function getConfigForCurrentPage() {
        return PAGE_CONFIG.find(config =>
            location.hostname === config.host &&
            config.pathRegex.test(location.pathname)
        );
    }

    function whenHeadReady(callback) {
        if (document.head) {
            callback();
            return;
        }

        const interval = setInterval(() => {
            if (document.head) {
                clearInterval(interval);
                callback();
            }
        }, 50);
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

        const icons = document.querySelectorAll(
            'link[rel~="icon"]'
        );

        if (!icons.length) return false;

        const lastIcon = icons[icons.length - 1];

        return (
            lastIcon.dataset.userscriptFavicon === 'true' &&
            lastIcon.href === currentFaviconHref
        );
    }

    function enforceFavicon(config) {
        if (!config) return;

        whenHeadReady(() => {
            applyFavicon(config);

            if (headObserver) {
                headObserver.disconnect();
            }

            headObserver = new MutationObserver(() => {
                if (!faviconIsCorrect()) {
                    applyFavicon(config);
                }
            });

            headObserver.observe(document.head, {
                childList: true,
                subtree: true
            });

            if (faviconInterval) {
                clearInterval(faviconInterval);
            }

            let attempts = 0;

            faviconInterval = setInterval(() => {
                attempts++;

                if (!faviconIsCorrect()) {
                    applyFavicon(config);
                }

                if (attempts >= 40) {
                    clearInterval(faviconInterval);

                    faviconInterval = setInterval(() => {
                        if (currentConfig && !faviconIsCorrect()) {
                            applyFavicon(currentConfig);
                        }
                    }, 10000);
                }
            }, 500);
        });
    }

    function applyTitle(config) {
        if (!config) return;

        document.title = config.title;

        if (titleInterval) {
            clearInterval(titleInterval);
        }

        let attempts = 0;

        titleInterval = setInterval(() => {
            attempts++;

            if (document.title !== config.title) {
                document.title = config.title;
            }

            if (attempts >= 60) {
                clearInterval(titleInterval);

                titleInterval = setInterval(() => {
                    if (
                        currentConfig &&
                        document.title !== currentConfig.title
                    ) {
                        document.title = currentConfig.title;
                    }
                }, 5000);
            }
        }, 500);
    }

    function stopEnforcement() {
        if (titleInterval) {
            clearInterval(titleInterval);
            titleInterval = null;
        }

        if (faviconInterval) {
            clearInterval(faviconInterval);
            faviconInterval = null;
        }

        if (headObserver) {
            headObserver.disconnect();
            headObserver = null;
        }

        currentFaviconHref = null;
        removeCustomFavicons();
    }

    function applySettings() {
        const config = getConfigForCurrentPage();

        if (!config) {
            if (currentConfig) {
                stopEnforcement();
            }

            currentConfig = null;
            lastAppliedKey = '';
            return;
        }

        const key = `${location.pathname}|${config.title}`;

        if (key === lastAppliedKey) {
            return;
        }

        lastAppliedKey = key;
        currentConfig = config;

        applyTitle(config);
        enforceFavicon(config);
    }

    function handleUrlChange() {
        if (location.href === lastUrl) {
            return;
        }

        lastUrl = location.href;

        setTimeout(() => {
            applySettings();
        }, 150);
    }

    function hookHistoryNavigation() {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function () {
            const result = originalPushState.apply(this, arguments);

            setTimeout(handleUrlChange, 50);

            return result;
        };

        history.replaceState = function () {
            const result = originalReplaceState.apply(this, arguments);

            setTimeout(handleUrlChange, 50);

            return result;
        };

        window.addEventListener('popstate', () => {
            setTimeout(handleUrlChange, 50);
        });
    }

    hookHistoryNavigation();

    whenHeadReady(() => {
        applySettings();
    });

})();
