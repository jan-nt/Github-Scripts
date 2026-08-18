// ==UserScript==
// @name         PassPay UserAdmin ChainID, PaymentID & Search Helper
// @namespace    https://nidushan.com
// @version      1.4
// @description  Converts ChainID and PaymentID values into clickable links and adds smart search helpers
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   https://nidushan.com
// @match        https://betaling.passpay.no/administration*
// @updateURL    https://github.com/jan-nt/Github-Scripts/raw/refs/heads/main/PassPay%20UserAdmin%20ChainID%20and%20PaymentID.js
// @downloadURL  https://github.com/jan-nt/Github-Scripts/raw/refs/heads/main/PassPay%20UserAdmin%20ChainID%20and%20PaymentID.js

// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PAYMANAGER_BASE_URL =
        'https://paymanager.logos.dk/transactions?chainid=';

    const DIBS_BASE_URL =
        'https://portal.dibspayment.eu/portal-frontend/payments?searchKey=PAYMENT_ID&searchValue=';

    // ============================================================
    // Styles
    // ============================================================

    function injectStyles() {

        if (document.getElementById('pp-userscript-styles')) {
            return;
        }

        const style = document.createElement('style');

        style.id = 'pp-userscript-styles';

        style.textContent = `
            .pp-button {
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
                outline: 0;
                margin: 0;
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
                box-shadow:
                    0px 3px 1px -2px rgba(0,0,0,0.20),
                    0px 2px 2px 0px rgba(0,0,0,0.14),
                    0px 1px 5px 0px rgba(0,0,0,0.12);
                transition:
                    background-color 250ms cubic-bezier(0.4, 0, 0.2, 1),
                    box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1),
                    transform 120ms ease;
            }

            .pp-button:hover {
                background-color: #ffbd2e;
                box-shadow:
                    0px 2px 4px -1px rgba(0,0,0,0.20),
                    0px 4px 5px 0px rgba(0,0,0,0.14),
                    0px 1px 10px 0px rgba(0,0,0,0.12);
                transform: translateY(-1px);
            }

            .pp-button:active {
                transform: translateY(0);
                box-shadow:
                    0px 5px 5px -3px rgba(0,0,0,0.20),
                    0px 8px 10px 1px rgba(0,0,0,0.14),
                    0px 3px 14px 2px rgba(0,0,0,0.12);
            }

            #pp-search-wrapper {
                display: flex;
                align-items: flex-end;
                gap: 8px;
                width: 100%;
            }

            #pp-remove-spaces-btn {
                white-space: nowrap;
                margin-bottom: 1px;
            }

            .pp-chain-link {
                color: #1976d2;
                text-decoration: underline;
                cursor: pointer;
            }
        `;

        document.head.appendChild(style);
    }

    // ============================================================
    // Helpers
    // ============================================================

    function setReactInputValue(input, value) {

        const nativeSetter =
            Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value'
            ).set;

        nativeSetter.call(input, value);

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
    }

    function normalizeSearchValue(value) {

        const trimmed = value.trim();

        // Phone: 951 05 712
        if (/^\d{3}\s+\d{2}\s+\d{3}$/.test(trimmed)) {
            return trimmed.replace(/\s+/g, '');
        }

        // Plate: DP 74369
        if (/^[A-Za-z]{2}\s+\d{4,5}$/.test(trimmed)) {
            return trimmed.replace(/\s+/g, '');
        }

        return value;
    }

    // ============================================================
    // Smart Search
    // ============================================================

    function addSmartSpaceRemoval() {

        const path = window.location.pathname;

        if (
            path !== '/administration' &&
            path !== '/administration/'
        ) {
            return;
        }

        const input = document.querySelector(
            '.MuiTextField-root input'
        );

        if (!input) {
            return;
        }

        if (input.dataset.ppSmartSpaces === 'true') {
            return;
        }

        input.dataset.ppSmartSpaces = 'true';

        const cleanValue = () => {

            const cleaned =
                normalizeSearchValue(input.value);

            if (cleaned !== input.value) {
                setReactInputValue(
                    input,
                    cleaned
                );
            }
        };

        input.addEventListener('input', cleanValue);
        input.addEventListener('paste', () => {
            setTimeout(cleanValue, 0);
        });

        console.log(
            '[PassPay Search Helper] Smart space removal active'
        );
    }

    // ============================================================
    // Manual Button
    // ============================================================

    function addRemoveSpacesButton() {

        const path = window.location.pathname;

        if (
            path !== '/administration' &&
            path !== '/administration/'
        ) {
            return;
        }

        if (document.getElementById('pp-remove-spaces-btn')) {
            return;
        }

        const searchInput = document.querySelector(
            '.MuiTextField-root input'
        );

        if (!searchInput) {
            return;
        }

        const formControl =
            searchInput.closest('.MuiFormControl-root');

        if (!formControl) {
            return;
        }

        let wrapper =
            document.getElementById(
                'pp-search-wrapper'
            );

        if (!wrapper) {

            wrapper =
                document.createElement('div');

            wrapper.id =
                'pp-search-wrapper';

            formControl.parentNode.insertBefore(
                wrapper,
                formControl
            );

            wrapper.appendChild(
                formControl
            );
        }

        const button =
            document.createElement('button');

        button.id =
            'pp-remove-spaces-btn';

        button.className =
            'pp-button';

        button.type = 'button';

        button.textContent =
            'No Spaces';

        button.addEventListener(
            'click',
            () => {

                const cleaned =
                    searchInput.value.replace(
                        /\s+/g,
                        ''
                    );

                setReactInputValue(
                    searchInput,
                    cleaned
                );

                searchInput.focus();
            }
        );

        wrapper.appendChild(button);
    }

    // ============================================================
    // ChainID / PaymentID Links
    // ============================================================

    function makeLinks(root = document) {

        const elements =
            root.querySelectorAll(
                'p, span'
            );

        elements.forEach(element => {

            if (
                element.dataset.linkified ===
                'true'
            ) {
                return;
            }

            const text =
                element.textContent?.trim();

            if (!text) {
                return;
            }

            const previous =
                element
                    .previousElementSibling
                    ?.textContent
                    ?.trim()
                    .toLowerCase() || '';

            const parentText =
                element.parentElement
                    ?.textContent
                    ?.toLowerCase() || '';

            let url = null;

            // ChainID
            if (
                /^\d{24,32}$/.test(text) &&
                (
                    previous.includes(
                        'chainid'
                    ) ||
                    parentText.includes(
                        'chainid'
                    )
                )
            ) {
                url =
                    PAYMANAGER_BASE_URL +
                    encodeURIComponent(
                        text
                    );
            }

            // Payment ID
            else if (
                /^[a-f0-9]{32}$/i.test(
                    text
                ) &&
                (
                    previous.includes(
                        'payment id'
                    ) ||
                    previous.includes(
                        'betalings id'
                    ) ||
                    parentText.includes(
                        'payment id'
                    ) ||
                    parentText.includes(
                        'betalings id'
                    )
                )
            ) {
                url =
                    DIBS_BASE_URL +
                    encodeURIComponent(
                        text
                    );
            }

            if (!url) {
                return;
            }

            const link =
                document.createElement(
                    'a'
                );

            link.href = url;
            link.textContent = text;
            link.target = '_blank';
            link.rel =
                'noopener noreferrer';
            link.className =
                'pp-chain-link';

            link.dataset.linkified =
                'true';

            element.replaceWith(link);
        });
    }

    // ============================================================
    // Main
    // ============================================================

    function run() {

        makeLinks();

        addRemoveSpacesButton();

        addSmartSpaceRemoval();
    }

    injectStyles();

    run();

    const observer =
        new MutationObserver(() => {
            run();
        });

    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );

    [500, 1500, 3000, 5000]
        .forEach(delay => {
            setTimeout(
                run,
                delay
            );
        });

    console.log(
        '[PassPay UserAdmin ChainID, PaymentID & Search Helper] Active'
    );

})();