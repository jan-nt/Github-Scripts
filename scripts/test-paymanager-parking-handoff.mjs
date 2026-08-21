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

function createHandoffScenario(initialStatus = 'active') {
    let clock = 0;
    let cleanUrl = '';
    let activeClicks = 0;
    let pendingClicks = 0;
    const timers = [];
    const storage = new Map();
    const dispatchedEvents = [];

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
            dispatchedEvents.push(event.type);
            return true;
        }

        focus() {
            this.focused = true;
        }
    }

    const input = new FakeInput();
    const entriesInfo = {
        textContent: ' 0 0 (38)'
    };
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
            activeClasses.add('active_tab');
            pendingClasses.delete('active_tab');
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
            pendingClasses.add('active_tab');
            activeClasses.delete('active_tab');
            entriesInfo.textContent = ' 1 1 (38)';
        }
    };
    const option = {
        value: 'manager-1',
        textContent: 'Tindevegen'
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
        hash: '#tmAreaManager=Tindevegen&tmLicensePlate=EV67016'
    };

    const document = {
        getElementById(id) {
            if (id === 'prs_select_user') return select;
            if (id === 'tm-prs-search-status') return status;
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
                timers.push({ callback, delay });
                return timers.length;
            }
        }
    };

    vm.runInNewContext(testSource, context);

    function runTimers(maximumCallbacks = 100) {
        let callbacks = 0;

        while (timers.length > 0 && callbacks < maximumCallbacks) {
            const timer = timers.shift();
            clock += timer.delay;
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
        select,
        status,
        getCleanUrl: () => cleanUrl,
        getActiveClicks: () => activeClicks,
        getPendingClicks: () => pendingClicks,
        getDispatchedEvents: () => dispatchedEvents,
        runTimers
    };
}

const scenario = createHandoffScenario();

assert.equal(scenario.api.applyRequestedHandoff(), true);
scenario.runTimers();

assert.equal(scenario.input.value, 'EV67016');
assert.equal(scenario.input.focused, true);
assert.equal(scenario.getActiveClicks(), 0);
assert.equal(scenario.getPendingClicks(), 1);
assert.deepEqual(scenario.select.dispatchedEvents, []);
assert.deepEqual(scenario.getDispatchedEvents(), [
    'input',
    'keyup',
    'search',
    'change',
    'input',
    'keyup',
    'search',
    'change'
]);
assert.equal(scenario.getCleanUrl(), '/parking');
assert.equal(scenario.status.textContent, 'Ready: EV67016');

const pendingFirstScenario = createHandoffScenario('pending');

assert.equal(pendingFirstScenario.api.applyRequestedHandoff(), true);
pendingFirstScenario.runTimers();

assert.equal(pendingFirstScenario.getActiveClicks(), 1);
assert.equal(pendingFirstScenario.getPendingClicks(), 1);
assert.equal(pendingFirstScenario.input.value, 'EV67016');
assert.equal(pendingFirstScenario.status.textContent, 'Ready: EV67016');

assert.equal(
    scenario.api.isEmptyEntriesText('Showing 0 to 0 of 0 entries'),
    true
);
assert.equal(scenario.api.isEmptyEntriesText('0 0'), true);
assert.equal(scenario.api.isEmptyEntriesText('0 0 (38)'), true);
assert.equal(
    scenario.api.isEntriesSummaryText('Showing 1 to 3 of 3 entries'),
    true
);
assert.equal(scenario.api.isEntriesSummaryText('1 1'), true);

console.log('PayManager parking handoff tests passed.');
