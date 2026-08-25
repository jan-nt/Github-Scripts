// ==UserScript==
// @name         PayManager Image Row Highlighter
// @namespace    https://nidushan.com
// @version      1.7.1
// @description  Highlights transaction rows containing Event, Camera, and Image details
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   mailto:jas@nortronic.com
// @match        https://paymanager.logos.dk/transactions*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Image%20Row%20Highlighter.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Image%20Row%20Highlighter.user.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const STATE_KEY = Symbol.for(
        'tampermonkey.paymanager.image-row-highlighter'
    );

    if (window[STATE_KEY]?.initialized) return;

    const state = {
        initialized: true,
        observer: null,
        rootObserver: null,
        discoveryObserver: null,
        discoveryTimer: null,
        scanTimer: null,
        observedRoot: null,
        clickBound: false
    };

    window[STATE_KEY] = state;

    const STYLE_ID = 'tm-paymanager-image-row-highlighter-style';
    const HIGHLIGHT_CLASS = 'tm-paymanager-image-highlight';
    const DISCOVERY_TIMEOUT_MS = 15_000;
    const MUTATION_SCAN_DEBOUNCE_MS = 75;
    const POST_CLICK_SCAN_DELAY_MS = 200;

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            tr.${HIGHLIGHT_CLASS} > td,
            .dataTables_scrollBody tr.${HIGHLIGHT_CLASS} > td,
            .subTable tbody tr.${HIGHLIGHT_CLASS} > td {
                background-color: #c8f7c5 !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function normalize(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    /************************************************************
     * DETECTION: Event → Camera → Image row
     ************************************************************/
    function rowHasEventCameraImage(row) {
        const cells = Array.from(row.cells || []);
        if (cells.length < 3) return false;

        for (let i = 0; i <= cells.length - 3; i++) {
            if (
                normalize(cells[i].textContent) === 'Event' &&
                normalize(cells[i + 1].textContent) === 'Camera' &&
                normalize(cells[i + 2].textContent) === 'Image'
            ) {
                return true;
            }
        }
        return false;
    }

    /************************************************************
     * APPLY: Image highlight
     ************************************************************/
    function applyImageHighlight(row) {
        if (rowHasEventCameraImage(row)) {
            if (!row.classList.contains(HIGHLIGHT_CLASS)) {
                row.classList.add(HIGHLIGHT_CLASS);
                return true;
            }
        } else {
            if (row.classList.contains(HIGHLIGHT_CLASS)) {
                row.classList.remove(HIGHLIGHT_CLASS);
            }
        }
        return false;
    }

    /************************************************************
     * MAIN SCAN
     *
     * Scans the current transaction container after relevant DOM changes.
     * Direct table bodies and rows are used so nested tables are not scanned
     * repeatedly through each ancestor table.
     ************************************************************/
    let scanning = false;

    function scanAllRows() {
        if (scanning) return;
        scanning = true;

        try {
            const root = state.observedRoot;

            if (!root) return;

            const tables = [];

            if (root.matches?.('table')) tables.push(root);
            tables.push(...root.querySelectorAll('table'));

            tables.forEach(table => {
                for (const tableBody of Array.from(table.tBodies || [])) {
                    for (const row of Array.from(tableBody.rows || [])) {
                        try {
                            applyImageHighlight(row);
                        } catch {
                            // A later mutation will retry transient redraws.
                        }
                    }
                }
            });
        } catch {
            // A later mutation will retry transient table redraw errors.
        } finally {
            scanning = false;
        }
    }

    function scheduleScan(delayMs = MUTATION_SCAN_DEBOUNCE_MS) {
        if (state.scanTimer !== null) clearTimeout(state.scanTimer);

        state.scanTimer = window.setTimeout(() => {
            state.scanTimer = null;
            scanAllRows();
        }, delayMs);
    }

    function getObservationRoot() {
        return document.getElementById('right_container') ||
            document.getElementById('financial_table_container');
    }

    function observeTransactionContainer(root) {
        if (!root || root === state.observedRoot) return;

        state.observer?.disconnect();
        state.rootObserver?.disconnect();
        state.observedRoot = root;
        state.observer = new MutationObserver(() => scheduleScan());
        state.observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true
        });

        if (root.parentElement) {
            state.rootObserver = new MutationObserver(() => {
                const currentRoot = getObservationRoot();

                if (currentRoot && currentRoot !== state.observedRoot) {
                    observeTransactionContainer(currentRoot);
                    return;
                }

                if (!currentRoot) {
                    state.observer?.disconnect();
                    state.observer = null;
                    state.observedRoot = null;
                    discoverTransactionContainer();
                }
            });
            state.rootObserver.observe(root.parentElement, { childList: true });
        } else {
            state.rootObserver = null;
        }

        scheduleScan(0);
    }

    function stopDiscovery() {
        state.discoveryObserver?.disconnect();
        state.discoveryObserver = null;

        if (state.discoveryTimer !== null) {
            clearTimeout(state.discoveryTimer);
            state.discoveryTimer = null;
        }
    }

    function discoverTransactionContainer() {
        const existingRoot = getObservationRoot();

        if (existingRoot) {
            observeTransactionContainer(existingRoot);
            return;
        }

        if (!document.body || state.discoveryObserver) return;

        state.discoveryObserver = new MutationObserver(() => {
            const discoveredRoot = getObservationRoot();

            if (!discoveredRoot) return;

            stopDiscovery();
            observeTransactionContainer(discoveredRoot);
        });

        state.discoveryObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        state.discoveryTimer = window.setTimeout(
            stopDiscovery,
            DISCOVERY_TIMEOUT_MS
        );
    }

    /************************************************************
     * CLICK HANDLER
     *
     * Catches clicks on "Show" / "Vis" / "Expand" buttons and
     * triggers an extra scan shortly after so the new content gets
     * highlighted immediately instead of waiting for the next poll.
     ************************************************************/
    function handleDocumentClick(event) {
        const eventTarget = event.target;

        if (!eventTarget || typeof eventTarget.closest !== 'function') return;

        const target = eventTarget.closest('a, button, span, td');
        if (!target) return;

        const text = normalize(target.textContent).toLowerCase();

        if (text === 'show' || text === 'vis' || text === 'expand') {
            scheduleScan(POST_CLICK_SCAN_DELAY_MS);
        }
    }

    function bindClickHandler() {
        if (state.clickBound) return;

        document.addEventListener('click', handleDocumentClick, true);
        state.clickBound = true;
    }

    function stopRuntime() {
        stopDiscovery();
        state.observer?.disconnect();
        state.rootObserver?.disconnect();
        state.observer = null;
        state.rootObserver = null;
        state.observedRoot = null;

        if (state.scanTimer !== null) {
            clearTimeout(state.scanTimer);
            state.scanTimer = null;
        }

        if (state.clickBound) {
            document.removeEventListener('click', handleDocumentClick, true);
            state.clickBound = false;
        }
    }

    function startRuntime() {
        ensureStyle();
        bindClickHandler();
        discoverTransactionContainer();
    }

    window.addEventListener('pagehide', stopRuntime);
    window.addEventListener('pageshow', event => {
        if (event.persisted) startRuntime();
    });

    startRuntime();

})();
