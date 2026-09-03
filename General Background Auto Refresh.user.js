// ==UserScript==
// @name         General Background Session Keeper
// @namespace    https://nidushan.com
// @version      3.3.0
// @description  Opens the DIBS and Horizon tabs, keeps their sessions active, and logs back in automatically
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   mailto:jas@nortronic.com
// @match        https://portal.dibspayment.eu/*
// @match        https://horizon.gothiagroup.com/HorizonWeb/*
// @match        https://nidushan.com/*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/General%20Background%20Auto%20Refresh.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/General%20Background%20Auto%20Refresh.user.js
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const INSTANCE_KEY = '__generalBackgroundSessionKeeperInitialized';

    if (window[INSTANCE_KEY]) return;
    window[INSTANCE_KEY] = true;

    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const ACTIVE_RETRY_MS = 30 * 1000;
    const LOGIN_RETRY_MS = 1000;
    const LOGIN_WAIT_MS = 30 * 1000;
    const LOGIN_COOLDOWN_MS = 5 * 60 * 1000;
    const ONLY_REFRESH_IN_BACKGROUND = true;

    const STORAGE_KEY = 'general_session_keeper_next_refresh_v3';

    const LOGIN_PAGES = [
        {
            host: 'portal.dibspayment.eu',
            isLoginPage: () => location.pathname === '/',
            detectByLoginForm: true,
            requiresVerifiedForm: true,
            requiresPasswordField: true,
            buttonXPath: '/html/body/div[2]/section/div/div[1]/div[2]/form/div[3]/button',
            fallbackSelectors: [
                'form button[type="submit"]',
                'form button:not([type])'
            ]
        },
        {
            host: 'horizon.gothiagroup.com',
            isLoginPage: () =>
                location.pathname.toLowerCase().endsWith(
                    '/horizonweb/portal/webforms/loginpage.aspx'
                ),
            buttonXPath: '/html/body/form/div[2]/table/tbody/tr[2]/td[3]/table/tbody/tr[2]/td[2]/div/div/table/tbody/tr/td[2]/table/tbody/tr[3]/td/input',
            fallbackSelectors: [
                'form input[type="submit"]'
            ]
        }
    ];

    const LAUNCHER_HOST = 'nidushan.com';

    const TARGET_URLS = [
        'https://portal.dibspayment.eu/',
        'https://horizon.gothiagroup.com/HorizonWeb/'
    ];

    const HEARTBEAT_KEY_PREFIX = 'gsk_heartbeat_';
    const OPEN_CLAIM_KEY_PREFIX = 'gsk_opening_';
    const CREDS_KEY_PREFIX = 'gsk_creds_';
    const LAUNCHER_THROTTLE_KEY = 'gsk_launcher_last_open';
    const HEARTBEAT_STALE_MS = 15 * 60 * 1000;
    const OPEN_CLAIM_MS = 60 * 1000;
    const OPEN_THROTTLE_MS = 10 * 60 * 1000;
    const PARTNER_CLAIM_JITTER_MS = 4000;

    function hostFromUrl(url) {
        try {
            return new URL(url).hostname;
        } catch {
            return null;
        }
    }

    function keyForHost(prefix, host) {
        return prefix + String(host).replace(/\./g, '_');
    }

    function isTargetHost(host) {
        return TARGET_URLS.some(function (url) {
            return hostFromUrl(url) === host;
        });
    }

    function partnerInfo() {
        return TARGET_URLS
            .map(function (url) {
                return {
                    host: hostFromUrl(url),
                    url: url
                };
            })
            .filter(function (info) {
                return info.host && info.host !== location.hostname;
            })[0] || null;
    }

    function writeHeartbeat() {
        if (!isTargetHost(location.hostname)) return;

        try {
            GM_setValue(
                keyForHost(HEARTBEAT_KEY_PREFIX, location.hostname),
                Date.now()
            );
        } catch {
            // Storage unavailable; the refresh loop still works on this tab.
        }
    }

    function openTabInBackground(url) {
        try {
            GM_openInTab(url, {
                active: false,
                insert: true,
                setParent: true
            });
            return true;
        } catch {
            return false;
        }
    }

    function claimAndOpen(url) {
        const host = hostFromUrl(url);

        if (!host) return false;

        const claimKey = keyForHost(OPEN_CLAIM_KEY_PREFIX, host);
        const now = Date.now();

        try {
            const claimUntil = Number(GM_getValue(claimKey, 0));

            if (Number.isFinite(claimUntil) && claimUntil > now) {
                return false;
            }

            GM_setValue(claimKey, now + OPEN_CLAIM_MS);
        } catch {
            return openTabInBackground(url);
        }

        const opened = openTabInBackground(url);

        if (!opened) {
            try {
                GM_setValue(claimKey, 0);
            } catch {
                // Ignore cleanup failures.
            }
        }

        return opened;
    }

    function partnerHeartbeatIsStale() {
        if (!document.hidden) return false;

        const partner = partnerInfo();

        if (!partner) return false;

        try {
            const lastHeartbeat = Number(
                GM_getValue(
                    keyForHost(HEARTBEAT_KEY_PREFIX, partner.host),
                    0
                )
            );

            return !(
                Number.isFinite(lastHeartbeat) &&
                lastHeartbeat > Date.now() - HEARTBEAT_STALE_MS
            );
        } catch {
            return false;
        }
    }

    function maybeReopenPartner() {
        if (!partnerHeartbeatIsStale()) return;

        const partner = partnerInfo();

        if (!partner) return;

        if (!claimAndOpen(partner.url)) {
            // Another tab may have claimed the open. Try again shortly in
            // case that tab failed to actually open anything.
            window.setTimeout(function () {
                if (partnerHeartbeatIsStale()) {
                    claimAndOpen(partner.url);
                }
            }, PARTNER_CLAIM_JITTER_MS);
        }
    }

    function openBothTargetsFromLauncher() {
        try {
            const lastOpen = Number(GM_getValue(LAUNCHER_THROTTLE_KEY, 0));

            if (
                Number.isFinite(lastOpen) &&
                lastOpen > Date.now() - OPEN_THROTTLE_MS
            ) {
                return;
            }

            GM_setValue(LAUNCHER_THROTTLE_KEY, Date.now());
        } catch {
            // Proceed even if storage is unavailable.
        }

        TARGET_URLS.forEach(function (url, index) {
            window.setTimeout(function () {
                claimAndOpen(url);
            }, index * 250);
        });
    }

    function credsKey() {
        return keyForHost(CREDS_KEY_PREFIX, location.hostname);
    }

    function getStoredCredentials() {
        try {
            const raw = GM_getValue(credsKey(), '');

            if (typeof raw === 'string' && raw.length > 0) {
                const parsed = JSON.parse(raw);

                if (parsed && typeof parsed.username === 'string') {
                    return parsed;
                }
            }
        } catch {
            // No usable stored credentials.
        }

        return null;
    }

    function saveStoredCredentials(credentials) {
        try {
            GM_setValue(credsKey(), JSON.stringify(credentials));
        } catch {
            // Storage unavailable.
        }
    }

    function clearStoredCredentials() {
        try {
            GM_deleteValue(credsKey());
        } catch {
            // Nothing stored.
        }
    }

    function findLoginControls() {
        const form = document.querySelector('form');

        if (!form) {
            return { username: null, password: null, button: null };
        }

        const username = form.querySelector(
            'input[type="text"], input[type="email"], ' +
            'input[name*="user" i], input[id*="user" i], ' +
            'input[name*="name" i], input[id*="name" i]'
        );
        const password = form.querySelector('input[type="password"]');
        const button = form.querySelector(
            'button[type="submit"], input[type="submit"], button:not([type])'
        );

        return { username: username, password: password, button: button };
    }

    function setNativeValue(element, value) {
        const descriptor = Object.getOwnPropertyDescriptor(element, 'value');

        if (descriptor && descriptor.set) {
            descriptor.set.call(element, value);
        } else {
            element.value = value;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function fillCredentials(credentials) {
        const controls = findLoginControls();

        if (!controls.username || !controls.password) return false;

        credentialsFilled = true;

        setNativeValue(controls.username, credentials.username);
        setNativeValue(controls.password, credentials.password);

        if (controls.button) {
            try {
                controls.button.click();
            } catch {
                // Form submission continues below if the click fails.
            }
        }

        return true;
    }

    function registerMenuCommands() {
        if (!isTargetHost(location.hostname)) return;

        const siteLabel = location.hostname;

        GM_registerMenuCommand(
            'Save login credentials for ' + siteLabel,
            function () {
                const username = window.prompt('Username for ' + siteLabel + ':');

                if (username === null) return;

                const password = window.prompt(
                    'Password for ' + siteLabel + ' (' + username + '):'
                );

                if (password === null) return;

                saveStoredCredentials({
                    username: username.trim(),
                    password: password
                });
            }
        );

        GM_registerMenuCommand(
            'Clear saved login credentials for ' + siteLabel,
            function () {
                if (window.confirm('Remove saved login credentials for ' + siteLabel + '?')) {
                    clearStoredCredentials();
                }
            }
        );
    }

    let refreshTimer = null;
    let loginTimer = null;
    let loginAttempted = false;
    let loginRefreshReset = false;
    let memoryNextRefreshTime = null;
    let credentialsFilled = false;

    function getLoginPage() {
        return LOGIN_PAGES.find(page => {
            if (location.hostname !== page.host) return false;

            const verifiedFormDetected = Boolean(
                page.detectByLoginForm &&
                findLoginCandidates(page, false).length === 1
            );

            return page.requiresVerifiedForm
                ? verifiedFormDetected
                : page.isLoginPage() || verifiedFormDetected;
        }) || null;
    }

    function getElementByXPath(xpath) {
        try {
            return document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;
        } catch {
            return null;
        }
    }

    function elementIsVisible(element) {
        if (!element || !element.isConnected || element.hidden) return false;

        try {
            const style = window.getComputedStyle(element);

            if (
                style &&
                (style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    style.visibility === 'collapse')
            ) {
                return false;
            }
        } catch {
            // Visibility can still be checked from layout information below.
        }

        return (
            typeof element.getClientRects !== 'function' ||
            element.getClientRects().length > 0
        );
    }

    function elementIsEnabled(element) {
        return Boolean(
            element &&
            !element.disabled &&
            element.getAttribute('aria-disabled') !== 'true'
        );
    }

    function loginControlMatchesPage(element, page) {
        if (!elementIsVisible(element)) return false;

        const tagName = element.tagName?.toLowerCase();
        const type = (element.getAttribute('type') || '').toLowerCase();
        const isSubmitButton =
            tagName === 'button' && (type === '' || type === 'submit');
        const isSubmitInput =
            tagName === 'input' && (type === 'submit' || type === 'button');

        if (!isSubmitButton && !isSubmitInput) return false;

        const form = element.form || element.closest?.('form');

        if (!form) return false;

        if (
            page.requiresPasswordField &&
            !form.querySelector?.(
                'input[type="password"]:not([disabled])'
            )
        ) {
            return false;
        }

        return true;
    }

    function loginControlIsReady(element, page) {
        if (!loginControlMatchesPage(element, page)) return false;
        if (!elementIsEnabled(element)) return false;

        const form = element.form || element.closest?.('form');

        try {
            return typeof form.checkValidity === 'function' &&
                form.checkValidity();
        } catch {
            return false;
        }
    }

    function findLoginCandidates(page, requireReady = true) {
        const candidates = new Set();
        const xpathButton = getElementByXPath(page.buttonXPath);

        if (xpathButton) candidates.add(xpathButton);

        for (const selector of page.fallbackSelectors) {
            try {
                document.querySelectorAll(selector).forEach(candidate => {
                    candidates.add(candidate);
                });
            } catch {
                // Ignore a site selector that is no longer valid.
            }
        }

        return Array.from(candidates).filter(candidate =>
            requireReady
                ? loginControlIsReady(candidate, page)
                : loginControlMatchesPage(candidate, page)
        );
    }

    function findLoginButton(page) {
        const validCandidates = findLoginCandidates(page);

        return validCandidates.length === 1 ? validCandidates[0] : null;
    }

    function clearLoginTimer() {
        if (loginTimer === null) return;

        clearTimeout(loginTimer);
        loginTimer = null;
    }

    function scheduleLoginRecoveryReload() {
        clearLoginTimer();

        loginTimer = window.setTimeout(() => {
            loginTimer = null;

            if (!getLoginPage()) {
                resumeRefreshAfterLogin();
                return;
            }

            location.reload();
        }, LOGIN_COOLDOWN_MS);
    }

    function tryLogin(page) {
        if (loginAttempted) return;

        const deadline = Date.now() + LOGIN_WAIT_MS;

        function attempt() {
            loginTimer = null;

            if (loginAttempted) return;

            const currentPage = getLoginPage();

            if (!currentPage) {
                resumeRefreshAfterLogin();
                return;
            }

            if (currentPage !== page) return;

            // If stored credentials exist, fill the form and submit as soon
            // as the controls are found instead of waiting for autofill.
            if (!credentialsFilled) {
                const credentials = getStoredCredentials();

                if (credentials) {
                    const filled = fillCredentials(credentials);

                    if (filled) {
                        loginAttempted = true;
                        scheduleLoginRecoveryReload();
                        return;
                    }
                }
            }

            const button = findLoginButton(page);

            if (button) {
                loginAttempted = true;

                try {
                    button.click();
                } catch {
                    // Reloading later is safer than repeatedly submitting the
                    // same form after a failed programmatic click.
                }

                scheduleLoginRecoveryReload();
                return;
            }

            if (Date.now() < deadline) {
                loginTimer = window.setTimeout(attempt, LOGIN_RETRY_MS);
            } else {
                scheduleLoginRecoveryReload();
            }
        }

        attempt();
    }

    function resetLoginState() {
        clearLoginTimer();
        loginAttempted = false;
        loginRefreshReset = false;
        credentialsFilled = false;
    }

    function resumeRefreshAfterLogin() {
        resetLoginState();
        scheduleCheck(0);
    }

    function readNextRefreshTime() {
        try {
            const stored = Number(localStorage.getItem(STORAGE_KEY));
            if (Number.isFinite(stored) && stored > 0) return stored;
        } catch {
            // Fall back to the in-memory schedule below.
        }

        return memoryNextRefreshTime;
    }

    function saveNextRefreshTime(timestamp) {
        memoryNextRefreshTime = timestamp;

        try {
            localStorage.setItem(STORAGE_KEY, String(timestamp));
        } catch {
            // The in-memory timer still works when storage is unavailable.
        }
    }

    function createNextRefreshTime() {
        const timestamp = Date.now() + REFRESH_INTERVAL_MS;
        saveNextRefreshTime(timestamp);
        return timestamp;
    }

    function getNextRefreshTime() {
        const stored = readNextRefreshTime();

        if (
            stored === null ||
            stored > Date.now() + REFRESH_INTERVAL_MS
        ) {
            return createNextRefreshTime();
        }

        return stored;
    }

    function scheduleCheck(delay) {
        if (refreshTimer !== null) {
            clearTimeout(refreshTimer);
        }

        refreshTimer = window.setTimeout(() => {
            refreshTimer = null;
            checkRefresh();
        }, Math.max(0, delay));
    }

    function checkRefresh() {
        if (isTargetHost(location.hostname)) {
            writeHeartbeat();
            maybeReopenPartner();
        }

        const loginPage = getLoginPage();

        if (loginPage) {
            if (!loginRefreshReset) {
                createNextRefreshTime();
                loginRefreshReset = true;
            }

            if (loginTimer === null && !loginAttempted) {
                tryLogin(loginPage);
            }
            return;
        }

        if (
            loginTimer !== null ||
            loginAttempted ||
            loginRefreshReset
        ) {
            resetLoginState();
        }

        const nextRefreshTime = getNextRefreshTime();
        const remaining = nextRefreshTime - Date.now();

        if (remaining <= 0) {
            if (ONLY_REFRESH_IN_BACKGROUND && !document.hidden) {
                scheduleCheck(ACTIVE_RETRY_MS);
                return;
            }

            createNextRefreshTime();
            location.reload();
            return;
        }

        scheduleCheck(Math.min(remaining, 60 * 1000));
    }

    function clearTimers() {
        if (refreshTimer !== null) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }

        clearLoginTimer();
        loginAttempted = false;
    }

    function wakeSessionKeeper() {
        scheduleCheck(0);
    }

    // If this is the launcher page, just open both target tabs and stop.
    // Nothing on the launcher needs session keeping or refreshing.
    if (location.hostname === LAUNCHER_HOST) {
        openBothTargetsFromLauncher();
        return;
    }

    registerMenuCommands();

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) wakeSessionKeeper();
    });

    window.addEventListener('pageshow', wakeSessionKeeper);
    window.addEventListener('pagehide', clearTimers);

    wakeSessionKeeper();

})();
