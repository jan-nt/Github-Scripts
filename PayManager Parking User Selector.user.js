// ==UserScript==
// @name         PayManager Parking User Selector
// @namespace    https://nidushan.com
// @version      2.6
// @description  Adds searchable PRS user selector and restores selected user after PayManager reloads
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
    const HANDOFF_MAX_AGE_MS = 5 * 60 * 1000;
    const HANDOFF_RETRY_MS = 500;
    const HANDOFF_MAX_ATTEMPTS = 30;
    const PARKING_SEARCH_INPUT_XPATH =
        '/html/body/div[2]/div[2]/div/div[4]/div[2]/div/div[4]/label/form/input';

    const UI_ID = 'tm-prs-search-box';
    const INPUT_ID = 'tm-prs-search-input';
    const RESULTS_ID = 'tm-prs-search-results';
    const STATUS_ID = 'tm-prs-search-status';

    let initialized = false;
    let initTimer = null;
    let handoffTimer = null;
    let outsideClickBound = false;
    let restoring = false;
    let lastAppliedValue = null;

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
            .replace(/\s+/g, '');
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

    function getRequestedHandoff() {
        const params = new URLSearchParams(location.hash.slice(1));
        const fromUrl = {
            areaManager: String(params.get(AREA_MANAGER_PARAM) || '').trim(),
            licensePlate: normalizePlate(params.get(LICENSE_PLATE_PARAM))
        };

        if (fromUrl.areaManager || fromUrl.licensePlate) {
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
                    licensePlate: normalizePlate(stored.licensePlate)
                };
            }

            sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
        } catch {
            // Ignore unavailable or malformed session storage.
        }

        return {
            areaManager: '',
            licensePlate: ''
        };
    }

    function clearRequestedHandoff() {
        try {
            sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
        } catch {
            // Ignore unavailable session storage.
        }

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
        return getElementByXPath(PARKING_SEARCH_INPUT_XPATH);
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

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
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
            $select.trigger('change');

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

    function restoreLastSelectedUser() {
        if (!RESTORE_LAST_SELECTED || restoring) {
            return;
        }

        const saved = getSavedSelectedUser();

        if (!saved || !saved.value) {
            return;
        }

        restoring = true;

        setTimeout(() => {
            const currentSelect = getSelect();

            if (!currentSelect) {
                restoring = false;
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

        }, RESTORE_DELAY_MS);
    }

    function applyRequestedHandoff() {
        const initialHandoff = getRequestedHandoff();

        if (!initialHandoff.areaManager && !initialHandoff.licensePlate) {
            return false;
        }

        if (handoffTimer !== null) return true;

        let attempts = 0;
        let areaManagerApplied = !initialHandoff.areaManager;
        let areaManagerAppliedAt = 0;
        let lastPlateInput = null;
        let stablePlateChecks = 0;

        function attemptSelection() {
            handoffTimer = null;
            attempts++;

            const handoff = getRequestedHandoff();

            if (!handoff.areaManager && !handoff.licensePlate) return;

            if (!areaManagerApplied) {
                const option = findAreaManagerOption(handoff.areaManager);

                if (option && applyUser(option.value, option.label, true)) {
                    areaManagerApplied = true;
                    areaManagerAppliedAt = Date.now();
                    setStatus(`Selected Area Manager: ${option.label}`, 'green');
                }
            }

            if (areaManagerApplied && !handoff.licensePlate) {
                clearRequestedHandoff();
                return;
            }

            if (
                areaManagerApplied &&
                Date.now() - areaManagerAppliedAt >= HANDOFF_RETRY_MS
            ) {
                const input = getParkingSearchInput();

                if (input) {
                    const currentPlate = normalizePlate(input.value);

                    if (currentPlate !== handoff.licensePlate) {
                        setParkingSearchValue(input, handoff.licensePlate);
                        lastPlateInput = input;
                        stablePlateChecks = 0;
                    } else if (input === lastPlateInput) {
                        stablePlateChecks++;

                        if (stablePlateChecks >= 1) {
                            clearRequestedHandoff();
                            setStatus(
                                `Ready: ${handoff.licensePlate}`,
                                'green'
                            );
                            input.focus();
                            return;
                        }
                    } else {
                        lastPlateInput = input;
                        stablePlateChecks = 0;
                    }
                }
            }

            if (attempts < HANDOFF_MAX_ATTEMPTS) {
                const action = areaManagerApplied
                    ? `Entering plate: ${handoff.licensePlate}`
                    : `Selecting Area Manager: ${handoff.areaManager}`;

                setStatus(action);
                handoffTimer = window.setTimeout(
                    attemptSelection,
                    HANDOFF_RETRY_MS
                );
                return;
            }

            setStatus(
                areaManagerApplied
                    ? `License plate input not found: ${handoff.licensePlate}`
                    : `Area Manager not found: ${handoff.areaManager}`,
                'red'
            );
        }

        attemptSelection();
        return true;
    }

    function preventPasswordManager(input) {
        if (!input) return;

        // Set a completely random, non-credential-sounding name
        input.name = '_x' + Math.random().toString(36).substring(2, 8);

        // Remove any id attribute that might hint at credentials
        // (the INPUT_ID constant is 'tm-prs-search-input' which is safe, but enforce anyway)
        if (/user|pass|login|cred|account/i.test(input.id)) {
            input.removeAttribute('id');
        }

        // Force all anti-password-manager attributes
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('data-form-type', 'other');
        input.setAttribute('data-1p-ignore', 'true');
        input.setAttribute('data-lpignore', 'true');
        input.setAttribute('data-bwignore', 'true');

        // Disable browser input heuristics
        input.setAttribute('inputmode', 'none');

        // The readonly trick: Chrome skips readonly fields when scanning for password fields
        // We make it readonly, then remove readonly on focus so the user can type
        if (!input.hasAttribute('data-readonly-fix')) {
            input.setAttribute('data-readonly-fix', 'true');
            input.readOnly = true;
            const enableInput = () => {
                input.readOnly = false;
                input.removeEventListener('focus', enableInput);
            };
            input.addEventListener('focus', enableInput, { once: true });
        }
    }

    function applyPasswordManagerDefense() {
        const input = document.getElementById(INPUT_ID);
        if (!input) return;

        preventPasswordManager(input);

        // Wrap the parent wrapper in a fake <form autocomplete="off">
        // This is the strongest signal Chrome respects
        const wrapper = document.getElementById(UI_ID);
        if (wrapper && wrapper.tagName !== 'FORM') {
            const form = document.createElement('form');
            form.setAttribute('autocomplete', 'off');
            form.style.display = 'contents';
            form.style.margin = '0';
            form.style.padding = '0';

            // Add hidden dummy fields to absorb any autofill
            const dummyUser = document.createElement('input');
            dummyUser.type = 'text';
            dummyUser.name = 'email_' + Math.random().toString(36).substring(2, 6);
            dummyUser.style.display = 'none';
            dummyUser.setAttribute('autocomplete', 'off');
            dummyUser.tabIndex = -1;
            dummyUser.readOnly = true;

            const dummyPass = document.createElement('input');
            dummyPass.type = 'password';
            dummyPass.name = 'pass_' + Math.random().toString(36).substring(2, 6);
            dummyPass.style.display = 'none';
            dummyPass.setAttribute('autocomplete', 'off');
            dummyPass.tabIndex = -1;
            dummyPass.readOnly = true;

            // Insert form before wrapper, move wrapper into form, prepend dummies
            wrapper.parentNode.insertBefore(form, wrapper);
            form.appendChild(wrapper);
            form.insertBefore(dummyUser, wrapper);
            form.insertBefore(dummyPass, wrapper);
        }

        // Re-apply protection at intervals to fight Chrome's delayed heuristic checks
        [500, 1500, 3000].forEach(delay => {
            setTimeout(() => {
                const el = document.getElementById(INPUT_ID);
                if (el) {
                    el.setAttribute('autocomplete', 'off');
                    el.setAttribute('data-form-type', 'other');
                }
            }, delay);
        });
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
                            applyUser(
                                item.value,
                                item.label,
                                true
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
                        applyUser(
                            currentMatches[
                                activeIndex
                            ].value,
                            currentMatches[
                                activeIndex
                            ].label,
                            true
                        );

                        resultsBox.style.display =
                            'none';

                        return;
                    }

                    if (
                        currentMatches.length > 0
                    ) {
                        applyUser(
                            currentMatches[0]
                                .value,
                            currentMatches[0]
                                .label,
                            true
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

                if (!applyRequestedHandoff()) {
                    restoreLastSelectedUser();
                }
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
        const observer =
            new MutationObserver(() => {
                const select =
                    getSelect();

                const ui =
                    document.getElementById(
                        UI_ID
                    );

                if (
                    select &&
                    !ui
                ) {
                    initialized = false;
                    init();
                }
            });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    init();

    if (document.body) {
        watchForPanelReloads();
    } else {
        window.addEventListener(
            'DOMContentLoaded',
            watchForPanelReloads
        );
    }

})();
