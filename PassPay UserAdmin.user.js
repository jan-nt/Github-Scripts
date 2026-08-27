// ==UserScript==
// @name         PassPay UserAdmin
// @namespace    https://nidushan.com
// @version      2.0.0
// @description  Adds safe admin search links and an explicitly armed batch-refund workflow
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   mailto:jas@nortronic.com
// @match        https://betaling.passpay.no/administration*
// @match        https://portal.dibspayment.eu/*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PassPay%20UserAdmin.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PassPay%20UserAdmin.user.js
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const INSTANCE_KEY = '__passPayUserAdminInitialized';
    const HISTORY_PATCH_KEY = '__passPayUserAdminHistoryPatched';

    if (window[INSTANCE_KEY]) return;
    window[INSTANCE_KEY] = true;

    const STYLE_ID = 'pp-useradmin-styles';
    const BUTTON_ID = 'pp-useradmin-remove-spaces-btn';
    const SEARCH_ROW_CLASS = 'pp-useradmin-search-row';
    const REFUND_TOOLBAR_ID = 'pp-useradmin-refund-toolbar';
    const REFUND_MODE_ID = 'pp-useradmin-refund-mode';
    const REFUND_SELECT_ALL_ID = 'pp-useradmin-refund-select-all';
    const REFUND_CLEAR_ID = 'pp-useradmin-refund-clear';
    const REFUND_START_ID = 'pp-useradmin-refund-start';
    const REFUND_STATUS_ID = 'pp-useradmin-refund-status';
    const PORTAL_STATUS_ID = 'pp-useradmin-portal-status';
    const PORTAL_CANCEL_ID = 'pp-useradmin-portal-cancel';
    const SMART_INPUT_MARKER = 'ppUseradminSmartSpaces';
    const LINK_MARKER = 'ppUseradminLinkified';
    const LINK_ATTRIBUTE = 'data-pp-useradmin-link';
    const REFUND_ROW_ATTRIBUTE = 'data-pp-useradmin-refund-row';
    const REFUND_ROW_KEY_ATTRIBUTE = 'data-pp-useradmin-refund-key';
    const SEARCH_LABELS = new Set(['search', 'søk']);
    const REFUNDABLE_STATUSES = new Set(['betalt', 'paid']);
    const REFUNDED_STATUSES = new Set(['refundert', 'refunded']);
    const DIBS_HOST = 'portal.dibspayment.eu';
    const DIBS_ORIGIN = `https://${DIBS_HOST}`;
    const PASSPAY_ORIGIN = 'https://betaling.passpay.no';
    const DIBS_PAYMENT_PATH = '/portal-frontend/payments/';
    const DIBS_LOGIN_EMAIL = 'jas@nortronic.com';
    const REFUND_QUEUE_KEY = 'pp-useradmin-refund-queue-v1';
    const REFUND_QUEUE_VERSION = 1;
    const REFUND_QUEUE_TTL_MS = 30 * 60 * 1000;
    const PAYMENT_ID_PATTERN = /^[a-f0-9]{32}$/i;
    const MAX_REFUND_BATCH_SIZE = 30;
    const PORTAL_READY_MESSAGE = 'pp-useradmin-refund-portal-ready';
    const PORTAL_QUEUE_MESSAGE = 'pp-useradmin-refund-queue';
    const REFUND_WINDOW_NAME_PREFIX = 'ppUserAdminRefundPortal-';
    const openBrowserWindow = typeof window.open === 'function'
        ? window.open.bind(window)
        : null;
    const requestUserConfirmation = typeof window.prompt === 'function'
        ? window.prompt.bind(window)
        : null;

    const PAYMANAGER_BASE_URL =
        'https://paymanager.logos.dk/transactions?chainid=';

    const DIBS_BASE_URL =
        'https://portal.dibspayment.eu/portal-frontend/payments?searchKey=PAYMENT_ID&searchValue=';

    let observer = null;
    let runScheduled = false;
    let animationFrame = null;
    let activeSearchRow = null;
    let refundModeEnabled = false;
    let refundCollectionInProgress = false;
    let refundPortalWindow = null;
    let refundQueueForPortal = null;
    let portalProcessing = false;
    let portalCancelled = false;
    let portalLoginObserver = null;
    let portalLoginTimer = null;
    const selectedRefundRows = new Map();
    const pendingRoots = new Set();

    function isAdministrationPage() {
        return (
            location.pathname === '/administration' ||
            location.pathname.startsWith('/administration/')
        );
    }

    function isPaymentHistoryPage() {
        if (!/^\/administration\/[^/]+\/?$/.test(location.pathname)) {
            return false;
        }

        const parameters = new URLSearchParams(location.search || '');

        return (
            parameters.get('tab') === '3' &&
            parameters.get('nestedTab') === '1'
        );
    }

    function isDibsPortal() {
        return location.hostname === DIBS_HOST;
    }

    function isRefundableStatus(value) {
        return REFUNDABLE_STATUSES.has(normalizeLabel(value));
    }

    function isRefundedStatus(value) {
        return REFUNDED_STATUSES.has(normalizeLabel(value));
    }

    function getRefundConfirmationPhrase(count) {
        return `REFUNDER ${count}`;
    }

    function getPaymentIdFromHref(href) {
        if (!href) return null;

        try {
            const url = new URL(href, DIBS_ORIGIN);
            const directId = url.pathname.startsWith(DIBS_PAYMENT_PATH)
                ? url.pathname.slice(DIBS_PAYMENT_PATH.length).split('/')[0]
                : '';
            const searchId = url.searchParams.get('searchValue') || '';
            const paymentId = directId || searchId;

            return PAYMENT_ID_PATTERN.test(paymentId)
                ? paymentId.toLowerCase()
                : null;
        } catch {
            return null;
        }
    }

    function isValidRefundQueue(queue, now = Date.now()) {
        if (
            !queue ||
            queue.version !== REFUND_QUEUE_VERSION ||
            typeof queue.token !== 'string' ||
            queue.token.length < 16 ||
            !Number.isFinite(queue.createdAt) ||
            now - queue.createdAt < 0 ||
            now - queue.createdAt > REFUND_QUEUE_TTL_MS ||
            !Number.isInteger(queue.index) ||
            !Array.isArray(queue.items) ||
            queue.items.length === 0 ||
            queue.items.length > MAX_REFUND_BATCH_SIZE ||
            queue.index < 0 ||
            queue.index > queue.items.length
        ) {
            return false;
        }

        return queue.items.every(item => (
            item &&
            PAYMENT_ID_PATTERN.test(item.paymentId) &&
            ['pending', 'submitted', 'refunded', 'skipped'].includes(item.state)
        ));
    }

    function injectStyles() {
        if (!document.head || document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');

        style.id = STYLE_ID;
        style.textContent = `
            .pp-useradmin-button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                position: relative;
                cursor: pointer;
                user-select: none;
                vertical-align: middle;
                appearance: none;
                min-width: 64px;
                border: 0;
                flex: 0 0 auto;
                margin: 6px 0 0;
                padding: 6px 16px;
                border-radius: 4px;
                background-color: #ffc94d;
                color: rgba(0, 0, 0, 0.87);
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 0.875rem;
                line-height: 1.75;
                letter-spacing: 0.02857em;
                font-weight: 500;
                text-transform: none;
                white-space: nowrap;
                box-shadow:
                    0px 3px 1px -2px rgba(0,0,0,0.20),
                    0px 2px 2px 0px rgba(0,0,0,0.14),
                    0px 1px 5px 0px rgba(0,0,0,0.12);
                transition:
                    background-color 250ms cubic-bezier(0.4, 0, 0.2, 1),
                    box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1),
                    transform 120ms ease;
            }

            .pp-useradmin-button:hover {
                background-color: #ffbd2e;
                box-shadow:
                    0px 2px 4px -1px rgba(0,0,0,0.20),
                    0px 4px 5px 0px rgba(0,0,0,0.14),
                    0px 1px 10px 0px rgba(0,0,0,0.12);
                transform: translateY(-1px);
            }

            .pp-useradmin-button:active {
                transform: translateY(0);
                box-shadow:
                    0px 5px 5px -3px rgba(0,0,0,0.20),
                    0px 8px 10px 1px rgba(0,0,0,0.14),
                    0px 3px 14px 2px rgba(0,0,0,0.12);
            }

            .pp-useradmin-button:focus-visible {
                outline: 3px solid #1976d2;
                outline-offset: 2px;
            }

            .pp-useradmin-chain-link {
                color: #1976d2;
                text-decoration: underline;
                cursor: pointer;
            }

            .${SEARCH_ROW_CLASS} {
                display: flex !important;
                align-items: flex-start;
                flex: 0 1 390px !important;
                flex-wrap: wrap;
                gap: 6px 8px;
                width: min(100%, 390px) !important;
                max-width: 100% !important;
                min-width: 0;
            }

            .${SEARCH_ROW_CLASS} > .MuiFormControl-root {
                flex: 1 1 240px;
                width: auto !important;
                min-width: 0;
            }

            #${REFUND_TOOLBAR_ID},
            #${PORTAL_STATUS_ID} {
                box-sizing: border-box;
                border: 1px solid #b7c5d5;
                border-radius: 8px;
                background: #f7f9fc;
                color: #172b4d;
                font-family: Roboto, Helvetica, Arial, sans-serif;
            }

            #${REFUND_TOOLBAR_ID} {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 8px 12px;
                width: 100%;
                margin: 8px 0 12px;
                padding: 10px 12px;
            }

            .pp-useradmin-refund-switch {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                font-weight: 600;
                cursor: pointer;
            }

            .pp-useradmin-refund-switch input {
                width: 18px;
                height: 18px;
                accent-color: #b42318;
            }

            .pp-useradmin-refund-action {
                appearance: none;
                border: 1px solid #8ea2b8;
                border-radius: 5px;
                background: #ffffff;
                color: #172b4d;
                padding: 7px 11px;
                font: inherit;
                font-weight: 600;
                cursor: pointer;
            }

            .pp-useradmin-refund-action:hover:not(:disabled) {
                background: #edf3f9;
            }

            .pp-useradmin-refund-action:focus-visible {
                outline: 3px solid #1976d2;
                outline-offset: 2px;
            }

            .pp-useradmin-refund-action:disabled {
                cursor: not-allowed;
                opacity: 0.5;
            }

            .pp-useradmin-refund-danger {
                border-color: #b42318;
                background: #b42318;
                color: #ffffff;
            }

            .pp-useradmin-refund-danger:hover:not(:disabled) {
                background: #8f1c13;
            }

            #${REFUND_STATUS_ID} {
                flex: 1 1 100%;
                min-height: 1.4em;
                color: #42526e;
                font-size: 0.875rem;
            }

            [${REFUND_ROW_ATTRIBUTE}="eligible"] {
                position: relative;
                transition: box-shadow 120ms ease, background-color 120ms ease;
            }

            [${REFUND_ROW_ATTRIBUTE}="eligible"]::before {
                content: '';
                display: none;
                position: absolute;
                z-index: 2;
                top: 50%;
                left: 10px;
                width: 18px;
                height: 18px;
                border: 2px solid #5d6b7a;
                border-radius: 4px;
                background: #ffffff;
                transform: translateY(-50%);
                pointer-events: none;
            }

            body.pp-useradmin-refund-mode [${REFUND_ROW_ATTRIBUTE}="eligible"] {
                padding-left: 44px;
            }

            body.pp-useradmin-refund-mode [${REFUND_ROW_ATTRIBUTE}="eligible"]::before {
                display: block;
            }

            body.pp-useradmin-refund-mode [${REFUND_ROW_ATTRIBUTE}="eligible"]:hover {
                box-shadow: inset 0 0 0 2px #6b87a3;
            }

            body.pp-useradmin-refund-mode
            [${REFUND_ROW_ATTRIBUTE}="eligible"][data-pp-useradmin-refund-selected="true"] {
                background-color: #e8f1fb;
                box-shadow: inset 0 0 0 2px #1976d2;
            }

            body.pp-useradmin-refund-mode
            [${REFUND_ROW_ATTRIBUTE}="eligible"][data-pp-useradmin-refund-selected="true"]::before {
                content: '✓';
                border-color: #1976d2;
                background: #1976d2;
                color: #ffffff;
                font-size: 14px;
                font-weight: 700;
                line-height: 16px;
                text-align: center;
            }

            #${PORTAL_STATUS_ID} {
                position: fixed;
                z-index: 2147483647;
                right: 16px;
                bottom: 16px;
                width: min(390px, calc(100vw - 32px));
                padding: 14px;
                box-shadow: 0 8px 28px rgba(0, 0, 0, 0.24);
            }

            .pp-useradmin-portal-title {
                margin: 0 0 7px;
                font-size: 1rem;
                font-weight: 700;
            }

            .pp-useradmin-portal-message {
                margin: 0 0 10px;
                white-space: pre-line;
                font-size: 0.875rem;
                line-height: 1.45;
            }

            @media (max-width: 560px) {
                #${REFUND_TOOLBAR_ID} {
                    align-items: stretch;
                }

                .pp-useradmin-refund-action {
                    flex: 1 1 140px;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function setReactInputValue(input, value) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        )?.set;

        if (nativeSetter) {
            nativeSetter.call(input, value);
        } else {
            input.value = value;
        }

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function normalizeSearchValue(value) {
        const trimmed = value.trim();

        if (/^\d{3}\s+\d{2}\s+\d{3}$/.test(trimmed)) {
            return trimmed.replace(/\s+/g, '');
        }

        if (/^[A-Za-z]{2}\s+\d{4,5}$/.test(trimmed)) {
            return trimmed.replace(/\s+/g, '');
        }

        return value;
    }

    function normalizeLabel(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLocaleLowerCase();
    }

    function inputIsUsable(input) {
        if (
            !input ||
            !input.isConnected ||
            input.disabled ||
            input.hidden ||
            input.type === 'hidden' ||
            input.getAttribute('aria-hidden') === 'true'
        ) {
            return false;
        }

        try {
            const style = window.getComputedStyle(input);

            if (
                style &&
                (style.display === 'none' || style.visibility === 'hidden')
            ) {
                return false;
            }
        } catch {
            // Connected, enabled inputs remain eligible without computed styles.
        }

        return true;
    }

    function getInputForLabel(label) {
        if (label.control && inputIsUsable(label.control)) {
            return label.control;
        }

        const forId = label.getAttribute('for');

        if (forId) {
            const input = document.getElementById(forId);
            if (inputIsUsable(input)) return input;
        }

        const nestedInput = label.querySelector('input');
        if (inputIsUsable(nestedInput)) return nestedInput;

        const formControl = label.closest('.MuiFormControl-root');
        const relatedInput = formControl?.querySelector('input');

        return inputIsUsable(relatedInput) ? relatedInput : null;
    }

    function findAdministrationSearchInput() {
        if (!isAdministrationPage()) return null;

        const labelledCandidates = new Set();

        document.querySelectorAll('label').forEach(label => {
            if (!SEARCH_LABELS.has(normalizeLabel(label.textContent))) return;

            const input = getInputForLabel(label);
            if (input) labelledCandidates.add(input);
        });

        document.querySelectorAll('input[aria-label]').forEach(input => {
            if (
                SEARCH_LABELS.has(normalizeLabel(input.getAttribute('aria-label'))) &&
                inputIsUsable(input)
            ) {
                labelledCandidates.add(input);
            }
        });

        if (labelledCandidates.size === 1) {
            return labelledCandidates.values().next().value;
        }

        if (labelledCandidates.size > 1) return null;

        const fallbackCandidates = Array.from(document.querySelectorAll(
            '.MuiTextField-root input'
        )).filter(inputIsUsable);

        return fallbackCandidates.length === 1
            ? fallbackCandidates[0]
            : null;
    }

    function addSmartSpaceRemoval() {
        const input = findAdministrationSearchInput();

        if (!input || input.dataset[SMART_INPUT_MARKER] === 'true') return;

        input.dataset[SMART_INPUT_MARKER] = 'true';

        const cleanValue = () => {
            if (
                !isAdministrationPage() ||
                input !== findAdministrationSearchInput()
            ) {
                return;
            }

            const cleaned = normalizeSearchValue(input.value);

            if (cleaned !== input.value) {
                setReactInputValue(input, cleaned);
            }
        };

        input.addEventListener('input', cleanValue);
        input.addEventListener('paste', () => {
            window.setTimeout(cleanValue, 0);
        });
    }

    function handleRemoveSpacesClick() {
        const searchInput = findAdministrationSearchInput();

        if (!searchInput) return;

        const cleaned = searchInput.value.replace(/\s+/g, '');

        setReactInputValue(searchInput, cleaned);
        searchInput.focus();
    }

    function addRemoveSpacesButton() {
        const searchInput = findAdministrationSearchInput();

        if (!searchInput) return;

        const formControl = searchInput.closest('.MuiFormControl-root');
        const parent = formControl?.parentNode;

        if (!formControl || !parent) return;

        if (activeSearchRow && activeSearchRow !== parent) {
            activeSearchRow.classList.remove(SEARCH_ROW_CLASS);
        }

        activeSearchRow = parent;
        activeSearchRow.classList.add(SEARCH_ROW_CLASS);

        let button = document.getElementById(BUTTON_ID);

        if (!button) {
            button = document.createElement('button');
            button.id = BUTTON_ID;
            button.className = 'pp-useradmin-button';
            button.type = 'button';
            button.textContent = 'No Spaces';
            button.setAttribute(
                'aria-label',
                'Remove spaces from the current search value'
            );
            button.addEventListener('click', handleRemoveSpacesClick);
        }

        if (
            button.parentNode !== parent ||
            button.previousElementSibling !== formControl
        ) {
            parent.insertBefore(button, formControl.nextSibling);
        }
    }

    function removeSearchButton() {
        document.getElementById(BUTTON_ID)?.remove();

        if (activeSearchRow) {
            activeSearchRow.classList.remove(SEARCH_ROW_CLASS);
            activeSearchRow = null;
        }
    }

    function getIdentifierUrl(element, text) {
        const label = normalizeLabel(
            element.previousElementSibling?.textContent
        );

        if (
            /^\d{24,32}$/.test(text) &&
            (label === 'chainid' || label === 'chain id')
        ) {
            return PAYMANAGER_BASE_URL + encodeURIComponent(text);
        }

        if (
            /^[a-f0-9]{32}$/i.test(text) &&
            (label === 'payment id' || label === 'betalings id')
        ) {
            return DIBS_BASE_URL + encodeURIComponent(text);
        }

        return null;
    }

    function getOwnedLink(element) {
        return element?.childElementCount === 1 &&
            element.firstElementChild?.matches(`a[${LINK_ATTRIBUTE}]`)
                ? element.firstElementChild
                : null;
    }

    function elementCanBeLinkified(element) {
        if (!element.matches('p, span')) return false;
        if (
            element.closest(
                'a, button, input, textarea, select, [contenteditable="true"]'
            )
        ) {
            return false;
        }

        if (getOwnedLink(element)) return true;

        return !element.querySelector(
            'a, button, input, textarea, select, [contenteditable="true"]'
        );
    }

    function unlinkOwnedElement(element) {
        const existingLink = getOwnedLink(element);

        if (!existingLink) return false;

        element.textContent = existingLink.textContent || '';
        delete element.dataset[LINK_MARKER];
        return true;
    }

    function linkifyElement(element) {
        if (!elementCanBeLinkified(element)) return;

        const text = element.textContent?.trim();

        if (!text) {
            unlinkOwnedElement(element);
            return;
        }

        const url = getIdentifierUrl(element, text);
        const existingLink = getOwnedLink(element);

        if (!url) {
            unlinkOwnedElement(element);
            return;
        }

        if (
            element.dataset[LINK_MARKER] === 'true' &&
            existingLink?.getAttribute('href') === url &&
            existingLink.textContent === text
        ) {
            return;
        }

        if (existingLink) {
            existingLink.href = url;
            existingLink.textContent = text;
            element.dataset[LINK_MARKER] = 'true';
            return;
        }

        if (element.childElementCount > 0 && !existingLink) return;

        const link = document.createElement('a');

        link.href = url;
        link.textContent = text;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'pp-useradmin-chain-link';
        link.setAttribute(LINK_ATTRIBUTE, 'true');

        element.replaceChildren(link);
        element.dataset[LINK_MARKER] = 'true';
    }

    function removeLinkifications() {
        document.querySelectorAll(`a[${LINK_ATTRIBUTE}]`).forEach(link => {
            const container = link.parentElement;

            if (container?.matches('p, span') && getOwnedLink(container) === link) {
                unlinkOwnedElement(container);
            }
        });
    }

    function waitForCondition(check, timeoutMs, intervalMs = 100) {
        return new Promise(resolve => {
            const startedAt = Date.now();

            const checkAgain = () => {
                let result = null;

                try {
                    result = check();
                } catch {
                    result = null;
                }

                if (result) {
                    resolve(result);
                    return;
                }

                if (Date.now() - startedAt >= timeoutMs) {
                    resolve(null);
                    return;
                }

                window.setTimeout(checkAgain, intervalMs);
            };

            checkAgain();
        });
    }

    function getPaymentRowParts(row) {
        return Array.from(row.querySelectorAll('p'))
            .map(element => String(element.textContent || '').trim())
            .filter(Boolean);
    }

    function getPaymentRowStatus(row) {
        return getPaymentRowParts(row).find(value => (
            isRefundableStatus(value) || isRefundedStatus(value)
        )) || '';
    }

    function getPaymentRows() {
        if (!isPaymentHistoryPage()) return [];

        return Array.from(document.querySelectorAll(
            '[role="button"].MuiListItemButton-root'
        )).filter(row => (
            getPaymentRowParts(row).length >= 3 &&
            Boolean(getPaymentRowStatus(row))
        ));
    }

    function hashRefundRow(value) {
        let hash = 2166136261;

        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }

        return (hash >>> 0).toString(36);
    }

    function getRefundRowBaseKey(row) {
        return hashRefundRow(
            getPaymentRowParts(row)
                .map(normalizeLabel)
                .join('|')
        );
    }

    function clearRefundSelection() {
        selectedRefundRows.clear();

        document.querySelectorAll(
            `[${REFUND_ROW_KEY_ATTRIBUTE}]`
        ).forEach(row => {
            delete row.dataset.ppUseradminRefundSelected;
        });

        updateRefundToolbar();
    }

    function decoratePaymentRows(rows = getPaymentRows()) {
        const keyOccurrences = new Map();
        const visibleKeys = new Set();

        rows.forEach(row => {
            const baseKey = getRefundRowBaseKey(row);
            const occurrence = (keyOccurrences.get(baseKey) || 0) + 1;
            const rowKey = `${baseKey}-${occurrence}`;
            const eligible = isRefundableStatus(getPaymentRowStatus(row));

            keyOccurrences.set(baseKey, occurrence);
            visibleKeys.add(rowKey);
            row.setAttribute(REFUND_ROW_KEY_ATTRIBUTE, rowKey);
            row.setAttribute(
                REFUND_ROW_ATTRIBUTE,
                eligible ? 'eligible' : 'ineligible'
            );

            if (eligible && selectedRefundRows.has(rowKey)) {
                row.dataset.ppUseradminRefundSelected = 'true';
            } else {
                delete row.dataset.ppUseradminRefundSelected;
            }
        });

        if (rows.length > 0) {
            for (const rowKey of selectedRefundRows.keys()) {
                if (!visibleKeys.has(rowKey)) selectedRefundRows.delete(rowKey);
            }
        }

        updateRefundToolbar();
    }

    function setRefundStatus(message, isError = false) {
        const status = document.getElementById(REFUND_STATUS_ID);

        if (!status) return;

        status.textContent = message;
        status.style.color = isError ? '#b42318' : '#42526e';
    }

    function updateRefundToolbar() {
        const selectAllButton = document.getElementById(REFUND_SELECT_ALL_ID);
        const clearButton = document.getElementById(REFUND_CLEAR_ID);
        const startButton = document.getElementById(REFUND_START_ID);
        const selectedCount = selectedRefundRows.size;

        if (selectAllButton) {
            selectAllButton.disabled = (
                !refundModeEnabled ||
                refundCollectionInProgress
            );
        }

        if (clearButton) {
            clearButton.disabled = (
                selectedCount === 0 ||
                refundCollectionInProgress
            );
        }

        if (startButton) {
            startButton.disabled = (
                !refundModeEnabled ||
                selectedCount === 0 ||
                refundCollectionInProgress
            );
            const label = `Refund selected (${selectedCount})`;
            if (startButton.textContent !== label) {
                startButton.textContent = label;
            }
        }
    }

    function setRefundMode(enabled) {
        refundModeEnabled = Boolean(enabled) && isPaymentHistoryPage();
        document.body?.classList.toggle(
            'pp-useradmin-refund-mode',
            refundModeEnabled
        );

        if (!refundModeEnabled) clearRefundSelection();

        const switchInput = document.getElementById(REFUND_MODE_ID);
        if (switchInput) switchInput.checked = refundModeEnabled;

        decoratePaymentRows();
        setRefundStatus(
            refundModeEnabled
                ? 'Selection mode is on. Click paid rows to select them.'
                : 'Refund selection is safely off.'
        );
    }

    function handleRefundRowClick(event) {
        if (
            !refundModeEnabled ||
            refundCollectionInProgress ||
            !isPaymentHistoryPage()
        ) {
            return;
        }

        const row = event.target.closest?.(`[${REFUND_ROW_ATTRIBUTE}]`);

        if (
            !row ||
            row.getAttribute(REFUND_ROW_ATTRIBUTE) !== 'eligible'
        ) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();

        const rowKey = row.getAttribute(REFUND_ROW_KEY_ATTRIBUTE);
        if (!rowKey) return;

        if (selectedRefundRows.has(rowKey)) {
            selectedRefundRows.delete(rowKey);
            delete row.dataset.ppUseradminRefundSelected;
        } else if (selectedRefundRows.size < MAX_REFUND_BATCH_SIZE) {
            selectedRefundRows.set(rowKey, true);
            row.dataset.ppUseradminRefundSelected = 'true';
        } else {
            setRefundStatus(
                `A batch is limited to ${MAX_REFUND_BATCH_SIZE} payments.`,
                true
            );
        }

        updateRefundToolbar();
    }

    function handleSelectAllRefundRows() {
        if (!refundModeEnabled || refundCollectionInProgress) return;

        const rows = getPaymentRows();
        decoratePaymentRows(rows);

        rows.forEach(row => {
            if (
                selectedRefundRows.size >= MAX_REFUND_BATCH_SIZE ||
                row.getAttribute(REFUND_ROW_ATTRIBUTE) !== 'eligible'
            ) {
                return;
            }

            const rowKey = row.getAttribute(REFUND_ROW_KEY_ATTRIBUTE);
            if (rowKey) selectedRefundRows.set(rowKey, true);
        });

        decoratePaymentRows(rows);
        setRefundStatus(`${selectedRefundRows.size} paid rows selected.`);
    }

    function findPaymentDialog() {
        return Array.from(document.querySelectorAll('[role="dialog"]')).find(
            dialog => (
                dialog.querySelector(
                    `a[href*="${DIBS_HOST}"][href*="searchValue="]`
                ) ||
                Array.from(dialog.querySelectorAll('p, span')).some(element => (
                    ['payment id', 'betalings id'].includes(
                        normalizeLabel(element.textContent)
                    )
                ))
            )
        ) || null;
    }

    function getPaymentIdFromDialog(dialog) {
        if (!dialog) return null;

        const links = Array.from(dialog.querySelectorAll('a[href]'));

        for (const link of links) {
            const paymentId = getPaymentIdFromHref(link.href);
            if (paymentId) return paymentId;
        }

        const elements = Array.from(dialog.querySelectorAll('p, span'));

        for (let index = 0; index < elements.length; index += 1) {
            if (
                !['payment id', 'betalings id'].includes(
                    normalizeLabel(elements[index].textContent)
                )
            ) {
                continue;
            }

            const candidates = [
                elements[index].nextElementSibling,
                elements[index].parentElement?.nextElementSibling
            ];

            for (const candidate of candidates) {
                const text = String(candidate?.textContent || '').trim();
                if (PAYMENT_ID_PATTERN.test(text)) return text.toLowerCase();
            }
        }

        return null;
    }

    async function closePaymentDialog(dialog) {
        if (!dialog?.isConnected) return true;

        const closeButton = (
            dialog.querySelector('button[aria-label="close" i]') ||
            dialog.querySelector('button[aria-label="lukk" i]') ||
            Array.from(dialog.querySelectorAll('button')).find(button => (
                ['close', 'lukk'].includes(normalizeLabel(button.textContent))
            ))
        );

        if (!closeButton) return false;

        closeButton.click();

        return Boolean(await waitForCondition(
            () => !dialog.isConnected,
            2500
        ));
    }

    async function collectPaymentIdForRow(row) {
        const existingDialog = findPaymentDialog();

        if (existingDialog && !await closePaymentDialog(existingDialog)) {
            throw new Error('Close the open payment dialog and try again.');
        }

        row.click();

        const dialog = await waitForCondition(findPaymentDialog, 5000);
        if (!dialog) throw new Error('The payment details did not open.');

        const paymentId = getPaymentIdFromDialog(dialog);
        const closed = await closePaymentDialog(dialog);

        if (!closed) {
            throw new Error('The payment details could not be closed safely.');
        }

        if (!paymentId) {
            throw new Error('No valid Payment ID was found in the details.');
        }

        return paymentId;
    }

    function createRefundToken() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);

        return Array.from(bytes, byte => (
            byte.toString(16).padStart(2, '0')
        )).join('');
    }

    function getDibsPaymentUrl(paymentId) {
        return `${DIBS_ORIGIN}${DIBS_PAYMENT_PATH}${encodeURIComponent(paymentId)}`;
    }

    function prepareRefundPortalWindow(portalWindow) {
        try {
            portalWindow.document.title = 'Preparing refund batch';
            portalWindow.document.body.textContent =
                'Collecting selected Payment IDs. No refund has started yet.';
        } catch {
            // The page is only a temporary same-origin placeholder.
        }
    }

    async function handleStartRefundBatch() {
        if (
            refundCollectionInProgress ||
            !refundModeEnabled ||
            selectedRefundRows.size === 0
        ) {
            return;
        }

        if (refundPortalWindow && !refundPortalWindow.closed) {
            setRefundStatus(
                'A refund batch tab is already open. Finish or close it before starting another.',
                true
            );
            return;
        }

        const selectedKeys = Array.from(selectedRefundRows.keys());
        const portalWindow = openBrowserWindow?.(
            'about:blank',
            `ppUserAdminRefundPortal-${Date.now()}`
        );

        if (!portalWindow) {
            setRefundStatus(
                'The refund tab was blocked. Allow pop-ups for PassPay and try again.',
                true
            );
            return;
        }

        prepareRefundPortalWindow(portalWindow);
        refundCollectionInProgress = true;
        updateRefundToolbar();

        try {
            const paymentIds = [];
            const uniqueIds = new Set();

            for (let index = 0; index < selectedKeys.length; index += 1) {
                const rowKey = selectedKeys[index];
                const row = document.querySelector(
                    `[${REFUND_ROW_KEY_ATTRIBUTE}="${CSS.escape(rowKey)}"]`
                );

                if (!row || !row.isConnected) {
                    throw new Error(
                        'A selected row changed. Review the list and select it again.'
                    );
                }

                setRefundStatus(
                    `Reading Payment ID ${index + 1} of ${selectedKeys.length}...`
                );

                const paymentId = await collectPaymentIdForRow(row);

                if (uniqueIds.has(paymentId)) {
                    throw new Error(
                        'The same Payment ID appeared more than once. Nothing was refunded.'
                    );
                }

                uniqueIds.add(paymentId);
                paymentIds.push(paymentId);
            }

            const phrase = getRefundConfirmationPhrase(paymentIds.length);
            const answer = requestUserConfirmation?.(
                `Safety check\n\n${paymentIds.length} payment(s) will be fully refunded one at a time. ` +
                'The batch stops on login, an error, or an uncertain result.\n\n' +
                `Type ${phrase} to arm the batch.`,
                ''
            );

            if (answer !== phrase) {
                portalWindow.close();
                setRefundStatus('Refund batch cancelled. Nothing was refunded.');
                return;
            }

            refundQueueForPortal = {
                version: REFUND_QUEUE_VERSION,
                token: createRefundToken(),
                createdAt: Date.now(),
                index: 0,
                items: paymentIds.map(paymentId => ({
                    paymentId,
                    state: 'pending'
                }))
            };
            refundPortalWindow = portalWindow;

            setRefundMode(false);
            setRefundStatus(
                `Refund batch armed for ${paymentIds.length} payment(s). ` +
                'Follow progress in the DIBS tab.'
            );
            portalWindow.location.replace(getDibsPaymentUrl(paymentIds[0]));
        } catch (error) {
            portalWindow.close();
            setRefundStatus(
                `${error.message || 'Payment IDs could not be collected'} Nothing was refunded.`,
                true
            );
        } finally {
            refundCollectionInProgress = false;
            updateRefundToolbar();
        }
    }

    function createRefundToolbar() {
        const toolbar = document.createElement('div');
        const switchLabel = document.createElement('label');
        const switchInput = document.createElement('input');
        const switchText = document.createElement('span');
        const selectAllButton = document.createElement('button');
        const clearButton = document.createElement('button');
        const startButton = document.createElement('button');
        const status = document.createElement('div');

        toolbar.id = REFUND_TOOLBAR_ID;
        toolbar.setAttribute('aria-label', 'Batch refund controls');

        switchLabel.className = 'pp-useradmin-refund-switch';
        switchInput.id = REFUND_MODE_ID;
        switchInput.type = 'checkbox';
        switchInput.checked = false;
        switchInput.addEventListener('change', () => {
            setRefundMode(switchInput.checked);
        });
        switchText.textContent = 'Enable refund selection';
        switchLabel.append(switchInput, switchText);

        selectAllButton.id = REFUND_SELECT_ALL_ID;
        selectAllButton.type = 'button';
        selectAllButton.className = 'pp-useradmin-refund-action';
        selectAllButton.textContent = 'Select paid on page';
        selectAllButton.addEventListener('click', handleSelectAllRefundRows);

        clearButton.id = REFUND_CLEAR_ID;
        clearButton.type = 'button';
        clearButton.className = 'pp-useradmin-refund-action';
        clearButton.textContent = 'Clear selection';
        clearButton.addEventListener('click', clearRefundSelection);

        startButton.id = REFUND_START_ID;
        startButton.type = 'button';
        startButton.className =
            'pp-useradmin-refund-action pp-useradmin-refund-danger';
        startButton.addEventListener('click', () => {
            void handleStartRefundBatch();
        });

        status.id = REFUND_STATUS_ID;
        status.setAttribute('aria-live', 'polite');
        status.textContent = 'Refund selection is safely off.';

        toolbar.append(
            switchLabel,
            selectAllButton,
            clearButton,
            startButton,
            status
        );

        return toolbar;
    }

    function ensureRefundToolbar() {
        if (!isPaymentHistoryPage()) {
            removeRefundUi();
            return;
        }

        const rows = getPaymentRows();
        if (rows.length === 0) return;

        const container = rows[0].parentElement;
        if (!container || !rows.every(row => row.parentElement === container)) {
            return;
        }

        let toolbar = document.getElementById(REFUND_TOOLBAR_ID);
        if (!toolbar) toolbar = createRefundToolbar();

        if (toolbar.parentElement !== container || toolbar.nextElementSibling !== rows[0]) {
            container.insertBefore(toolbar, rows[0]);
        }

        decoratePaymentRows(rows);
        updateRefundToolbar();
    }

    function removeRefundUi() {
        document.getElementById(REFUND_TOOLBAR_ID)?.remove();
        document.body?.classList.remove('pp-useradmin-refund-mode');

        document.querySelectorAll(`[${REFUND_ROW_ATTRIBUTE}]`).forEach(row => {
            row.removeAttribute(REFUND_ROW_ATTRIBUTE);
            row.removeAttribute(REFUND_ROW_KEY_ATTRIBUTE);
            delete row.dataset.ppUseradminRefundSelected;
        });

        refundModeEnabled = false;
        refundCollectionInProgress = false;
        selectedRefundRows.clear();
    }

    function handlePortalReadyMessage(event) {
        if (
            event.origin !== DIBS_ORIGIN ||
            event.source !== refundPortalWindow ||
            event.data?.type !== PORTAL_READY_MESSAGE ||
            !isValidRefundQueue(refundQueueForPortal)
        ) {
            return;
        }

        event.source.postMessage({
            type: PORTAL_QUEUE_MESSAGE,
            queue: refundQueueForPortal
        }, DIBS_ORIGIN);
        refundQueueForPortal = null;
    }

    function loadPortalRefundQueue() {
        try {
            const rawValue = sessionStorage.getItem(REFUND_QUEUE_KEY);
            if (!rawValue) return null;

            const queue = JSON.parse(rawValue);

            if (!isValidRefundQueue(queue)) {
                sessionStorage.removeItem(REFUND_QUEUE_KEY);
                return null;
            }

            return queue;
        } catch {
            try {
                sessionStorage.removeItem(REFUND_QUEUE_KEY);
            } catch {
                // Storage can be unavailable in restricted browser modes.
            }

            return null;
        }
    }

    function savePortalRefundQueue(queue) {
        if (!isValidRefundQueue(queue)) return false;

        try {
            sessionStorage.setItem(REFUND_QUEUE_KEY, JSON.stringify(queue));
            return true;
        } catch {
            return false;
        }
    }

    function clearPortalRefundQueue() {
        try {
            sessionStorage.removeItem(REFUND_QUEUE_KEY);
        } catch {
            // The in-memory stop flag still prevents further processing.
        }
    }

    function clearPortalLoginWatch() {
        portalLoginObserver?.disconnect();
        portalLoginObserver = null;

        if (portalLoginTimer !== null) {
            window.clearTimeout(portalLoginTimer);
            portalLoginTimer = null;
        }
    }

    function renderPortalStatus(message, options = {}) {
        if (!document.body) return;

        injectStyles();

        let panel = document.getElementById(PORTAL_STATUS_ID);

        if (!panel) {
            panel = document.createElement('aside');
            panel.id = PORTAL_STATUS_ID;
            panel.setAttribute('aria-live', 'polite');

            const title = document.createElement('h2');
            const messageElement = document.createElement('p');
            const cancelButton = document.createElement('button');

            title.className = 'pp-useradmin-portal-title';
            title.textContent = 'PassPay refund batch';
            messageElement.className = 'pp-useradmin-portal-message';
            cancelButton.id = PORTAL_CANCEL_ID;
            cancelButton.type = 'button';
            cancelButton.className = 'pp-useradmin-refund-action';
            cancelButton.textContent = 'Stop remaining refunds';
            cancelButton.addEventListener('click', () => {
                clearPortalLoginWatch();
                portalCancelled = true;
                portalProcessing = false;
                clearPortalRefundQueue();
                window.name = '';
                renderPortalStatus(
                    'Batch stopped. No remaining payment will be submitted. ' +
                    'Refunds already confirmed by DIBS cannot be undone.',
                    { showCancel: false, isError: true }
                );
            });

            panel.append(title, messageElement, cancelButton);
            document.body.appendChild(panel);
        }

        const messageElement = panel.querySelector(
            '.pp-useradmin-portal-message'
        );
        const cancelButton = panel.querySelector(`#${PORTAL_CANCEL_ID}`);

        if (messageElement) {
            messageElement.textContent = message;
            messageElement.style.color = options.isError
                ? '#b42318'
                : '#42526e';
        }

        if (cancelButton) {
            cancelButton.hidden = options.showCancel === false;
        }
    }

    function stopPortalBatch(message) {
        clearPortalLoginWatch();
        portalCancelled = true;
        portalProcessing = false;
        clearPortalRefundQueue();
        window.name = '';
        renderPortalStatus(
            `${message}\n\nThe batch stopped without retrying. ` +
            'Check DIBS manually before starting another batch.',
            { showCancel: false, isError: true }
        );
    }

    function finishPortalBatch(queue) {
        clearPortalLoginWatch();
        clearPortalRefundQueue();
        portalProcessing = false;
        portalCancelled = false;
        window.name = '';

        const refundedCount = queue.items.filter(
            item => item.state === 'refunded'
        ).length;
        const skippedCount = queue.items.filter(
            item => item.state === 'skipped'
        ).length;

        renderPortalStatus(
            `Batch complete. ${refundedCount} refunded, ` +
            `${skippedCount} already refunded and skipped.`,
            { showCancel: false }
        );
    }

    function getCurrentDibsPaymentId() {
        if (!location.pathname.startsWith(DIBS_PAYMENT_PATH)) return null;

        const paymentId = decodeURIComponent(
            location.pathname.slice(DIBS_PAYMENT_PATH.length).split('/')[0]
        );

        return PAYMENT_ID_PATTERN.test(paymentId)
            ? paymentId.toLowerCase()
            : null;
    }

    function findDibsLoginForm() {
        const passwordInput = document.querySelector('input[type="password"]');
        const form = passwordInput?.closest('form');

        if (!passwordInput || !form) return null;

        const emailInput = (
            form.querySelector('input[type="email"]') ||
            form.querySelector('input[name*="email" i]') ||
            form.querySelector('input[type="text"]')
        );

        return emailInput ? { emailInput, passwordInput } : null;
    }

    function findDibsLoginRedirectControl() {
        const labels = new Set([
            'gå til innloggingssiden',
            'go to login page',
            'go to sign-in page'
        ]);

        return Array.from(document.querySelectorAll('a, button')).find(
            element => labels.has(normalizeLabel(element.textContent))
        ) || null;
    }

    function watchForDibsLoginCompletion(queue) {
        if (!document.body || portalLoginObserver) return;

        const remainingLifetime = Math.max(
            1000,
            REFUND_QUEUE_TTL_MS - (Date.now() - queue.createdAt)
        );

        portalLoginObserver = new MutationObserver(() => {
            if (findDibsLoginForm() || !document.querySelector('main')) return;

            clearPortalLoginWatch();
            void processPortalRefundQueue(loadPortalRefundQueue());
        });
        portalLoginObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        portalLoginTimer = window.setTimeout(() => {
            clearPortalLoginWatch();
            stopPortalBatch('The 30-minute refund authorization expired.');
        }, remainingLifetime);
    }

    function prepareDibsLogin(queue) {
        const login = findDibsLoginForm();
        if (!login || !isValidRefundQueue(queue)) return false;

        if (!login.emailInput.value.trim()) {
            setReactInputValue(login.emailInput, DIBS_LOGIN_EMAIL);
        }

        if (!login.passwordInput.value) {
            login.passwordInput.placeholder = 'Enter portal password manually';
        }

        login.passwordInput.focus();
        renderPortalStatus(
            `Batch paused at sign-in (${queue.index + 1} of ${queue.items.length}). ` +
            `Email is prefilled as ${DIBS_LOGIN_EMAIL}. Enter the password ` +
            'yourself and complete any authentication. The batch resumes after login.',
            { showCancel: true }
        );
        watchForDibsLoginCompletion(queue);
        portalProcessing = false;
        return true;
    }

    function portalPageIsRefunded() {
        const statusCells = Array.from(
            document.querySelectorAll('main table tbody tr')
        ).map(row => row.querySelector('td:last-child')).filter(Boolean);

        return (
            statusCells.length > 0 &&
            statusCells.every(cell => isRefundedStatus(cell.textContent))
        );
    }

    function portalRefundIsVerified() {
        if (!portalPageIsRefunded()) return false;

        return Array.from(document.querySelectorAll('main ul')).some(list => {
            const text = normalizeLabel(list.textContent);

            return (
                Array.from(list.querySelectorAll('h1, h2, h3, h4, h5, h6'))
                    .some(heading => (
                        normalizeLabel(heading.textContent).startsWith('refundert') ||
                        normalizeLabel(heading.textContent).startsWith('refunded')
                    )) &&
                text.includes(normalizeLabel(DIBS_LOGIN_EMAIL))
            );
        });
    }

    function findPortalRefundButton() {
        return Array.from(document.querySelectorAll('main button')).find(
            button => (
                !button.disabled &&
                ['refunder', 'refund'].includes(normalizeLabel(button.textContent))
            )
        ) || null;
    }

    function findPortalRefundDialog() {
        return Array.from(document.querySelectorAll('[role="dialog"]')).find(
            dialog => Array.from(dialog.querySelectorAll('button')).some(
                button => (
                    ['refunder', 'refund'].includes(
                        normalizeLabel(button.textContent)
                    )
                )
            )
        ) || null;
    }

    function findPortalConfirmRefundButton(dialog) {
        return Array.from(dialog?.querySelectorAll('button') || [])
            .filter(button => (
                !button.disabled &&
                ['refunder', 'refund'].includes(normalizeLabel(button.textContent))
            ))
            .at(-1) || null;
    }

    function navigateToPortalQueueItem(queue) {
        if (portalCancelled) return;

        if (queue.index >= queue.items.length) {
            finishPortalBatch(queue);
            return;
        }

        if (!savePortalRefundQueue(queue)) {
            stopPortalBatch('The guarded refund queue could not be saved.');
            return;
        }

        location.replace(getDibsPaymentUrl(
            queue.items[queue.index].paymentId
        ));
    }

    function completePortalQueueItem(queue, state) {
        queue.items[queue.index].state = state;
        queue.index += 1;
        portalProcessing = false;
        navigateToPortalQueueItem(queue);
    }

    async function processPortalRefundQueue(queue = loadPortalRefundQueue()) {
        if (
            portalProcessing ||
            portalCancelled ||
            !isValidRefundQueue(queue)
        ) {
            return;
        }

        portalProcessing = true;

        const readyElement = await waitForCondition(
            () => (
                findDibsLoginForm() ||
                findDibsLoginRedirectControl() ||
                document.querySelector('main')
            ),
            15000,
            150
        );

        if (portalCancelled) return;

        if (!readyElement) {
            stopPortalBatch('DIBS did not finish loading within 15 seconds.');
            return;
        }

        const loginRedirectControl = findDibsLoginRedirectControl();
        if (loginRedirectControl) {
            renderPortalStatus(
                'The DIBS session expired. Opening the login page; enter the ' +
                'password yourself when prompted.',
                { showCancel: true }
            );
            portalProcessing = false;
            loginRedirectControl.click();
            return;
        }

        if (prepareDibsLogin(queue)) return;

        if (queue.index >= queue.items.length) {
            finishPortalBatch(queue);
            return;
        }

        const item = queue.items[queue.index];
        const currentPaymentId = getCurrentDibsPaymentId();

        if (currentPaymentId !== item.paymentId) {
            portalProcessing = false;
            navigateToPortalQueueItem(queue);
            return;
        }

        renderPortalStatus(
            `Checking payment ${queue.index + 1} of ${queue.items.length}...`,
            { showCancel: true }
        );

        if (item.state === 'submitted') {
            const verified = await waitForCondition(
                portalRefundIsVerified,
                20000,
                250
            );

            if (portalCancelled) return;

            if (verified) {
                completePortalQueueItem(queue, 'refunded');
            } else {
                stopPortalBatch(
                    'A refund may have been submitted, but its final status and ' +
                    `${DIBS_LOGIN_EMAIL} confirmation could not be verified.`
                );
            }
            return;
        }

        if (portalPageIsRefunded()) {
            completePortalQueueItem(queue, 'skipped');
            return;
        }

        const refundButton = await waitForCondition(
            findPortalRefundButton,
            15000,
            200
        );

        if (portalCancelled) return;

        if (!refundButton) {
            if (portalPageIsRefunded()) {
                completePortalQueueItem(queue, 'skipped');
            } else {
                stopPortalBatch(
                    'No enabled Refund button appeared for the current payment.'
                );
            }
            return;
        }

        item.state = 'submitted';
        if (!savePortalRefundQueue(queue)) {
            stopPortalBatch('The queue could not be secured before submission.');
            return;
        }

        renderPortalStatus(
            `Submitting refund ${queue.index + 1} of ${queue.items.length}...`,
            { showCancel: true }
        );
        refundButton.click();

        const dialog = await waitForCondition(
            findPortalRefundDialog,
            5000,
            100
        );
        const confirmButton = findPortalConfirmRefundButton(dialog);

        if (portalCancelled) return;

        if (!dialog || !confirmButton) {
            stopPortalBatch(
                'The DIBS refund confirmation dialog did not appear as expected.'
            );
            return;
        }

        confirmButton.click();

        const verified = await waitForCondition(
            portalRefundIsVerified,
            45000,
            250
        );

        if (portalCancelled) return;

        if (!verified) {
            stopPortalBatch(
                'DIBS did not confirm both Refundert status and the expected ' +
                `${DIBS_LOGIN_EMAIL} refund event within 45 seconds.`
            );
            return;
        }

        completePortalQueueItem(queue, 'refunded');
    }

    function handlePortalQueueMessage(event) {
        if (
            event.origin !== PASSPAY_ORIGIN ||
            event.source !== window.opener ||
            event.data?.type !== PORTAL_QUEUE_MESSAGE ||
            !isValidRefundQueue(event.data.queue)
        ) {
            return;
        }

        const queue = event.data.queue;

        if (!savePortalRefundQueue(queue)) {
            stopPortalBatch('The refund queue could not be stored in this tab.');
            return;
        }

        void processPortalRefundQueue(queue);
    }

    function startDibsPortal() {
        if (!document.body) return;

        injectStyles();
        window.addEventListener('message', handlePortalQueueMessage);

        const existingQueue = loadPortalRefundQueue();

        if (existingQueue) {
            void processPortalRefundQueue(existingQueue);
            return;
        }

        if (
            window.opener &&
            window.name.startsWith(REFUND_WINDOW_NAME_PREFIX)
        ) {
            renderPortalStatus(
                'Waiting for the armed refund batch from PassPay...',
                { showCancel: false }
            );
            window.opener.postMessage(
                { type: PORTAL_READY_MESSAGE },
                PASSPAY_ORIGIN
            );
        }
    }

    function processRoot(root) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

        if (root.matches('p, span')) {
            linkifyElement(root);
        }

        root.querySelectorAll('p, span').forEach(linkifyElement);
    }

    function runPendingWork() {
        runScheduled = false;
        animationFrame = null;

        if (!isAdministrationPage()) {
            pendingRoots.clear();
            observer?.disconnect();
            observer = null;
            removeSearchButton();
            removeRefundUi();
            removeLinkifications();
            return;
        }

        ensureObserver();

        const roots = Array.from(pendingRoots);
        pendingRoots.clear();

        roots.forEach(processRoot);
        addRemoveSpacesButton();
        addSmartSpaceRemoval();
        ensureRefundToolbar();
    }

    function queuePendingRoot(root) {
        if (root?.nodeType === Node.TEXT_NODE) {
            root = root.parentElement;
        }

        if (root?.nodeType !== Node.ELEMENT_NODE) return;

        for (const existingRoot of pendingRoots) {
            if (existingRoot === root || existingRoot.contains?.(root)) {
                return;
            }

            if (root.contains?.(existingRoot)) {
                pendingRoots.delete(existingRoot);
            }
        }

        pendingRoots.add(root);
    }

    function scheduleRun(root = document.body) {
        queuePendingRoot(root);

        if (runScheduled) return;

        runScheduled = true;
        animationFrame = requestAnimationFrame(runPendingWork);
    }

    function handleMutations(records) {
        for (const record of records) {
            if (record.type === 'characterData') {
                scheduleRun(record.target.parentElement?.parentElement ||
                    record.target.parentElement);
                continue;
            }

            scheduleRun(record.target);

            record.addedNodes.forEach(node => {
                scheduleRun(
                    node.nodeType === Node.TEXT_NODE
                        ? node.parentElement
                        : node
                );
            });
        }
    }

    function hookNavigation() {
        if (history[HISTORY_PATCH_KEY]) return;

        history[HISTORY_PATCH_KEY] = true;

        for (const methodName of ['pushState', 'replaceState']) {
            const originalMethod = history[methodName];

            history[methodName] = function () {
                const result = originalMethod.apply(this, arguments);

                scheduleRun(document.body);
                return result;
            };
        }

        window.addEventListener('popstate', () => {
            scheduleRun(document.body);
        });
    }

    function ensureObserver() {
        if (observer || !document.body || !isAdministrationPage()) return;

        observer = new MutationObserver(handleMutations);
        observer.observe(document.body, {
            characterData: true,
            childList: true,
            subtree: true
        });
    }

    function start() {
        if (!document.body) return;

        injectStyles();
        scheduleRun(document.body);

        ensureObserver();
        document.addEventListener('click', handleRefundRowClick, true);
        window.addEventListener('message', handlePortalReadyMessage);

        window.addEventListener('pagehide', () => {
            observer?.disconnect();
            observer = null;

            if (animationFrame !== null) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }

            pendingRoots.clear();
            runScheduled = false;
        });

        window.addEventListener('pageshow', () => {
            ensureObserver();
            scheduleRun(document.body);
        });
    }

    if (isDibsPortal()) {
        if (document.body) {
            startDibsPortal();
        } else {
            document.addEventListener('DOMContentLoaded', startDibsPortal, {
                once: true
            });
        }
        return;
    }

    hookNavigation();

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }

})();
