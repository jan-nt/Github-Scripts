// ==UserScript==
// @name         PayManager Parking User Selector
// @namespace    https://nidushan.com
// @version      2.9.1
// @description  Adds searchable PRS user and license-plate controls with guarded Active/Pending parking searches
// @author       Jan Sinnadurai
// @homepageURL  https://nidushan.com
// @supportURL   mailto:jas@nortronic.com
// @match        https://paymanager.logos.dk/parking*
// @updateURL    https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Parking%20User%20Selector.user.js
// @downloadURL  https://raw.githubusercontent.com/jan-nt/Github-Scripts/main/PayManager%20Parking%20User%20Selector.user.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_INSTANCE_KEY = '__payManagerParkingUserSelectorLoaded';

    if (window[SCRIPT_INSTANCE_KEY]) return;
    window[SCRIPT_INSTANCE_KEY] = true;

    // =========================
    // SETTINGS
    // =========================

    const RESTORE_LAST_SELECTED = true;
    const RESTORE_DELAY_MS = 1500;
    const MAX_INIT_ATTEMPTS = 80;
    const INIT_RETRY_MS = 500;

    // =========================
    // INTERNAL CONFIG
    // =========================

    const SELECT_ID = 'prs_select_user';
    const BUTTON_ID = 'prs_select_user-button';

    const STORAGE_KEY = 'pm_selected_prs_user';
    const STORAGE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
    const AREA_MANAGER_PARAM = 'tmAreaManager';
    const LICENSE_PLATE_PARAM = 'tmLicensePlate';
    const HANDOFF_STORAGE_KEY = 'pm_parking_handoff_v1';
    const HANDOFF_PENDING_STORAGE_KEY = 'pm_parking_handoff_pending_v1';
    const HANDOFF_MAX_AGE_MS = 5 * 60 * 1000;
    const HANDOFF_RETRY_MS = 500;
    const HANDOFF_MAX_ATTEMPTS = 180;
    const HANDOFF_AREA_SETTLE_MS = 750;
    const HANDOFF_PENDING_SETTLE_MS = 1500;
    const HANDOFF_TABLE_READY_FALLBACK_MS = 5000;
    const HANDOFF_FILTER_RESULT_TIMEOUT_MS = 5000;
    const HANDOFF_PLATE_REAPPLY_MS = 1000;
    const HANDOFF_MAX_PLATE_DISPATCHES = 3;
    const HANDOFF_STABLE_RESULT_CHECKS = 2;
    const MANUAL_PLATE_STORAGE_KEY = 'pm_parking_manual_plate_v1';
    const MANUAL_PLATE_MAX_AGE_MS = 30 * 60 * 1000;
    const PARKING_SEARCH_INPUT_XPATH =
        '/html/body/div[2]/div[2]/div/div[4]/div[2]/div/div[4]/label/form/input';
    const PARKING_ENTRIES_INFO_XPATH =
        '/html/body/div[2]/div[2]/div/div[4]/div[2]/div/div[6]';
    const PARKING_TABLE_ID = 'parkings_table';
    const PARKING_ENTRIES_INFO_ID = 'parkings_table_info';
    const PARKING_FILTER_ID = 'parkings_table_filter';
    const PARKING_PROCESSING_ID = 'parkings_table_processing';
    const ACTIVE_STATUS_BUTTON_ID = 'parkings_active_btn';
    const PENDING_STATUS_BUTTON_ID = 'parkings_pending_btn';
    const ACTIVE_STATUS_XPATH =
        '/html/body/div[2]/div[2]/div/div[2]/div[2]/div[3]/fieldset/div/div[1]/a';
    const PENDING_STATUS_XPATH =
        '/html/body/div[2]/div[2]/div/div[2]/div[2]/div[3]/fieldset/div/div[2]/a';

    const UI_ID = 'tm-prs-search-box';
    const INPUT_ID = 'tm-prs-search-input';
    const PLATE_INPUT_ID = 'tm-parking-license-plate-input';
    const RESULTS_ID = 'tm-prs-search-results';
    const STATUS_ID = 'tm-prs-search-status';

    let initialized = false;
    let initTimer = null;
    let handoffTimer = null;
    let outsideClickBound = false;
    let restoring = false;
    let lastAppliedValue = null;
    let handoffRunId = 0;
    let plateSearchTimer = null;
    let restoreTimer = null;
    let tableMutationVersion = 0;
    let tableObserver = null;
    let observedTableContainer = null;
    let latestTableAction = null;
    let panelObserver = null;
    let panelCheckScheduled = false;

    function getSelect() {
        return document.getElementById(SELECT_ID);
    }

    function getButton() {
        return document.getElementById(BUTTON_ID);
    }

    function getInsertTarget() {
        return document.getElementById('select_user_menu_content')
            || document.getElementById('menu_content')
            || document.getElementById('left_container');
    }

    function normalize(text) {
        return String(text || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function normalizePlate(value) {
        return String(value || '')
            .trim()
            .toUpperCase()
            .replace(
                /[\s\u00A0\u2007\u202F\u2010-\u2015\u2212\uFE58\uFE63\uFF0D-]+/g,
                ''
            );
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function getOptions() {
        const select = getSelect();

        if (!select) return [];

        return Array.from(select.options).map(option => ({
            value: option.value,
            label: option.textContent.trim()
        }));
    }

    function getOptionByValue(value) {
        return getOptions().find(
            option => option.value === String(value)
        );
    }

    function getOptionByLabel(label) {
        const wanted = normalize(label);

        return getOptions().find(
            option => normalize(option.label) === wanted
        );
    }

    function savePendingHandoff(handoff) {
        try {
            sessionStorage.setItem(
                HANDOFF_STORAGE_KEY,
                JSON.stringify({
                    ...handoff,
                    savedAt: Date.now()
                })
            );
        } catch {
            // The URL fragment remains available when storage is blocked.
        }
    }

    function saveManualPlate(licensePlate) {
        const normalizedPlate = normalizePlate(licensePlate);

        try {
            if (!normalizedPlate) {
                sessionStorage.removeItem(MANUAL_PLATE_STORAGE_KEY);
                return;
            }

            sessionStorage.setItem(
                MANUAL_PLATE_STORAGE_KEY,
                JSON.stringify({
                    licensePlate: normalizedPlate,
                    savedAt: Date.now()
                })
            );
        } catch {
            // The editable field still works when storage is unavailable.
        }
    }

    function getSavedManualPlate() {
        try {
            const stored = JSON.parse(
                sessionStorage.getItem(MANUAL_PLATE_STORAGE_KEY)
            );

            if (
                stored &&
                Number.isFinite(stored.savedAt) &&
                Date.now() - stored.savedAt <= MANUAL_PLATE_MAX_AGE_MS
            ) {
                return normalizePlate(stored.licensePlate);
            }

            sessionStorage.removeItem(MANUAL_PLATE_STORAGE_KEY);
        } catch {
            try {
                sessionStorage.removeItem(MANUAL_PLATE_STORAGE_KEY);
            } catch {
                // Ignore unavailable session storage.
            }
        }

        return '';
    }

    function setPlateEditorValue(licensePlate) {
        const input = document.getElementById(PLATE_INPUT_ID);

        if (input) {
            input.value = normalizePlate(licensePlate);
        }
    }

    function getRequestedHandoff() {
        const params = new URLSearchParams(location.hash.slice(1));
        const hasUrlHandoff =
            params.has(AREA_MANAGER_PARAM) ||
            params.has(LICENSE_PLATE_PARAM);
        const fromUrl = {
            areaManager: String(params.get(AREA_MANAGER_PARAM) || '').trim(),
            licensePlate: normalizePlate(params.get(LICENSE_PLATE_PARAM)),
            explicit: hasUrlHandoff
        };

        if (hasUrlHandoff) {
            savePendingHandoff(fromUrl);
            return fromUrl;
        }

        try {
            const stored = JSON.parse(
                sessionStorage.getItem(HANDOFF_STORAGE_KEY)
            );

            if (
                stored &&
                Number.isFinite(stored.savedAt) &&
                Date.now() - stored.savedAt <= HANDOFF_MAX_AGE_MS
            ) {
                return {
                    areaManager: String(stored.areaManager || '').trim(),
                    licensePlate: normalizePlate(stored.licensePlate),
                    explicit: Boolean(
                        stored.explicit || stored.areaManager
                    )
                };
            }

            sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
            sessionStorage.removeItem(HANDOFF_PENDING_STORAGE_KEY);
        } catch {
            try {
                sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
                sessionStorage.removeItem(HANDOFF_PENDING_STORAGE_KEY);
            } catch {
                // Ignore unavailable session storage.
            }
        }

        return {
            areaManager: '',
            licensePlate: '',
            explicit: false
        };
    }

    function getEffectiveHandoff() {
        const requested = getRequestedHandoff();

        if (requested.explicit) {
            saveManualPlate(requested.licensePlate);
            setPlateEditorValue(requested.licensePlate);
            return requested;
        }

        if (requested.licensePlate) {
            saveManualPlate(requested.licensePlate);
            setPlateEditorValue(requested.licensePlate);
            return requested;
        }

        const manualPlate = getSavedManualPlate();

        if (manualPlate) {
            setPlateEditorValue(manualPlate);
            return {
                areaManager: requested.areaManager,
                licensePlate: manualPlate,
                explicit: false
            };
        }

        return requested;
    }

    function clearRequestedHandoff() {
        try {
            sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
            sessionStorage.removeItem(HANDOFF_PENDING_STORAGE_KEY);
        } catch {
            // Ignore unavailable session storage.
        }

        latestTableAction = null;

        const params = new URLSearchParams(location.hash.slice(1));
        params.delete(AREA_MANAGER_PARAM);
        params.delete(LICENSE_PLATE_PARAM);

        const remainingHash = params.toString();
        const cleanUrl =
            location.pathname +
            location.search +
            (remainingHash ? `#${remainingHash}` : '');

        history.replaceState(history.state, '', cleanUrl);
    }

    function cancelHandoffSearch() {
        handoffRunId++;

        if (handoffTimer !== null) {
            window.clearTimeout(handoffTimer);
            handoffTimer = null;
        }

        if (plateSearchTimer !== null) {
            window.clearTimeout(plateSearchTimer);
            plateSearchTimer = null;
        }

        if (restoreTimer !== null) {
            window.clearTimeout(restoreTimer);
            restoreTimer = null;
            restoring = false;
        }
    }

    function restartParkingSearch(
        licensePlate,
        delayMs = 0,
        preserveRequestedAreaManager = true
    ) {
        const normalizedPlate = normalizePlate(licensePlate);
        const existingHandoff = getRequestedHandoff();
        const areaManager = preserveRequestedAreaManager
            ? existingHandoff.areaManager
            : '';

        cancelHandoffSearch();
        clearRequestedHandoff();
        setPlateEditorValue(normalizedPlate);
        saveManualPlate(normalizedPlate);

        if (!normalizedPlate) {
            setStatus('Enter a license plate to search.');
            return false;
        }

        savePendingHandoff({
            areaManager,
            licensePlate: normalizedPlate,
            explicit: Boolean(
                preserveRequestedAreaManager &&
                existingHandoff.explicit &&
                areaManager
            )
        });
        setStatus(`Preparing search for: ${normalizedPlate}`);

        if (delayMs > 0) {
            handoffTimer = window.setTimeout(() => {
                handoffTimer = null;
                applyRequestedHandoff();
            }, delayMs);
        } else {
            applyRequestedHandoff();
        }

        return true;
    }

    function getHandoffSignature(handoff) {
        return JSON.stringify([
            String(handoff.areaManager || '').trim(),
            normalizePlate(handoff.licensePlate)
        ]);
    }

    function wasPendingStatusAttempted(handoff) {
        try {
            return sessionStorage.getItem(HANDOFF_PENDING_STORAGE_KEY) ===
                getHandoffSignature(handoff);
        } catch {
            return false;
        }
    }

    function markPendingStatusAttempted(handoff) {
        try {
            sessionStorage.setItem(
                HANDOFF_PENDING_STORAGE_KEY,
                getHandoffSignature(handoff)
            );
        } catch {
            // A same-page retry still works when storage is unavailable.
        }
    }

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

    function getParkingSearchInput() {
        return document.querySelector?.(
            `#${PARKING_FILTER_ID} input[type="search"], ` +
            `input[type="search"][aria-controls="${PARKING_TABLE_ID}"]`
        ) || getElementByXPath(PARKING_SEARCH_INPUT_XPATH);
    }

    function getParkingEntriesInfo() {
        return document.getElementById(PARKING_ENTRIES_INFO_ID) ||
            getElementByXPath(PARKING_ENTRIES_INFO_XPATH);
    }

    function getParkingTable() {
        return document.getElementById(PARKING_TABLE_ID);
    }

    function getParkingTableContainer() {
        const table = getParkingTable();
        const info = getParkingEntriesInfo();

        return table?.closest?.('.dataTables_wrapper') ||
            table?.parentElement ||
            info?.parentElement ||
            null;
    }

    function ensureTableObserver() {
        if (typeof MutationObserver !== 'function') return;

        const container = getParkingTableContainer();

        if (!container || container === observedTableContainer) return;

        tableObserver?.disconnect();
        observedTableContainer = container;
        tableObserver = new MutationObserver(() => {
            tableMutationVersion++;
        });
        tableObserver.observe(container, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'aria-busy', 'aria-hidden']
        });
    }

    function resetTableObserverTracking() {
        tableObserver?.disconnect();
        tableObserver = null;
        observedTableContainer = null;
        tableMutationVersion = 0;
        latestTableAction = null;
    }

    function getParkingTableFingerprint() {
        const infoText = normalizeEntriesText(
            getParkingEntriesInfo()?.textContent
        );
        const tableText = normalizeEntriesText(
            getParkingTable()?.tBodies?.[0]?.textContent ||
            getParkingTable()?.textContent
        ).slice(0, 5000);

        return `${infoText}\n${tableText}`;
    }

    function markTableReloadExpected() {
        ensureTableObserver();
        latestTableAction = {
            fingerprint: getParkingTableFingerprint(),
            mutationVersion: tableMutationVersion
        };

        return latestTableAction;
    }

    function getLatestTableActionSnapshot() {
        return latestTableAction
            ? { ...latestTableAction }
            : null;
    }

    function hasTableChangedSince(action) {
        if (!action) return true;

        ensureTableObserver();

        return tableMutationVersion > action.mutationVersion ||
            getParkingTableFingerprint() !== action.fingerprint;
    }

    function isParkingTableProcessing() {
        const processing = document.getElementById(PARKING_PROCESSING_ID);

        if (!processing) return false;
        if (processing.hidden) return false;
        if (processing.getAttribute?.('aria-hidden') === 'true') return false;
        if (processing.style?.display === 'none') return false;

        try {
            if (window.getComputedStyle?.(processing).display === 'none') {
                return false;
            }
        } catch {
            // The element's direct attributes remain a useful fallback.
        }

        return true;
    }

    function getRenderedParkingRows() {
        const table = getParkingTable();

        if (!table?.querySelectorAll) return [];

        return Array.from(table.querySelectorAll('tbody tr')).filter(row => {
            if (row.hidden) return false;
            if (row.getAttribute?.('aria-hidden') === 'true') return false;
            if (row.style?.display === 'none') return false;
            if (row.querySelector?.('td.dataTables_empty')) return false;

            try {
                if (window.getComputedStyle?.(row).display === 'none') {
                    return false;
                }
            } catch {
                // Direct visibility attributes are sufficient in this fallback.
            }

            return true;
        });
    }

    function rowContainsPlate(row, licensePlate) {
        const wanted = normalizePlate(licensePlate);

        if (!wanted) return false;

        const cells = row.cells
            ? Array.from(row.cells)
            : Array.from(row.querySelectorAll?.('td, th') || []);

        if (!cells.length) {
            return normalizePlate(row.textContent) === wanted;
        }

        return cells.some(cell => {
            const candidateValues = [
                cell.textContent,
                cell.getAttribute?.('data-search'),
                cell.getAttribute?.('data-filter'),
                cell.getAttribute?.('title')
            ];

            return candidateValues.some(value => {
                return normalizePlate(value) === wanted;
            });
        });
    }

    function hasRenderedPlateMatch(licensePlate) {
        const rows = getRenderedParkingRows();

        return rows.length > 0 && rows.every(row => {
            return rowContainsPlate(row, licensePlate);
        });
    }

    function beginTableReloadAction() {
        const input = getParkingSearchInput();

        if (input && String(input.value || '')) {
            setParkingSearchValue(input, '');
        }

        return markTableReloadExpected();
    }

    function getPendingStatusButton() {
        return document.getElementById(PENDING_STATUS_BUTTON_ID) ||
            getElementByXPath(PENDING_STATUS_XPATH);
    }

    function getActiveStatusButton() {
        return document.getElementById(ACTIVE_STATUS_BUTTON_ID) ||
            getElementByXPath(ACTIVE_STATUS_XPATH);
    }

    function isParkingStatusSelected(button) {
        return Boolean(button?.classList?.contains('active_tab'));
    }

    function normalizeEntriesText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function getLeadingEntryCounts(value) {
        const numbers = normalizeEntriesText(value).match(/\d+/g) || [];

        if (numbers.length < 2) return null;

        return {
            first: Number(numbers[0]),
            second: Number(numbers[1])
        };
    }

    function isEmptyEntriesText(value) {
        const text = normalizeEntriesText(value);
        const counts = getLeadingEntryCounts(text);

        return /\b0\s+(?:to|of)\s+0\b/i.test(text) ||
            Boolean(counts && counts.first === 0 && counts.second === 0);
    }

    function isEntriesSummaryText(value) {
        const text = normalizeEntriesText(value);
        const counts = getLeadingEntryCounts(text);

        return /\b\d+\s+(?:to|of)\s+\d+\b/i.test(text) ||
            Boolean(counts);
    }

    function setParkingSearchValue(input, licensePlate) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        )?.set;

        if (nativeSetter) {
            nativeSetter.call(input, licensePlate);
        } else {
            input.value = licensePlate;
        }

        ['input', 'keyup', 'search', 'change'].forEach(type => {
            input.dispatchEvent(new Event(type, { bubbles: true }));
        });
    }

    function findAreaManagerOption(areaManager) {
        const exact = getOptionByLabel(areaManager);
        if (exact) return exact;

        const wanted = normalize(areaManager);
        const partialMatches = getOptions().filter(option => {
            const label = normalize(option.label);
            if (!label) return false;
            return label.includes(wanted) || wanted.includes(label);
        });

        return partialMatches.length === 1 ? partialMatches[0] : null;
    }

    function setStatus(message, color = '#444') {
        const status = document.getElementById(STATUS_ID);

        if (!status) return;

        status.textContent = message;
        status.style.color = color;
    }

    function updateJqueryMobileButton(label) {
        const button = getButton();

        if (!button) return;

        const span = button.querySelector('span');

        if (span) {
            span.textContent = label;
        }
    }

    function refreshJqueryMobileSelect(select) {
        try {
            if (!window.jQuery) return;

            const $select = window.jQuery(select);

            $select.val(select.value);

            if (typeof $select.selectmenu === 'function') {
                try {
                    $select.selectmenu('refresh', true);
                } catch {
                    $select.selectmenu('refresh');
                }
            }
        } catch {
            // The native select events above still apply the selection.
        }
    }

    function fireSelectEvents(select) {
        [
            new Event('input', { bubbles: true }),
            new Event('change', { bubbles: true }),
            new Event('blur', { bubbles: true })
        ].forEach(event => select.dispatchEvent(event));
    }

    function saveSelectedUser(value) {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    value,
                    savedAt: Date.now()
                })
            );
        } catch {
            // Selection still works when browser storage is unavailable.
        }
    }

    function getSavedSelectedUser() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));

            if (
                !saved ||
                !String(saved.value || '').trim() ||
                !Number.isFinite(saved.savedAt) ||
                Date.now() - saved.savedAt > STORAGE_MAX_AGE_MS
            ) {
                localStorage.removeItem(STORAGE_KEY);
                return null;
            }

            const sanitized = {
                value: String(saved.value || ''),
                savedAt: saved.savedAt
            };

            if (Object.prototype.hasOwnProperty.call(saved, 'label')) {
                localStorage.setItem(
                    STORAGE_KEY,
                    JSON.stringify(sanitized)
                );
            }

            return sanitized;
        } catch {
            try {
                localStorage.removeItem(STORAGE_KEY);
            } catch {
                // Ignore unavailable local storage.
            }
            return null;
        }
    }

    function applyUser(value, label, shouldSave = true) {
        const select = getSelect();

        if (!select) {
            return false;
        }

        const option =
            getOptionByValue(value) ||
            getOptionByLabel(label);

        if (!option) {
            setStatus(
                `Could not find user: ${label || value}`,
                'red'
            );
            return false;
        }

        if (
            lastAppliedValue === option.value &&
            select.value === option.value
        ) {
            return true;
        }

        lastAppliedValue = option.value;

        beginTableReloadAction();
        select.value = option.value;

        updateJqueryMobileButton(option.label);
        fireSelectEvents(select);
        refreshJqueryMobileSelect(select);

        const input = document.getElementById(INPUT_ID);

        if (input) {
            input.value = option.label;
        }

        if (shouldSave) {
            saveSelectedUser(option.value);
        }

        setStatus(
            `Selected: ${option.label} (${option.value})`,
            'green'
        );

        return true;
    }

    function restoreLastSelectedUser(onComplete) {
        if (!RESTORE_LAST_SELECTED || restoring) {
            return false;
        }

        const saved = getSavedSelectedUser();

        if (!saved || !saved.value) {
            return false;
        }

        restoring = true;

        if (restoreTimer !== null) {
            window.clearTimeout(restoreTimer);
        }

        restoreTimer = window.setTimeout(() => {
            restoreTimer = null;
            const currentSelect = getSelect();

            if (!currentSelect) {
                restoring = false;
                onComplete?.(false);
                return;
            }

            const optionExists =
                getOptionByValue(saved.value);

            if (optionExists) {
                applyUser(
                    optionExists.value,
                    optionExists.label,
                    false
                );
            }

            restoring = false;
            onComplete?.(Boolean(optionExists));

        }, RESTORE_DELAY_MS);

        return true;
    }

    function applyRequestedHandoff() {
        const initialHandoff = getEffectiveHandoff();

        if (!initialHandoff.areaManager && !initialHandoff.licensePlate) {
            return false;
        }

        if (handoffTimer !== null) return true;

        const runId = ++handoffRunId;
        let attempts = 0;
        let areaManagerApplied = !initialHandoff.areaManager;
        let areaManagerAppliedAt = areaManagerApplied ? Date.now() : 0;
        let parkingStatusClickedAt = 0;
        let parkingStatusClickRequested = false;
        let pendingStatusAttempted =
            wasPendingStatusAttempted(initialHandoff);
        let tableAction = getLatestTableActionSnapshot();
        let tableWaitStartedAt = null;
        let tableFilterCleared = false;
        let tableReadyEntriesText = '';
        let tableReadyFingerprint = '';
        let lastTableEntriesText = '';
        let stableTableChecks = 0;
        let filterStartedAt = null;
        let filterStartMutationVersion = 0;
        let lastPlateDispatchAt = 0;
        let plateDispatchCount = 0;
        let lastPlateInput = null;
        let lastEntriesText = '';
        let stableResultChecks = 0;
        let failureMessage = 'PayManager did not finish the parking search';

        function scheduleNextAttempt() {
            handoffTimer = window.setTimeout(
                attemptSelection,
                HANDOFF_RETRY_MS
            );
        }

        function resetSearchPhase() {
            tableAction = getLatestTableActionSnapshot();
            tableWaitStartedAt = null;
            tableFilterCleared = false;
            tableReadyEntriesText = '';
            tableReadyFingerprint = '';
            lastTableEntriesText = '';
            stableTableChecks = 0;
            filterStartedAt = null;
            filterStartMutationVersion = 0;
            lastPlateDispatchAt = 0;
            plateDispatchCount = 0;
            lastPlateInput = null;
            lastEntriesText = '';
            stableResultChecks = 0;
        }

        function applyAreaManager(handoff) {
            if (areaManagerApplied) return true;

            const option = findAreaManagerOption(handoff.areaManager);
            const select = getSelect();

            if (!option || !select) {
                failureMessage =
                    `Area Manager not found: ${handoff.areaManager}`;
                return false;
            }

            if (select.value === option.value) {
                areaManagerApplied = true;
                areaManagerAppliedAt = Date.now();
                setStatus(`Area Manager already selected: ${option.label}`);
                return true;
            }

            if (!applyUser(option.value, option.label, true)) {
                failureMessage =
                    `Could not select Area Manager: ${handoff.areaManager}`;
                return false;
            }

            areaManagerApplied = true;
            areaManagerAppliedAt = Date.now();
            resetSearchPhase();
            setStatus(`Selected Area Manager: ${option.label}`, 'green');
            return true;
        }

        function dispatchPlateSearch(
            input,
            handoff,
            isRepeat = false,
            restartFilterWindow = false
        ) {
            if (restartFilterWindow) {
                filterStartedAt = null;
                lastPlateDispatchAt = 0;
                plateDispatchCount = 0;
                lastEntriesText = '';
                stableResultChecks = 0;
            }

            if (filterStartedAt === null) {
                const entriesInfo = getParkingEntriesInfo();

                tableReadyEntriesText = normalizeEntriesText(
                    entriesInfo?.textContent
                );
                ensureTableObserver();
                tableReadyFingerprint = getParkingTableFingerprint();
                filterStartMutationVersion = tableMutationVersion;
                filterStartedAt = Date.now();
                lastEntriesText = '';
                stableResultChecks = 0;
            }

            setParkingSearchValue(input, handoff.licensePlate);
            lastPlateInput = input;
            lastPlateDispatchAt = Date.now();
            plateDispatchCount++;

            setStatus(
                isRepeat
                    ? `Confirming search for plate: ${handoff.licensePlate}`
                    : `Searching ${pendingStatusAttempted ? 'Pending' : 'Active'} for: ${handoff.licensePlate}`
            );
        }

        function ensureRequestedParkingStatus(handoff) {
            pendingStatusAttempted =
                pendingStatusAttempted ||
                wasPendingStatusAttempted(handoff);

            const wantsPending = pendingStatusAttempted;
            const button = wantsPending
                ? getPendingStatusButton()
                : getActiveStatusButton();
            const statusName = wantsPending ? 'Pending' : 'Active';

            if (!button) {
                failureMessage = `${statusName} parking status was not found`;
                return false;
            }

            if (isParkingStatusSelected(button)) return true;

            if (!parkingStatusClickRequested) {
                parkingStatusClickRequested = true;
                parkingStatusClickedAt = Date.now();
                beginTableReloadAction();
                resetSearchPhase();
                setStatus(`Switching to ${statusName}...`);
                button.click();
            }

            return false;
        }

        function finishCurrentStatusAsEmpty(handoff, input) {
            if (!pendingStatusAttempted) {
                markPendingStatusAttempted(handoff);
                pendingStatusAttempted = true;
                parkingStatusClickedAt = 0;
                parkingStatusClickRequested = false;
                resetSearchPhase();
                setStatus('No active entries. Switching to Pending...');
                return false;
            }

            clearRequestedHandoff();
            setStatus(
                `No active or Pending entries found for: ${handoff.licensePlate}`,
                '#a15c00'
            );
            (document.getElementById(PLATE_INPUT_ID) || input)?.focus();
            return true;
        }

        function finishMatchedResult(handoff, input) {
            clearRequestedHandoff();
            setStatus(
                `Found in ${pendingStatusAttempted ? 'Pending' : 'Active'}: ${handoff.licensePlate}`,
                'green'
            );
            input.focus();
            return true;
        }

        function finishUnverifiedResult(handoff, input, message) {
            clearRequestedHandoff();
            setStatus(message, 'red');
            (document.getElementById(PLATE_INPUT_ID) || input)?.focus();
            return true;
        }

        function waitForTableAndStartSearch(handoff, input) {
            const now = Date.now();

            if (tableWaitStartedAt === null) {
                tableWaitStartedAt = now;
            }

            if (!tableFilterCleared) {
                tableFilterCleared = true;

                if (String(input.value || '')) {
                    setParkingSearchValue(input, '');
                    tableWaitStartedAt = now;
                    lastTableEntriesText = '';
                    stableTableChecks = 0;
                    setStatus(
                        `Waiting for the ${pendingStatusAttempted ? 'Pending' : 'Active'} table...`
                    );
                    return false;
                }
            }

            const entriesInfo = getParkingEntriesInfo();
            const entriesText = normalizeEntriesText(
                entriesInfo?.textContent
            );
            const counts = getLeadingEntryCounts(entriesText);
            const tableHasRows = Boolean(
                counts && (counts.first > 0 || counts.second > 0)
            );
            const summaryRecognized = isEntriesSummaryText(entriesText);

            if (entriesText === lastTableEntriesText) {
                stableTableChecks++;
            } else {
                lastTableEntriesText = entriesText;
                stableTableChecks = entriesText ? 1 : 0;
            }

            const fallbackElapsed =
                now - tableWaitStartedAt >= HANDOFF_TABLE_READY_FALLBACK_MS;
            const tableChangedAfterAction = hasTableChangedSince(tableAction);

            if (isParkingTableProcessing()) {
                failureMessage =
                    `${pendingStatusAttempted ? 'Pending' : 'Active'} table is still loading`;
                setStatus(
                    `Waiting for the ${pendingStatusAttempted ? 'Pending' : 'Active'} table...`
                );
                return false;
            }

            if (!tableChangedAfterAction) {
                if (
                    fallbackElapsed &&
                    summaryRecognized &&
                    isEmptyEntriesText(entriesText) &&
                    stableTableChecks >= HANDOFF_STABLE_RESULT_CHECKS
                ) {
                    return finishCurrentStatusAsEmpty(handoff, input);
                }

                failureMessage =
                    `${pendingStatusAttempted ? 'Pending' : 'Active'} table did not finish reloading`;
                setStatus(
                    `Waiting for the ${pendingStatusAttempted ? 'Pending' : 'Active'} table...`
                );
                return false;
            }

            if (
                (!tableHasRows || stableTableChecks < HANDOFF_STABLE_RESULT_CHECKS) &&
                !fallbackElapsed
            ) {
                setStatus(
                    `Waiting for the ${pendingStatusAttempted ? 'Pending' : 'Active'} table...`
                );
                return false;
            }

            if (
                fallbackElapsed &&
                summaryRecognized &&
                isEmptyEntriesText(entriesText) &&
                stableTableChecks >= HANDOFF_STABLE_RESULT_CHECKS
            ) {
                return finishCurrentStatusAsEmpty(handoff, input);
            }

            if (!tableHasRows || !summaryRecognized) {
                failureMessage = 'Parking table summary was not ready';
                return false;
            }

            dispatchPlateSearch(input, handoff);
            return false;
        }

        function checkFilteredResult(handoff, input) {
            const now = Date.now();

            if (isParkingTableProcessing()) {
                stableResultChecks = 0;
                lastEntriesText = '';
                setStatus(
                    `Waiting for ${pendingStatusAttempted ? 'Pending' : 'Active'} search results...`
                );
                return false;
            }

            const entriesInfo = getParkingEntriesInfo();
            const entriesText = normalizeEntriesText(
                entriesInfo?.textContent
            );

            if (entriesText === lastEntriesText) {
                stableResultChecks++;
            } else {
                lastEntriesText = entriesText;
                stableResultChecks = entriesText ? 1 : 0;
            }

            const filterElapsed = now - filterStartedAt;
            const filterDrawObserved =
                tableMutationVersion > filterStartMutationVersion ||
                getParkingTableFingerprint() !== tableReadyFingerprint ||
                (
                    Boolean(entriesText) &&
                    entriesText !== tableReadyEntriesText
                );
            const renderedMatch = hasRenderedPlateMatch(
                handoff.licensePlate
            );

            if (
                filterDrawObserved &&
                renderedMatch &&
                isEntriesSummaryText(entriesText) &&
                !isEmptyEntriesText(entriesText) &&
                stableResultChecks >= HANDOFF_STABLE_RESULT_CHECKS
            ) {
                return finishMatchedResult(handoff, input);
            }

            if (
                plateDispatchCount < HANDOFF_MAX_PLATE_DISPATCHES &&
                now - lastPlateDispatchAt >= HANDOFF_PLATE_REAPPLY_MS
            ) {
                dispatchPlateSearch(input, handoff, true);
            }

            if (filterElapsed < HANDOFF_FILTER_RESULT_TIMEOUT_MS) {
                return false;
            }

            if (
                filterDrawObserved &&
                isEntriesSummaryText(entriesText) &&
                isEmptyEntriesText(entriesText) &&
                stableResultChecks >= HANDOFF_STABLE_RESULT_CHECKS
            ) {
                return finishCurrentStatusAsEmpty(handoff, input);
            }

            if (!filterDrawObserved) {
                return finishUnverifiedResult(
                    handoff,
                    input,
                    `PayManager did not apply the plate filter for: ${handoff.licensePlate}`
                );
            }

            if (!renderedMatch) {
                return finishUnverifiedResult(
                    handoff,
                    input,
                    `PayManager returned rows, but none matched: ${handoff.licensePlate}`
                );
            }

            return finishUnverifiedResult(
                handoff,
                input,
                `Parking result could not be verified for: ${handoff.licensePlate}`
            );
        }

        function attemptSelection() {
            if (runId !== handoffRunId) return;

            handoffTimer = null;
            attempts++;

            const handoff = getEffectiveHandoff();

            if (!handoff.areaManager && !handoff.licensePlate) return;

            applyAreaManager(handoff);

            if (areaManagerApplied && !handoff.licensePlate) {
                clearRequestedHandoff();
                return;
            }

            const areaManagerSettled =
                areaManagerApplied &&
                Date.now() - areaManagerAppliedAt >= HANDOFF_AREA_SETTLE_MS;
            const parkingStatusReady =
                areaManagerSettled &&
                ensureRequestedParkingStatus(handoff);
            const parkingStatusSettled =
                !parkingStatusClickedAt ||
                Date.now() - parkingStatusClickedAt >= HANDOFF_PENDING_SETTLE_MS;

            if (parkingStatusReady && parkingStatusSettled) {
                const input = getParkingSearchInput();

                if (!input) {
                    failureMessage = 'Parking search input was not found';
                } else if (filterStartedAt === null) {
                    if (waitForTableAndStartSearch(handoff, input)) return;
                } else {
                    const currentPlate = normalizePlate(input.value);

                    if (
                        input !== lastPlateInput ||
                        currentPlate !== handoff.licensePlate
                    ) {
                        dispatchPlateSearch(
                            input,
                            handoff,
                            true,
                            input !== lastPlateInput
                        );
                    }

                    if (checkFilteredResult(handoff, input)) return;
                }
            }

            if (attempts < HANDOFF_MAX_ATTEMPTS) {
                scheduleNextAttempt();
                return;
            }

            clearRequestedHandoff();
            setStatus(failureMessage, 'red');
        }

        attemptSelection();
        return true;
    }

    function applyUserAndRestartParkingSearch(value, label) {
        if (!applyUser(value, label, true)) {
            return false;
        }

        const plateInput = document.getElementById(PLATE_INPUT_ID);
        const licensePlate = normalizePlate(
            plateInput?.value || getSavedManualPlate()
        );

        if (licensePlate) {
            restartParkingSearch(licensePlate, 1000, false);
        }

        return true;
    }

    function preventPasswordManager(input, fieldName) {
        if (!input) return;

        input.name = fieldName;
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('data-form-type', 'other');
        input.setAttribute('data-1p-ignore', 'true');
        input.setAttribute('data-lpignore', 'true');
        input.setAttribute('data-bwignore', 'true');
    }

    function applyPasswordManagerDefense() {
        preventPasswordManager(
            document.getElementById(INPUT_ID),
            'tm-prs-filter'
        );
        preventPasswordManager(
            document.getElementById(PLATE_INPUT_ID),
            'tm-license-plate-filter'
        );
    }

    function createSearchUi() {
        const target = getInsertTarget();
        const select = getSelect();

        if (!target || !select) {
            return false;
        }

        const options = getOptions();

        if (options.length < 2) {
            return false;
        }

        if (document.getElementById(UI_ID)) {
            return true;
        }

        const wrapper = document.createElement('div');

        wrapper.id = UI_ID;
        wrapper.style.margin = '10px 0';
        wrapper.style.padding = '10px';
        wrapper.style.background = '#f7f7f7';
        wrapper.style.border = '1px solid #bdbdbd';
        wrapper.style.borderRadius = '6px';
        wrapper.style.boxShadow =
            '0 1px 4px rgba(0,0,0,0.15)';
        wrapper.style.fontFamily =
            'Arial, sans-serif';

        wrapper.innerHTML = `
            <div style="font-weight:bold; margin-bottom:6px;">
                Search PRS User
            </div>

            <input
    id="${INPUT_ID}"
    type="text"
    placeholder="Search user or value..."
    autocomplete="off"
    autocorrect="off"
    autocapitalize="off"
    spellcheck="false"
    role="combobox"
    aria-autocomplete="list"
    aria-haspopup="listbox"
    data-form-type="other"
    style="
        width:100%;
        box-sizing:border-box;
        padding:8px;
        border:1px solid #999;
        border-radius:4px;
        font-size:14px;
    "
>

            <div
                id="${RESULTS_ID}"
                style="
                    display:none;
                    margin-top:6px;
                    max-height:280px;
                    overflow-y:auto;
                    background:#fff;
                    border:1px solid #ccc;
                    border-radius:4px;
                    z-index:99999;
                "
            ></div>

            <div style="font-weight:bold; margin:10px 0 6px;">
                Search License Plate
            </div>

            <input
                id="${PLATE_INPUT_ID}"
                type="text"
                placeholder="Enter license plate..."
                autocomplete="off"
                autocorrect="off"
                autocapitalize="characters"
                spellcheck="false"
                data-form-type="other"
                style="
                    width:100%;
                    box-sizing:border-box;
                    padding:8px;
                    border:1px solid #999;
                    border-radius:4px;
                    font-size:14px;
                    text-transform:uppercase;
                "
            >

            <div
                id="${STATUS_ID}"
                style="
                    margin-top:6px;
                    font-size:12px;
                    color:#444;
                "
            ></div>
        `;

        const selectMenuContent =
            document.getElementById(
                'select_user_menu_content'
            );

        if (selectMenuContent) {
            selectMenuContent.prepend(wrapper);
        } else {
            target.prepend(wrapper);
        }

        bindSearchEvents();

        const requestedHandoff = getEffectiveHandoff();

        if (requestedHandoff.licensePlate) {
            setPlateEditorValue(requestedHandoff.licensePlate);
        }

        const currentOption =
            select.options[select.selectedIndex];

        if (currentOption) {
            document.getElementById(INPUT_ID).value =
                currentOption.textContent.trim();

            setStatus(
                `Current: ${currentOption.textContent.trim()} (${currentOption.value})`
            );
        }

        // Apply aggressive anti-password-manager measures
        applyPasswordManagerDefense();

        return true;
    }

    function bindSearchEvents() {
        const input =
            document.getElementById(INPUT_ID);

        const resultsBox =
            document.getElementById(RESULTS_ID);

        if (!input || !resultsBox) return;

        const plateInput = document.getElementById(PLATE_INPUT_ID);

        function submitPlateSearch() {
            if (!plateInput) return;

            if (plateSearchTimer !== null) {
                window.clearTimeout(plateSearchTimer);
                plateSearchTimer = null;
            }

            const licensePlate = normalizePlate(plateInput.value);

            plateInput.value = licensePlate;
            restartParkingSearch(licensePlate);
        }

        if (plateInput) {
            plateInput.addEventListener('input', () => {
                const licensePlate = normalizePlate(plateInput.value);

                saveManualPlate(licensePlate);
                setStatus(
                    licensePlate
                        ? `Preparing search for: ${licensePlate}`
                        : 'Enter a license plate to search.'
                );

                if (plateSearchTimer !== null) {
                    window.clearTimeout(plateSearchTimer);
                }

                plateSearchTimer = window.setTimeout(
                    submitPlateSearch,
                    600
                );
            });

            plateInput.addEventListener('keydown', event => {
                if (event.key !== 'Enter') return;

                event.preventDefault();
                submitPlateSearch();
            });

            plateInput.addEventListener('blur', () => {
                plateInput.value = normalizePlate(plateInput.value);
            });
        }

        let activeIndex = -1;
        let currentMatches = [];

        function setActiveIndex(index) {
            const rows =
                resultsBox.querySelectorAll(
                    '.tm-prs-search-result'
                );

            rows.forEach(row => {
                row.style.background = '#fff';
            });

            activeIndex = index;

            const activeRow = rows[activeIndex];

            if (activeRow) {
                activeRow.style.background =
                    '#e6f0ff';

                activeRow.scrollIntoView({
                    block: 'nearest'
                });
            }
        }

        function renderResults(matches) {
            resultsBox.innerHTML = '';
            currentMatches = matches;
            activeIndex = -1;

            if (!matches.length) {
                resultsBox.style.display =
                    'block';

                resultsBox.innerHTML = `
                    <div style="padding:8px; color:#777;">
                        No matches found
                    </div>
                `;

                return;
            }

            matches.slice(0, 50).forEach(
                (item, index) => {
                    const row =
                        document.createElement(
                            'div'
                        );

                    row.className =
                        'tm-prs-search-result';

                    row.style.padding = '8px';
                    row.style.cursor = 'pointer';
                    row.style.borderBottom =
                        '1px solid #eee';

                    row.innerHTML = `
                        <div style="font-weight:bold;">
                            ${escapeHtml(item.label)}
                        </div>

                        <div style="font-size:11px; color:#666;">
                            Value: ${escapeHtml(item.value)}
                        </div>
                    `;

                    row.addEventListener(
                        'mouseenter',
                        () => {
                            setActiveIndex(index);
                        }
                    );

                    row.addEventListener(
                        'click',
                        () => {
                            applyUserAndRestartParkingSearch(
                                item.value,
                                item.label
                            );

                            resultsBox.style.display =
                                'none';
                        }
                    );

                    resultsBox.appendChild(row);
                }
            );

            resultsBox.style.display = 'block';
        }

        function search() {
            const query = normalize(
                input.value.trim()
            );

            if (!query) {
                resultsBox.style.display =
                    'none';

                resultsBox.innerHTML = '';

                currentMatches = [];

                return;
            }

            const matches = getOptions()
                .map(option => {
                    const label =
                        normalize(option.label);

                    const value =
                        normalize(option.value);

                    let score = 0;

                    if (label === query)
                        score += 100;

                    if (label.startsWith(query))
                        score += 80;

                    if (label.includes(query))
                        score += 50;

                    if (value === query)
                        score += 90;

                    if (value.startsWith(query))
                        score += 60;

                    if (value.includes(query))
                        score += 40;

                    return {
                        ...option,
                        score
                    };
                })
                .filter(
                    option => option.score > 0
                )
                .sort((a, b) => {
                    if (b.score !== a.score) {
                        return b.score - a.score;
                    }

                    return a.label.localeCompare(
                        b.label
                    );
                });

            renderResults(matches);
        }

        input.addEventListener('input', search);

        input.addEventListener('focus', () => {
            if (input.value.trim()) {
                search();
            }
        });

        input.addEventListener(
            'keydown',
            event => {
                const rows =
                    resultsBox.querySelectorAll(
                        '.tm-prs-search-result'
                    );

                if (
                    event.key === 'ArrowDown'
                ) {
                    event.preventDefault();

                    if (!rows.length) return;

                    setActiveIndex(
                        activeIndex <
                            rows.length - 1
                            ? activeIndex + 1
                            : 0
                    );
                }

                if (event.key === 'ArrowUp') {
                    event.preventDefault();

                    if (!rows.length) return;

                    setActiveIndex(
                        activeIndex > 0
                            ? activeIndex - 1
                            : rows.length - 1
                    );
                }

                if (event.key === 'Enter') {
                    event.preventDefault();

                    if (
                        activeIndex >= 0 &&
                        currentMatches[
                        activeIndex
                        ]
                    ) {
                        applyUserAndRestartParkingSearch(
                            currentMatches[
                                activeIndex
                            ].value,
                            currentMatches[
                                activeIndex
                            ].label
                        );

                        resultsBox.style.display =
                            'none';

                        return;
                    }

                    if (
                        currentMatches.length > 0
                    ) {
                        applyUserAndRestartParkingSearch(
                            currentMatches[0]
                                .value,
                            currentMatches[0]
                                .label
                        );

                        resultsBox.style.display =
                            'none';
                    }
                }

                if (
                    event.key === 'Escape'
                ) {
                    resultsBox.style.display =
                        'none';
                }
            }
        );

        if (!outsideClickBound) {
            outsideClickBound = true;

            document.addEventListener('click', event => {
                const wrapper = document.getElementById(UI_ID);
                const currentResults = document.getElementById(RESULTS_ID);

                if (
                    wrapper &&
                    currentResults &&
                    !wrapper.contains(event.target)
                ) {
                    currentResults.style.display = 'none';
                }
            });
        }
    }

    function startInitialHandoffOrRestore() {
        const initialHandoff = getEffectiveHandoff();
        const isManualResume = Boolean(
            initialHandoff.licensePlate &&
            !initialHandoff.areaManager &&
            !initialHandoff.explicit
        );

        if (isManualResume) {
            const restoreScheduled = restoreLastSelectedUser(
                restored => {
                    if (restored) {
                        applyRequestedHandoff();
                    } else {
                        setStatus(
                            'Saved PRS user was not available. Select a PRS user to resume the plate search.',
                            'red'
                        );
                    }
                }
            );

            if (!restoreScheduled) {
                applyRequestedHandoff();
            }

            return;
        }

        if (!applyRequestedHandoff()) {
            restoreLastSelectedUser();
        }
    }

    function init() {
        if (initialized || initTimer !== null) {
            return;
        }

        let attempts = 0;

        initTimer = setInterval(() => {
            attempts++;

            const success =
                createSearchUi();

            if (success) {
                if (initialized) {
                    clearInterval(initTimer);
                    initTimer = null;
                    return;
                }

                initialized = true;

                clearInterval(initTimer);
                initTimer = null;

                startInitialHandoffOrRestore();
            }

            if (
                attempts >=
                MAX_INIT_ATTEMPTS
            ) {
                clearInterval(initTimer);
                initTimer = null;
            }
        }, INIT_RETRY_MS);
    }

    function watchForPanelReloads() {
        panelObserver?.disconnect();

        const observationRoot = getInsertTarget()?.parentElement ||
            document.body;

        if (!observationRoot) return;

        panelObserver = new MutationObserver(() => {
            if (panelCheckScheduled) return;

            panelCheckScheduled = true;
            queueMicrotask(() => {
                panelCheckScheduled = false;

                const select = getSelect();
                const ui = document.getElementById(UI_ID);

                if (select && !ui) {
                    cancelHandoffSearch();
                    resetTableObserverTracking();
                    initialized = false;
                    init();
                }
            });
        });

        panelObserver.observe(observationRoot, {
            childList: true,
            subtree: true
        });
    }

    function suspendRuntime() {
        panelObserver?.disconnect();
        panelObserver = null;
        panelCheckScheduled = false;

        if (initTimer !== null) {
            clearInterval(initTimer);
            initTimer = null;
        }

        cancelHandoffSearch();
        resetTableObserverTracking();
    }

    function resumeRuntime() {
        if (!document.getElementById(UI_ID)) {
            initialized = false;
        }

        init();
        watchForPanelReloads();
    }

    init();

    if (document.body) {
        watchForPanelReloads();
    } else {
        window.addEventListener(
            'DOMContentLoaded',
            watchForPanelReloads,
            { once: true }
        );
    }

    window.addEventListener('pagehide', suspendRuntime);
    window.addEventListener('pageshow', event => {
        if (event.persisted) resumeRuntime();
    });

})();
