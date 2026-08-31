import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
    new URL('../PayManager Parking User Selector.user.js', import.meta.url),
    'utf8'
);
const initMarker = '\n    init();';
const initIndex = source.lastIndexOf(initMarker);

assert.notEqual(initIndex, -1, 'Could not isolate userscript initialization');

const testSource = `${source.slice(0, initIndex)}
    globalThis.__handoffTest = {
        applyRequestedHandoff,
        applyUser,
        restartParkingSearch,
        getEffectiveHandoff,
        bindPlateSearchEvents,
        bindClearButton,
        cancelPlateSearch,
        clearLegacyManualPlateState,
        guardBlankPlateEditor,
        isValidPlate,
        isEmptyEntriesText,
        isEntriesSummaryText,
        findPrsSearchMatches: typeof findPrsSearchMatches === 'function'
            ? findPrsSearchMatches
            : undefined,
        findReliablePrsMatch: typeof findReliablePrsMatch === 'function'
            ? findReliablePrsMatch
            : undefined,
        startInitialHandoffOrRestore,
        markTableReloadExpected,
        hasTableChangedSince
    };
})();`;

const xpaths = {
    input:
        '/html/body/div[2]/div[2]/div/div[4]/div[2]/div/div[4]/label/form/input',
    entries:
        '/html/body/div[2]/div[2]/div/div[4]/div[2]/div/div[6]',
    pending:
        '/html/body/div[2]/div[2]/div/div[2]/div[2]/div[3]/fieldset/div/div[2]/a',
    active:
        '/html/body/div[2]/div[2]/div/div[2]/div[2]/div[3]/fieldset/div/div[1]/a'
};

function createHandoffScenario({
    initialStatus = 'active',
    activeInitialText = '1 10 69',
    activeFilteredText = '1 1 69',
    pendingInitialText = '1 10 38',
    pendingFilteredText = '1 1 38',
    activeApplyAfterDispatches = 1,
    pendingApplyAfterDispatches = 1,
    activeFilteredRowMode = 'match',
    pendingFilteredRowMode = 'match',
    plateReapplyMs = null,
    prsOptions = [
        { value: 'manager-1', label: 'Example Manager' },
        { value: 'manager-2', label: 'Second Manager' }
    ],
    prsOptionsAvailableAt = 0,
    locationHash = '#tmAreaManager=Example%20Manager&tmLicensePlate=TEST123'
} = {}) {
    let clock = 0;
    let cleanUrl = '';
    let activeClicks = 0;
    let pendingClicks = 0;
    let currentStatus = initialStatus;
    let activePlateDispatches = 0;
    let pendingPlateDispatches = 0;
    let nextTimerId = 1;
    const timers = [];
    const storage = new Map();
    const persistentStorage = new Map();
    const dispatchedEvents = [];
    const statusClickTimes = [];
    const jqueryTriggeredEvents = [];
    const tableMutationObservers = [];
    const eventTimeline = [];

    class FakeMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.connected = false;
            tableMutationObservers.push(this);
        }

        observe() {
            this.connected = true;
        }

        disconnect() {
            this.connected = false;
        }
    }

    function currentInitialText() {
        return currentStatus === 'active'
            ? activeInitialText
            : pendingInitialText;
    }

    function currentFilteredText() {
        return currentStatus === 'active'
            ? activeFilteredText
            : pendingFilteredText;
    }

    function currentFilteredRowMode() {
        return currentStatus === 'active'
            ? activeFilteredRowMode
            : pendingFilteredRowMode;
    }

    function hasRows(entriesText) {
        const numbers = String(entriesText).match(/\d+/g) || [];
        return Number(numbers[0]) > 0 || Number(numbers[1]) > 0;
    }

    function createRow(value) {
        const cell = { textContent: value };

        return {
            cells: [cell],
            hidden: false,
            style: {},
            textContent: value,
            getAttribute() {
                return null;
            },
            querySelector() {
                return null;
            }
        };
    }

    let renderedRows = [];

    function showInitialRows() {
        renderedRows = hasRows(currentInitialText())
            ? [createRow('OTHER999')]
            : [];
    }

    function showFilteredRows(licensePlate) {
        if (!hasRows(currentFilteredText())) {
            renderedRows = [];
            return;
        }

        renderedRows = currentFilteredRowMode() === 'match'
            ? [createRow(licensePlate)]
            : [createRow('OTHER999')];
    }

    class FakeDate extends Date {
        static now() {
            return clock;
        }
    }

    class FakeEvent {
        constructor(type, options = {}) {
            this.type = type;
            this.bubbles = Boolean(options.bubbles);
        }
    }

    const entriesInfo = {
        textContent: currentInitialText()
    };

    showInitialRows();

    const tableContainer = {};
    const table = {
        get textContent() {
            return renderedRows.map(row => row.textContent).join(' ');
        },
        get tBodies() {
            return [{ textContent: this.textContent }];
        },
        parentElement: tableContainer,
        closest() {
            return null;
        },
        querySelectorAll(selector) {
            return selector === 'tbody tr' ? renderedRows : [];
        }
    };

    class FakeInput {
        constructor(isTableFilter = false) {
            this._value = '';
            this.focused = false;
            this.isConnected = true;
            this.isTableFilter = isTableFilter;
            this.listeners = new Map();
        }

        get value() {
            return this._value;
        }

        set value(value) {
            this._value = String(value);
        }

        addEventListener(type, listener) {
            const listeners = this.listeners.get(type) || [];
            listeners.push(listener);
            this.listeners.set(type, listeners);
        }

        removeAttribute() {}

        emit(type, properties = {}) {
            const event = {
                type,
                isTrusted: true,
                key: '',
                preventDefault() {},
                ...properties
            };

            for (const listener of this.listeners.get(type) || []) {
                listener(event);
            }
        }

        dispatchEvent(event) {
            for (const listener of this.listeners.get(event.type) || []) {
                listener(event);
            }

            dispatchedEvents.push({
                type: event.type,
                value: this.value,
                parkingStatus: currentStatus,
                at: clock
            });

            if (this.isTableFilter && event.type === 'input') {
                eventTimeline.push({
                    type: 'plate-search',
                    value: this.value,
                    selectedUser: select.value,
                    at: clock
                });
            }

            if (this.isTableFilter && event.type === 'input') {
                if (!this.value) {
                    entriesInfo.textContent = currentInitialText();
                    showInitialRows();
                } else if (currentStatus === 'active') {
                    activePlateDispatches++;

                    if (activePlateDispatches >= activeApplyAfterDispatches) {
                        entriesInfo.textContent = currentFilteredText();
                        showFilteredRows(this.value);
                    }
                } else {
                    pendingPlateDispatches++;

                    if (pendingPlateDispatches >= pendingApplyAfterDispatches) {
                        entriesInfo.textContent = currentFilteredText();
                        showFilteredRows(this.value);
                    }
                }
            }

            return true;
        }

        focus() {
            this.focused = true;
        }
    }

    const input = new FakeInput(true);
    const plateEditor = new FakeInput();
    const activeClasses = new Set(
        initialStatus === 'active' ? ['active_tab'] : []
    );
    const pendingClasses = new Set(
        initialStatus === 'pending' ? ['active_tab'] : []
    );
    const activeButton = {
        classList: {
            contains(value) {
                return activeClasses.has(value);
            }
        },
        click() {
            activeClicks++;
            currentStatus = 'active';
            activeClasses.add('active_tab');
            pendingClasses.delete('active_tab');
            entriesInfo.textContent = activeInitialText;
            showInitialRows();
            statusClickTimes.push({ status: 'active', at: clock });
        }
    };
    const pendingButton = {
        classList: {
            contains(value) {
                return pendingClasses.has(value);
            }
        },
        click() {
            pendingClicks++;
            currentStatus = 'pending';
            pendingClasses.add('active_tab');
            activeClasses.delete('active_tab');
            entriesInfo.textContent = pendingInitialText;
            showInitialRows();
            statusClickTimes.push({ status: 'pending', at: clock });
        }
    };
    const selectOptions = prsOptions.map(option => ({
        value: String(option.value),
        textContent: String(option.label)
    }));
    const select = {
        value: selectOptions[0]?.value || '',
        get options() {
            return clock >= prsOptionsAvailableAt ? selectOptions : [];
        },
        dispatchedEvents: [],
        dispatchEvent(event) {
            this.dispatchedEvents.push(event.type);

            if (event.type === 'change') {
                eventTimeline.push({
                    type: 'user-selection',
                    value: this.value,
                    at: clock
                });
                entriesInfo.textContent = '1 10 70';
                renderedRows = [createRow('SECOND999')];
            }

            return true;
        }
    };
    const status = { textContent: '', style: {} };
    const location = {
        pathname: '/parking',
        search: '',
        hash: locationHash
    };

    const document = {
        getElementById(id) {
            if (id === 'prs_select_user') return select;
            if (id === 'tm-prs-search-status') return status;
            if (id === 'tm-parking-license-plate-input') return plateEditor;
            if (id === 'parkings_active_btn') return activeButton;
            if (id === 'parkings_pending_btn') return pendingButton;
            if (id === 'parkings_table_info') return entriesInfo;
            if (id === 'parkings_table') return table;
            return null;
        },
        querySelector(selector) {
            if (
                selector.includes('#parkings_table_filter') ||
                selector.includes('aria-controls="parkings_table"')
            ) {
                return input;
            }

            return null;
        },
        evaluate(xpath) {
            const elements = new Map([
                [xpaths.input, input],
                [xpaths.entries, entriesInfo],
                [xpaths.pending, pendingButton],
                [xpaths.active, activeButton]
            ]);

            return { singleNodeValue: elements.get(xpath) || null };
        }
    };

    const context = {
        Date: FakeDate,
        Event: FakeEvent,
        HTMLInputElement: FakeInput,
        MutationObserver: FakeMutationObserver,
        URLSearchParams,
        XPathResult: { FIRST_ORDERED_NODE_TYPE: 9 },
        document,
        history: {
            state: null,
            replaceState(_state, _title, url) {
                cleanUrl = url;
                location.hash = '';
            }
        },
        location,
        sessionStorage: {
            getItem(key) {
                return storage.has(key) ? storage.get(key) : null;
            },
            setItem(key, value) {
                storage.set(key, String(value));
            },
            removeItem(key) {
                storage.delete(key);
            }
        },
        localStorage: {
            getItem(key) {
                return persistentStorage.has(key)
                    ? persistentStorage.get(key)
                    : null;
            },
            setItem(key, value) {
                persistentStorage.set(key, String(value));
            },
            removeItem(key) {
                persistentStorage.delete(key);
            }
        },
        window: {
            setTimeout(callback, delay) {
                const id = nextTimerId++;

                timers.push({
                    id,
                    callback,
                    dueAt: clock + delay,
                    canceled: false
                });
                return id;
            },
            clearTimeout(id) {
                const timer = timers.find(candidate => candidate.id === id);

                if (timer) timer.canceled = true;
            }
        }
    };

    const scenarioSource = plateReapplyMs === null
        ? testSource
        : testSource.replace(
            /const HANDOFF_PLATE_REAPPLY_MS = \d+;/,
            `const HANDOFF_PLATE_REAPPLY_MS = ${plateReapplyMs};`
        );

    vm.runInNewContext(scenarioSource, context);

    function runTimers(maximumCallbacks = 240) {
        let callbacks = 0;

        while (timers.some(timer => !timer.canceled) && callbacks < maximumCallbacks) {
            timers.sort((a, b) => a.dueAt - b.dueAt || a.id - b.id);
            const timer = timers.shift();

            if (timer.canceled) continue;

            clock = timer.dueAt;
            timer.callback();
            callbacks++;
        }

        assert.ok(
            callbacks < maximumCallbacks,
            'Handoff did not finish within the expected timer callbacks'
        );
    }

    return {
        api: context.__handoffTest,
        input,
        plateEditor,
        select,
        status,
        location,
        getClock: () => clock,
        getCleanUrl: () => cleanUrl,
        getActiveClicks: () => activeClicks,
        getPendingClicks: () => pendingClicks,
        getActivePlateDispatches: () => activePlateDispatches,
        getPendingPlateDispatches: () => pendingPlateDispatches,
        getDispatchedEvents: () => dispatchedEvents,
        getEventTimeline: () => eventTimeline,
        getStatusClickTimes: () => statusClickTimes,
        getJqueryTriggeredEvents: () => jqueryTriggeredEvents,
        runScriptAgain() {
            const existingApi = context.__handoffTest;
            vm.runInNewContext(testSource, context);
            return context.__handoffTest === existingApi;
        },
        enableJqueryMobile() {
            context.window.jQuery = element => {
                const api = {
                    val(value) {
                        element.value = value;
                        return api;
                    },
                    trigger(type) {
                        jqueryTriggeredEvents.push(type);
                        return api;
                    },
                    selectmenu() {
                        return api;
                    }
                };

                return api;
            };
        },
        saveSelectedUser(value) {
            persistentStorage.set(
                'pm_selected_prs_user',
                JSON.stringify({ value, savedAt: clock })
            );
        },
        setSessionValue(key, value) {
            storage.set(key, String(value));
        },
        hasSessionValue(key) {
            return storage.has(key);
        },
        triggerTableMutation() {
            for (const observer of tableMutationObservers) {
                if (observer.connected) observer.callback([]);
            }
        },
        runTimers
    };
}

const searchScenario = createHandoffScenario({ locationHash: '' });

assert.equal(
    typeof searchScenario.api.findPrsSearchMatches,
    'function',
    'PRS search must expose its production matching behavior'
);
assert.equal(
    typeof searchScenario.api.findReliablePrsMatch,
    'function',
    'URL handoffs must use the shared reliable PRS matching behavior'
);

const prsSearchOptions = [
    { value: 'manager-1', label: 'Helse Fonna AS' },
    { value: 'manager-2', label: 'Nesbyen-Hedalen' },
    { value: 'manager-3', label: 'HelseFonnaAS' },
    { value: 'manager-4', label: 'Helse Vest AS' }
];

assert.equal(
    searchScenario.api.findPrsSearchMatches(
        prsSearchOptions,
        'HelseFonnaAS'
    ).map(option => option.label).includes('Helse Fonna AS'),
    true,
    'typing a joined name must find the spaced PRS label'
);
assert.equal(
    searchScenario.api.findPrsSearchMatches(
        prsSearchOptions,
        'Nesbyen Hedalen'
    ).map(option => option.label).join('|'),
    'Nesbyen-Hedalen',
    'spaces and hyphens must be interchangeable in PRS search'
);

for (const [label, query, separatorName] of [
    ['Fjord_Kraft_AS', 'Fjord Kraft AS', 'underscores'],
    ['Oslo.Parkering.AS', 'Oslo Parkering AS', 'periods'],
    ['Nord/Vest Drift', 'Nord Vest Drift', 'slashes']
]) {
    assert.deepEqual(
        searchScenario.api.findPrsSearchMatches(
            [{ value: separatorName, label }],
            query
        ).map(option => option.label),
        [label],
        `${separatorName} must be interchangeable with spaces in PRS search`
    );
}

assert.equal(
    searchScenario.api.findPrsSearchMatches(
        prsSearchOptions,
        'HelseFonnaAS'
    )[0].label,
    'HelseFonnaAS',
    'a literal exact label must outrank a separator-insensitive match'
);
assert.equal(
    searchScenario.api.findPrsSearchMatches(
        prsSearchOptions,
        'HelseFonnaAZ'
    ).length,
    0,
    'separator matching must not become broad typo matching'
);

assert.deepEqual(
    searchScenario.api.findPrsSearchMatches(
        [
            { value: 'literal-exact', label: 'Alpha' },
            { value: 'literal-prefix', label: 'Alpha Beta' },
            { value: 'literal-contains', label: 'Beta Alpha' }
        ],
        'Alpha'
    ).map(option => option.label),
    ['Alpha', 'Alpha Beta', 'Beta Alpha'],
    'legacy literal exact, prefix, and contains ranking must remain intact'
);

const reliablePrsOptions = [
    { value: 'moskenes', label: 'Moskenes Kommune' },
    { value: 'nesbyen', label: 'Nesbyen-Hedalen' },
    { value: 'prs-301', label: 'Vegen Gulsvik-Damtjern SA' },
    { value: 'prs-302', label: 'Helse Fonna AS' },
    { value: 'prs-303', label: 'FoglefonnaUser' },
    { value: 'prs-304', label: 'Flakstad Kommune User' }
];

for (const [query, expectedLabel] of [
    ['MoskenesKommune', 'Moskenes Kommune'],
    ['Moskenes Kommune', 'Moskenes Kommune'],
    ['NesbyenHedalen', 'Nesbyen-Hedalen'],
    ['Nesbyen Hedalen', 'Nesbyen-Hedalen'],
    ['Nesbyen-Hedalen', 'Nesbyen-Hedalen'],
    ['  nEsByEn---hEdAlEn  ', 'Nesbyen-Hedalen'],
    ['VegenGulsvikDamtjern', 'Vegen Gulsvik-Damtjern SA'],
    ['HelseFonnaHF', 'Helse Fonna AS'],
    ['Foglefonna', 'FoglefonnaUser'],
    ['Flakstad', 'Flakstad Kommune User']
]) {
    const match = searchScenario.api.findReliablePrsMatch(
        reliablePrsOptions,
        query
    );

    assert.equal(match.status, 'matched', `${query} must match reliably`);
    assert.equal(match.option.label, expectedLabel);
}

for (const [query, expectedLabel] of [
    ['VegenGulsvikDamtjern', 'Vegen Gulsvik-Damtjern SA'],
    ['HelseFonnaHF', 'Helse Fonna AS'],
    ['Foglefonna', 'FoglefonnaUser']
]) {
    assert.equal(
        searchScenario.api.findPrsSearchMatches(
            reliablePrsOptions,
            query
        )[0].label,
        expectedLabel,
        `${query} must also rank the suffix-aware match first in direct PRS search`
    );
}

assert.equal(
    searchScenario.api.findReliablePrsMatch(
        reliablePrsOptions,
        'UnknownManager'
    ).status,
    'not-found',
    'an unknown compact name must not fall back to fuzzy matching'
);

assert.equal(
    searchScenario.api.findReliablePrsMatch(
        [{ value: 'HelseFonnaHF', label: 'Different Organization AS' }],
        'HelseFonna'
    ).status,
    'not-found',
    'organization-suffix fallback must not trust a mismatched internal option value'
);

for (const [query, label] of [['Andre', 'Andreas']]) {
    assert.equal(
        searchScenario.api.findReliablePrsMatch(
            [{ value: 'prs-name-safety', label }],
            query
        ).status,
        'not-found',
        `${query} must not treat the ending of ${label} as an organization suffix`
    );
}

const ambiguousPrsMatch = searchScenario.api.findReliablePrsMatch(
    [
        { value: 'nesbyen-1', label: 'Nesbyen-Hedalen' },
        { value: 'nesbyen-2', label: 'Nesbyen Hedalen' }
    ],
    'NesbyenHedalen'
);

assert.equal(
    ambiguousPrsMatch.status,
    'ambiguous',
    'multiple options with the same compact name must require manual selection'
);
assert.equal(ambiguousPrsMatch.option, null);

const ambiguousSuffixPrsMatch = searchScenario.api.findReliablePrsMatch(
    [
        { value: 'prs-401', label: 'Helse Fonna AS' },
        { value: 'prs-402', label: 'Helse Fonna HF' }
    ],
    'HelseFonna'
);

assert.equal(
    ambiguousSuffixPrsMatch.status,
    'ambiguous',
    'multiple options with the same organization stem must require manual selection'
);
assert.equal(ambiguousSuffixPrsMatch.option, null);

const exactSuffixPrsMatch = searchScenario.api.findReliablePrsMatch(
    [
        { value: 'prs-401', label: 'Helse Fonna AS' },
        { value: 'prs-402', label: 'Helse Fonna HF' }
    ],
    'HelseFonnaHF'
);

assert.equal(
    exactSuffixPrsMatch.status,
    'matched',
    'an exact compact match must outrank organization-stem fallback matches'
);
assert.equal(exactSuffixPrsMatch.option.label, 'Helse Fonna HF');

function verifyUrlHandoff({
    areaManager,
    encodedAreaManager = encodeURIComponent(areaManager),
    licensePlate,
    encodedLicensePlate = encodeURIComponent(licensePlate),
    expectedLabel,
    expectedValue,
    optionsAvailableAt = 0
}) {
    const scenario = createHandoffScenario({
        prsOptions: [
            { value: 'unrelated', label: 'Unrelated Manager' },
            { value: expectedValue, label: expectedLabel }
        ],
        prsOptionsAvailableAt: optionsAvailableAt,
        locationHash:
            `#tmAreaManager=${encodedAreaManager}` +
            `&tmLicensePlate=${encodedLicensePlate}`
    });

    assert.equal(scenario.api.applyRequestedHandoff(), true);
    assert.equal(
        scenario.api.applyRequestedHandoff(),
        true,
        'repeated initialization must reuse the active handoff run'
    );
    scenario.runTimers();

    assert.equal(scenario.select.value, expectedValue);
    assert.equal(scenario.input.value, licensePlate.replace(/[\s-]+/g, ''));
    assert.equal(scenario.plateEditor.value, licensePlate.replace(/[\s-]+/g, ''));
    assert.equal(scenario.getActivePlateDispatches(), 1);
    assert.equal(
        scenario.status.textContent,
        `Found in Active: ${licensePlate.replace(/[\s-]+/g, '')}`
    );

    const selectionIndex = scenario.getEventTimeline().findIndex(
        event => event.type === 'user-selection'
    );
    const searchIndex = scenario.getEventTimeline().findIndex(
        event => event.type === 'plate-search'
    );

    assert.ok(selectionIndex >= 0, 'the requested PRS user was not selected');
    assert.ok(searchIndex > selectionIndex, 'plate search started before PRS selection');
    assert.equal(
        scenario.getEventTimeline()[searchIndex].selectedUser,
        expectedValue,
        'plate search used the wrong PRS user'
    );

    return scenario;
}

const nesbyenHandoff = verifyUrlHandoff({
    areaManager: 'NesbyenHedalen',
    licensePlate: 'EF78880',
    expectedLabel: 'Nesbyen-Hedalen',
    expectedValue: 'nesbyen',
    optionsAvailableAt: 1500
});
assert.ok(
    nesbyenHandoff.getClock() >= 1500,
    'handoff must wait for delayed PRS options'
);

verifyUrlHandoff({
    areaManager: 'MoskenesKommune',
    licensePlate: 'HRC5I5',
    expectedLabel: 'Moskenes Kommune',
    expectedValue: 'moskenes'
});

verifyUrlHandoff({
    areaManager: 'Nesbyen Hedalen',
    encodedAreaManager: '%20%20nEsByEn---hEdAlEn%20%20',
    licensePlate: 'EF78880',
    encodedLicensePlate: 'EF%2078-880',
    expectedLabel: 'Nesbyen-Hedalen',
    expectedValue: 'nesbyen'
});

verifyUrlHandoff({
    areaManager: 'VegenGulsvikDamtjern',
    licensePlate: 'TEST301',
    expectedLabel: 'Vegen Gulsvik-Damtjern SA',
    expectedValue: 'prs-301'
});

verifyUrlHandoff({
    areaManager: 'HelseFonnaHF',
    licensePlate: 'TEST302',
    expectedLabel: 'Helse Fonna AS',
    expectedValue: 'prs-302'
});

verifyUrlHandoff({
    areaManager: 'Foglefonna',
    licensePlate: 'TEST123',
    expectedLabel: 'FoglefonnaUser',
    expectedValue: 'prs-303'
});

const missingAreaManager = createHandoffScenario({
    locationHash: '#tmLicensePlate=EF78880'
});
assert.equal(missingAreaManager.api.applyRequestedHandoff(), false);
assert.equal(
    missingAreaManager.status.textContent,
    'PayManager handoff is missing the Area Manager.'
);
assert.equal(missingAreaManager.getActivePlateDispatches(), 0);

const missingLicensePlate = createHandoffScenario({
    locationHash: '#tmAreaManager=NesbyenHedalen'
});
assert.equal(missingLicensePlate.api.applyRequestedHandoff(), false);
assert.equal(
    missingLicensePlate.status.textContent,
    'PayManager handoff is missing the license plate.'
);
assert.equal(missingLicensePlate.getActivePlateDispatches(), 0);

const invalidLicensePlate = createHandoffScenario({
    locationHash: '#tmAreaManager=NesbyenHedalen&tmLicensePlate=%25%25%25'
});
assert.equal(invalidLicensePlate.api.applyRequestedHandoff(), false);
assert.equal(
    invalidLicensePlate.status.textContent,
    'PayManager handoff has an invalid license plate.'
);
assert.equal(invalidLicensePlate.getActivePlateDispatches(), 0);

const missingPrsUser = createHandoffScenario({
    locationHash: '#tmAreaManager=UnknownManager&tmLicensePlate=EF78880'
});
assert.equal(missingPrsUser.api.applyRequestedHandoff(), true);
missingPrsUser.runTimers();
assert.equal(
    missingPrsUser.status.textContent,
    'PRS user not found: UnknownManager'
);
assert.equal(missingPrsUser.getActivePlateDispatches(), 0);

const ambiguousHandoff = createHandoffScenario({
    prsOptions: [
        { value: 'nesbyen-1', label: 'Nesbyen-Hedalen' },
        { value: 'nesbyen-2', label: 'Nesbyen Hedalen' }
    ],
    locationHash: '#tmAreaManager=NesbyenHedalen&tmLicensePlate=EF78880'
});
assert.equal(ambiguousHandoff.api.applyRequestedHandoff(), true);
ambiguousHandoff.runTimers();
assert.equal(
    ambiguousHandoff.status.textContent,
    'Multiple PRS users match: NesbyenHedalen. Select the user manually.'
);
assert.equal(ambiguousHandoff.getActivePlateDispatches(), 0);

// A positive Active result must stop without a redundant dispatch, even when
// the plate reapply interval matches the handoff retry interval.
const activeMatch = createHandoffScenario({
    activeApplyAfterDispatches: 2,
    plateReapplyMs: 500
});

assert.equal(activeMatch.runScriptAgain(), true);

assert.equal(activeMatch.api.applyRequestedHandoff(), true);
activeMatch.runTimers();

assert.equal(activeMatch.input.value, 'TEST123');
assert.equal(activeMatch.plateEditor.value, 'TEST123');
assert.equal(activeMatch.input.focused, true);
assert.equal(activeMatch.getActiveClicks(), 0);
assert.equal(activeMatch.getPendingClicks(), 0);
assert.equal(activeMatch.getActivePlateDispatches(), 2);
assert.deepEqual(activeMatch.select.dispatchedEvents, []);
assert.equal(activeMatch.getCleanUrl(), '/parking');
assert.equal(activeMatch.status.textContent, 'Found in Active: TEST123');

// A stable zero Active result waits three seconds, then searches Pending.
const pendingMatch = createHandoffScenario({
    activeFilteredText: '0 0 69'
});

assert.equal(pendingMatch.api.applyRequestedHandoff(), true);
pendingMatch.runTimers();

assert.equal(pendingMatch.getActiveClicks(), 0);
assert.equal(pendingMatch.getPendingClicks(), 1);
assert.ok(pendingMatch.getActivePlateDispatches() >= 1);
assert.ok(pendingMatch.getPendingPlateDispatches() >= 1);
assert.equal(pendingMatch.input.value, 'TEST123');
assert.equal(pendingMatch.status.textContent, 'Found in Pending: TEST123');

// If PayManager opens on Pending, the script still reviews Active first.
const pendingFirst = createHandoffScenario({
    initialStatus: 'pending'
});

assert.equal(pendingFirst.api.applyRequestedHandoff(), true);
pendingFirst.runTimers();

assert.equal(pendingFirst.getActiveClicks(), 1);
assert.equal(pendingFirst.getPendingClicks(), 0);
assert.equal(pendingFirst.status.textContent, 'Found in Active: TEST123');

// A table with no rows uses the three-second readiness fallback before Pending.
const emptyBoth = createHandoffScenario({
    activeInitialText: '0 0 0',
    activeFilteredText: '0 0 0',
    pendingInitialText: '0 0 0',
    pendingFilteredText: '0 0 0'
});

assert.equal(emptyBoth.api.applyRequestedHandoff(), true);
emptyBoth.runTimers();

const pendingClick = emptyBoth.getStatusClickTimes().find(
    event => event.status === 'pending'
);

assert.ok(pendingClick, 'Expected the Pending status fallback');
assert.ok(pendingClick.at >= 3000, 'Pending was selected before the table fallback');
assert.ok(pendingClick.at < 5000, 'Pending did not use the faster table fallback');
assert.equal(emptyBoth.getActivePlateDispatches(), 0);
assert.equal(emptyBoth.getPendingPlateDispatches(), 0);
assert.equal(
    emptyBoth.status.textContent,
    'No active or Pending entries found for: TEST123'
);

// An ignored filter must not turn an unchanged unfiltered table into a match.
const ignoredFilter = createHandoffScenario({
    activeFilteredText: '1 10 69',
    activeFilteredRowMode: 'mismatch'
});

assert.equal(ignoredFilter.api.applyRequestedHandoff(), true);
ignoredFilter.runTimers();

assert.equal(ignoredFilter.getPendingClicks(), 0);
assert.equal(
    ignoredFilter.status.textContent,
    'PayManager did not apply the plate filter for: TEST123'
);
assert.ok(
    ignoredFilter.getClock() < 6000,
    'Ignored plate filters must stop within the faster result timeout'
);

// A positive summary is not a match unless a rendered row contains the plate.
const mismatchedRows = createHandoffScenario({
    activeFilteredText: '1 1 69',
    activeFilteredRowMode: 'mismatch'
});

assert.equal(mismatchedRows.api.applyRequestedHandoff(), true);
mismatchedRows.runTimers();

assert.equal(mismatchedRows.getPendingClicks(), 0);
assert.equal(
    mismatchedRows.status.textContent,
    'PayManager returned rows, but none matched: TEST123'
);

// PRS selection emits one change event, even when jQuery Mobile is present.
const prsSelection = createHandoffScenario({ locationHash: '' });
prsSelection.enableJqueryMobile();

assert.equal(
    prsSelection.api.applyUser('manager-2', 'Second Manager', true),
    true
);
assert.equal(
    prsSelection.select.dispatchedEvents.filter(type => type === 'change').length,
    1
);
assert.deepEqual(prsSelection.getJqueryTriggeredEvents(), []);

// A DataTables redraw can be meaningful even when its final text is identical.
const identicalRedraw = createHandoffScenario({ locationHash: '' });
const tableAction = identicalRedraw.api.markTableReloadExpected();
assert.equal(identicalRedraw.api.hasTableChangedSince(tableAction), false);
identicalRedraw.triggerTableMutation();
assert.equal(identicalRedraw.api.hasTableChangedSince(tableAction), true);

// Expired handoffs also remove the pending-status signature containing the plate.
const expiredHandoff = createHandoffScenario({ locationHash: '' });
expiredHandoff.setSessionValue(
    'pm_parking_handoff_v1',
    JSON.stringify({
        areaManager: 'Expired Manager',
        licensePlate: 'OLD123',
        savedAt: -400_000
    })
);
expiredHandoff.setSessionValue(
    'pm_parking_handoff_pending_v1',
    '["Expired Manager","OLD123"]'
);
expiredHandoff.api.getEffectiveHandoff();
assert.equal(expiredHandoff.hasSessionValue('pm_parking_handoff_v1'), false);
assert.equal(
    expiredHandoff.hasSessionValue('pm_parking_handoff_pending_v1'),
    false
);

// An explicit area-only handoff must not inherit legacy manual plate storage.
const areaOnly = createHandoffScenario({
    locationHash: '#tmAreaManager=Example%20Manager'
});

areaOnly.setSessionValue(
    'pm_parking_manual_plate_v1',
    JSON.stringify({ licensePlate: 'STALE123', savedAt: 0 })
);
areaOnly.api.clearLegacyManualPlateState();
const areaOnlyHandoff = areaOnly.api.getEffectiveHandoff();

assert.equal(areaOnlyHandoff.areaManager, 'Example Manager');
assert.equal(areaOnlyHandoff.licensePlate, '');
assert.equal(areaOnlyHandoff.explicit, true);
assert.equal(areaOnly.hasSessionValue('pm_parking_manual_plate_v1'), false);

// Normal parking review restores only the PRS user and starts no plate search.
const normalReview = createHandoffScenario({ locationHash: '' });

normalReview.setSessionValue(
    'pm_parking_manual_plate_v1',
    JSON.stringify({ licensePlate: 'OLD123', savedAt: 0 })
);
normalReview.setSessionValue(
    'pm_parking_handoff_v1',
    JSON.stringify({
        areaManager: '',
        licensePlate: 'OLD123',
        explicit: false,
        savedAt: 0
    })
);
normalReview.setSessionValue(
    'pm_parking_handoff_pending_v1',
    '["","OLD123"]'
);
normalReview.api.clearLegacyManualPlateState();
normalReview.saveSelectedUser('manager-2');
normalReview.api.startInitialHandoffOrRestore();

assert.equal(normalReview.select.value, 'manager-1');
assert.equal(normalReview.getActivePlateDispatches(), 0);

normalReview.runTimers();

assert.equal(normalReview.select.value, 'manager-2');
assert.equal(
    normalReview.select.dispatchedEvents.filter(type => type === 'change').length,
    1
);
assert.equal(normalReview.input.value, '');
assert.equal(normalReview.plateEditor.value, '');
assert.equal(normalReview.getActivePlateDispatches(), 0);
assert.equal(normalReview.hasSessionValue('pm_parking_handoff_v1'), false);
assert.equal(
    normalReview.hasSessionValue('pm_parking_handoff_pending_v1'),
    false
);

// Browser autofill is scrubbed before user activation and cannot trigger Ajax.
const dynamicPlate = createHandoffScenario({ locationHash: '' });
dynamicPlate.api.bindPlateSearchEvents(dynamicPlate.plateEditor);
dynamicPlate.plateEditor.value = 'jas@nortronic.com';
dynamicPlate.plateEditor.emit('input');
assert.equal(dynamicPlate.plateEditor.value, '');
assert.equal(dynamicPlate.getActivePlateDispatches(), 0);
assert.equal(dynamicPlate.api.isValidPlate('jas@nortronic.com'), false);

dynamicPlate.plateEditor.value = 'autofilled@example.com';
dynamicPlate.api.guardBlankPlateEditor(dynamicPlate.plateEditor);
dynamicPlate.runTimers();
assert.equal(dynamicPlate.plateEditor.value, '');

// User typing starts a guarded search; deleting the value cancels and clears it.
dynamicPlate.plateEditor.emit('pointerdown');
dynamicPlate.plateEditor.value = ' xy-123 ';
dynamicPlate.plateEditor.emit('input');
dynamicPlate.runTimers();
assert.equal(dynamicPlate.input.value, 'XY123');
assert.equal(dynamicPlate.status.textContent, 'Found in Active: XY123');
assert.equal(
    dynamicPlate.getDispatchedEvents().every(event => event.type === 'input'),
    true,
    'plate automation must not emit redundant keyup/search/change events'
);

dynamicPlate.plateEditor.value = '';
dynamicPlate.plateEditor.emit('input');
assert.equal(dynamicPlate.input.value, '');
assert.equal(
    dynamicPlate.status.textContent,
    'License-plate search is inactive.'
);

// The inline clear control hides when empty and cancels the live table filter.
const buttonClear = createHandoffScenario({ locationHash: '' });
const clearButtonListeners = new Map();
const clearButtonAttributes = new Map();
const clearButton = {
    style: {},
    setAttribute(name, value) {
        clearButtonAttributes.set(name, String(value));
    },
    addEventListener(type, listener) {
        clearButtonListeners.set(type, listener);
    },
    click() {
        clearButtonListeners.get('click')?.({
            preventDefault() {},
            stopPropagation() {}
        });
    }
};

buttonClear.plateEditor.value = 'BUTTON123';
buttonClear.input.value = 'BUTTON123';
buttonClear.api.bindClearButton(
    clearButton,
    buttonClear.plateEditor,
    () => buttonClear.api.cancelPlateSearch()
);

assert.equal(clearButton.style.display, 'flex');
assert.equal(clearButtonAttributes.get('aria-hidden'), 'false');
clearButton.click();
assert.equal(buttonClear.plateEditor.value, '');
assert.equal(buttonClear.input.value, '');
assert.equal(clearButton.style.display, 'none');
assert.equal(clearButtonAttributes.get('aria-hidden'), 'true');
assert.equal(buttonClear.plateEditor.focused, true);
assert.equal(
    buttonClear.status.textContent,
    'License-plate search is inactive.'
);

// Changing the editable plate starts the same guarded search again.
assert.equal(activeMatch.api.restartParkingSearch(' alt-456 '), true);
activeMatch.runTimers();

assert.equal(activeMatch.input.value, 'ALT456');
assert.equal(activeMatch.plateEditor.value, 'ALT456');
assert.equal(activeMatch.status.textContent, 'Found in Active: ALT456');

assert.equal(
    activeMatch.api.isEmptyEntriesText('Showing 0 to 0 of 0 entries'),
    true
);
assert.equal(activeMatch.api.isEmptyEntriesText('0 0'), true);
assert.equal(activeMatch.api.isEmptyEntriesText('0 0 (38)'), true);
assert.equal(
    activeMatch.api.isEntriesSummaryText('Showing 1 to 3 of 3 entries'),
    true
);
assert.equal(activeMatch.api.isEntriesSummaryText('1 1 69'), true);

console.log('PayManager parking handoff tests passed.');
