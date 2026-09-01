// ==UserScript==
// @name         General Background Session Keeper
// @namespace    https://nidushan.com
// @version      3.2.2
// @description  Keeps DIBS and Riverty sessions active and resumes login when their login pages appear
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   mailto:jas@nortronic.com
// @match        https://portal.dibspayment.eu/*
// @match        https://horizon.gothiagroup.com/HorizonWeb/*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/General%20Background%20Auto%20Refresh.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/General%20Background%20Auto%20Refresh.user.js
// @grant        none
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

    let refreshTimer = null;
    let loginTimer = null;
    let loginAttempted = false;
    let loginRefreshReset = false;
    let memoryNextRefreshTime = null;

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

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) wakeSessionKeeper();
    });

    window.addEventListener('pageshow', wakeSessionKeeper);
    window.addEventListener('pagehide', clearTimers);

    wakeSessionKeeper();

})();
