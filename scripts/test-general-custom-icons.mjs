import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scriptSource = await readFile(
    new URL('../General Custom Icons.user.js', import.meta.url),
    'utf8'
);

class FakeClock {
    constructor() {
        this.now = 0;
        this.nextId = 1;
        this.timers = new Map();
    }

    setTimeout(callback, delay = 0) {
        const id = this.nextId++;
        this.timers.set(id, {
            callback,
            due: this.now + Math.max(0, Number(delay) || 0)
        });
        return id;
    }

    clearTimeout(id) {
        this.timers.delete(id);
    }

    advance(milliseconds) {
        const target = this.now + milliseconds;

        while (true) {
            const next = Array.from(this.timers.entries())
                .filter(([, timer]) => timer.due <= target)
                .sort((left, right) =>
                    left[1].due - right[1].due || left[0] - right[0]
                )[0];

            if (!next) break;

            const [id, timer] = next;
            this.timers.delete(id);
            this.now = timer.due;
            timer.callback();
        }

        this.now = target;
    }
}

function createScenario({ headReady = true } = {}) {
    const clock = new FakeClock();
    const observers = [];
    const windowListeners = new Map();
    const headChildren = [];

    class FakeMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.connected = false;
            this.target = null;
            observers.push(this);
        }

        observe(target, options = {}) {
            this.connected = true;
            this.target = target;
            this.options = options;
        }

        disconnect() {
            this.connected = false;
            this.target = null;
        }
    }

    function triggerObservers(target) {
        for (const observer of observers) {
            if (observer.connected && observer.target === target) {
                observer.callback([{ target }]);
            }
        }
    }

    class FakeLink {
        constructor() {
            this.attributes = new Map();
            this.dataset = {};
            this.parentNode = null;
            this.type = '';
        }

        set rel(value) {
            this.attributes.set('rel', value);
        }

        get rel() {
            return this.attributes.get('rel') || '';
        }

        set href(value) {
            this.attributes.set('href', value);
        }

        get href() {
            return this.attributes.get('href') || '';
        }

        setAttribute(name, value) {
            this.attributes.set(name, String(value));
            if (name === 'data-userscript-favicon') {
                this.dataset.userscriptFavicon = String(value);
            }
        }

        getAttribute(name) {
            return this.attributes.get(name) ?? null;
        }

        remove() {
            const index = headChildren.indexOf(this);
            if (index >= 0) headChildren.splice(index, 1);
            this.parentNode = null;
        }
    }

    const head = {
        appendChild(link) {
            link.parentNode = this;
            headChildren.push(link);
            return link;
        }
    };

    const documentElement = {};
    const document = {
        title: 'PassPay native',
        head: headReady ? head : null,
        documentElement,
        createElement(tagName) {
            assert.equal(tagName, 'link');
            return new FakeLink();
        },
        querySelectorAll(selector) {
            if (selector === 'link[data-userscript-favicon="true"]') {
                return headChildren.filter(
                    link => link.dataset.userscriptFavicon === 'true'
                );
            }

            if (selector === 'link[rel~="icon"]') {
                return headChildren.filter(link =>
                    link.rel.split(/\s+/).includes('icon')
                );
            }

            return [];
        }
    };

    const nativeIcon = new FakeLink();
    nativeIcon.rel = 'icon';
    nativeIcon.href = 'https://betaling.passpay.no/favicon.ico';
    head.appendChild(nativeIcon);

    const location = {
        hostname: 'betaling.passpay.no',
        pathname: '/search',
        href: 'https://betaling.passpay.no/search'
    };

    function updateLocation(nextUrl) {
        const url = new URL(nextUrl, location.href);
        location.hostname = url.hostname;
        location.pathname = url.pathname;
        location.href = url.href;
    }

    const history = {
        pushState(_state, _title, url) {
            if (url !== undefined && url !== null) updateLocation(url);
        },
        replaceState(_state, _title, url) {
            if (url !== undefined && url !== null) updateLocation(url);
        }
    };

    const window = {
        addEventListener(type, listener) {
            const listeners = windowListeners.get(type) || [];
            listeners.push(listener);
            windowListeners.set(type, listeners);
        },
        setTimeout: (callback, delay) => clock.setTimeout(callback, delay)
    };

    const context = vm.createContext({
        Array,
        Boolean,
        Map,
        MutationObserver: FakeMutationObserver,
        Set,
        clearTimeout: id => clock.clearTimeout(id),
        document,
        encodeURIComponent,
        history,
        location,
        setTimeout: (callback, delay) => clock.setTimeout(callback, delay),
        window
    });

    vm.runInContext(scriptSource, context);

    return {
        clock,
        context,
        document,
        head,
        headChildren,
        history,
        location,
        triggerHeadMutation() {
            triggerObservers(document.head);
        },
        observerOptionsFor(target) {
            return observers
                .filter(observer => observer.connected && observer.target === target)
                .map(observer => observer.options);
        },
        makeHeadReady() {
            document.head = head;
            triggerObservers(document);
        },
        triggerWindow(type) {
            for (const listener of windowListeners.get(type) || []) {
                listener({ type });
            }
        },
        windowListenerCount(type) {
            return (windowListeners.get(type) || []).length;
        },
        customIcons() {
            return document.querySelectorAll(
                'link[data-userscript-favicon="true"]'
            );
        }
    };
}

const scenario = createScenario();
assert.equal(scenario.document.title, 'Search');
assert.equal(scenario.customIcons().length, 3);
assert.equal(scenario.clock.timers.size, 0);
assert.equal(
    scenario.observerOptionsFor(scenario.head)
        .some(options => options.characterData === true),
    true,
    'title text-node mutations must be observed'
);

const patchedPushState = scenario.history.pushState;
vm.runInContext(scriptSource, scenario.context);
assert.equal(scenario.history.pushState, patchedPushState);
assert.equal(scenario.windowListenerCount('popstate'), 1);
assert.equal(scenario.customIcons().length, 3);

const competingIcon = scenario.document.createElement('link');
competingIcon.rel = 'icon';
competingIcon.href = 'https://betaling.passpay.no/replacement.ico';
scenario.head.appendChild(competingIcon);
scenario.triggerHeadMutation();
assert.equal(scenario.customIcons().length, 3);
assert.equal(
    scenario.headChildren.at(-2).dataset.userscriptFavicon,
    'true'
);

scenario.history.pushState({}, '', '/unconfigured');
scenario.document.title = 'Unconfigured native';
scenario.triggerHeadMutation();
assert.equal(scenario.document.title, 'Search');
scenario.clock.advance(150);
assert.equal(scenario.document.title, 'Unconfigured native');
assert.equal(scenario.customIcons().length, 0);

scenario.document.title = 'Payments native';
scenario.history.pushState({}, '', '/payments');
scenario.clock.advance(150);
assert.equal(scenario.document.title, 'Payments');
assert.equal(scenario.customIcons().length, 3);
assert.equal(scenario.clock.timers.size, 0);

scenario.triggerWindow('pagehide');
assert.equal(scenario.clock.timers.size, 0);
scenario.triggerWindow('pageshow');
assert.equal(scenario.document.title, 'Payments');
assert.equal(scenario.customIcons().length, 3);

const delayedHeadScenario = createScenario({ headReady: false });
assert.equal(delayedHeadScenario.document.title, 'PassPay native');
assert.equal(delayedHeadScenario.customIcons().length, 0);
assert.equal(delayedHeadScenario.clock.timers.size, 1);

delayedHeadScenario.history.pushState({}, '', '/payments');
delayedHeadScenario.clock.advance(150);
delayedHeadScenario.makeHeadReady();
assert.equal(delayedHeadScenario.document.title, 'Payments');
assert.equal(delayedHeadScenario.customIcons().length, 3);
assert.equal(delayedHeadScenario.clock.timers.size, 0);
assert.equal(
    delayedHeadScenario.observerOptionsFor(
        delayedHeadScenario.document.documentElement
    ).length,
    1,
    'startup head-replacement observation must survive an early route change'
);

console.log('General custom icons tests passed.');
