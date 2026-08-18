// ==UserScript==
// @name         General Background Session Keeper
// @namespace    https://nidushan.com
// @version      3.0
// @description  Keeps DIBS and Riverty sessions active and resumes login when their login pages appear
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   https://nidushan.com
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

    const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    const ACTIVE_RETRY_MS = 30 * 1000;
    const LOGIN_RETRY_MS = 1000;
    const LOGIN_WAIT_MS = 30 * 1000;
    const ONLY_REFRESH_IN_BACKGROUND = true;

    const STORAGE_KEY = 'general_session_keeper_next_refresh_v3';

    const LOGIN_PAGES = [
        {
            host: 'portal.dibspayment.eu',
            isLoginPage: () => location.pathname === '/',
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
                'form input[type="submit"]',
                'form input[type="button"]'
            ]
        }
    ];

    let refreshTimer = null;
    let loginTimer = null;
    let loginClicked = false;
    let memoryNextRefreshTime = null;

    function getLoginPage() {
        return LOGIN_PAGES.find(page =>
            location.hostname === page.host && page.isLoginPage()
        ) || null;
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

    function findLoginButton(page) {
        const xpathButton = getElementByXPath(page.buttonXPath);

        if (xpathButton) return xpathButton;

        for (const selector of page.fallbackSelectors) {
            const button = document.querySelector(selector);
            if (button) return button;
        }

        return null;
    }

    function tryLogin(page) {
        const deadline = Date.now() + LOGIN_WAIT_MS;

        function attempt() {
            loginTimer = null;

            if (loginClicked) return;

            const button = findLoginButton(page);

            if (button && !button.disabled) {
                loginClicked = true;
                button.click();
                return;
            }

            if (Date.now() < deadline) {
                loginTimer = window.setTimeout(attempt, LOGIN_RETRY_MS);
            } else {
                scheduleCheck(ACTIVE_RETRY_MS);
            }
        }

        attempt();
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

        refreshTimer = window.setTimeout(checkRefresh, Math.max(0, delay));
    }

    function checkRefresh() {
        refreshTimer = null;

        const loginPage = getLoginPage();

        if (loginPage) {
            if (loginTimer === null && !loginClicked) {
                tryLogin(loginPage);
            }
            return;
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

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            checkRefresh();
        }
    });

    window.addEventListener('pageshow', checkRefresh);

    checkRefresh();

})();
