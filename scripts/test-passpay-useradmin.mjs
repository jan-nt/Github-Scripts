import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scriptSource = await readFile(
    new URL('../PassPay UserAdmin.user.js', import.meta.url),
    'utf8'
);

const startupIndex = scriptSource.lastIndexOf('\n    hookNavigation();');
assert.notEqual(startupIndex, -1);

const isolatedSource = `${scriptSource.slice(0, startupIndex)}
    window.__passPayUserAdminTest = {
        addRemoveSpacesButton,
        addSmartSpaceRemoval,
        findAdministrationSearchInput,
        handleRemoveSpacesClick,
        injectStyles,
        getPaymentIdFromHref,
        isPortalRefundActionLabel,
        isPaymentHistoryPage,
        isRefundableStatus,
        isRefundedStatus,
        isValidRefundQueue,
        linkifyElement,
        normalizeSearchValue,
        removeSearchButton,
        ensureObserver,
        queuePendingRoot,
        runPendingWork,
        pendingRootCount: () => pendingRoots.size,
        observerIsActive: () => Boolean(observer)
    };
})();
`;

class FakeEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.bubbles = Boolean(options.bubbles);
    }
}

class FakeElement {
    constructor(tagName, textContent = '') {
        this.tagName = tagName.toUpperCase();
        this.nodeType = 1;
        this._textContent = textContent;
        this.children = [];
        this.dataset = {};
        this.attributes = new Map();
        this.className = '';
        this.classList = {
            add: (...tokens) => {
                const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                tokens.forEach(token => classes.add(token));
                this.className = Array.from(classes).join(' ');
            },
            remove: (...tokens) => {
                const removed = new Set(tokens);
                this.className = this.className
                    .split(/\s+/)
                    .filter(token => token && !removed.has(token))
                    .join(' ');
            },
            contains: token => this.className
                .split(/\s+/)
                .includes(token)
        };
        this.id = '';
        this.parentNode = null;
        this.previousElementSibling = null;
        this.listeners = new Map();
    }

    get textContent() {
        return this.children.length
            ? this.children.map(child => child.textContent).join('')
            : this._textContent;
    }

    set textContent(value) {
        for (const child of this.children) child.parentNode = null;
        this.children = [];
        this._textContent = String(value);
    }

    get childElementCount() {
        return this.children.length;
    }

    get firstElementChild() {
        return this.children[0] || null;
    }

    get nextSibling() {
        if (!this.parentNode?.children) return null;
        const index = this.parentNode.children.indexOf(this);
        return this.parentNode.children[index + 1] || null;
    }

    set href(value) {
        this.attributes.set('href', String(value));
    }

    get href() {
        return this.attributes.get('href') || '';
    }

    set rel(value) {
        this.attributes.set('rel', String(value));
    }

    get rel() {
        return this.attributes.get('rel') || '';
    }

    set target(value) {
        this.attributes.set('target', String(value));
    }

    get target() {
        return this.attributes.get('target') || '';
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatchEvent(event) {
        for (const listener of this.listeners.get(event.type) || []) {
            listener(event);
        }
        return true;
    }

    click() {
        this.dispatchEvent(new FakeEvent('click'));
    }

    matches(selector) {
        if (selector === 'p, span') {
            return this.tagName === 'P' || this.tagName === 'SPAN';
        }

        if (selector === 'a[data-pp-useradmin-link]') {
            return (
                this.tagName === 'A' &&
                this.getAttribute('data-pp-useradmin-link') !== null
            );
        }

        return selector.toLowerCase() === this.tagName.toLowerCase();
    }

    closest(selector) {
        if (selector === '.MuiFormControl-root') {
            return this.formControl || null;
        }

        const interactiveTags = new Set([
            'A',
            'BUTTON',
            'INPUT',
            'TEXTAREA',
            'SELECT'
        ]);

        let current = this;
        while (current) {
            if (interactiveTags.has(current.tagName)) return current;
            if (
                selector.includes('[contenteditable="true"]') &&
                current.getAttribute?.('contenteditable') === 'true'
            ) {
                return current;
            }
            current = current.parentNode;
        }

        return null;
    }

    querySelector(selector) {
        if (selector === 'input') {
            return this.children.find(child => child.tagName === 'INPUT') || null;
        }

        if (
            selector.includes('a') ||
            selector.includes('button') ||
            selector.includes('input')
        ) {
            return this.children.find(child =>
                ['A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(
                    child.tagName
                )
            ) || null;
        }

        return null;
    }

    querySelectorAll(selector) {
        const matches = [];

        function visit(element) {
            for (const child of element.children || []) {
                if (
                    selector === 'p, span' &&
                    (child.tagName === 'P' || child.tagName === 'SPAN')
                ) {
                    matches.push(child);
                }

                visit(child);
            }
        }

        visit(this);
        return matches;
    }

    contains(element) {
        if (element === this) return true;
        return this.children.some(child => child.contains?.(element));
    }

    replaceChildren(...children) {
        this.children = children;
        this._textContent = '';
        for (const child of children) child.parentNode = this;
    }

    remove() {
        if (!this.parentNode?.children) return;
        const index = this.parentNode.children.indexOf(this);
        if (index >= 0) this.parentNode.children.splice(index, 1);
        this.parentNode = null;
    }
}

class FakeInput extends FakeElement {
    constructor(value = '') {
        super('input');
        this._value = value;
        this.type = 'text';
        this.isConnected = true;
        this.disabled = false;
        this.hidden = false;
        this.focused = false;
    }

    get value() {
        return this._value;
    }

    set value(value) {
        this._value = String(value);
    }

    focus() {
        this.focused = true;
    }
}

class FakeParent extends FakeElement {
    constructor(...children) {
        super('div');
        this.children = children;
        this.relink();
    }

    relink() {
        this.children.forEach((child, index) => {
            child.parentNode = this;
            child.previousElementSibling = this.children[index - 1] || null;
        });
    }

    insertBefore(node, referenceNode) {
        if (node.parentNode?.children) {
            const currentIndex = node.parentNode.children.indexOf(node);
            if (currentIndex >= 0) node.parentNode.children.splice(currentIndex, 1);
        }

        const referenceIndex = this.children.indexOf(referenceNode);
        const insertIndex = referenceIndex >= 0
            ? referenceIndex
            : this.children.length;
        this.children.splice(insertIndex, 0, node);
        this.relink();
        return node;
    }

    appendChild(node) {
        return this.insertBefore(node, null);
    }
}

function createScenario() {
    const labels = [];
    const fallbackInputs = [];
    const createdElements = [];
    const head = new FakeParent();
    let searchInputById = null;

    const body = new FakeElement('body');
    const mutationObservers = [];

    class FakeMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.connected = false;
            mutationObservers.push(this);
        }

        observe() {
            this.connected = true;
        }

        disconnect() {
            this.connected = false;
        }
    }

    const document = {
        body,
        head,
        querySelectorAll(selector) {
            if (selector === 'label') return labels;
            if (selector === 'input[aria-label]') {
                return fallbackInputs.filter(
                    input => input.getAttribute('aria-label') !== null
                );
            }
            if (selector === '.MuiTextField-root input') {
                return fallbackInputs;
            }
            if (selector === 'a[data-pp-useradmin-link]') {
                return createdElements.filter(element =>
                    element.parentNode &&
                    element.matches('a[data-pp-useradmin-link]')
                );
            }
            return [];
        },
        getElementById(id) {
            if (searchInputById?.id === id) return searchInputById;
            return createdElements.find(element => element.id === id) || null;
        },
        createElement(tagName) {
            const element = new FakeElement(tagName);
            createdElements.push(element);
            return element;
        }
    };

    const window = {
        getComputedStyle: () => ({
            display: 'block',
            visibility: 'visible'
        }),
        setTimeout(callback) {
            callback();
            return 1;
        }
    };

    const context = vm.createContext({
        Event: FakeEvent,
        HTMLInputElement: FakeInput,
        Map,
        MutationObserver: FakeMutationObserver,
        Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
        Set,
        document,
        encodeURIComponent,
        location: {
            hostname: 'betaling.passpay.no',
            pathname: '/administration',
            search: ''
        },
        requestAnimationFrame: callback => callback(),
        URL,
        URLSearchParams,
        window
    });

    vm.runInContext(isolatedSource, context);

    return {
        api: window.__passPayUserAdminTest,
        context,
        createdElements,
        document,
        fallbackInputs,
        labels,
        location: context.location,
        setInputById(input) {
            searchInputById = input;
        }
    };
}

function makeLabel(text, input) {
    const label = new FakeElement('label', text);
    label.control = input;
    return label;
}

const scenario = createScenario();
const { api } = scenario;
const formattedPhone = ['123', '45', '678'].join(' ');
const formattedPlate = ['AB', '12345'].join(' ');

assert.equal(api.normalizeSearchValue(formattedPhone), '12345678');
assert.equal(api.normalizeSearchValue(formattedPlate), 'AB12345');
assert.equal(api.normalizeSearchValue('keep - value'), 'keep - value');

scenario.location.pathname = '/administration/42';
scenario.location.search = '?tab=3&nestedTab=1';
assert.equal(api.isPaymentHistoryPage(), true);
scenario.location.pathname = '/administration/dynamic-user-id/';
scenario.location.search = '?nestedTab=1&extra=kept&tab=3';
assert.equal(api.isPaymentHistoryPage(), true);
scenario.location.search = '?tab=3&nestedTab=2';
assert.equal(api.isPaymentHistoryPage(), false);
scenario.location.pathname = '/administration';
scenario.location.search = '?tab=3&nestedTab=1';
assert.equal(api.isPaymentHistoryPage(), false);
scenario.location.pathname = '/administration';
scenario.location.search = '';

assert.equal(api.isRefundableStatus(' Betalt '), true);
assert.equal(api.isRefundableStatus('Paid'), true);
assert.equal(api.isRefundableStatus('Refundert'), false);
assert.equal(api.isRefundedStatus('Refundert'), true);
assert.equal(api.isRefundedStatus('refunded'), true);
assert.equal(api.isPortalRefundActionLabel('Refunder'), true);
assert.equal(api.isPortalRefundActionLabel('Refund'), true);
assert.equal(api.isPortalRefundActionLabel('Refunder 95,00 NOK'), true);
assert.equal(api.isPortalRefundActionLabel('Refund 95.00 NOK'), true);
assert.equal(api.isPortalRefundActionLabel('Refundert'), false);
assert.equal(api.isPortalRefundActionLabel('Refund history'), false);

const examplePaymentId = 'a'.repeat(32);
assert.equal(
    api.getPaymentIdFromHref(
        `https://portal.dibspayment.eu/portal-frontend/payments?` +
        `searchKey=PAYMENT_ID&searchValue=${examplePaymentId}`
    ),
    examplePaymentId
);
assert.equal(
    api.getPaymentIdFromHref(
        `https://portal.dibspayment.eu/portal-frontend/payments/${examplePaymentId}`
    ),
    examplePaymentId
);
assert.equal(api.getPaymentIdFromHref('https://example.com/not-a-payment'), null);

const queueNow = Date.now();
const validQueue = {
    version: 1,
    token: 'b'.repeat(32),
    createdAt: queueNow,
    index: 0,
    items: [{ paymentId: examplePaymentId, state: 'pending' }]
};
assert.equal(api.isValidRefundQueue(validQueue, queueNow), true);
assert.equal(
    api.isValidRefundQueue(
        { ...validQueue, createdAt: queueNow - (31 * 60 * 1000) },
        queueNow
    ),
    false
);
assert.equal(
    api.isValidRefundQueue({ ...validQueue, index: 2 }, queueNow),
    false
);
assert.equal(
    api.isValidRefundQueue({
        ...validQueue,
        items: [{ paymentId: 'invalid', state: 'pending' }]
    }, queueNow),
    false
);

assert.equal(api.findAdministrationSearchInput(), null);

api.injectStyles();
api.injectStyles();
const injectedStyles = scenario.createdElements.filter(
    element => element.id === 'pp-useradmin-styles'
);
assert.equal(injectedStyles.length, 1);
assert.match(injectedStyles[0].textContent, /pp-useradmin-search-row/);
assert.match(injectedStyles[0].textContent, /display:\s*flex\s*!important/);
assert.match(injectedStyles[0].textContent, /flex-wrap:\s*wrap/);

const oldInput = new FakeInput(formattedPlate);
const decoyInput = new FakeInput('decoy');
scenario.fallbackInputs.push(oldInput, decoyInput);
const searchLabel = makeLabel('Søk', oldInput);
scenario.labels.push(searchLabel);

assert.equal(api.findAdministrationSearchInput(), oldInput);
api.addSmartSpaceRemoval();

const replacementInput = new FakeInput(formattedPlate);
searchLabel.control = replacementInput;
scenario.fallbackInputs.splice(0, 2, replacementInput, decoyInput);
api.addSmartSpaceRemoval();

oldInput.dispatchEvent(new FakeEvent('input'));
assert.equal(oldInput.value, formattedPlate);

replacementInput.dispatchEvent(new FakeEvent('input'));
assert.equal(replacementInput.value, 'AB12345');

replacementInput.value = 'A B - 1';
api.handleRemoveSpacesClick();
assert.equal(replacementInput.value, 'AB-1');
assert.equal(replacementInput.focused, true);

searchLabel.textContent = 'Research';
assert.equal(api.findAdministrationSearchInput(), null);
searchLabel.textContent = 'Search';
assert.equal(api.findAdministrationSearchInput(), replacementInput);

const formControl = new FakeElement('div');
formControl.className = 'MuiFormControl-root';
replacementInput.formControl = formControl;
const formParent = new FakeParent(formControl);

api.addRemoveSpacesButton();
const button = scenario.createdElements.find(
    element => element.id === 'pp-useradmin-remove-spaces-btn'
);
assert.ok(button);
assert.equal(formControl.parentNode, formParent);
assert.deepEqual(formParent.children, [formControl, button]);
assert.equal(formParent.classList.contains('pp-useradmin-search-row'), true);
assert.equal((button.listeners.get('click') || []).length, 1);

api.addRemoveSpacesButton();
assert.deepEqual(formParent.children, [formControl, button]);
assert.equal((button.listeners.get('click') || []).length, 1);

const currentInput = new FakeInput('C D 2');
const currentFormControl = new FakeElement('div');
currentInput.formControl = currentFormControl;
searchLabel.control = currentInput;
scenario.fallbackInputs.splice(0, 2, currentInput, decoyInput);
const replacementFormParent = new FakeParent(currentFormControl);

api.addRemoveSpacesButton();
button.click();
assert.equal(currentInput.value, 'CD2');
assert.equal(replacementInput.value, 'AB-1');
assert.equal(currentFormControl.parentNode, replacementFormParent);
assert.equal(button.previousElementSibling, currentFormControl);
assert.deepEqual(replacementFormParent.children, [currentFormControl, button]);
assert.equal(formParent.classList.contains('pp-useradmin-search-row'), false);
assert.equal(
    replacementFormParent.classList.contains('pp-useradmin-search-row'),
    true
);

api.removeSearchButton();
assert.equal(button.parentNode, null);
assert.equal(
    replacementFormParent.classList.contains('pp-useradmin-search-row'),
    false
);
api.addRemoveSpacesButton();
assert.deepEqual(replacementFormParent.children, [currentFormControl, button]);
assert.equal((button.listeners.get('click') || []).length, 1);

const chainLabel = new FakeElement('p', 'ChainID');
const chainValue = new FakeElement('p', '123456789012345678901234');
const chainParent = new FakeParent(chainLabel, chainValue);

api.linkifyElement(chainValue);
assert.equal(chainParent.children[1], chainValue);
assert.equal(chainValue.childElementCount, 1);
assert.equal(chainValue.firstElementChild.tagName, 'A');
assert.equal(
    chainValue.firstElementChild.getAttribute('href'),
    'https://paymanager.logos.dk/transactions?chainid=123456789012345678901234'
);
assert.equal(chainValue.firstElementChild.target, '_blank');
assert.equal(chainValue.firstElementChild.rel, 'noopener noreferrer');

const replacementChainId = '223456789012345678901234';
chainValue.firstElementChild.textContent = replacementChainId;
api.linkifyElement(chainValue);
assert.equal(
    chainValue.firstElementChild.getAttribute('href'),
    `https://paymanager.logos.dk/transactions?chainid=${replacementChainId}`,
    'a recycled SPA value must update the owned link destination'
);

chainLabel.textContent = 'Reference';
api.linkifyElement(chainValue);
assert.equal(chainValue.childElementCount, 0);
assert.equal(chainValue.textContent, replacementChainId);
assert.equal(chainValue.dataset.ppUseradminLinkified, undefined);

chainLabel.textContent = 'ChainID';
chainValue.textContent = 'invalid';
api.linkifyElement(chainValue);
assert.equal(chainValue.childElementCount, 0);

const unrelatedLabel = new FakeElement('p', 'Reference');
const unrelatedValue = new FakeElement('p', '123456789012345678901234');
new FakeParent(unrelatedLabel, unrelatedValue);
api.linkifyElement(unrelatedValue);
assert.equal(unrelatedValue.childElementCount, 0);

const paymentLabel = new FakeElement('span', 'Betalings ID');
const paymentValue = new FakeElement(
    'span',
    'abcdef0123456789abcdef0123456789'
);
const interactiveParent = new FakeElement('button');
new FakeParent(paymentLabel, paymentValue).parentNode = interactiveParent;
paymentLabel.parentNode.parentNode = interactiveParent;
api.linkifyElement(paymentValue);
assert.equal(paymentValue.childElementCount, 0);

const outerRoot = new FakeElement('div');
const innerRoot = new FakeElement('div');
outerRoot.replaceChildren(innerRoot);
api.queuePendingRoot(innerRoot);
api.queuePendingRoot(outerRoot);
api.queuePendingRoot(innerRoot);
assert.equal(api.pendingRootCount(), 1);

scenario.location.pathname = '/administration';
api.ensureObserver();
assert.equal(api.observerIsActive(), true);
scenario.location.pathname = '/payments';
api.runPendingWork();
assert.equal(api.observerIsActive(), false);
scenario.location.pathname = '/administration';
api.runPendingWork();
assert.equal(api.observerIsActive(), true);

const initializedFlag = scenario.context.window[
    '__passPayUserAdminInitialized'
];
vm.runInContext(isolatedSource, scenario.context);
assert.equal(initializedFlag, true);
assert.equal(
    scenario.context.window.__passPayUserAdminTest,
    api
);

console.log('PassPay UserAdmin tests passed.');
