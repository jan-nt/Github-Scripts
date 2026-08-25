import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scriptSource = await readFile(
    new URL('../PayManager Search Input Normalizer.user.js', import.meta.url),
    'utf8'
);

const expectedXpaths = {
    '/transactions':
        '/html/body/div[2]/div[2]/div/div[3]/div[5]/div[3]/div[3]/label/input',
    '/parking':
        '/html/body/div[2]/div[2]/div/div[4]/div[2]/div/div[4]/label/form/input'
};

const expectedSelectors = {
    '/transactions': '#financial_table_filter input[type="search"]',
    '/parking': '#parkings_table_filter input[type="search"]'
};

function createScenario(
    pathname,
    initialValue = '',
    { useStableSelector = true } = {}
) {
    const listeners = new Map();
    let evaluatedXpath = '';
    let evaluatedSelector = '';

    class FakeInput {
        constructor(value) {
            this.value = value;
            this.selectionStart = value.length;
            this.selectionEnd = value.length;
        }

        setSelectionRange(start, end) {
            this.selectionStart = start;
            this.selectionEnd = end;
        }
    }

    let activeInput = new FakeInput(initialValue);

    const document = {
        documentElement: {},
        addEventListener(type, listener) {
            const typeListeners = listeners.get(type) || [];
            typeListeners.push(listener);
            listeners.set(type, typeListeners);
        },
        querySelector(selector) {
            evaluatedSelector = selector;
            return useStableSelector ? activeInput : null;
        },
        evaluate(xpath) {
            evaluatedXpath = xpath;
            return { singleNodeValue: activeInput };
        }
    };

    const window = {};
    const context = vm.createContext({
        document,
        window,
        location: { pathname },
        XPathResult: { FIRST_ORDERED_NODE_TYPE: 9 },
        HTMLInputElement: FakeInput
    });

    vm.runInContext(scriptSource, context);

    return {
        get input() {
            return activeInput;
        },
        getEvaluatedXpath: () => evaluatedXpath,
        getEvaluatedSelector: () => evaluatedSelector,
        listenerCount(type) {
            return (listeners.get(type) || []).length;
        },
        replaceInput(value = '') {
            activeInput = new FakeInput(value);
            return activeInput;
        },
        rerun() {
            vm.runInContext(scriptSource, context);
        },
        trigger(
            type,
            target = activeInput,
            isTrusted = true,
            isComposing = false
        ) {
            for (const listener of listeners.get(type) || []) {
                listener({ target, isTrusted, isComposing });
            }
        }
    };
}

const transactionScenario = createScenario('/transactions');
transactionScenario.input.value = 'uf 12 345';
transactionScenario.input.selectionStart = 9;
transactionScenario.input.selectionEnd = 9;
transactionScenario.trigger('input');

assert.equal(transactionScenario.input.value, 'uf12345');
assert.equal(transactionScenario.input.selectionStart, 7);
assert.equal(
    transactionScenario.getEvaluatedSelector(),
    expectedSelectors['/transactions']
);
assert.equal(transactionScenario.getEvaluatedXpath(), '');

const parkingScenario = createScenario(
    '/parking/',
    '',
    { useStableSelector: false }
);
parkingScenario.input.value = 'AeS-123\u2013123';
parkingScenario.input.selectionStart = 11;
parkingScenario.input.selectionEnd = 11;
parkingScenario.trigger('input');

assert.equal(parkingScenario.input.value, 'AeS123123');
assert.equal(parkingScenario.input.selectionStart, 9);
assert.equal(
    parkingScenario.getEvaluatedXpath(),
    expectedXpaths['/parking']
);
assert.equal(
    parkingScenario.getEvaluatedSelector(),
    expectedSelectors['/parking']
);

parkingScenario.input.value = 'XY\u00A0\u2212 9';
parkingScenario.input.selectionStart = 6;
parkingScenario.input.selectionEnd = 6;
parkingScenario.trigger('change');

assert.equal(parkingScenario.input.value, 'XY9');
assert.equal(parkingScenario.input.selectionStart, 3);

const unrelatedInput = { value: 'keep - this' };
parkingScenario.trigger('input', unrelatedInput);
assert.equal(unrelatedInput.value, 'keep - this');

parkingScenario.input.value = 'keep - synthetic';
parkingScenario.trigger('input', parkingScenario.input, false);
assert.equal(parkingScenario.input.value, 'keep - synthetic');

const replacementScenario = createScenario('/transactions');
const replacementInput = replacementScenario.replaceInput('ZX 12-34');
replacementInput.selectionStart = replacementInput.value.length;
replacementInput.selectionEnd = replacementInput.value.length;
replacementScenario.trigger('input');
assert.equal(replacementInput.value, 'ZX1234');
assert.equal(replacementInput.selectionStart, 6);

const compositionScenario = createScenario('/parking');
compositionScenario.input.value = 'AB - 12';
compositionScenario.trigger('compositionstart');
compositionScenario.trigger('input', compositionScenario.input, true, true);
assert.equal(compositionScenario.input.value, 'AB - 12');
compositionScenario.trigger('compositionend');
assert.equal(compositionScenario.input.value, 'AB12');

const duplicateScenario = createScenario('/transactions');
const originalInputListeners = duplicateScenario.listenerCount('input');
duplicateScenario.rerun();
assert.equal(duplicateScenario.listenerCount('input'), originalInputListeners);
assert.equal(duplicateScenario.listenerCount('compositionstart'), 1);
assert.equal(duplicateScenario.listenerCount('compositionend'), 1);

const unsupportedScenario = createScenario('/unrelated');
unsupportedScenario.input.value = 'keep - value';
unsupportedScenario.trigger('input');
assert.equal(unsupportedScenario.input.value, 'keep - value');
assert.equal(unsupportedScenario.getEvaluatedSelector(), '');
assert.equal(unsupportedScenario.getEvaluatedXpath(), '');

console.log('PayManager search input normalization tests passed.');
