import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
    new URL('../PassPay Search Admin Panel.user.js', import.meta.url),
    'utf8'
);
const startupMarker = '\n    migrateLegacyParkingData();';
const startupIndex = source.lastIndexOf(startupMarker);
const visiblePlateXpath =
    '/html/body/div[1]/div/div/div/div/div[2]/div[1]/div/div[1]/div[1]/span[2]';

assert.notEqual(startupIndex, -1, 'Could not isolate userscript startup');

const testSource = `${source.slice(0, startupIndex)}
    globalThis.__adminPanelTest = {
        buildParkingDataFromResponse,
        createNetworkRequestContext,
        handleNavigationChange,
        hookFetch,
        hookXMLHttpRequest,
        isParkingSearchWorkflowPage,
        processResponse,
        getStoredData,
        scheduleAutoRecoveryReload,
        shouldInspectNetworkResponse,
        setLatestData(value) {
            latestData = value;
        },
        getLatestData() {
            return latestData;
        }
    };
})();`;

function createScenario() {
    let visiblePlate = 'OLD123';
    let removedPanel = false;
    let reloadCount = 0;
    let nextTimerId = 1;
    let pendingFetchResolve = null;
    const storage = new Map();
    const timers = new Map();
    const location = {
        href: 'https://betaling.passpay.no/parkings',
        pathname: '/parkings',
        search: '',
        hash: '',
        reload() {
            reloadCount++;
        }
    };
    const panel = {
        remove() {
            removedPanel = true;
        }
    };
    const visiblePlateElement = {
        get textContent() {
            return visiblePlate;
        }
    };

    const document = {
        getElementById(id) {
            return id === 'tm-parking-info' ? panel : null;
        },
        evaluate(xpath) {
            return {
                singleNodeValue:
                    xpath === visiblePlateXpath ? visiblePlateElement : null
            };
        }
    };

    const window = {
        fetch() {
            return new Promise(resolve => {
                pendingFetchResolve = resolve;
            });
        },
        setTimeout(callback) {
            const id = nextTimerId++;
            timers.set(id, callback);
            return id;
        }
    };

    class FakeXMLHttpRequest {
        constructor() {
            this.listeners = new Map();
            this.responseText = '';
            this.status = 200;
            this.contentType = 'application/json';
        }

        addEventListener(type, listener) {
            this.listeners.set(type, listener);
        }

        open() {}

        send() {}

        getResponseHeader(name) {
            return name.toLowerCase() === 'content-type'
                ? this.contentType
                : null;
        }

        complete(text) {
            this.responseText = text;
            this.listeners.get('load')?.call(this);
        }
    }

    const context = {
        URL,
        URLSearchParams,
        XMLHttpRequest: FakeXMLHttpRequest,
        XPathResult: { FIRST_ORDERED_NODE_TYPE: 9 },
        document,
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
        clearInterval() {},
        clearTimeout(id) {
            timers.delete(id);
        },
        setTimeout() {},
        window
    };

    vm.runInNewContext(testSource, context);

    return {
        api: context.__adminPanelTest,
        location,
        setVisiblePlate(value) {
            visiblePlate = value;
        },
        wasPanelRemoved: () => removedPanel,
        getReloadCount: () => reloadCount,
        async captureFetchAcrossNavigation(data) {
            context.__adminPanelTest.hookFetch();
            location.href = 'https://betaling.passpay.no/search';
            location.pathname = '/search';

            const request = window.fetch('/parking-search');

            location.href = 'https://betaling.passpay.no/parkings';
            location.pathname = '/parkings';

            pendingFetchResolve({
                clone() {
                    return {
                        text: async () => JSON.stringify(data)
                    };
                }
            });

            await request;
            await Promise.resolve();
            await Promise.resolve();
        },
        captureXhrAcrossNavigation(data) {
            context.__adminPanelTest.hookXMLHttpRequest();
            location.href = 'https://betaling.passpay.no/search';
            location.pathname = '/search';

            const request = new FakeXMLHttpRequest();
            request.open('GET', '/parking-search');

            location.href = 'https://betaling.passpay.no/parkings';
            location.pathname = '/parkings';
            request.complete(JSON.stringify(data));
        },
        runTimers() {
            while (timers.size > 0) {
                const [id, callback] = timers.entries().next().value;
                timers.delete(id);
                callback();
            }
        }
    };
}

const scenario = createScenario();
const newResponse = {
    locations: [
        {
            location: 'Example location',
            parkings: [
                {
                    parkingRightID: 'right-1',
                    areaManager: 'Example manager',
                    chainID: 'chain-1',
                    licensePlate: 'NEW456',
                    start: '2026-01-01T00:00:00Z',
                    end: '2026-01-01T01:00:00Z'
                }
            ]
        }
    ]
};

const parsedWithStaleDom =
    scenario.api.buildParkingDataFromResponse(newResponse);

assert.equal(parsedWithStaleDom.licensePlate, 'NEW456');
assert.equal(parsedWithStaleDom.parkings.length, 1);
assert.equal(parsedWithStaleDom.parkings[0].licensePlate, 'NEW456');

scenario.setVisiblePlate('NEW456');
const parsedWithCurrentDom =
    scenario.api.buildParkingDataFromResponse(newResponse);

assert.equal(parsedWithCurrentDom.licensePlate, 'NEW456');

const multiPlateResponse = {
    locations: [
        {
            location: 'Example location',
            parkings: [
                newResponse.locations[0].parkings[0],
                {
                    ...newResponse.locations[0].parkings[0],
                    parkingRightID: 'right-2',
                    licensePlate: 'OLD123'
                }
            ]
        }
    ]
};
const parsedWithRequestCorrelation =
    scenario.api.buildParkingDataFromResponse(
        multiPlateResponse,
        { requestedPlate: 'NEW456' }
    );

assert.equal(parsedWithRequestCorrelation.licensePlate, 'NEW456');
assert.equal(parsedWithRequestCorrelation.parkings.length, 1);

const responseWithUnrelatedParkingShape = {
    ...newResponse,
    diagnostics: {
        parkings: [
            {
                parkingRightID: 'unrelated-right',
                chainID: 'unrelated-chain',
                licensePlate: 'WRONG999',
                start: '2026-01-01T00:00:00Z'
            }
        ]
    }
};
const parsedFromRecognizedLocationsOnly =
    scenario.api.buildParkingDataFromResponse(
        responseWithUnrelatedParkingShape
    );

assert.equal(parsedFromRecognizedLocationsOnly.licensePlate, 'NEW456');
assert.equal(parsedFromRecognizedLocationsOnly.parkings.length, 1);

scenario.api.setLatestData(parsedWithCurrentDom);
scenario.location.href = 'https://betaling.passpay.no/search';
scenario.location.pathname = '/search';
scenario.api.handleNavigationChange();

assert.equal(scenario.api.getLatestData(), null);
assert.equal(scenario.wasPanelRemoved(), true);

assert.equal(scenario.api.isParkingSearchWorkflowPage(), true);
assert.equal(scenario.api.shouldInspectNetworkResponse(false), false);
assert.equal(scenario.api.shouldInspectNetworkResponse(true), true);
assert.equal(
    scenario.api.shouldInspectNetworkResponse(
        true,
        500,
        'application/json'
    ),
    false
);
assert.equal(
    scenario.api.shouldInspectNetworkResponse(
        true,
        200,
        'text/html'
    ),
    false
);
assert.equal(
    scenario.api.shouldInspectNetworkResponse(
        true,
        200,
        'application/problem+json'
    ),
    true
);

scenario.location.href = 'https://betaling.passpay.no/administration';
scenario.location.pathname = '/administration';

assert.equal(scenario.api.isParkingSearchWorkflowPage(), false);
assert.equal(scenario.api.shouldInspectNetworkResponse(false), false);
assert.equal(scenario.api.shouldInspectNetworkResponse(true), false);

const captureScenario = createScenario();
await captureScenario.captureFetchAcrossNavigation(newResponse);

assert.equal(
    captureScenario.api.getLatestData().licensePlate,
    'NEW456'
);

const xhrCaptureScenario = createScenario();
xhrCaptureScenario.captureXhrAcrossNavigation(newResponse);

assert.equal(
    xhrCaptureScenario.api.getLatestData().licensePlate,
    'NEW456'
);

const orderedScenario = createScenario();
orderedScenario.location.href = 'https://betaling.passpay.no/search';
orderedScenario.location.pathname = '/search';

const olderContext = orderedScenario.api.createNetworkRequestContext(
    '/parking-search?licensePlate=OLD123'
);
const newerContext = orderedScenario.api.createNetworkRequestContext(
    '/parking-search?licensePlate=NEW456'
);

assert.equal(
    orderedScenario.api.processResponse(
        JSON.stringify(newResponse),
        newerContext
    ),
    true
);
assert.equal(
    orderedScenario.api.processResponse(
        JSON.stringify({
            locations: [
                {
                    location: 'Old location',
                    parkings: [
                        {
                            ...newResponse.locations[0].parkings[0],
                            parkingRightID: 'old-right',
                            licensePlate: 'OLD123'
                        }
                    ]
                }
            ]
        }),
        olderContext
    ),
    false
);
assert.equal(orderedScenario.api.getLatestData().licensePlate, 'NEW456');

const emptyContext = orderedScenario.api.createNetworkRequestContext(
    '/parking-search?licensePlate=EMPTY789'
);

assert.equal(
    orderedScenario.api.processResponse(
        JSON.stringify({
            locations: [
                {
                    location: 'Empty location',
                    parkings: []
                }
            ]
        }),
        emptyContext
    ),
    true
);
assert.equal(orderedScenario.api.getLatestData().licensePlate, 'EMPTY789');
assert.deepEqual(
    Array.from(orderedScenario.api.getLatestData().parkings),
    []
);
assert.equal(orderedScenario.api.getStoredData().licensePlate, 'EMPTY789');
assert.deepEqual(
    Array.from(orderedScenario.api.getStoredData().parkings),
    []
);

const latestBeforeUnrelated = orderedScenario.api.getLatestData();
const unrelatedContext = orderedScenario.api.createNetworkRequestContext(
    '/unrelated-locations'
);

assert.equal(
    orderedScenario.api.processResponse(
        JSON.stringify({ locations: [{ name: 'Not parking data' }] }),
        unrelatedContext
    ),
    false
);
assert.equal(orderedScenario.api.getLatestData(), latestBeforeUnrelated);

const unrelatedEmptyContext = orderedScenario.api.createNetworkRequestContext(
    '/unrelated-empty-locations'
);

assert.equal(
    orderedScenario.api.processResponse(
        JSON.stringify({ locations: [] }),
        unrelatedEmptyContext
    ),
    false
);
assert.equal(orderedScenario.api.getLatestData(), latestBeforeUnrelated);

const recoveryScenario = createScenario();

assert.equal(
    recoveryScenario.api.scheduleAutoRecoveryReload(),
    'scheduled'
);
recoveryScenario.runTimers();
assert.equal(recoveryScenario.getReloadCount(), 1);

assert.equal(
    recoveryScenario.api.scheduleAutoRecoveryReload(),
    'exhausted'
);
recoveryScenario.runTimers();
assert.equal(recoveryScenario.getReloadCount(), 1);

console.log('PassPay search admin panel tests passed.');
