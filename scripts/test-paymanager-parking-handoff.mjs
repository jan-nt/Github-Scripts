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
        restartParkingSearch,
        getSavedManualPlate,
        isEmptyEntriesText,
        isEntriesSummaryText
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
    pendingApplyAfterDispatches = 1
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
    const dispatchedEvents = [];
    const statusClickTimes = [];

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

    class FakeInput {
        constructor() {
            this._value = '';
            this.focused = false;
        }

        get value() {
            return this._value;
        }

        set value(value) {
            this._value = String(value);
        }

        dispatchEvent(event) {
            dispatchedEvents.push({
                type: event.type,
                value: this.value,
                parkingStatus: currentStatus,
                at: clock
            });

            if (event.type === 'input') {
                if (!this.value) {
                    entriesInfo.textContent = currentInitialText();
                } else if (currentStatus === 'active') {
                    activePlateDispatches++;

                    if (activePlateDispatches >= activeApplyAfterDispatches) {
                        entriesInfo.textContent = currentFilteredText();
                    }
                } else {
                    pendingPlateDispatches++;

                    if (pendingPlateDispatches >= pendingApplyAfterDispatches) {
                        entriesInfo.textContent = currentFilteredText();
                    }
                }
            }

            return true;
        }

        focus() {
            this.focused = true;
        }
    }

    const input = new FakeInput();
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
            statusClickTimes.push({ status: 'pending', at: clock });
        }
    };
    const option = {
        value: 'manager-1',
        textContent: 'Example Manager'
    };
    const select = {
        value: option.value,
        options: [option],
        dispatchedEvents: [],
        dispatchEvent(event) {
            this.dispatchedEvents.push(event.type);
            return true;
        }
    };
    const status = { textContent: '', style: {} };
    const location = {
        pathname: '/parking',
        search: '',
        hash: '#tmAreaManager=Example%20Manager&tmLicensePlate=TEST123'
    };

    const document = {
        getElementById(id) {
            if (id === 'prs_select_user') return select;
            if (id === 'tm-prs-search-status') return status;
            if (id === 'tm-parking-license-plate-input') return plateEditor;
            if (id === 'parkings_active_btn') return activeButton;
            if (id === 'parkings_pending_btn') return pendingButton;
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

    vm.runInNewContext(testSource, context);

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
        getClock: () => clock,
        getCleanUrl: () => cleanUrl,
        getActiveClicks: () => activeClicks,
        getPendingClicks: () => pendingClicks,
        getActivePlateDispatches: () => activePlateDispatches,
        getPendingPlateDispatches: () => pendingPlateDispatches,
        getDispatchedEvents: () => dispatchedEvents,
        getStatusClickTimes: () => statusClickTimes,
        runTimers
    };
}

// A positive Active result must stop the flow without touching Pending.
const activeMatch = createHandoffScenario({
    activeApplyAfterDispatches: 2
});

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

// A stable zero Active result waits five seconds, then searches Pending.
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

// A table with no rows uses the five-second readiness fallback before Pending.
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
assert.ok(pendingClick.at >= 5000, 'Pending was selected before the table fallback');
assert.equal(emptyBoth.getActivePlateDispatches(), 0);
assert.equal(emptyBoth.getPendingPlateDispatches(), 0);
assert.equal(
    emptyBoth.status.textContent,
    'No active or Pending entries found for: TEST123'
);

// Changing the editable plate starts the same guarded search again.
assert.equal(activeMatch.api.restartParkingSearch(' alt-456 '), true);
activeMatch.runTimers();

assert.equal(activeMatch.input.value, 'ALT456');
assert.equal(activeMatch.plateEditor.value, 'ALT456');
assert.equal(activeMatch.api.getSavedManualPlate(), 'ALT456');
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
