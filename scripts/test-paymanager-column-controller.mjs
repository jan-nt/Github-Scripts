import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const originalSource = await readFile(
    new URL('../PayManager Column Controller.user.js', import.meta.url),
    'utf8'
);

const scriptSource = originalSource
    .replace('const ELEMENT_WAIT_TIMEOUT_MS = 12_000;',
        'const ELEMENT_WAIT_TIMEOUT_MS = 1_000;')
    .replace('const ELEMENT_WAIT_INTERVAL_MS = 200;',
        'const ELEMENT_WAIT_INTERVAL_MS = 1;')
    .replace(
        /\n\s*startReplacementRecovery\(\);[\s\S]*?\n\}\)\(\);\s*$/,
        `
    window.__columnControllerTest = {
        closeColumnsPopup,
        findColumnsPopup,
        getColumnsButton,
        openColumnsPanel,
        popupHasConfiguredColumns,
        runColumnsController,
        startReplacementRecovery,
        toggleColumns,
        waitFor
    };
})();`
    );

assert.notEqual(scriptSource, originalSource, 'test harness injection failed');

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

class FakeColumnControl {
    constructor(columnClass, enabled) {
        this.columnClass = columnClass;
        this.classList = new FakeClassList(
            columnClass,
            ...(enabled ? ['toggled'] : [])
        );
        this.clickCount = 0;
    }

    click() {
        this.clickCount++;

        if (this.classList.contains('toggled')) {
            this.classList.remove('toggled');
        } else {
            this.classList.add('toggled');
        }
    }
}

function createScenario() {
    const observers = [];

    class FakeMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.connected = false;
            this.target = null;
            observers.push(this);
        }

        observe(target) {
            this.connected = true;
            this.target = target;
        }

        disconnect() {
            this.connected = false;
            this.target = null;
        }
    }

    const disabledControl = new FakeColumnControl('financial_terminal', true);
    const enabledControl = new FakeColumnControl('financial_chainid', false);
    const controls = new Map([
        ['financial_terminal', disabledControl],
        ['financial_chainid', enabledControl]
    ]);
    const popupScreen = {
        classList: new FakeClassList('in'),
        clickCount: 0,
        click() {
            this.clickCount++;
            this.classList.remove('in');
            popup.ariaHidden = 'true';
        }
    };
    const popup = {
        ariaHidden: 'false',
        querySelector(selector) {
            if (selector.startsWith('a.')) {
                return controls.get(selector.slice(2)) || null;
            }

            return null;
        },
        getAttribute(name) {
            return name === 'aria-hidden' ? this.ariaHidden : null;
        }
    };
    const button = {
        id: 'financial_column_toggle_btn',
        clickCount: 0,
        getAttribute() {
            return null;
        },
        click() {
            this.clickCount++;
            popup.ariaHidden = 'false';
            popupScreen.classList.add('in');
        }
    };
    let xpathResult = null;
    const elements = new Map([
        ['financial_column_toggle_btn', button],
        ['financial_column_toggle', popup],
        ['financial_column_toggle-screen', popupScreen]
    ]);
    const document = {
        body: {},
        getElementById(id) {
            return elements.get(id) || null;
        },
        querySelector(selector) {
            if (selector.startsWith('a.')) {
                return controls.get(selector.slice(2)) || null;
            }

            return null;
        },
        evaluate() {
            return { singleNodeValue: xpathResult };
        }
    };
    const window = {
        setTimeout,
        addEventListener() {}
    };
    const context = vm.createContext({
        clearTimeout,
        document,
        MutationObserver: FakeMutationObserver,
        Node: { ELEMENT_NODE: 1 },
        setTimeout,
        window,
        XPathResult: { FIRST_ORDERED_NODE_TYPE: 9 }
    });

    vm.runInContext(scriptSource, context);

    return {
        api: window.__columnControllerTest,
        button,
        controls,
        disabledControl,
        document,
        elements,
        enabledControl,
        popup,
        popupScreen,
        setXpathResult(value) {
            xpathResult = value;
        },
        triggerBodyMutation() {
            observers
                .filter(observer =>
                    observer.connected && observer.target === document.body
                )
                .forEach(observer => observer.callback([]));
        }
    };
}

const scenario = createScenario();

assert.equal(scenario.api.getColumnsButton(), scenario.button);
assert.equal(scenario.api.findColumnsPopup(), scenario.popup);
assert.equal(scenario.api.popupHasConfiguredColumns(scenario.popup), true);

await scenario.api.toggleColumns();

assert.equal(scenario.disabledControl.classList.contains('toggled'), false);
assert.equal(scenario.disabledControl.clickCount, 1);
assert.equal(scenario.enabledControl.classList.contains('toggled'), true);
assert.equal(scenario.enabledControl.clickCount, 1);

await scenario.api.toggleColumns();
assert.equal(scenario.disabledControl.clickCount, 1, 'second run must be idempotent');
assert.equal(scenario.enabledControl.clickCount, 1, 'second run must be idempotent');

scenario.api.closeColumnsPopup();
assert.equal(scenario.popupScreen.clickCount, 1);

const reopenedPopup = await scenario.api.openColumnsPanel();
assert.equal(reopenedPopup.popup, scenario.popup);
assert.equal(reopenedPopup.openedByController, true);
assert.equal(scenario.button.clickCount, 1);

scenario.elements.delete('financial_column_toggle_btn');
const verifiedFallbackButton = {
    click() {},
    getAttribute(name) {
        return name === 'href' ? '#financial_column_toggle' : null;
    }
};
scenario.setXpathResult(verifiedFallbackButton);
assert.equal(scenario.api.getColumnsButton(), verifiedFallbackButton);

const unverifiedFallbackButton = {
    click() {},
    getAttribute() {
        return null;
    }
};
scenario.setXpathResult(unverifiedFallbackButton);
assert.equal(scenario.api.getColumnsButton(), null);

scenario.elements.delete('financial_column_toggle');
scenario.controls.clear();
const unrelatedPopup = {
    querySelector() {
        return null;
    }
};
scenario.setXpathResult(unrelatedPopup);
assert.equal(
    scenario.api.findColumnsPopup(),
    null,
    'an unverified fallback popup must be rejected'
);

let delayedCalls = 0;
const delayedValue = await scenario.api.waitFor(() => {
    delayedCalls++;
    return delayedCalls >= 3 ? 'ready' : null;
});
assert.equal(delayedValue, 'ready');

const timedOutValue = await scenario.api.waitFor(() => null, 5);
assert.equal(timedOutValue, null);

const delayedScenario = createScenario();
delayedScenario.popup.ariaHidden = 'true';
delayedScenario.popupScreen.classList.remove('in');
delayedScenario.api.startReplacementRecovery();
delayedScenario.elements.set('right_container', { parentElement: null });
delayedScenario.triggerBodyMutation();
await new Promise(resolve => setTimeout(resolve, 500));
assert.equal(
    delayedScenario.disabledControl.classList.contains('toggled'),
    false,
    'discovering the delayed transaction root must schedule column enforcement'
);
assert.equal(delayedScenario.enabledControl.classList.contains('toggled'), true);
assert.equal(
    delayedScenario.button.clickCount,
    0,
    'delayed recovery must not visibly open the columns popup'
);
assert.equal(
    delayedScenario.popupScreen.clickCount,
    0,
    'delayed recovery must not need to close a popup it did not open'
);

const lateHiddenPopupScenario = createScenario();
lateHiddenPopupScenario.popup.ariaHidden = 'true';
lateHiddenPopupScenario.popupScreen.classList.remove('in');
lateHiddenPopupScenario.elements.delete('financial_column_toggle_btn');
lateHiddenPopupScenario.elements.delete('financial_column_toggle');

setTimeout(() => {
    lateHiddenPopupScenario.elements.set(
        'financial_column_toggle_btn',
        lateHiddenPopupScenario.button
    );
    lateHiddenPopupScenario.elements.set(
        'financial_column_toggle',
        lateHiddenPopupScenario.popup
    );
}, 5);

await lateHiddenPopupScenario.api.runColumnsController();
assert.equal(
    lateHiddenPopupScenario.button.clickCount,
    0,
    'a hidden popup that appears while waiting must be reused silently'
);
assert.equal(lateHiddenPopupScenario.popupScreen.clickCount, 0);
assert.equal(
    lateHiddenPopupScenario.enabledControl.classList.contains('toggled'),
    true
);

const lateOpenPopupScenario = createScenario();
lateOpenPopupScenario.elements.delete('financial_column_toggle_btn');
lateOpenPopupScenario.elements.delete('financial_column_toggle');

setTimeout(() => {
    lateOpenPopupScenario.elements.set(
        'financial_column_toggle_btn',
        lateOpenPopupScenario.button
    );
    lateOpenPopupScenario.elements.set(
        'financial_column_toggle',
        lateOpenPopupScenario.popup
    );
}, 5);

await lateOpenPopupScenario.api.runColumnsController();
assert.equal(lateOpenPopupScenario.button.clickCount, 0);
assert.equal(
    lateOpenPopupScenario.popupScreen.clickCount,
    0,
    'the controller must not close a popup that appeared already open'
);

const replacedOwnedPopupScenario = createScenario();
replacedOwnedPopupScenario.popup.ariaHidden = 'true';
replacedOwnedPopupScenario.popupScreen.classList.remove('in');
replacedOwnedPopupScenario.elements.delete('financial_column_toggle');
const replacementPopupScreen = {
    classList: new FakeClassList('in'),
    clickCount: 0,
    click() {
        this.clickCount++;
        this.classList.remove('in');
    }
};
const replacementPopup = {
    ariaHidden: 'false',
    querySelector(selector) {
        if (selector.startsWith('a.')) {
            return replacedOwnedPopupScenario.controls.get(
                selector.slice(2)
            ) || null;
        }

        return null;
    },
    getAttribute(name) {
        return name === 'aria-hidden' ? this.ariaHidden : null;
    }
};
const originalButtonClick =
    replacedOwnedPopupScenario.button.click.bind(
        replacedOwnedPopupScenario.button
    );

replacedOwnedPopupScenario.button.click = () => {
    originalButtonClick();
    replacedOwnedPopupScenario.elements.set(
        'financial_column_toggle',
        replacedOwnedPopupScenario.popup
    );

    setTimeout(() => {
        replacedOwnedPopupScenario.elements.set(
            'financial_column_toggle',
            replacementPopup
        );
        replacedOwnedPopupScenario.elements.set(
            'financial_column_toggle-screen',
            replacementPopupScreen
        );
    }, 10);
};

await replacedOwnedPopupScenario.api.runColumnsController();
assert.equal(replacedOwnedPopupScenario.button.clickCount, 1);
assert.equal(
    replacementPopupScreen.clickCount,
    0,
    'the controller must not close a replacement popup it did not open'
);

console.log('PayManager column controller tests passed.');
