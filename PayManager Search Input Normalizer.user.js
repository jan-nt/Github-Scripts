// ==UserScript==
// @name         PayManager Search Input Normalizer
// @namespace    https://nidushan.com
// @version      1.0
// @description  Removes spaces and dashes from PayManager transaction and parking search input
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   mailto:jas@nortronic.com
// @match        https://paymanager.logos.dk/transactions*
// @match        https://paymanager.logos.dk/parking*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Search%20Input%20Normalizer.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Search%20Input%20Normalizer.user.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const SEARCH_INPUT_XPATHS = {
        '/transactions':
            '/html/body/div[2]/div[2]/div/div[3]/div[5]/div[3]/div[3]/label/input',
        '/parking':
            '/html/body/div[2]/div[2]/div/div[4]/div[2]/div/div[4]/label/form/input'
    };

    const REMOVABLE_CHARACTERS =
        /[\s\u00A0\u2007\u202F\u2010-\u2015\u2212\uFE58\uFE63\uFF0D-]+/g;

    function getSearchInput() {
        const pathname = location.pathname.replace(/\/+$/, '') || '/';
        const xpath = SEARCH_INPUT_XPATHS[pathname];

        if (!xpath) return null;

        try {
            const element = document.evaluate(
                xpath,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;

            return element instanceof HTMLInputElement ? element : null;
        } catch {
            return null;
        }
    }

    function normalizeValue(value) {
        return String(value || '').replace(REMOVABLE_CHARACTERS, '');
    }

    function getNormalizedCaretPosition(value, position) {
        if (!Number.isInteger(position)) return null;

        return normalizeValue(value.slice(0, position)).length;
    }

    function normalizeInput(input) {
        const currentValue = input.value;
        const normalizedValue = normalizeValue(currentValue);

        if (normalizedValue === currentValue) return false;

        const start = getNormalizedCaretPosition(
            currentValue,
            input.selectionStart
        );
        const end = getNormalizedCaretPosition(
            currentValue,
            input.selectionEnd
        );

        input.value = normalizedValue;

        if (start !== null && end !== null) {
            try {
                input.setSelectionRange(start, end);
            } catch {
                // Some input types do not support a text selection range.
            }
        }

        return true;
    }

    function handleInputEvent(event) {
        if (!event.isTrusted) return;

        const input = getSearchInput();

        if (input && event.target === input) {
            normalizeInput(input);
        }
    }

    document.addEventListener('input', handleInputEvent, true);
    document.addEventListener('change', handleInputEvent, true);
    document.addEventListener('blur', handleInputEvent, true);
})();
