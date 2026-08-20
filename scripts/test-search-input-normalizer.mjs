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

function createScenario(pathname, initialValue = '') {
    const listeners = new Map();
    let evaluatedXpath = '';

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

    const input = new FakeInput(initialValue);

    const document = {
        documentElement: {},
        addEventListener(type, listener) {
            const typeListeners = listeners.get(type) || [];
            typeListeners.push(listener);
            listeners.set(type, typeListeners);
        },
        evaluate(xpath) {
            evaluatedXpath = xpath;
            return { singleNodeValue: input };
        }
    };

    vm.runInNewContext(scriptSource, {
        document,
        location: { pathname },
        XPathResult: { FIRST_ORDERED_NODE_TYPE: 9 },
        HTMLInputElement: FakeInput
    });

    return {
        input,
        getEvaluatedXpath: () => evaluatedXpath,
        trigger(type, target = input, isTrusted = true) {
            for (const listener of listeners.get(type) || []) {
                listener({ target, isTrusted });
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
    transactionScenario.getEvaluatedXpath(),
    expectedXpaths['/transactions']
);

const parkingScenario = createScenario('/parking/');
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

console.log('PayManager search input normalization tests passed.');
