import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
    new URL('../PassPay Search Admin Panel.user.js', import.meta.url),
    'utf8'
);
const startupMarker = '\n    migrateLegacyParkingData();';
const startupIndex = source.lastIndexOf(startupMarker);

assert.notEqual(startupIndex, -1, 'Could not isolate userscript startup');

const testSource = `${source.slice(0, startupIndex)}
    globalThis.__adminPanelTest = {
        buildParkingDataFromResponse,
        handleNavigationChange,
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
    const storage = new Map();
    const location = {
        href: 'https://betaling.passpay.no/parkings',
        pathname: '/parkings'
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
        evaluate() {
            return { singleNodeValue: visiblePlateElement };
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
        clearTimeout() {},
        setTimeout() {},
        window: { setTimeout() {} }
    };

    vm.runInNewContext(testSource, context);

    return {
        api: context.__adminPanelTest,
        location,
        setVisiblePlate(value) {
            visiblePlate = value;
        },
        wasPanelRemoved: () => removedPanel
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

console.log('PassPay search admin panel tests passed.');
