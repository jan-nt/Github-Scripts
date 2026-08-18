// ==UserScript==
// @name         PayManager Column Controller
// @namespace    https://nidushan.com
// @version      1.2
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

    /************************************************************
     * CONFIG
     ************************************************************/

    const columnsToDisable = [
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

    const columnsToEnable = [
        "financial_chainid"
    ];

    const columnsTabXPath = "/html/body/div[2]/div[2]/div/div[3]/div[5]/a[1]";
    const popupXPath = "/html/body/div[2]/div[25]";

    const START_DELAY_MS = 1000;
    const PANEL_OPEN_DELAY_MS = 500;
    const CLOSE_POPUP_DELAY_MS = 100;

    /************************************************************
     * HELPERS
     ************************************************************/

    function getXPath(xpath) {
        return document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null
        ).singleNodeValue;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /************************************************************
     * CLOSE POPUP
     ************************************************************/

    function closePopup() {
        // 1) Try pressing Escape via keydown + keyup on document and window
        const escapeOpts = {
            key: "Escape",
            code: "Escape",
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true,
            composed: true
        };

        document.dispatchEvent(new KeyboardEvent("keydown", escapeOpts));
        document.dispatchEvent(new KeyboardEvent("keyup", escapeOpts));
        window.dispatchEvent(new KeyboardEvent("keydown", escapeOpts));
        window.dispatchEvent(new KeyboardEvent("keyup", escapeOpts));

        // 2) Try to find a close/× button inside the popup
        const popup = findColumnsPopup();
        if (popup) {
            const closeBtn = popup.querySelector(
                'button[class*="close"], a[class*="close"], [data-dismiss], ' +
                '.close, .btn-close, [aria-label="Close"], li.x, span.x, ' +
                'a.x, i.x, button:has(svg), button:has(span)'
            );
            if (closeBtn) {
                closeBtn.click();
            } else {
                // 3) Try clicking on a backdrop/overlay if one exists
                const backdrop = document.querySelector(
                    '.modal-backdrop, .overlay, .popup-backdrop, ' +
                    'div[class*="backdrop"], div[class*="overlay"]'
                );
                if (backdrop) {
                    backdrop.click();
                }
            }
        }
    }

    /************************************************************
     * COLUMN FUNCTIONS
     ************************************************************/

    async function openColumnsPanel() {
        const btn = getXPath(columnsTabXPath);

        if (!btn) {
            return false;
        }

        btn.click();
        await sleep(PANEL_OPEN_DELAY_MS);

        return true;
    }

    function findColumnsPopup() {
        let popup = getXPath(popupXPath);

        if (popup) {
            return popup;
        }

        const candidates = Array.from(document.querySelectorAll("body div"))
            .filter(div => div.querySelectorAll("ul a").length > 5);

        if (candidates.length > 0) {
            popup = candidates[candidates.length - 1];
            return popup;
        }

        return null;
    }

    async function toggleColumns() {
        const popup = findColumnsPopup();

        if (!popup) {
            return;
        }

        const items = popup.querySelectorAll("ul a");

        items.forEach(el => {
            const classes = Array.from(el.classList);

            columnsToDisable.forEach(target => {
                if (classes.includes(target)) {
                    if (el.classList.contains("toggled")) {
                        el.click();
                    }
                }
            });

            columnsToEnable.forEach(target => {
                if (classes.includes(target)) {
                    if (!el.classList.contains("toggled")) {
                        el.click();
                    }
                }
            });
        });
    }

    async function runColumnsController() {
        await sleep(START_DELAY_MS);

        const opened = await openColumnsPanel();

        if (!opened) {
            return;
        }

        await toggleColumns();

        await sleep(CLOSE_POPUP_DELAY_MS);

        closePopup();
    }

    if (document.readyState === "complete") {
        runColumnsController();
    } else {
        window.addEventListener("load", runColumnsController, { once: true });
    }

})();
