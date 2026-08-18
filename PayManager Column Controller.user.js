// ==UserScript==
// @name         PayManager Column Controller
// @namespace    https://nidushan.com/
// @version      1.0
// @description  Enable and disable selected PayManager columns automatically
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com/
// @match        https://paymanager.logos.dk/transactions*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Column%20Controller.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Column%20Controller.user.js
// @grant        none
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

    function log(step, msg, data = "") {
        console.log(
            `[%cCOLUMNS:${step}%c] ${msg}`,
            "color: #7b1fa2; font-weight: bold;",
            "",
            data
        );
    }

    function warn(step, msg, data = "") {
        console.warn(`[COLUMNS:${step}] ${msg}`, data);
    }

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
        log("CLOSE", "Closing popup...");

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
                log("CLOSE", "Found close button inside popup, clicking it", closeBtn);
                closeBtn.click();
            } else {
                // 3) Try clicking on a backdrop/overlay if one exists
                const backdrop = document.querySelector(
                    '.modal-backdrop, .overlay, .popup-backdrop, ' +
                    'div[class*="backdrop"], div[class*="overlay"]'
                );
                if (backdrop) {
                    log("CLOSE", "Found backdrop overlay, clicking it", backdrop);
                    backdrop.click();
                }
            }
        }

        log("CLOSE", "Close attempts completed");
    }

    /************************************************************
     * COLUMN FUNCTIONS
     ************************************************************/

    async function openColumnsPanel() {
        log("OPEN", "Trying to open Columns panel...");

        const btn = getXPath(columnsTabXPath);

        if (!btn) {
            warn("OPEN", "Columns button not found");
            return false;
        }

        btn.click();
        log("OPEN", "Columns button clicked");

        await sleep(PANEL_OPEN_DELAY_MS);

        return true;
    }

    function findColumnsPopup() {
        let popup = getXPath(popupXPath);

        if (popup) {
            log("POPUP", "Popup found using XPath", popup);
            return popup;
        }

        warn("POPUP", "Popup XPath failed. Trying fallback search...");

        const candidates = Array.from(document.querySelectorAll("body div"))
            .filter(div => div.querySelectorAll("ul a").length > 5);

        if (candidates.length > 0) {
            popup = candidates[candidates.length - 1];
            log("POPUP", "Popup found using fallback", popup);
            return popup;
        }

        return null;
    }

    async function toggleColumns() {
        log("TOGGLE", "Starting column toggle logic");

        const popup = findColumnsPopup();

        if (!popup) {
            warn("TOGGLE", "Popup not found. Cannot toggle columns.");
            return;
        }

        const items = popup.querySelectorAll("ul a");

        log("TOGGLE", `Found ${items.length} column buttons`);

        items.forEach(el => {
            const classes = Array.from(el.classList);

            columnsToDisable.forEach(target => {
                if (classes.includes(target)) {
                    log("DISABLE MATCH", target, el);

                    if (el.classList.contains("toggled")) {
                        log("DISABLE ACTION", `Turning OFF ${target}`);
                        el.click();
                    } else {
                        log("DISABLE SKIP", `${target} already OFF`);
                    }
                }
            });

            columnsToEnable.forEach(target => {
                if (classes.includes(target)) {
                    log("ENABLE MATCH", target, el);

                    if (!el.classList.contains("toggled")) {
                        log("ENABLE ACTION", `Turning ON ${target}`);
                        el.click();
                    } else {
                        log("ENABLE SKIP", `${target} already ON`);
                    }
                }
            });
        });

        log("DONE", "Column processing completed");
    }

    async function runColumnsController() {
        log("INIT", `Waiting ${START_DELAY_MS / 1000} seconds before starting...`);

        await sleep(START_DELAY_MS);

        const opened = await openColumnsPanel();

        if (!opened) {
            warn("INIT", "Could not open columns panel");
            return;
        }

        await toggleColumns();

        await sleep(CLOSE_POPUP_DELAY_MS);

        closePopup();

        log("INIT", "Columns Controller finished");
    }

    window.addEventListener("load", runColumnsController);

})();
