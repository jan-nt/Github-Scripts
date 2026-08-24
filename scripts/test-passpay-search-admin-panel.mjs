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
        handleNavigationChange,
        scheduleAutoRecoveryReload,
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

    const context = {
        URL,
        URLSearchParams,
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
        window: {
            setTimeout(callback) {
                const id = nextTimerId++;
                timers.set(id, callback);
                return id;
            }
        }
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

scenario.api.setLatestData(parsedWithCurrentDom);
scenario.location.href = 'https://betaling.passpay.no/search';
scenario.location.pathname = '/search';
scenario.api.handleNavigationChange();

assert.equal(scenario.api.getLatestData(), null);
assert.equal(scenario.wasPanelRemoved(), true);

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
