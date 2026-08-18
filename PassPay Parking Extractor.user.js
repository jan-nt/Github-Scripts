// ==UserScript==
// @name         PassPay Parking Extractor
// @namespace    https://nidushan.com
// @version      6.8
// @description  Extract license plate and all parkings, MUI-styled centered UI, copy plate and screenshot
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   https://nidushan.com
// @match        https://betaling.passpay.no/*
// @match        https://betaling.parkpay.no/*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PassPay%20Parking%20Extractor.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PassPay%20Parking%20Extractor.user.js
// @require      https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    /************************************************************
     * SETTINGS
     ************************************************************/

    const PAYMANAGER_CHAINID_URL = 'https://paymanager.logos.dk/transactions?chainid=';
    const STORAGE_KEY = 'tm-parking-data-v6-mui-location';

    const PARKING_PAGE_PATH = '/parkings';

    const INFO_BOX_TARGET_XPATH =
        '/html/body/div[1]/div/div/div/div/div[2]/div[1]/div';

    const SCREENSHOT_TARGET_XPATH =
        '/html/body/div[1]/div/div/div/div/div[2]/div[1]/div/div[1]';

    const SCREENSHOT_FILENAME_XPATH =
        '/html/body/div[1]/div/div/div/div/div[2]/div[1]/div/div[1]/div[1]/span[2]';

    const VISIBLE_PLATE_XPATH =
        '/html/body/div[1]/div/div/div/div/div[2]/div[1]/div/div[1]/div[1]/span[2]';

    const INITIAL_INJECT_DELAY_MS = 2000;
    const RETRY_INTERVAL_MS = 1000;
    const MAX_RETRY_ATTEMPTS = 30;

    /************************************************************
     * STATE
     ************************************************************/

    let latestData = null;
    let lastUrl = location.href;
    let retryTimer = null;

    /************************************************************
     * GLOBAL CSS
     ************************************************************/

    function injectStyles() {
        if (document.getElementById('tm-parking-extractor-styles')) return;

        const globalStyle = document.createElement('style');
        globalStyle.id = 'tm-parking-extractor-global-styles';
        globalStyle.setAttribute('data-emotion', 'css-global');

        globalStyle.textContent = `
            .tm-parking-info-wrapper,
            .tm-parking-info-wrapper * {
                box-sizing: border-box;
            }
        `;

        const style = document.createElement('style');
        style.id = 'tm-parking-extractor-styles';
        style.setAttribute('data-emotion', 'css');

        style.textContent = `
            .tm-parking-info-wrapper {
                width: 100%;
                display: flex;
                justify-content: center;
                align-items: flex-start;
                margin-top: 24px;
                margin-bottom: 24px;
                padding-left: 0;
                padding-right: 0;
            }

            .tm-parking-info-card {
                width: min(100%, 1082px);
                padding: 16px;
                background-color: #f8f9fb;
                border: 1px solid rgba(0, 0, 0, 0.12);
                border-radius: 4px;
                box-shadow:
                    0px 2px 1px -1px rgba(0,0,0,0.20),
                    0px 1px 1px 0px rgba(0,0,0,0.14),
                    0px 1px 3px 0px rgba(0,0,0,0.12);
                font-family: Roboto, Helvetica, Arial, sans-serif;
                color: rgba(0, 0, 0, 0.87);
                text-align: left;
            }

            .tm-parking-title {
                margin: 0 0 16px 0;
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 1.25rem;
                line-height: 1.6;
                letter-spacing: 0.0075em;
                font-weight: 500;
                color: rgba(0, 0, 0, 0.87);
            }

            .tm-parking-section-title {
                margin-top: 18px;
                margin-bottom: 12px;
                padding-top: 16px;
                border-top: 1px solid rgba(0, 0, 0, 0.12);
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 1rem;
                line-height: 1.5;
                letter-spacing: 0.00938em;
                font-weight: 600;
                color: rgba(0, 0, 0, 0.87);
            }

            .tm-parking-row {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                margin-top: 8px;
                min-height: 24px;
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 1rem;
                line-height: 1.5;
                letter-spacing: 0.00938em;
            }

            .tm-parking-label {
                flex: 0 0 140px;
                min-width: 140px;
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 1rem;
                line-height: 1.5;
                letter-spacing: 0.00938em;
                font-weight: 600;
                color: rgba(0, 0, 0, 0.87);
            }

            .tm-parking-value {
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 1rem;
                line-height: 1.5;
                letter-spacing: 0.00938em;
                font-weight: 400;
                color: rgba(0, 0, 0, 0.87);
                word-break: break-word;
            }

            .tm-parking-button-row {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
                margin-top: 16px;
            }

            .tm-parking-button {
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

            .tm-parking-button:hover {
                background-color: #ffbd2e;
                box-shadow:
                    0px 2px 4px -1px rgba(0,0,0,0.20),
                    0px 4px 5px 0px rgba(0,0,0,0.14),
                    0px 1px 10px 0px rgba(0,0,0,0.12);
                transform: translateY(-1px);
            }

            .tm-parking-button:active {
                transform: translateY(0);
                box-shadow:
                    0px 5px 5px -3px rgba(0,0,0,0.20),
                    0px 8px 10px 1px rgba(0,0,0,0.14),
                    0px 3px 14px 2px rgba(0,0,0,0.12);
            }

            .tm-parking-status {
                margin-top: 12px;
                min-height: 18px;
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 0.875rem;
                line-height: 1.43;
                letter-spacing: 0.01071em;
                color: rgba(0, 0, 0, 0.60);
            }

            .tm-parking-card {
                margin-top: 12px;
                padding: 16px;
                background-color: #ffffff;
                border: 1px solid rgba(0, 0, 0, 0.12);
                border-radius: 4px;
                box-shadow:
                    0px 2px 1px -1px rgba(0,0,0,0.12),
                    0px 1px 1px 0px rgba(0,0,0,0.08),
                    0px 1px 3px 0px rgba(0,0,0,0.08);
            }

            .tm-parking-card-title {
                margin: 0 0 10px 0;
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 1rem;
                line-height: 1.5;
                letter-spacing: 0.00938em;
                font-weight: 600;
                color: rgba(0, 0, 0, 0.87);
            }

            .tm-parking-chain-link {
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 1rem;
                line-height: 1.5;
                letter-spacing: 0.00938em;
                font-weight: 500;
                color: #0057d8;
                text-decoration: underline;
                text-decoration-thickness: 1px;
                text-underline-offset: 2px;
                word-break: break-word;
            }

            .tm-parking-chain-link:hover {
                color: #003f9e;
            }

            .tm-parking-error {
                margin-top: 8px;
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 0.875rem;
                line-height: 1.43;
                letter-spacing: 0.01071em;
                color: #b91c1c;
                font-weight: 600;
            }

            .tm-parking-message-pre {
                margin-top: 8px;
                padding: 10px;
                background-color: #f1f5f9;
                border: 1px solid rgba(0, 0, 0, 0.12);
                border-radius: 4px;
                white-space: pre-wrap;
                font-family: Consolas, Monaco, monospace;
                font-size: 0.75rem;
                color: rgba(0, 0, 0, 0.87);
            }

            .tm-creator-footer {
                margin-top: 14px;
                padding-top: 10px;
                border-top: 1px solid rgba(0, 0, 0, 0.08);
                font-family: Roboto, Helvetica, Arial, sans-serif;
                font-size: 0.75rem;
                line-height: 1.5;
                letter-spacing: 0.03333em;
                color: rgba(0, 0, 0, 0.48);
                text-align: left;
            }

            .tm-creator-footer a {
                color: rgba(0, 0, 0, 0.62);
                text-decoration: none;
                font-weight: 500;
            }

            .tm-creator-footer a:hover {
                text-decoration: underline;
            }
        `;

        const appendStyle = () => {
            if (document.head) {
                document.head.appendChild(globalStyle);
                document.head.appendChild(style);
            } else {
                setTimeout(appendStyle, 50);
            }
        };

        appendStyle();
    }

   

    /************************************************************
     * GENERAL HELPERS
     ************************************************************/

    function getElementByXPath(xpath) {
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

    function sanitizeFileName(name) {
        return String(name || '')
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/\s+/g, '_')
            .trim();
    }

    function createElement(tag, options = {}) {
        const element = document.createElement(tag);

        if (options.id) element.id = options.id;
        if (options.className) element.className = options.className;
        if (options.textContent !== undefined) element.textContent = options.textContent;
        if (options.attributes) {
            Object.entries(options.attributes).forEach(([key, value]) => {
                element.setAttribute(key, value);
            });
        }

        if (options.onClick) {
            element.addEventListener('click', options.onClick);
        }

        return element;
    }

    function normalizePlate(value) {
        return String(value || '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '');
    }

    function getVisiblePlateFromPage() {
        const element = getElementByXPath(VISIBLE_PLATE_XPATH);

        if (!element) return '';

        let text = element.textContent.trim();

        if (text.includes('(')) {
            text = text.split('(')[0].trim();
        }

        return normalizePlate(text);
    }

    function getMostCommonPlate(parkings) {
        const counts = new Map();

        parkings.forEach(parking => {
            const plate = normalizePlate(parking.licensePlate);

            if (!plate) return;

            counts.set(plate, (counts.get(plate) || 0) + 1);
        });

        let bestPlate = '';
        let bestCount = 0;

        counts.forEach((count, plate) => {
            if (count > bestCount) {
                bestPlate = plate;
                bestCount = count;
            }
        });

        return bestPlate;
    }

    function formatDateTime(value) {
        if (!value) return '-';

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return new Intl.DateTimeFormat('nb-NO', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    function formatPeriod(start, end) {
        return `${formatDateTime(start)} → ${formatDateTime(end)}`;
    }

    /************************************************************
     * UI HELPERS
     ************************************************************/

    function createButton(label, onClick) {
        return createElement('button', {
            className: 'tm-parking-button',
            textContent: label,
            onClick
        });
    }

    function setStatus(message, colorClass = '') {
        const status = document.getElementById('tm-action-status');

        if (!status) return;

        status.textContent = message;

        if (colorClass === 'success') {
            status.style.color = '#166534';
        } else if (colorClass === 'error') {
            status.style.color = '#b91c1c';
        } else {
            status.style.color = 'rgba(0, 0, 0, 0.60)';
        }

        if (message) {
            setTimeout(() => {
                status.textContent = '';
                status.style.color = 'rgba(0, 0, 0, 0.60)';
            }, 3000);
        }
    }

    async function copyToClipboard(text, successMessage) {
        try {
            await navigator.clipboard.writeText(text);
            setStatus(successMessage, 'success');
        } catch {
            setStatus('Copy failed', 'error');
        }
    }

    function createInfoRow(label, value) {
        const row = createElement('div', {
            className: 'tm-parking-row'
        });

        const labelSpan = createElement('span', {
            className: 'tm-parking-label',
            textContent: label
        });

        const valueSpan = createElement('span', {
            className: 'tm-parking-value',
            textContent: value === undefined || value === null || value === '' ? '-' : String(value)
        });

        row.appendChild(labelSpan);
        row.appendChild(valueSpan);

        return row;
    }

    function createLinkedChainRow(chainID) {
        const row = createElement('div', {
            className: 'tm-parking-row'
        });

        const labelSpan = createElement('span', {
            className: 'tm-parking-label',
            textContent: 'Chain ID:'
        });

        row.appendChild(labelSpan);

        if (!chainID) {
            row.appendChild(createElement('span', {
                className: 'tm-parking-value',
                textContent: '-'
            }));

            return row;
        }

        const link = createElement('a', {
            className: 'tm-parking-chain-link',
            textContent: chainID,
            attributes: {
                href: PAYMANAGER_CHAINID_URL + encodeURIComponent(chainID),
                target: '_blank',
                rel: 'noopener noreferrer',
                title: 'Open Chain ID in PayManager'
            }
        });

        row.appendChild(link);

        return row;
    }

    function createCreatorFooter() {
        const footer = createElement('div', {
            className: 'tm-creator-footer'
        });

        footer.appendChild(document.createTextNode('Support: '));

        const emailLink = createElement('a', {
            textContent: 'jas@nortronic.com',
            attributes: {
                href: 'mailto:jas@nortronic.com',
                title: 'Contact creator'
            }
        });

        footer.appendChild(emailLink);

        return footer;
    }

    function getOrCreateInfoWrapper(target) {
        let wrapper = document.getElementById('tm-parking-info-wrapper');

        if (!wrapper) {
            wrapper = createElement('div', {
                id: 'tm-parking-info-wrapper',
                className: 'tm-parking-info-wrapper'
            });

            target.appendChild(wrapper);
        }

        return wrapper;
    }

    function getOrCreateInfoBox(target) {
        const wrapper = getOrCreateInfoWrapper(target);

        let box = document.getElementById('tm-parking-info');

        if (!box) {
            box = createElement('div', {
                id: 'tm-parking-info',
                className: 'tm-parking-info-card'
            });

            wrapper.appendChild(box);
        } else if (box.parentElement !== wrapper) {
            wrapper.appendChild(box);
        }

        return box;
    }

    function showMessageBox(message, details = '') {
        const target = getElementByXPath(INFO_BOX_TARGET_XPATH);

        if (!target) {
            return false;
        }

        const box = getOrCreateInfoBox(target);
        box.innerHTML = '';

        box.appendChild(createElement('div', {
            className: 'tm-parking-title',
            textContent: 'Extractor status'
        }));

        box.appendChild(createElement('div', {
            className: 'tm-parking-error',
            textContent: message
        }));

        if (details) {
            box.appendChild(createElement('pre', {
                className: 'tm-parking-message-pre',
                textContent: details
            }));
        }

        box.appendChild(createCreatorFooter());

        return true;
    }

    /************************************************************
     * SCREENSHOT LOGIC
     ************************************************************/

    function getScreenshotFileName() {
        const titleElement = getElementByXPath(SCREENSHOT_FILENAME_XPATH);

        let rawName = titleElement ? titleElement.textContent.trim() : '';

        if (rawName.includes('(')) {
            rawName = rawName.split('(')[0].trim();
        }

        if (!rawName) {
            rawName = 'parking-screenshot';
        }

        return sanitizeFileName(rawName) + '.png';
    }

    function getScreenshotTarget() {
        return getElementByXPath(SCREENSHOT_TARGET_XPATH);
    }

    async function downloadScreenshot() {
        try {
            const target = getScreenshotTarget();

            if (!target) {
                setStatus('Screenshot target not found', 'error');
                return;
            }

            setStatus('Taking screenshot...');

            const canvas = await html2canvas(target, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                logging: false
            });

            const fileName = getScreenshotFileName();

            const link = document.createElement('a');
            link.download = fileName;
            link.href = canvas.toDataURL('image/png');

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setStatus(`Saved: ${fileName}`, 'success');

        } catch {
            setStatus('Screenshot failed', 'error');
        }
    }

    /************************************************************
     * NETWORK RESPONSE PARSING
     ************************************************************/

    function looksLikeParkingObject(obj) {
        if (!obj || typeof obj !== 'object') return false;

        return Boolean(
            obj.parkingRightID ||
            obj.chainID ||
            obj.licensePlate ||
            obj.start ||
            obj.end
        );
    }

    function normalizeParkingObject(parking, parentLocation = '') {
        return {
            parkingRightID: parking.parkingRightID ?? '',
            areaManager: parking.areaManager ?? '',
            location: parking.location ?? parentLocation ?? '',
            chainID: parking.chainID ?? '',
            licensePlate: parking.licensePlate ?? '',
            start: parking.start ?? '',
            end: parking.end ?? ''
        };
    }

    function extractParkingEntries(data) {
        const entries = [];

        function walk(obj, inheritedLocation = '') {
            if (!obj || typeof obj !== 'object') return;

            if (Array.isArray(obj)) {
                obj.forEach(item => walk(item, inheritedLocation));
                return;
            }

            const currentLocation = obj.location ?? inheritedLocation ?? '';

            if (Array.isArray(obj.parkings)) {
                obj.parkings.forEach(parking => {
                    if (looksLikeParkingObject(parking)) {
                        entries.push(normalizeParkingObject(parking, currentLocation));
                    }
                });
            }

            if (
                looksLikeParkingObject(obj) &&
                (obj.parkingRightID || obj.chainID) &&
                obj.licensePlate
            ) {
                entries.push(normalizeParkingObject(obj, currentLocation));
            }

            Object.entries(obj).forEach(([key, value]) => {
                if (key !== 'parkings') walk(value, currentLocation);
            });
        }

        walk(data);

        const seen = new Set();

        const uniqueEntries = entries.filter(entry => {
            const key = `${entry.parkingRightID || ''}|${entry.chainID || ''}|${entry.start || ''}`;

            if (seen.has(key)) return false;

            seen.add(key);
            return true;
        });

        return uniqueEntries;
    }

    function buildParkingDataFromResponse(data) {
        const allParkings = extractParkingEntries(data);

        if (!allParkings.length) {
            return null;
        }

        const visiblePlate = getVisiblePlateFromPage();
        const commonPlate = getMostCommonPlate(allParkings);

        const selectedPlate =
            visiblePlate ||
            commonPlate ||
            normalizePlate(allParkings[0].licensePlate);

        let matchingParkings = allParkings.filter(parking => {
            return normalizePlate(parking.licensePlate) === selectedPlate;
        });

        if (!matchingParkings.length) {
            matchingParkings = allParkings;
        }

        return {
            licensePlate: selectedPlate,
            parkings: matchingParkings
        };
    }

    function processResponse(text) {
        if (!text || typeof text !== 'string') return;

        try {
            const data = JSON.parse(text);
            const parsed = buildParkingDataFromResponse(data);

            if (!parsed) {
                return;
            }

            latestData = parsed;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));

            if (isParkingPage()) {
                setTimeout(retryInject, 300);
            }

        } catch {
            // Ignore non-JSON responses
        }
    }

    /************************************************************
     * INFO BOX UI
     ************************************************************/

    function insertData(data) {
        const target = getElementByXPath(INFO_BOX_TARGET_XPATH);

        if (!target) {
            return false;
        }

        if (!data) {
            showMessageBox(
                'No parking data available yet.',
                'The script is waiting for a network response containing locations[].parkings[].'
            );
            return false;
        }

        const plate = data.licensePlate || '';
        const parkings = Array.isArray(data.parkings) ? data.parkings : [];

        const box = getOrCreateInfoBox(target);
        box.innerHTML = '';

        box.appendChild(createElement('div', {
            className: 'tm-parking-title',
            textContent: 'Admin panel'
        }));

        box.appendChild(createInfoRow('License Plate:', plate));

        const buttonRow = createElement('div', {
            className: 'tm-parking-button-row'
        });

        buttonRow.appendChild(createButton('Copy Plate', () => {
            copyToClipboard(plate, 'License plate copied');
        }));

        buttonRow.appendChild(createButton('Screenshot', () => {
            downloadScreenshot();
        }));

        box.appendChild(buttonRow);

        box.appendChild(createElement('div', {
            className: 'tm-parking-section-title',
            textContent: `Parkings (${parkings.length})`
        }));

        if (!parkings.length) {
            box.appendChild(createElement('div', {
                className: 'tm-parking-error',
                textContent: 'No parkings found for this license plate.'
            }));
        }

        parkings.forEach((parking, index) => {
            box.appendChild(createParkingCard(parking, index + 1));
        });

        box.appendChild(createElement('div', {
            id: 'tm-action-status',
            className: 'tm-parking-status'
        }));

        box.appendChild(createCreatorFooter());

        return true;
    }

    function createParkingCard(parking, number) {
        const card = createElement('div', {
            className: 'tm-parking-card'
        });

        card.appendChild(createElement('div', {
            className: 'tm-parking-card-title',
            textContent: `Parking ${number}`
        }));

        card.appendChild(createInfoRow('ParkingRightID:', parking.parkingRightID));
        card.appendChild(createInfoRow('Area Manager:', parking.areaManager));

        if (
            (parking.location || '').trim().toLowerCase() !==
            (parking.areaManager || '').trim().toLowerCase()
        ) {
            card.appendChild(createInfoRow('Location:', parking.location));
        }
        card.appendChild(createLinkedChainRow(parking.chainID));
        card.appendChild(createInfoRow('Periode:', formatPeriod(parking.start, parking.end)));

        return card;
    }

    /************************************************************
     * NETWORK HOOKS
     ************************************************************/

    function hookFetch() {
        const originalFetch = window.fetch;

        window.fetch = async function (...args) {
            const response = await originalFetch.apply(this, args);

            try {
                response.clone().text().then(processResponse).catch(() => {});
            } catch {
                // Ignore responses that cannot be cloned.
            }

            return response;
        };

    }

    function hookXMLHttpRequest() {
        const originalOpen = XMLHttpRequest.prototype.open;

        XMLHttpRequest.prototype.open = function (...args) {
            this.addEventListener('load', function () {
                try {
                    processResponse(this.responseText);
                } catch {
                    // Ignore non-text responses.
                }
            });

            return originalOpen.apply(this, args);
        };

    }

    /************************************************************
     * INJECTION RETRY LOGIC
     ************************************************************/

    function getStoredData() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY));
        } catch {
            return null;
        }
    }

    function retryInject() {
        if (retryTimer !== null) return;

        let attempts = 0;

        retryTimer = setInterval(() => {
            attempts++;

            const data = latestData || getStoredData();

            if (data) {
                const success = insertData(data);

                if (success) {
                    clearInterval(retryTimer);
                    retryTimer = null;
                    return;
                }
            } else {
                if (attempts === 3) {
                    showMessageBox(
                        'Waiting for parking data...',
                        'No matching network response has been captured yet. Try running the search again.'
                    );
                }
            }

            if (attempts >= MAX_RETRY_ATTEMPTS) {
                showMessageBox(
                    'No parking data found.',
                    'The script did not capture a JSON response containing parkings[]. Try running the search again.'
                );

                clearInterval(retryTimer);
                retryTimer = null;
            }

        }, RETRY_INTERVAL_MS);
    }

    /************************************************************
     * NAVIGATION DETECTION
     ************************************************************/

    function isParkingPage() {
        return location.pathname.includes(PARKING_PAGE_PATH);
    }

    function handleNavigationChange() {
        if (location.href === lastUrl) return;

        lastUrl = location.href;

        if (isParkingPage()) {
            setTimeout(retryInject, INITIAL_INJECT_DELAY_MS);
        }
    }

    function startNavigationObserver() {
        const observer = new MutationObserver(handleNavigationChange);

        observer.observe(document, {
            subtree: true,
            childList: true
        });

    }

    /************************************************************
     * STARTUP
     ************************************************************/

    function start() {
        if (isParkingPage()) {
            setTimeout(retryInject, INITIAL_INJECT_DELAY_MS);
        }
    }

    injectStyles();
    hookFetch();
    hookXMLHttpRequest();
    startNavigationObserver();
    

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    window.addEventListener('load', () => {
        if (isParkingPage()) {
            setTimeout(retryInject, INITIAL_INJECT_DELAY_MS);
        }
    });

})();
