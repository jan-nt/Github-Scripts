// ==UserScript==
// @name         PassPay User Activation Queue
// @namespace    https://nidushan.com
// @version      2.0
// @description  Reviews a queue of PassPay accounts and automatically activates eligible accounts
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   https://nidushan.com
// @match        https://betaling.passpay.no/administration*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /******************************************************************
     * IMPORTANT
     *
     * This script automatically activates accounts that meet the
     * eligibility criteria. Only the created date is checked; no
     * manual confirmation dialog is shown.
     ******************************************************************/

    /******************************************************************
     * CONFIGURATION
     ******************************************************************/

    const SCRIPT_NAME = 'PassPay User Activation Queue';

    const ADMIN_PATHS = [
        '/administration',
        '/administration/'
    ];

    const ADMIN_URL =
        'https://betaling.passpay.no/administration/?onlyConfirmed=false';

    const MAX_ACCOUNT_AGE_MONTHS = 12;

    const SEARCH_WAIT_MS = 4000;
    const PAGE_WAIT_MS = 250;
    const ALERT_WAIT_MS = 250;

    const ELEMENT_WAIT_TIMEOUT_MS = 15000;

    /*
     * Exact XPaths supplied for the current PassPay layout.
     */

    const XPATHS = {
        searchInput:
            '/html/body/div[1]/div/div/div/div/div[2]/div[1]/div[2]/div/div/div[1]/div[1]/div/div/input',

        firstSearchResult:
            '/html/body/div[1]/div/div/div/div/div[2]/div[1]/div[2]/div/div/div[3]/div[2]/div/table/tbody/tr/td[1]/span',

        createdDate:
            '/html/body/div[1]/div/div/div/div/div[2]/div[1]/div/div[2]/div[2]/div/div[2]/div/div/div[1]/div[2]/div/input',

        accountTab:
            '/html/body/div[1]/div/div/div/div/div[2]/div[1]/div/div[2]/div[2]/div/div[1]/div/div[2]/div/button[2]',

        activateButton:
            '/html/body/div[1]/div/div/div/div/div[2]/div[1]/div/div[2]/div[2]/div/div[3]/div/div[1]/button[2]',

        activateButtonText:
            '/html/body/div[1]/div/div/div/div/div[2]/div[1]/div/div[2]/div[2]/div/div[3]/div/div[1]/button[2]/span[1]',

        alert:
            '/html/body/div[1]/div/div/div[1]/div/div[2]'
    };

    /*
     * Tampermonkey storage keys.
     */

    const STORAGE_KEYS = {
        queue: 'pp_activation_queue',
        results: 'pp_activation_results',
        activatedAccounts: 'pp_activated_accounts',
        currentEmail: 'pp_activation_current_email',
        running: 'pp_activation_running',
        panelPosition: 'pp_activation_panel_position',
        panelMinimized: 'pp_activation_panel_minimized'
    };

    /******************************************************************
     * STATE
     ******************************************************************/

    let processing = false;
    let paused = false;

    /******************************************************************
     * LOGGING
     ******************************************************************/

    function log(message, data = '') {
        console.log(
            `%c[${SCRIPT_NAME}] ${message}`,
            'color:#1565c0;font-weight:bold;',
            data
        );
    }

    function warn(message, data = '') {
        console.warn(`[${SCRIPT_NAME}] ${message}`, data);
    }

    function error(message, data = '') {
        console.error(`[${SCRIPT_NAME}] ${message}`, data);
    }

    /******************************************************************
     * GENERAL HELPERS
     ******************************************************************/

    function sleep(milliseconds) {
        return new Promise(resolve => {
            setTimeout(resolve, milliseconds);
        });
    }

    function isMainAdministrationPage() {
        return ADMIN_PATHS.includes(window.location.pathname);
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
        } catch (err) {
            error(`Invalid XPath: ${xpath}`, err);
            return null;
        }
    }

    async function waitForXPath(
        xpath,
        timeout = ELEMENT_WAIT_TIMEOUT_MS
    ) {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeout) {
            const element = getElementByXPath(xpath);

            if (element) {
                return element;
            }

            await sleep(150);
        }

        return null;
    }

    function normalizeEmail(value) {
        return String(value || '')
            .trim()
            .toLowerCase();
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    function setReactInputValue(input, value) {
        const valueSetter =
            Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value'
            )?.set;

        if (valueSetter) {
            valueSetter.call(input, value);
        } else {
            input.value = value;
        }

        input.dispatchEvent(
            new Event('input', {
                bubbles: true
            })
        );

        input.dispatchEvent(
            new Event('change', {
                bubbles: true
            })
        );

        input.dispatchEvent(
            new KeyboardEvent('keyup', {
                bubbles: true,
                key: 'Enter'
            })
        );
    }

    function clickElement(element) {
        if (!element) {
            return false;
        }

        element.scrollIntoView({
            block: 'center',
            behavior: 'smooth'
        });

        element.dispatchEvent(
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true
            })
        );

        element.dispatchEvent(
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true
            })
        );

        element.click();

        return true;
    }

    /******************************************************************
     * DATE HANDLING
     ******************************************************************/

    function parseCreatedDate(value) {
        const text = String(value || '').trim();

        if (!text) {
            return null;
        }

        /*
         * ISO-like format:
         * 2026-08-15
         * 2026-08-15 14:30
         */

        let match = text.match(
            /^(\d{4})-(\d{1,2})-(\d{1,2})/
        );

        if (match) {
            return createValidatedDate(
                Number(match[1]),
                Number(match[2]),
                Number(match[3])
            );
        }

        /*
         * Norwegian/European format:
         * 15.08.2026
         * 15-08-2026
         * 15/08/2026
         * 15.08.2026 14:30
         */

        match = text.match(
            /^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/
        );

        if (match) {
            return createValidatedDate(
                Number(match[3]),
                Number(match[2]),
                Number(match[1])
            );
        }

        /*
         * Final fallback for browser-recognized date strings.
         */

        const fallback = new Date(text);

        if (!Number.isNaN(fallback.getTime())) {
            fallback.setHours(0, 0, 0, 0);
            return fallback;
        }

        return null;
    }

    function createValidatedDate(year, month, day) {
        const date = new Date(
            year,
            month - 1,
            day
        );

        date.setHours(0, 0, 0, 0);

        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month - 1 ||
            date.getDate() !== day
        ) {
            return null;
        }

        return date;
    }

    function getDateEligibility(createdDate) {
        if (!(createdDate instanceof Date)) {
            return {
                eligible: false,
                reason: 'Created date could not be read.'
            };
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (createdDate > today) {
            return {
                eligible: false,
                reason: 'Created date is in the future.'
            };
        }

        const cutoff = new Date(today);

        cutoff.setMonth(
            cutoff.getMonth() - MAX_ACCOUNT_AGE_MONTHS
        );

        /*
         * Eligible from exactly 12 months ago through today.
         */

        if (createdDate < cutoff) {
            return {
                eligible: false,
                reason:
                    `Account is older than ${MAX_ACCOUNT_AGE_MONTHS} months.`
            };
        }

        return {
            eligible: true,
            reason:
                `Account was created within the last ` +
                `${MAX_ACCOUNT_AGE_MONTHS} months.`
        };
    }

    /******************************************************************
     * STORAGE
     ******************************************************************/

    /*
     * Per-tab state (queue, current email, running flag) is kept in
     * sessionStorage so that each browser tab runs independently.
     * sessionStorage is isolated per tab and discarded when the tab
     * closes, so a second tab never picks up another tab's run.
     * The shared results / activated list stays in GM storage on
     * purpose, so exports combine all tabs.
     */

    function ssGet(key, fallback) {
        try {
            const raw = window.sessionStorage.getItem(key);

            if (raw === null) {
                return fallback;
            }

            return JSON.parse(raw);
        } catch (err) {
            return fallback;
        }
    }

    function ssSet(key, value) {
        try {
            window.sessionStorage.setItem(
                key,
                JSON.stringify(value)
            );
        } catch (err) {
            // Quota exceeded or unavailable; run with in-memory state.
        }
    }

    function ssRemove(key) {
        try {
            window.sessionStorage.removeItem(key);
        } catch (err) {
            // Ignore.
        }
    }

    function getQueue() {
        const queue = ssGet(
            STORAGE_KEYS.queue,
            []
        );

        return Array.isArray(queue) ? queue : [];
    }

    function saveQueue(queue) {
        ssSet(
            STORAGE_KEYS.queue,
            queue
        );
    }

    function getResults() {
        const results = GM_getValue(
            STORAGE_KEYS.results,
            []
        );

        return Array.isArray(results) ? results : [];
    }

    function saveResult(result) {
        const results = getResults();

        results.push({
            ...result,
            recordedAt: new Date().toISOString()
        });

        GM_setValue(
            STORAGE_KEYS.results,
            results
        );
    }

    function getActivatedAccounts() {
        const accounts = GM_getValue(
            STORAGE_KEYS.activatedAccounts,
            []
        );

        return Array.isArray(accounts) ? accounts : [];
    }

    function saveActivatedAccount(email, createdDate) {
        const accounts = getActivatedAccounts();

        const normalizedEmail = normalizeEmail(email);

        const alreadyStored = accounts.some(account => {
            return normalizeEmail(account.email) === normalizedEmail;
        });

        if (!alreadyStored) {
            accounts.push({
                email: normalizedEmail,
                createdDate:
                    createdDate instanceof Date
                        ? createdDate.toISOString()
                        : null,
                activatedAt: new Date().toISOString()
            });

            GM_setValue(
                STORAGE_KEYS.activatedAccounts,
                accounts
            );
        }
    }

    function removeEmailFromQueue(email) {
        const normalizedEmail = normalizeEmail(email);

        const nextQueue = getQueue().filter(item => {
            return normalizeEmail(item) !== normalizedEmail;
        });

        saveQueue(nextQueue);
    }

    function getCurrentEmail() {
        return normalizeEmail(
            ssGet(
                STORAGE_KEYS.currentEmail,
                ''
            )
        );
    }

    function setCurrentEmail(email) {
        ssSet(
            STORAGE_KEYS.currentEmail,
            normalizeEmail(email)
        );
    }

    function clearCurrentEmail() {
        ssRemove(STORAGE_KEYS.currentEmail);
    }

    function getRunning() {
        return ssGet(STORAGE_KEYS.running, false) === true;
    }

    function setRunning(value) {
        ssSet(STORAGE_KEYS.running, value === true);
    }

    /******************************************************************
     * UI STYLES
     ******************************************************************/

    function injectStyles() {
        if (
            document.getElementById(
                'pp-activation-queue-styles'
            )
        ) {
            return;
        }

        const style = document.createElement('style');

        style.id = 'pp-activation-queue-styles';

        style.textContent = `
            #pp-activation-panel,
            #pp-activation-panel * {
                box-sizing: border-box;
            }

            #pp-activation-panel {
                position: fixed;
                right: 18px;
                bottom: 18px;
                z-index: 2147483000;
                width: 390px;
                max-width: calc(100vw - 36px);
                max-height: calc(100vh - 36px);
                overflow: hidden;
                padding: 16px;
                background-color: #f8f9fb;
                border: 1px solid rgba(0, 0, 0, 0.16);
                border-radius: 6px;
                box-shadow:
                    0 5px 5px -3px rgba(0,0,0,0.20),
                    0 8px 10px 1px rgba(0,0,0,0.14),
                    0 3px 14px 2px rgba(0,0,0,0.12);
                color: rgba(0, 0, 0, 0.87);
                font-family: Roboto, Helvetica, Arial, sans-serif;
            }

            #pp-activation-panel.pp-activation-minimized {
                width: auto;
                max-height: none;
                padding-bottom: 8px;
                cursor: default;
            }

            .pp-activation-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin: 0 0 12px;
                cursor: move;
                user-select: none;
            }

            .pp-activation-title {
                margin: 0;
                font-size: 1.1rem;
                font-weight: 600;
            }

            .pp-activation-minimize {
                flex: 0 0 auto;
                width: 26px;
                height: 26px;
                padding: 0;
                border: 0;
                border-radius: 4px;
                outline: 0;
                background: rgba(0, 0, 0, 0.06);
                color: rgba(0, 0, 0, 0.70);
                font-size: 0.9rem;
                line-height: 1;
                cursor: pointer;
            }

            .pp-activation-minimize:hover {
                background: rgba(0, 0, 0, 0.12);
            }

            .pp-activation-body {
                max-height: calc(100vh - 90px);
                overflow-y: auto;
            }

            #pp-activation-panel.pp-activation-minimized
                .pp-activation-body {
                display: none;
            }

            .pp-activation-help {
                margin-bottom: 10px;
                color: rgba(0, 0, 0, 0.65);
                font-size: 0.8rem;
                line-height: 1.45;
            }

            #pp-email-list {
                width: 100%;
                min-height: 140px;
                padding: 10px;
                resize: vertical;
                border: 1px solid rgba(0, 0, 0, 0.25);
                border-radius: 4px;
                outline: none;
                background: #fff;
                color: rgba(0, 0, 0, 0.87);
                font: 0.875rem/1.45 Consolas, Monaco, monospace;
            }

            #pp-email-list:focus {
                border-color: #1976d2;
                box-shadow: 0 0 0 1px #1976d2;
            }

            .pp-activation-buttons {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 12px;
            }

            .pp-activation-button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 64px;
                margin: 0;
                padding: 6px 14px;
                border: 0;
                border-radius: 4px;
                outline: 0;
                appearance: none;
                background-color: #ffc94d;
                color: rgba(0, 0, 0, 0.87);
                cursor: pointer;
                user-select: none;
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 0.8125rem;
                font-weight: 500;
                line-height: 1.75;
                letter-spacing: 0.02857em;
                box-shadow:
                    0 3px 1px -2px rgba(0,0,0,0.20),
                    0 2px 2px 0 rgba(0,0,0,0.14),
                    0 1px 5px 0 rgba(0,0,0,0.12);
                transition:
                    background-color 250ms cubic-bezier(0.4,0,0.2,1),
                    box-shadow 250ms cubic-bezier(0.4,0,0.2,1),
                    transform 120ms ease;
            }

            .pp-activation-button:hover {
                background-color: #ffbd2e;
                transform: translateY(-1px);
                box-shadow:
                    0 2px 4px -1px rgba(0,0,0,0.20),
                    0 4px 5px 0 rgba(0,0,0,0.14),
                    0 1px 10px 0 rgba(0,0,0,0.12);
            }

            .pp-activation-button:active {
                transform: translateY(0);
            }

            .pp-activation-button:disabled {
                background-color: #ddd;
                color: rgba(0, 0, 0, 0.4);
                cursor: not-allowed;
                transform: none;
                box-shadow: none;
            }

            #pp-activation-status {
                margin-top: 12px;
                min-height: 42px;
                padding: 9px;
                border-radius: 4px;
                background: #fff;
                border: 1px solid rgba(0, 0, 0, 0.10);
                white-space: pre-wrap;
                color: rgba(0, 0, 0, 0.7);
                font-size: 0.8rem;
                line-height: 1.45;
            }

            .pp-activation-summary {
                margin-top: 10px;
                color: rgba(0, 0, 0, 0.65);
                font-size: 0.78rem;
            }

            #pp-activation-history {
                margin-top: 10px;
            }

            #pp-activation-history summary {
                cursor: pointer;
                font-size: 0.8rem;
                font-weight: 600;
            }

            #pp-activation-history pre {
                max-height: 180px;
                overflow: auto;
                padding: 8px;
                background: #fff;
                border: 1px solid rgba(0, 0, 0, 0.10);
                border-radius: 4px;
                white-space: pre-wrap;
                font: 0.72rem/1.4 Consolas, Monaco, monospace;
            }
        `;

        document.head.appendChild(style);
    }

    /******************************************************************
     * PANEL
     ******************************************************************/

    function setStatus(message, type = 'default') {
        const status = document.getElementById(
            'pp-activation-status'
        );

        if (!status) {
            return;
        }

        status.textContent = message;

        if (type === 'success') {
            status.style.color = '#166534';
            status.style.background = '#f0fdf4';
        } else if (type === 'error') {
            status.style.color = '#b91c1c';
            status.style.background = '#fef2f2';
        } else if (type === 'warning') {
            status.style.color = '#92400e';
            status.style.background = '#fffbeb';
        } else {
            status.style.color = 'rgba(0, 0, 0, 0.70)';
            status.style.background = '#fff';
        }
    }

    function updatePanel() {
        const queue = getQueue();
        const activated = getActivatedAccounts();
        const results = getResults();

        const summary = document.getElementById(
            'pp-activation-summary'
        );

        if (summary) {
            summary.textContent =
                `Queue: ${queue.length} | ` +
                `Activated: ${activated.length} | ` +
                `Results: ${results.length}`;
        }

        const history = document.getElementById(
            'pp-activation-history-data'
        );

        if (history) {
            history.textContent = activated.length
                ? JSON.stringify(activated, null, 2)
                : 'No activated accounts recorded.';
        }

        const textarea = document.getElementById(
            'pp-email-list'
        );

        if (
            textarea &&
            document.activeElement !== textarea
        ) {
            textarea.value = queue.join('\n');
        }

        const startButton = document.getElementById(
            'pp-start-activation'
        );

        if (startButton) {
            startButton.disabled = processing;
        }
    }

    function createPanel() {
        if (
            document.getElementById(
                'pp-activation-panel'
            )
        ) {
            updatePanel();
            return;
        }

        const panel = document.createElement('div');
        panel.id = 'pp-activation-panel';

        panel.innerHTML = `
            <div class="pp-activation-header">
                <div class="pp-activation-title">
                    Account activation queue
                </div>

                <button
                    id="pp-activation-minimize"
                    class="pp-activation-minimize"
                    type="button"
                    title="Minimize / restore"
                >
                    &minus;
                </button>
            </div>

            <div class="pp-activation-body">
                <div class="pp-activation-help">
                    Enter one email address per line. The script checks each
                    account's created date and activates eligible accounts
                    automatically.
                </div>

                <textarea
                    id="pp-email-list"
                    spellcheck="false"
                    placeholder="user1@example.com&#10;user2@example.com"
                ></textarea>

                <div class="pp-activation-buttons">
                    <button
                        id="pp-save-queue"
                        class="pp-activation-button"
                        type="button"
                    >
                        Save list
                    </button>

                    <button
                        id="pp-start-activation"
                        class="pp-activation-button"
                        type="button"
                    >
                        Start review
                    </button>

                    <button
                        id="pp-pause-activation"
                        class="pp-activation-button"
                        type="button"
                    >
                        Pause
                    </button>

                    <button
                        id="pp-clear-queue"
                        class="pp-activation-button"
                        type="button"
                    >
                        Clear queue
                    </button>

                    <button
                        id="pp-export-history"
                        class="pp-activation-button"
                        type="button"
                    >
                        Export log
                    </button>
                </div>

                <div id="pp-activation-status">
                    Ready.
                </div>

                <div
                    id="pp-activation-summary"
                    class="pp-activation-summary"
                ></div>

                <details id="pp-activation-history">
                    <summary>Activated accounts</summary>
                    <pre id="pp-activation-history-data"></pre>
                </details>
            </div>
        `;

        document.body.appendChild(panel);

        /*
         * The panel is always visible - never hidden. Clear any stale
         * display state so a previous render can not leave it invisible.
         */

        panel.style.display = '';

        /*
         * Restore the saved panel position and minimized state.
         */

        const savedPosition = GM_getValue(
            STORAGE_KEYS.panelPosition,
            null
        );

        if (savedPosition) {
            const margin = 8;
            const maxLeft =
                window.innerWidth -
                panel.offsetWidth -
                margin;
            const maxTop =
                window.innerHeight -
                panel.offsetHeight -
                margin;

            const left = Math.min(
                maxLeft,
                Math.max(
                    margin,
                    Number(savedPosition.left) || margin
                )
            );
            const top = Math.min(
                maxTop,
                Math.max(
                    margin,
                    Number(savedPosition.top) || margin
                )
            );

            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }

        const wasMinimized = GM_getValue(
            STORAGE_KEYS.panelMinimized,
            false
        );

        if (wasMinimized) {
            applyMinimized();
        } else {
            applyRestored();
        }

        makePanelDraggable(panel);
        setupMinimizeToggle(panel);

        document
            .getElementById('pp-save-queue')
            .addEventListener('click', saveQueueFromPanel);

        document
            .getElementById('pp-start-activation')
            .addEventListener('click', startQueue);

        document
            .getElementById('pp-pause-activation')
            .addEventListener('click', pauseQueue);

        document
            .getElementById('pp-clear-queue')
            .addEventListener('click', clearQueue);

        document
            .getElementById('pp-export-history')
            .addEventListener('click', exportHistory);

        updatePanel();
    }

    function updateMinimizeButton(panel) {
        const button = panel.querySelector(
            '#pp-activation-minimize'
        );

        if (button) {
            button.textContent = panel.classList.contains(
                'pp-activation-minimized'
            )
                ? '+'
                : '\u2212';
        }
    }

    function applyMinimized() {
        const panel = document.getElementById(
            'pp-activation-panel'
        );

        if (!panel) {
            return;
        }

        panel.classList.add('pp-activation-minimized');
        updateMinimizeButton(panel);
    }

    function applyRestored() {
        const panel = document.getElementById(
            'pp-activation-panel'
        );

        if (!panel) {
            return;
        }

        panel.classList.remove('pp-activation-minimized');
        updateMinimizeButton(panel);
    }

    function setPanelMinimized(minimized) {
        if (minimized) {
            applyMinimized();
        } else {
            applyRestored();
        }

        GM_setValue(
            STORAGE_KEYS.panelMinimized,
            minimized
        );
    }

    function setupMinimizeToggle(panel) {
        const button = panel.querySelector(
            '#pp-activation-minimize'
        );

        if (!button) {
            return;
        }

        button.addEventListener('click', event => {
            event.stopPropagation();

            const minimized = !panel.classList.contains(
                'pp-activation-minimized'
            );

            setPanelMinimized(minimized);
        });
    }

    function makePanelDraggable(panel) {
        const header = panel.querySelector(
            '.pp-activation-header'
        );

        if (!header) {
            return;
        }

        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let offsetX = 0;
        let offsetY = 0;

        header.addEventListener('mousedown', event => {
            if (
                event.target.closest(
                    '#pp-activation-minimize'
                )
            ) {
                return;
            }

            if (event.button !== 0) {
                return;
            }

            event.preventDefault();

            isDragging = true;
            startX = event.clientX;
            startY = event.clientY;
            offsetX =
                panel.offsetLeft - startX;
            offsetY =
                panel.offsetTop - startY;

            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left = panel.offsetLeft + 'px';
            panel.style.top = panel.offsetTop + 'px';
        });

        document.addEventListener('mousemove', event => {
            if (!isDragging) {
                return;
            }

            const margin = 8;
            const maxLeft =
                window.innerWidth -
                panel.offsetWidth -
                margin;
            const maxTop =
                window.innerHeight -
                panel.offsetHeight -
                margin;

            const left = Math.min(
                maxLeft,
                Math.max(
                    margin,
                    event.clientX + offsetX
                )
            );
            const top = Math.min(
                maxTop,
                Math.max(
                    margin,
                    event.clientY + offsetY
                )
            );

            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) {
                return;
            }

            isDragging = false;

            GM_setValue(
                STORAGE_KEYS.panelPosition,
                {
                    left: panel.offsetLeft,
                    top: panel.offsetTop
                }
            );
        });
    }

    /******************************************************************
     * SIDEBAR MENU ENTRY
     ******************************************************************/

    const MENU_ENTRY_ICON =
        '<svg aria-hidden="true" focusable="false" ' +
        'data-prefix="fas" data-icon="user-check" ' +
        'class="svg-inline--fa fa-user-check fa-w-20 fa-2x " ' +
        'role="img" xmlns="http://www.w3.org/2000/svg" ' +
        'viewBox="0 0 640 512" color="#304b77">' +
        '<path fill="currentColor" d="M96 128a128 128 0 1 1 ' +
        '128 128A128 128 0 0 1 96 128zm0 272c0-32.37 ' +
        '10.49-62.36 28.2-86.69a176.9 176.9 0 0 1 ' +
        '17.59-19.76A126.3 126.3 0 0 0 96 272a126.3 ' +
        '126.3 0 0 0-45.79 9.55A143.52 143.52 0 0 0 0 400v48h128z' +
        'M352 320a96 96 0 1 1 96-96 96 96 0 0 1-96 96z' +
        'm184 32h-24.52a161 161 0 0 1-43.52 0H424.18z' +
        'm-46.76 148.29' +
        'l73.08 73.08a10.5 10.5 0 0 0 14.85 0' +
        'l73.08-73.08a10.5 10.5 0 0 0 0-14.85' +
        'l-14.85-14.85a10.5 10.5 0 0 0-14.85 0' +
        'l-25.11 25.11V352a10.5 10.5 0 0 0-10.5-10.5h-21a10.5' +
        '10.5 0 0 0-10.5 10.5v58.55' +
        'l-25.11-25.11a10.5 10.5 0 0 0-14.85 0' +
        'l-14.85 14.85a10.5 10.5 0 0 0 0 14.85z"/></svg>';

    function injectMenuEntry() {
        const sideMenuItem = document.querySelector(
            'a[href="/site-administration"]'
        );

        if (!sideMenuItem) {
            return;
        }

        if (
            document.getElementById(
                'pp-menu-activation-queue'
            )
        ) {
            return;
        }

        const anchor = document.createElement('a');

        anchor.id = 'pp-menu-activation-queue';
        anchor.href = '#';
        anchor.style.margin = '0px';
        anchor.style.textDecoration = 'none';
        anchor.style.color = 'inherit';
        anchor.style.width = '100%';

        anchor.innerHTML =
            '<div class="MuiButtonBase-root ' +
            'MuiListItemButton-root ' +
            'MuiListItemButton-gutters ' +
            'MuiListItemButton-root ' +
            'MuiListItemButton-gutters css-n57fah" ' +
            'tabindex="0" role="button" ' +
            'data-cy="menu-activation-queue">' +
            '<div class="MuiListItemIcon-root css-kv96wn">' +
            MENU_ENTRY_ICON +
            '</div>' +
            '<div class="MuiListItemText-root css-1tsvksn">' +
            '<p class="MuiTypography-root ' +
            'MuiTypography-body1 css-wgfeei">' +
            'Aktiveringsk\u00f8</p>' +
            '</div>' +
            '<span class="MuiTouchRipple-root css-w0pj6f">' +
            '</span></div>';

        anchor.addEventListener('click', event => {
            event.preventDefault();

            const panel = document.getElementById(
                'pp-activation-panel'
            );

            if (!panel) {
                createPanel();
            }

            const current = document.getElementById(
                'pp-activation-panel'
            );

            if (!current) {
                return;
            }

            /*
             * The panel is never hidden - only minimized or moved.
             * Clicking the menu entry always brings it back into view:
             * clear any stale display state and expand it.
             */

            current.style.display = '';
            applyRestored();
            current.scrollIntoView();
        });

        sideMenuItem.insertAdjacentElement(
            'afterend',
            anchor
        );
    }

    function saveQueueFromPanel() {
        const textarea = document.getElementById(
            'pp-email-list'
        );

        if (!textarea) {
            return;
        }

        const entries = textarea.value
            .split(/[\n,;]+/)
            .map(normalizeEmail)
            .filter(Boolean);

        const validEmails = [];
        const invalidEmails = [];
        const seen = new Set();

        entries.forEach(email => {
            if (!isValidEmail(email)) {
                invalidEmails.push(email);
                return;
            }

            if (!seen.has(email)) {
                seen.add(email);
                validEmails.push(email);
            }
        });

        saveQueue(validEmails);
        updatePanel();

        if (invalidEmails.length) {
            setStatus(
                `${validEmails.length} valid email(s) saved.\n` +
                `Invalid entries ignored:\n` +
                invalidEmails.join('\n'),
                'warning'
            );
        } else {
            setStatus(
                `${validEmails.length} email(s) saved.`,
                'success'
            );
        }
    }

    function pauseQueue() {
        paused = true;

        setRunning(false);

        setStatus(
            'Queue paused after the current step.',
            'warning'
        );
    }

    function clearQueue() {
        if (
            !window.confirm(
                'Clear all unprocessed email addresses from the queue?'
            )
        ) {
            return;
        }

        paused = true;
        processing = false;

        saveQueue([]);
        clearCurrentEmail();

        setRunning(false);

        updatePanel();

        setStatus(
            'Queue cleared.',
            'success'
        );
    }

    function exportHistory() {
        const exportData = {
            exportedAt: new Date().toISOString(),
            activatedAccounts: getActivatedAccounts(),
            results: getResults(),
            remainingQueue: getQueue()
        };

        const blob = new Blob(
            [JSON.stringify(exportData, null, 2)],
            {
                type: 'application/json'
            }
        );

        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download =
            `passpay-activation-log-${Date.now()}.json`;

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        URL.revokeObjectURL(url);

        setStatus(
            'Activation log exported.',
            'success'
        );
    }

    /******************************************************************
     * SEARCH AND ACCOUNT REVIEW
     ******************************************************************/

    async function searchForEmail(email) {
        if (!isMainAdministrationPage()) {
            window.location.href = ADMIN_URL;
            return false;
        }

        setStatus(`Searching for:\n${email}`);

        const input = await waitForXPath(
            XPATHS.searchInput
        );

        if (!input) {
            throw new Error(
                'Search input could not be found.'
            );
        }

        setReactInputValue(input, '');

        await sleep(200);

        setReactInputValue(input, email);

        input.focus();

        await sleep(SEARCH_WAIT_MS);

        const result = await waitForXPath(
            XPATHS.firstSearchResult,
            20000
        );

        if (!result) {
            saveResult({
                email,
                status: 'not-found',
                message: 'No search result was found.'
            });

            removeEmailFromQueue(email);
            clearCurrentEmail();
            updatePanel();

            setStatus(
                `No result found for:\n${email}`,
                'warning'
            );

            return false;
        }

        /*
         * Verify the result row contains the searched email.
         * This prevents blindly opening an unrelated first result.
         */

        const resultRow = result.closest('tr');
        const resultText =
            resultRow?.textContent?.toLowerCase() || '';

        if (!resultText.includes(email.toLowerCase())) {
            saveResult({
                email,
                status: 'no-exact-match',
                message:
                    'The first result did not contain the searched email.'
            });

            removeEmailFromQueue(email);
            clearCurrentEmail();
            updatePanel();

            setStatus(
                `No exact result match for:\n${email}`,
                'warning'
            );

            return false;
        }

        /*
         * If the matched row already shows the confirmed/activated icon
         * (data-testid="CheckCircleIcon"), the account is already
         * activated. Skip it and move on to the next email.
         */

        if (
            resultRow.querySelector(
                '[data-testid="CheckCircleIcon"]'
            )
        ) {
            saveResult({
                email,
                status: 'skipped-already-confirmed',
                message:
                    'The account is already confirmed/activated ' +
                    '(CheckCircleIcon shown in the search result).'
            });

            removeEmailFromQueue(email);
            clearCurrentEmail();
            updatePanel();

            setStatus(
                `Already confirmed, skipping:\n${email}`,
                'info'
            );

            return false;
        }

        setStatus(
            `Opening matching account:\n${email}`
        );

        clickElement(result);

        /*
         * After clicking the search result, actively wait for the
         * account-detail page to render. The created-date field is a
         * reliable signal that the detail view has loaded. If it does
         * not appear within the timeout, stop with a clear error
         * instead of hanging on this status message.
         */

        const detailLoaded = await waitForXPath(
            XPATHS.createdDate,
            10000
        );

        if (!detailLoaded) {
            throw new Error(
                'Account detail page did not open after clicking ' +
                'the search result.'
            );
        }

        await reviewCurrentAccount(email);

        return true;
    }

    async function reviewCurrentAccount(email) {
        setStatus(
            `Reading account date:\n${email}`
        );

        const createdInput = await waitForXPath(
            XPATHS.createdDate
        );

        if (!createdInput) {
            throw new Error(
                'Created-date field could not be found.'
            );
        }

        const rawDate =
            createdInput.value ||
            createdInput.getAttribute('value') ||
            createdInput.textContent ||
            '';

        const createdDate = parseCreatedDate(rawDate);
        const eligibility = getDateEligibility(createdDate);

        if (!eligibility.eligible) {
            saveResult({
                email,
                status: 'not-eligible',
                rawCreatedDate: rawDate,
                parsedCreatedDate:
                    createdDate?.toISOString() || null,
                message: eligibility.reason
            });

            removeEmailFromQueue(email);
            clearCurrentEmail();
            updatePanel();

            setStatus(
                `${email}\n` +
                `Created: ${rawDate || 'Unknown'}\n` +
                eligibility.reason,
                'warning'
            );

            await sleep(400);

            window.location.href = ADMIN_URL;

            return;
        }

        await activateAccount(
            email,
            createdDate,
            rawDate
        );
    }

    async function activateAccount(
        email,
        createdDate,
        rawDate
    ) {
        setStatus(
            `Opening account actions:\n${email}`
        );

        const accountTab = await waitForXPath(
            XPATHS.accountTab
        );

        if (!accountTab) {
            throw new Error(
                'Account action tab could not be found.'
            );
        }

        clickElement(accountTab);

        await sleep(PAGE_WAIT_MS);

        const activateButton =
            await waitForXPath(
                XPATHS.activateButton
            );

        if (!activateButton) {
            throw new Error(
                'Activate account button could not be found.'
            );
        }

        const buttonText =
            activateButton.textContent?.trim() || '';

        /*
         * Extra protection against clicking the wrong button.
         */

        if (
            !/activate|aktiver/i.test(buttonText)
        ) {
            throw new Error(
                `Expected an activation button, but found: ` +
                `"${buttonText || 'no text'}".`
            );
        }

        setStatus(
            `Activating account:\n${email}`,
            'warning'
        );

        clickElement(activateButton);

        const alertElement = await waitForXPath(
            XPATHS.alert,
            12000
        );

        if (!alertElement) {
            throw new Error(
                'No activation confirmation alert appeared.'
            );
        }

        await sleep(ALERT_WAIT_MS);

        const alertText =
            alertElement.textContent?.trim() || '';

        /*
         * Guard against false positives: the alert XPath may match an
         * element that is already present on the page. Only record the
         * account as activated if the alert text reads like a success
         * message. Otherwise stop with a clear error.
         */

        if (
            !/aktiver/i.test(alertText)
        ) {
            throw new Error(
                'Activation alert did not indicate success: ' +
                `"${alertText || 'empty alert'}".`
            );
        }

        saveActivatedAccount(
            email,
            createdDate
        );

        saveResult({
            email,
            status: 'activated',
            rawCreatedDate: rawDate,
            parsedCreatedDate:
                createdDate.toISOString(),
            alertText
        });

        removeEmailFromQueue(email);
        clearCurrentEmail();
        updatePanel();

        setStatus(
            `Activated:\n${email}\n\n${alertText}`,
            'success'
        );

        await sleep(600);

        window.location.href = ADMIN_URL;
    }

    /******************************************************************
     * QUEUE PROCESSING
     ******************************************************************/

    async function startQueue() {
        if (processing) {
            return;
        }

        saveQueueFromPanel();

        const queue = getQueue();

        if (!queue.length) {
            setStatus(
                'The queue is empty.',
                'warning'
            );
            return;
        }

        paused = false;
        processing = true;

        setRunning(true);

        updatePanel();

        try {
            await continueQueue();
        } catch (err) {
            handleProcessingError(err);
        }
    }

    async function continueQueue() {
        if (paused) {
            processing = false;
            updatePanel();
            return;
        }

        const queue = getQueue();

        if (!queue.length) {
            processing = false;

            setRunning(false);

            clearCurrentEmail();
            updatePanel();

            setStatus(
                'Queue completed.',
                'success'
            );

            return;
        }

        const email =
            getCurrentEmail() ||
            normalizeEmail(queue[0]);

        setCurrentEmail(email);

        if (isMainAdministrationPage()) {
            const opened = await searchForEmail(email);

            /*
             * If the search failed, continue with the next queue entry
             * without requiring a page reload.
             */

            if (!opened && getQueue().length) {
                await sleep(300);
                await continueQueue();
            }

            return;
        }

        if (
            window.location.pathname.startsWith(
                '/administration/'
            )
        ) {
            await reviewCurrentAccount(email);
            return;
        }

        window.location.href = ADMIN_URL;
    }

    function handleProcessingError(err) {
        const email = getCurrentEmail();

        processing = false;

        setRunning(false);

        error('Processing stopped', err);

        saveResult({
            email: email || null,
            status: 'error',
            message: err.message
        });

        updatePanel();

        setStatus(
            `Processing stopped.\n` +
            `${email ? `Email: ${email}\n` : ''}` +
            `Reason: ${err.message}`,
            'error'
        );
    }

    /******************************************************************
     * SPA NAVIGATION WATCH
     ******************************************************************/

    function watchNavigation() {
        let lastUrl = window.location.href;

        const observer = new MutationObserver(() => {
            if (window.location.href === lastUrl) {
                return;
            }

            lastUrl = window.location.href;

            log('Navigation detected', lastUrl);

            setTimeout(() => {
                createPanel();
                injectMenuEntry();

                const shouldContinue = getRunning();

                if (
                    shouldContinue &&
                    !processing &&
                    !paused
                ) {
                    processing = true;

                    continueQueue().catch(
                        handleProcessingError
                    );
                }
            }, 500);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /******************************************************************
     * STARTUP
     ******************************************************************/

    function start() {
        injectStyles();
        createPanel();
        injectMenuEntry();
        watchNavigation();

        const shouldContinue = getRunning();

        /*
         * Continue after a normal page navigation or reload.
         *
         * The stored current email is a resume point for an
         * interrupted step, but continueQueue also falls back to the
         * head of the queue, so the run must resume even when no
         * current email was saved. This is what lets the queue move on
         * to the next account after the previous one was completed.
         */

        if (shouldContinue) {
            processing = true;

            setTimeout(() => {
                continueQueue().catch(
                    handleProcessingError
                );
            }, 800);
        }

        log('Active');
    }

    start();

})();