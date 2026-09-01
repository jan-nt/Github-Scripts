// ==UserScript==
// @name         PayManager Column Controller
// @namespace    https://nidushan.com
// @version      1.2.2
// @description  Enable and disable selected PayManager columns automatically
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   mailto:jas@nortronic.com
// @match        https://paymanager.logos.dk/transactions*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Column%20Controller.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Column%20Controller.user.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const STATE_KEY = Symbol.for(
        'tampermonkey.paymanager.column-controller'
    );

    if (window[STATE_KEY]?.initialized) return;

    const state = {
        initialized: true,
        disposed: false,
        inFlight: false,
        rerunRequested: false,
        runTimer: null,
        observer: null,
        discoveryObserver: null,
        discoveryTimer: null,
        observedRoots: new Set()
    };

    window[STATE_KEY] = state;

    const COLUMNS_TO_DISABLE = [
        "financial_terminal",
        "financial_emails",
        "financial_phonenumbers",
        "financial_cardname",
        "financial_comment",
        "financial_discount",
        "financial_fee",
        "financial_currency",
        "financial_business",
        "financial_collection",
        "financial_service",
        "financial_item_count",
        "financial_amount",
        "financial_asw",
        "financial_pan"
    ];

    const COLUMNS_TO_ENABLE = [
        "financial_chainid"
    ];

    const ALL_COLUMN_CLASSES = [
        ...COLUMNS_TO_DISABLE,
        ...COLUMNS_TO_ENABLE
    ];

    const COLUMN_BUTTON_ID = 'financial_column_toggle_btn';
    const COLUMN_POPUP_ID = 'financial_column_toggle';
    const COLUMN_POPUP_SCREEN_ID = 'financial_column_toggle-screen';
    const COLUMN_POPUP_WRAPPER_ID = 'financial_column_toggle-popup';

    const COLUMN_BUTTON_XPATH =
        "/html/body/div[2]/div[2]/div/div[3]/div[5]/a[1]";
    const COLUMN_POPUP_XPATH = "/html/body/div[2]/div[25]";

    const ELEMENT_WAIT_TIMEOUT_MS = 12_000;
    const ELEMENT_WAIT_INTERVAL_MS = 200;
    const DISCOVERY_TIMEOUT_MS = 15_000;
    const REPLACEMENT_DEBOUNCE_MS = 250;
    const COLUMN_CLICK_SETTLE_MS = 25;
    const CLOSE_POPUP_DELAY_MS = 100;

    function getXPath(xpath) {
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

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function waitFor(getter, timeoutMs = ELEMENT_WAIT_TIMEOUT_MS) {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() <= deadline) {
            const value = getter();

            if (value) return value;

            await sleep(ELEMENT_WAIT_INTERVAL_MS);
        }

        return null;
    }

    function isClickableElement(element) {
        return Boolean(element && typeof element.click === 'function');
    }

    function isVerifiedColumnsButton(element) {
        if (!isClickableElement(element)) return false;
        if (element.id === COLUMN_BUTTON_ID) return true;

        const popupReference = `#${COLUMN_POPUP_ID}`;

        return element.getAttribute?.('href') === popupReference ||
            element.getAttribute?.('data-target') === popupReference ||
            element.getAttribute?.('aria-controls') === COLUMN_POPUP_ID;
    }

    function getColumnsButton() {
        const stableButton = document.getElementById(COLUMN_BUTTON_ID);

        if (isVerifiedColumnsButton(stableButton)) return stableButton;

        const fallbackButton = getXPath(COLUMN_BUTTON_XPATH);

        return isVerifiedColumnsButton(fallbackButton) ? fallbackButton : null;
    }

    function popupHasConfiguredColumns(popup) {
        if (!popup || typeof popup.querySelector !== 'function') return false;

        return ALL_COLUMN_CLASSES.some(columnClass =>
            popup.querySelector(`a.${columnClass}`)
        );
    }

    function findColumnsPopup() {
        const stablePopup = document.getElementById(COLUMN_POPUP_ID);

        if (popupHasConfiguredColumns(stablePopup)) return stablePopup;

        const fallbackPopup = getXPath(COLUMN_POPUP_XPATH);

        if (popupHasConfiguredColumns(fallbackPopup)) return fallbackPopup;

        for (const columnClass of ALL_COLUMN_CLASSES) {
            const control = document.querySelector(`a.${columnClass}`);
            const candidate = control?.closest?.(
                '[data-role="popup"], .ui-popup, .ui-popup-container'
            );

            if (popupHasConfiguredColumns(candidate)) return candidate;
        }

        return null;
    }

    function isColumnsPopupOpen(popup) {
        if (!popup) return false;

        const popupWrapper = document.getElementById(COLUMN_POPUP_WRAPPER_ID);
        const popupScreen = document.getElementById(COLUMN_POPUP_SCREEN_ID);

        return popup.getAttribute?.('aria-hidden') === 'false' ||
            popupWrapper?.classList?.contains('ui-popup-active') ||
            popupScreen?.classList?.contains('in');
    }

    async function openColumnsPanel({ reuseExisting = false } = {}) {
        const availableControl = await waitFor(() => {
            const popup = findColumnsPopup();

            if (popup) return { popup };

            const button = getColumnsButton();
            return button ? { button } : null;
        });

        if (!availableControl) {
            return { popup: null, openedByController: false };
        }

        const existingPopup = findColumnsPopup();

        if (
            existingPopup &&
            (reuseExisting || isColumnsPopupOpen(existingPopup))
        ) {
            return { popup: existingPopup, openedByController: false };
        }

        const button = availableControl.button || getColumnsButton();

        if (!button) {
            return { popup: existingPopup, openedByController: false };
        }

        button.click();

        const popup = await waitFor(() => {
            const popup = findColumnsPopup();
            return isColumnsPopupOpen(popup) ? popup : null;
        });

        return {
            popup,
            openedByController: Boolean(popup)
        };
    }

    function findColumnControl(columnClass) {
        const popup = findColumnsPopup();

        return popup?.querySelector(`a.${columnClass}`) || null;
    }

    async function setColumnEnabled(columnClass, shouldEnable) {
        const control = findColumnControl(columnClass);

        if (!control) return false;

        const isEnabled = control.classList.contains('toggled');

        if (isEnabled === shouldEnable) return true;

        control.click();
        await sleep(COLUMN_CLICK_SETTLE_MS);

        return true;
    }

    async function toggleColumns() {
        for (const columnClass of COLUMNS_TO_DISABLE) {
            await setColumnEnabled(columnClass, false);
        }

        for (const columnClass of COLUMNS_TO_ENABLE) {
            await setColumnEnabled(columnClass, true);
        }
    }

    function closeColumnsPopup(expectedPopup = null) {
        const currentPopup = findColumnsPopup();
        const popup = expectedPopup || currentPopup;

        if (
            !popup ||
            (expectedPopup && currentPopup !== expectedPopup) ||
            !isColumnsPopupOpen(popup)
        ) {
            return;
        }

        const popupCloseControl = popup?.querySelector(
            '[data-rel="back"], [data-role="close"], .ui-popup-close'
        );

        if (isClickableElement(popupCloseControl)) {
            popupCloseControl.click();
            return;
        }

        const popupScreen = document.getElementById(COLUMN_POPUP_SCREEN_ID);

        if (isClickableElement(popupScreen)) {
            popupScreen.click();
            return;
        }

        const button = document.getElementById(COLUMN_BUTTON_ID);

        if (isClickableElement(button) && isColumnsPopupOpen(popup)) {
            button.click();
        }
    }

    async function runColumnsController() {
        if (state.disposed) return;

        if (state.inFlight) {
            state.rerunRequested = true;
            return;
        }

        state.inFlight = true;
        state.rerunRequested = false;

        try {
            const {
                popup,
                openedByController
            } = await openColumnsPanel({ reuseExisting: true });

            if (!popup) return;

            observeCurrentRoots(popup);

            await toggleColumns();

            if (openedByController) {
                await sleep(CLOSE_POPUP_DELAY_MS);
                closeColumnsPopup(popup);
            }
        } finally {
            state.inFlight = false;

            if (state.rerunRequested) scheduleRun();
        }
    }

    function scheduleRun() {
        if (state.disposed) return;

        if (state.runTimer !== null) {
            clearTimeout(state.runTimer);
        }

        state.runTimer = window.setTimeout(() => {
            state.runTimer = null;
            runColumnsController();
        }, REPLACEMENT_DEBOUNCE_MS);
    }

    function mutationContainsControl(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

        return node.id === COLUMN_BUTTON_ID ||
            node.id === COLUMN_POPUP_ID ||
            Boolean(node.querySelector?.(
                `#${COLUMN_BUTTON_ID}, #${COLUMN_POPUP_ID}`
            ));
    }

    function handleControlMutations(mutations) {
        if (mutations.some(mutation =>
            [...mutation.addedNodes, ...mutation.removedNodes]
                .some(mutationContainsControl)
        )) {
            scheduleRun();
        }
    }

    function observeRoot(root) {
        if (state.disposed || !root || state.observedRoots.has(root)) return;

        if (!state.observer) {
            state.observer = new MutationObserver(handleControlMutations);
        }

        state.observer.observe(root, { childList: true, subtree: true });
        state.observedRoots.add(root);
    }

    function observeCurrentRoots(popup = findColumnsPopup()) {
        const primaryRoot = document.getElementById('right_container') ||
            document.getElementById('financial_table_container');

        observeRoot(primaryRoot);
        observeRoot(primaryRoot?.parentElement);
        observeRoot(popup?.parentElement);
    }

    function startReplacementRecovery() {
        const primaryRoot = document.getElementById('right_container') ||
            document.getElementById('financial_table_container');

        observeCurrentRoots();

        if (primaryRoot || !document.body) return;

        state.discoveryObserver = new MutationObserver(() => {
            const discoveredRoot = document.getElementById('right_container') ||
                document.getElementById('financial_table_container');

            if (!discoveredRoot) return;

            observeCurrentRoots();
            scheduleRun();
            state.discoveryObserver?.disconnect();
            state.discoveryObserver = null;

            if (state.discoveryTimer !== null) {
                clearTimeout(state.discoveryTimer);
                state.discoveryTimer = null;
            }
        });

        state.discoveryObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        state.discoveryTimer = window.setTimeout(() => {
            state.discoveryObserver?.disconnect();
            state.discoveryObserver = null;
            state.discoveryTimer = null;
        }, DISCOVERY_TIMEOUT_MS);
    }

    function cleanup(event) {
        if (event?.persisted) return;

        state.disposed = true;

        if (state.runTimer !== null) clearTimeout(state.runTimer);
        if (state.discoveryTimer !== null) clearTimeout(state.discoveryTimer);

        state.observer?.disconnect();
        state.discoveryObserver?.disconnect();
        state.observedRoots.clear();
    }

    startReplacementRecovery();
    scheduleRun();
    window.addEventListener('pagehide', cleanup, { once: true });

})();
