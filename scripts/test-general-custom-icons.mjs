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

function createScenario({
    headReady = true,
    initialUrl = 'https://betaling.passpay.no/search'
} = {}) {
    const clock = new FakeClock();
    const observers = [];
    const windowListeners = new Map();
    const headChildren = [];
    const warnings = [];

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
            this.listeners = new Map();
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

        hasAttribute(name) {
            return this.attributes.has(name);
        }

        removeAttribute(name) {
            this.attributes.delete(name);

            if (name === 'data-userscript-favicon') {
                delete this.dataset.userscriptFavicon;
            }
        }

        addEventListener(type, listener) {
            const listeners = this.listeners.get(type) || [];
            listeners.push(listener);
            this.listeners.set(type, listeners);
        }

        dispatchEvent(event) {
            event.currentTarget = this;

            for (const listener of this.listeners.get(event.type) || []) {
                listener(event);
            }
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

            if (selector === 'link[data-userscript-favicon-disabled="true"]') {
                return headChildren.filter(link =>
                    link.getAttribute('data-userscript-favicon-disabled') ===
                        'true'
                );
            }

            if (selector === 'link[rel]') {
                return headChildren.filter(link => link.hasAttribute('rel'));
            }

            return [];
        }
    };

    const nativeIcon = new FakeLink();
    nativeIcon.rel = 'icon';
    nativeIcon.href = 'https://betaling.passpay.no/favicon.ico';
    head.appendChild(nativeIcon);

    const initialLocation = new URL(initialUrl);
    const location = {
        hostname: initialLocation.hostname,
        pathname: initialLocation.pathname,
        href: initialLocation.href
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
        console: {
            warn(message) {
                warnings.push(String(message));
            }
        },
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
        },
        disabledIcons() {
            return document.querySelectorAll(
                'link[data-userscript-favicon-disabled="true"]'
            );
        },
        addExternalIcon(href = 'https://betaling.passpay.no/favicon.ico') {
            const link = document.createElement('link');
            link.rel = 'icon';
            link.href = href;
            head.appendChild(link);
            return link;
        },
        updateLocation,
        warningCount() {
            return warnings.length;
        },
        connectedObserverCount(target) {
            return observers.filter(
                observer => observer.connected && observer.target === target
            ).length;
        }
    };
}

const configuredRoutes = [
    ['https://betaling.passpay.no/locations/5', 'Locations'],
    ['https://betaling.passpay.no/search', 'Search'],
    ['https://betaling.passpay.no/administration', 'Admin'],
    ['https://betaling.passpay.no/place-administration', 'Loc-Admin'],
    ['https://betaling.passpay.no/vehicles', 'Car'],
    ['https://betaling.passpay.no/bookings', 'Booking'],
    ['https://betaling.passpay.no/payments', 'Payments'],
    ['https://betaling.passpay.no/site-administration', 'Site-Admin'],
    ['https://paymanager.logos.dk/transactions', 'Transactions'],
    ['https://paymanager.logos.dk/terminals', 'Terminals'],
    ['https://paymanager.logos.dk/parking', 'Parking'],
    ['https://paymanager.logos.dk/files', 'Files'],
    ['https://paymanager.logos.dk/user_administration', 'User-Admin']
];

for (const [initialUrl, expectedTitle] of configuredRoutes) {
    const initial = createScenario({ initialUrl });
    const [canonical] = initial.customIcons();

    assert.equal(initial.document.title, expectedTitle);
    assert.equal(initial.customIcons().length, 1);
    assert.equal(canonical.getAttribute('rel'), 'icon');
    assert.equal(canonical.getAttribute('type'), 'image/svg+xml');
    assert.equal(canonical.getAttribute('sizes'), 'any');
    assert.match(canonical.getAttribute('href'), /^data:image\/svg\+xml/);
    assert.equal(initial.disabledIcons().length, 1);
    assert.equal(initial.clock.timers.size, 0);
}

const scenario = createScenario();
assert.equal(
    scenario.observerOptionsFor(scenario.head)
        .some(options => options.characterData === true),
    true,
    'title text-node mutations must be observed'
);
assert.equal(scenario.connectedObserverCount(scenario.head), 1);
assert.equal(
    scenario.connectedObserverCount(scenario.document.documentElement),
    1
);

// A second execution must not patch history, bind listeners, or add icons again.
const patchedPushState = scenario.history.pushState;
const originalCanonical = scenario.customIcons()[0];
vm.runInContext(scriptSource, scenario.context);
assert.equal(scenario.history.pushState, patchedPushState);
assert.equal(scenario.windowListenerCount('popstate'), 1);
assert.equal(scenario.windowListenerCount('hashchange'), 1);
assert.equal(scenario.windowListenerCount('pagehide'), 1);
assert.equal(scenario.windowListenerCount('pageshow'), 1);
assert.equal(scenario.customIcons().length, 1);
assert.equal(scenario.customIcons()[0], originalCanonical);
assert.equal(scenario.connectedObserverCount(scenario.head), 1);

// A site-added default icon is neutralized without replacing the canonical icon.
const competingIcon = scenario.addExternalIcon(
    'https://betaling.passpay.no/replacement.ico'
);
const shortcutIcon = scenario.addExternalIcon('/shortcut.ico');
shortcutIcon.rel = 'shortcut icon';
const appleTouchIcon = scenario.addExternalIcon('/touch.png');
appleTouchIcon.rel = 'apple-touch-icon';
const maskIcon = scenario.addExternalIcon('/mask.svg');
maskIcon.rel = 'mask-icon';
scenario.triggerHeadMutation();
assert.equal(scenario.customIcons().length, 1);
assert.equal(scenario.customIcons()[0], originalCanonical);
assert.equal(competingIcon.hasAttribute('rel'), false);
assert.equal(shortcutIcon.hasAttribute('rel'), false);
assert.equal(appleTouchIcon.hasAttribute('rel'), false);
assert.equal(maskIcon.hasAttribute('rel'), false);
assert.equal(
    competingIcon.getAttribute('data-userscript-favicon-disabled'),
    'true'
);

// Rechecking an already-correct head performs no DOM replacement.
scenario.triggerHeadMutation();
assert.equal(scenario.customIcons()[0], originalCanonical);
assert.equal(scenario.customIcons().length, 1);

// Leaving configured routes restores native declarations and removes ours.
scenario.history.pushState({}, '', '/unconfigured');
scenario.document.title = 'Unconfigured native';
scenario.triggerHeadMutation();
assert.equal(scenario.document.title, 'Search');
scenario.clock.advance(150);
assert.equal(scenario.document.title, 'Unconfigured native');
assert.equal(scenario.customIcons().length, 0);
assert.equal(scenario.disabledIcons().length, 0);
assert.equal(competingIcon.getAttribute('rel'), 'icon');

// Query strings, hashes, and trailing slashes keep the same normalized route.
scenario.document.title = 'Payments native';
scenario.history.pushState({}, '', '/payments/?page=2#details');
scenario.clock.advance(150);
assert.equal(scenario.document.title, 'Payments');
assert.equal(scenario.customIcons().length, 1);
const paymentsHref = scenario.customIcons()[0].getAttribute('href');
scenario.history.pushState({}, '', '/payments?different=true#next');
scenario.clock.advance(150);
assert.equal(scenario.customIcons()[0].getAttribute('href'), paymentsHref);

// Rapid SPA navigation is debounced and applies only the final route.
scenario.history.pushState({}, '', '/search');
scenario.history.pushState({}, '', '/administration');
scenario.history.pushState({}, '', '/locations/5');
assert.equal(scenario.clock.timers.size, 1);
scenario.clock.advance(150);
assert.equal(scenario.document.title, 'Locations');
assert.notEqual(scenario.customIcons()[0].getAttribute('href'), paymentsHref);

// Back/Forward-style navigation re-applies the corresponding route.
scenario.updateLocation('/search');
scenario.triggerWindow('popstate');
scenario.clock.advance(150);
assert.equal(scenario.document.title, 'Search');
scenario.updateLocation('/payments');
scenario.triggerWindow('popstate');
scenario.clock.advance(150);
assert.equal(scenario.document.title, 'Payments');

scenario.triggerWindow('pagehide');
assert.equal(scenario.clock.timers.size, 0);
scenario.triggerWindow('pageshow');
assert.equal(scenario.document.title, 'Payments');
assert.equal(scenario.customIcons().length, 1);

// A failed configured icon logs once, stops retrying, and restores the native icon.
const failureScenario = createScenario();
failureScenario.customIcons()[0].dispatchEvent({ type: 'error' });
assert.equal(failureScenario.customIcons().length, 0);
assert.equal(failureScenario.disabledIcons().length, 0);
assert.equal(failureScenario.warningCount(), 1);
failureScenario.triggerHeadMutation();
failureScenario.triggerHeadMutation();
assert.equal(failureScenario.customIcons().length, 0);
assert.equal(failureScenario.warningCount(), 1);
assert.equal(failureScenario.clock.timers.size, 0);

const delayedHeadScenario = createScenario({ headReady: false });
assert.equal(delayedHeadScenario.document.title, 'PassPay native');
assert.equal(delayedHeadScenario.customIcons().length, 0);
assert.equal(delayedHeadScenario.clock.timers.size, 1);

delayedHeadScenario.history.pushState({}, '', '/payments');
delayedHeadScenario.clock.advance(150);
delayedHeadScenario.makeHeadReady();
assert.equal(delayedHeadScenario.document.title, 'Payments');
assert.equal(delayedHeadScenario.customIcons().length, 1);
assert.equal(delayedHeadScenario.clock.timers.size, 0);
assert.equal(
    delayedHeadScenario.observerOptionsFor(
        delayedHeadScenario.document.documentElement
    ).length,
    1,
    'startup head-replacement observation must survive an early route change'
);

console.log('General custom icons tests passed.');
