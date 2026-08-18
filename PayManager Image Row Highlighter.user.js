// ==UserScript==
// @name         PayManager Image Row Highlighter
// @namespace    https://nidushan.com/
// @version      1.5
// @description  Highlight rows with Event->Camera->Image
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com/
// @match        https://paymanager.logos.dk/transactions*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Image%20Row%20Highlighter.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Image%20Row%20Highlighter.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /************************************************************
     * CONFIG
     ************************************************************/
    const INITIAL_SCAN_DELAY_MS = 500;
    const POLL_INTERVAL_MS = 1000;
    const POST_CLICK_SCAN_DELAY_MS = 200;

    /************************************************************
     * CSS
     ************************************************************/
    const style = document.createElement('style');
    style.textContent = `
        tr.image_highlight > td {
            background-color: #c8f7c5 !important;
        }
        .dataTables_scrollBody tr.image_highlight > td,
        .subTable tbody tr.image_highlight > td {
            background-color: #c8f7c5 !important;
        }
    `;
    document.head.appendChild(style);

    /************************************************************
     * HELPERS
     ************************************************************/
    function log(msg) {
        console.log('[PayManager]', msg);
    }

    function normalize(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    /************************************************************
     * DETECTION: Event → Camera → Image row
     ************************************************************/
    function rowHasEventCameraImage(row) {
        const cells = Array.from(row.querySelectorAll('td'));
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
            if (!row.classList.contains('image_highlight')) {
                row.classList.add('image_highlight');
                log('Highlighted row ' + (row.getAttribute('data-rowid') || row.rowIndex));
                return true;
            }
        } else {
            if (row.classList.contains('image_highlight')) {
                row.classList.remove('image_highlight');
            }
        }
        return false;
    }

    /************************************************************
     * MAIN SCAN
     *
     * Polls ALL <table> elements on the page on every scan.
     * This naturally catches:
     *   - The main DataTable
     *   - Expanded child rows (sub-tables inside detail panels)
     *   - DataTable redraws / pagination changes
     ************************************************************/
    let scanning = false;

    function scanAllRows() {
        if (scanning) return;
        scanning = true;

        try {
            const tables = document.querySelectorAll('table');
            let highlightCount = 0;

            tables.forEach(table => {
                const rows = table.querySelectorAll('tbody tr');
                rows.forEach(row => {
                    try {
                        if (applyImageHighlight(row)) highlightCount++;
                    } catch (rowErr) {
                        // Ignore errors on individual rows
                    }
                });
            });

            if (highlightCount > 0) {
                log('Scan: ' + highlightCount + ' highlighted');
            }
        } catch (err) {
            console.warn('[PayManager] Scan error:', err);
        } finally {
            scanning = false;
        }
    }

    /************************************************************
     * SCHEDULING
     ************************************************************/
    let pollTimer = null;

    function startPolling() {
        // Do an initial scan after a short delay (page may still load)
        setTimeout(scanAllRows, INITIAL_SCAN_DELAY_MS);

        // Poll regularly to catch any dynamic content
        pollTimer = setInterval(scanAllRows, POLL_INTERVAL_MS);
        log('Polling started every ' + POLL_INTERVAL_MS + 'ms');
    }

    /************************************************************
     * CLICK HANDLER
     *
     * Catches clicks on "Show" / "Vis" / "Expand" buttons and
     * triggers an extra scan shortly after so the new content gets
     * highlighted immediately instead of waiting for the next poll.
     ************************************************************/
    document.addEventListener('click', function (e) {
        // Walk up to find the nearest clickable element
        const target = e.target.closest('a, button, span, td');
        if (!target) return;

        const text = normalize(target.textContent).toLowerCase();

        if (text === 'show' || text === 'vis' || text === 'expand') {
            setTimeout(scanAllRows, POST_CLICK_SCAN_DELAY_MS);
        }
    }, true);

    /************************************************************
     * START
     ************************************************************/
    window.addEventListener('load', startPolling);

})();
