import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scriptSource = await readFile(
    new URL('../General Background Auto Refresh.user.js', import.meta.url),
    'utf8'
);

class FakeClock {
    constructor(now = 0) {
        this.now = now;
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

function createLoginButton({
    valid = true,
    visible = true,
    tagName = 'BUTTON',
    type = 'submit',
    throwOnClick = false
} = {}) {
    const form = {
        checkValidity: () => valid,
        querySelectorAll: () => []
    };

    return {
        tagName,
        type,
        form,
        hidden: false,
        disabled: false,
        isConnected: true,
        clicks: 0,
        getAttribute(name) {
            if (name === 'type') return type;
            if (name === 'aria-disabled') return 'false';
            return null;
        },
        getClientRects: () => visible ? [{}] : [],
        closest: selector => selector === 'form' ? form : null,
        click() {
            this.clicks++;
            if (throwOnClick) throw new Error('simulated click failure');
            this.onClick?.();
        }
    };
}

function createScenario({
    hostname = 'portal.dibspayment.eu',
    pathname = '/portal-frontend/payments',
    hidden = false,
    candidates = [],
    now = 0,
    storedRefresh = null
} = {}) {
    const clock = new FakeClock(now);
    const documentListeners = new Map();
    const windowListeners = new Map();
    const storedValues = new Map();

    if (storedRefresh !== null) {
        storedValues.set(
            'general_session_keeper_next_refresh_v3',
            String(storedRefresh)
        );
    }

    const location = {
        hostname,
        pathname,
        reloads: 0,
        reload() {
            this.reloads++;
        }
    };

    const document = {
        hidden,
        addEventListener(type, listener) {
            const listeners = documentListeners.get(type) || [];
            listeners.push(listener);
            documentListeners.set(type, listeners);
        },
        evaluate() {
            return { singleNodeValue: candidates[0] || null };
        },
        querySelectorAll() {
            return candidates;
        }
    };

    const window = {
        addEventListener(type, listener) {
            const listeners = windowListeners.get(type) || [];
            listeners.push(listener);
            windowListeners.set(type, listeners);
        },
        getComputedStyle: () => ({
            display: 'block',
            visibility: 'visible'
        }),
        setTimeout: (callback, delay) => clock.setTimeout(callback, delay)
    };

    const context = vm.createContext({
        Array,
        Date: { now: () => clock.now },
        Event,
        HTMLInputElement: class {},
        Number,
        Set,
        String,
        XPathResult: { FIRST_ORDERED_NODE_TYPE: 9 },
        clearTimeout: id => clock.clearTimeout(id),
        document,
        localStorage: {
            getItem: key => storedValues.get(key) ?? null,
            setItem: (key, value) => storedValues.set(key, value)
        },
        location,
        setTimeout: (callback, delay) => clock.setTimeout(callback, delay),
        window
    });

    vm.runInContext(scriptSource, context);

    return {
        clock,
        context,
        document,
        location,
        triggerDocument(type) {
            for (const listener of documentListeners.get(type) || []) {
                listener({ type });
            }
        },
        triggerWindow(type) {
            for (const listener of windowListeners.get(type) || []) {
                listener({ type });
            }
        },
        documentListenerCount(type) {
            return (documentListeners.get(type) || []).length;
        },
        windowListenerCount(type) {
            return (windowListeners.get(type) || []).length;
        }
    };
}

const timerScenario = createScenario();
timerScenario.clock.advance(0);
assert.equal(timerScenario.clock.timers.size, 1);

timerScenario.document.hidden = true;
for (let index = 0; index < 5; index++) {
    timerScenario.triggerDocument('visibilitychange');
}
assert.equal(timerScenario.clock.timers.size, 1);

timerScenario.triggerWindow('pageshow');
assert.equal(timerScenario.clock.timers.size, 1);
timerScenario.clock.advance(0);
assert.equal(timerScenario.clock.timers.size, 1);

vm.runInContext(scriptSource, timerScenario.context);
assert.equal(timerScenario.documentListenerCount('visibilitychange'), 1);
assert.equal(timerScenario.windowListenerCount('pageshow'), 1);
assert.equal(timerScenario.clock.timers.size, 1);

timerScenario.triggerWindow('pagehide');
assert.equal(timerScenario.clock.timers.size, 0);

const refreshScenario = createScenario({
    hidden: true,
    now: 100,
    storedRefresh: 1
});
refreshScenario.clock.advance(0);
assert.equal(refreshScenario.location.reloads, 1);

const loginButton = createLoginButton();
const loginScenario = createScenario({
    pathname: '/',
    candidates: [loginButton]
});

loginScenario.clock.advance(0);
assert.equal(loginButton.clicks, 1);
loginScenario.clock.advance(15_000);
assert.equal(loginButton.clicks, 1);
loginScenario.clock.advance(15_000);
assert.equal(loginButton.clicks, 1);
loginScenario.clock.advance(4 * 60 * 1000 + 30_000);
assert.equal(loginScenario.location.reloads, 1);
assert.equal(loginScenario.clock.timers.size, 0);

const ambiguousFirst = createLoginButton();
const ambiguousSecond = createLoginButton();
const ambiguousScenario = createScenario({
    pathname: '/',
    candidates: [ambiguousFirst, ambiguousSecond]
});

ambiguousScenario.clock.advance(30_000);
assert.equal(ambiguousFirst.clicks, 0);
assert.equal(ambiguousSecond.clicks, 0);
ambiguousScenario.clock.advance(5 * 60 * 1000);
assert.equal(ambiguousScenario.location.reloads, 1);

const invalidButton = createLoginButton({ valid: false });
const invalidScenario = createScenario({
    pathname: '/',
    candidates: [invalidButton]
});

invalidScenario.clock.advance(30_000);
assert.equal(invalidButton.clicks, 0);

const failedButton = createLoginButton({ throwOnClick: true });
const failedClickScenario = createScenario({
    pathname: '/',
    candidates: [failedButton]
});

failedClickScenario.clock.advance(0);
assert.equal(failedButton.clicks, 1);
failedClickScenario.clock.advance(5 * 60 * 1000);
assert.equal(failedButton.clicks, 1, 'a failed click must not be repeated');
assert.equal(failedClickScenario.location.reloads, 1);

const rivertyButton = createLoginButton({
    tagName: 'INPUT',
    type: 'submit'
});
const rivertyScenario = createScenario({
    hostname: 'horizon.gothiagroup.com',
    pathname: '/HorizonWeb/Portal/WebForms/LoginPage.aspx',
    candidates: [rivertyButton]
});

rivertyScenario.clock.advance(0);
assert.equal(rivertyButton.clicks, 1);

const spaLoginButton = createLoginButton();
const spaLoginScenario = createScenario({
    pathname: '/',
    candidates: [spaLoginButton]
});
spaLoginButton.onClick = () => {
    spaLoginScenario.location.pathname = '/portal-frontend/payments';
};

spaLoginScenario.clock.advance(0);
assert.equal(spaLoginButton.clicks, 1);
spaLoginScenario.clock.advance(15_000);
assert.equal(spaLoginButton.clicks, 1);
assert.equal(spaLoginScenario.clock.timers.size, 1);

console.log('General background session keeper tests passed.');
