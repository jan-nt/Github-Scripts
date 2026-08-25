// ==UserScript==
// @name         PassPay UserAdmin
// @namespace    https://nidushan.com
// @version      1.9.1
// @description  Converts ChainID and PaymentID values into clickable links and adds smart search helpers
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   mailto:jas@nortronic.com
// @match        https://betaling.passpay.no/administration*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PassPay%20UserAdmin.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PassPay%20UserAdmin.user.js
// @grant        none
// @run-at       document-idle
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
    const SMART_INPUT_MARKER = 'ppUseradminSmartSpaces';
    const LINK_MARKER = 'ppUseradminLinkified';
    const LINK_ATTRIBUTE = 'data-pp-useradmin-link';
    const SEARCH_LABELS = new Set(['search', 'søk']);

    const PAYMANAGER_BASE_URL =
        'https://paymanager.logos.dk/transactions?chainid=';

    const DIBS_BASE_URL =
        'https://portal.dibspayment.eu/portal-frontend/payments?searchKey=PAYMENT_ID&searchValue=';

    let observer = null;
    let runScheduled = false;
    let animationFrame = null;
    const pendingRoots = new Set();

    function isAdministrationPage() {
        return (
            location.pathname === '/administration' ||
            location.pathname.startsWith('/administration/')
        );
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;

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
                margin: 0 0 1px 8px;
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
            removeLinkifications();
            return;
        }

        ensureObserver();

        const roots = Array.from(pendingRoots);
        pendingRoots.clear();

        roots.forEach(processRoot);
        addRemoveSpacesButton();
        addSmartSpaceRemoval();
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

    hookNavigation();

    if (document.body) {
        start();
    } else {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    }

})();
