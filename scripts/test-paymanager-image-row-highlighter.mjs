import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const originalSource = await readFile(
    new URL('../PayManager Image Row Highlighter.user.js', import.meta.url),
    'utf8'
);
const scriptSource = originalSource.replace(
    /\n\s*startRuntime\(\);\s*\n\s*\}\)\(\);\s*$/,
    `
    window.__imageHighlighterTest = {
        applyImageHighlight,
        rowHasEventCameraImage,
        scanAllRows,
        scheduleScan,
        startRuntime,
        state
    };

    startRuntime();
})();`
);

assert.match(scriptSource, /__imageHighlighterTest/);

class FakeClassList {
    constructor(...classes) {
        this.classes = new Set(classes);
    }

    add(value) {
        this.classes.add(value);
    }

    remove(value) {
        this.classes.delete(value);
    }

    contains(value) {
        return this.classes.has(value);
    }
}

function createRow(cellTexts) {
    return {
        cells: cellTexts.map(textContent => ({ textContent })),
        classList: new FakeClassList()
    };
}

const matchingRow = createRow(['Event', 'Camera', 'Image']);
const nonMatchingRow = createRow(['Event', 'Vehicle', 'Image']);
const nestedContentWrapperRow = createRow(['Event Camera Image']);
const tableBody = { rows: [matchingRow, nonMatchingRow] };
const table = { tBodies: [tableBody] };
const root = {
    matches() {
        return false;
    },
    querySelectorAll(selector) {
        return selector === 'table' ? [table] : [];
    }
};
const styles = new Map();
const documentListeners = new Map();
const windowListeners = new Map();
const observers = [];

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.disconnectCount = 0;
        this.observedTargets = [];
        observers.push(this);
    }

    observe(target, options) {
        this.observedTargets.push({ target, options });
    }

    disconnect() {
        this.disconnectCount++;
    }
}

const document = {
    body: {},
    documentElement: {
        appendChild(element) {
            styles.set(element.id, element);
        }
    },
    head: {
        appendChild(element) {
            styles.set(element.id, element);
        }
    },
    addEventListener(type, listener) {
        const listeners = documentListeners.get(type) || [];
        listeners.push(listener);
        documentListeners.set(type, listeners);
    },
    removeEventListener(type, listener) {
        const listeners = documentListeners.get(type) || [];
        documentListeners.set(
            type,
            listeners.filter(candidate => candidate !== listener)
        );
    },
    createElement(tagName) {
        return { id: '', tagName, textContent: '' };
    },
    getElementById(id) {
        if (id === 'right_container') return root;
        return styles.get(id) || null;
    }
};
const window = {
    addEventListener(type, listener) {
        const listeners = windowListeners.get(type) || [];
        listeners.push(listener);
        windowListeners.set(type, listeners);
    },
    setTimeout
};
const context = vm.createContext({
    clearTimeout,
    document,
    MutationObserver: FakeMutationObserver,
    setTimeout,
    window
});

vm.runInContext(scriptSource, context);

const api = window.__imageHighlighterTest;

assert.equal(api.rowHasEventCameraImage(matchingRow), true);
assert.equal(api.rowHasEventCameraImage(nonMatchingRow), false);
assert.equal(
    api.rowHasEventCameraImage(nestedContentWrapperRow),
    false,
    'nested descendant text must not make a one-cell wrapper row match'
);

api.scanAllRows();
assert.equal(
    matchingRow.classList.contains('tm-paymanager-image-highlight'),
    true
);
assert.equal(
    nonMatchingRow.classList.contains('tm-paymanager-image-highlight'),
    false
);

matchingRow.cells = createRow(['Event', 'Vehicle', 'Image']).cells;
api.applyImageHighlight(matchingRow);
assert.equal(
    matchingRow.classList.contains('tm-paymanager-image-highlight'),
    false,
    'recycled nonmatching rows must lose the highlight'
);

const insertedRow = createRow(['Event', 'Camera', 'Image']);
tableBody.rows.push(insertedRow);
assert.equal(observers.length, 1);
observers[0].callback([{ addedNodes: [insertedRow] }]);
await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(
    insertedRow.classList.contains('tm-paymanager-image-highlight'),
    true,
    'a mutation must schedule a scan of newly inserted rows'
);

const styleCount = styles.size;
const clickListenerCount = (documentListeners.get('click') || []).length;
vm.runInContext(scriptSource, context);
assert.equal(styles.size, styleCount, 'duplicate execution must not add a style');
assert.equal(
    (documentListeners.get('click') || []).length,
    clickListenerCount,
    'duplicate execution must not add a click handler'
);
assert.equal(observers.length, 1, 'duplicate execution must not add an observer');

for (const listener of windowListeners.get('pagehide') || []) {
    listener({ persisted: false });
}

assert.equal(observers[0].disconnectCount, 1);
assert.equal((documentListeners.get('click') || []).length, 0);

console.log('PayManager image row highlighter tests passed.');
