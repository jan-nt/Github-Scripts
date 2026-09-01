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
    throwOnClick = false,
    hasPasswordField = true,
    credentialsFilled = true,
    disabled = false
} = {}) {
    const requiredInputs = hasPasswordField
        ? [
            { type: 'text', value: credentialsFilled ? 'user' : '' },
            { type: 'password', value: credentialsFilled ? 'secret' : '' }
        ]
        : [];
    const form = {
        checkValidity: () =>
            valid && requiredInputs.every(input => input.value !== ''),
        querySelector(selector) {
            if (selector.includes('input[type="password"]')) {
                return requiredInputs.find(
                    input => input.type === 'password'
                ) || null;
            }

            return null;
        },
        querySelectorAll: () => requiredInputs
    };

    return {
        tagName,
        type,
        form,
        hidden: false,
        disabled,
        isConnected: true,
        clicks: 0,
        getAttribute(name) {
            if (name === 'type') return type;
            if (name === 'aria-disabled') {
                return this.disabled ? 'true' : 'false';
            }
            return null;
        },
        getClientRects: () => visible ? [{}] : [],
        closest: selector => selector === 'form' ? form : null,
        setCredentialsFilled(filled) {
            for (const input of requiredInputs) {
                input.value = filled ?
                    (input.type === 'password' ? 'secret' : 'user') : '';
            }
        },
        setDisabled(value) {
            this.disabled = value;
        },
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
    search = '',
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
        search,
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

const fiveMinuteRefreshScenario = createScenario({ hidden: true });
fiveMinuteRefreshScenario.clock.advance(5 * 60 * 1000 - 1);
assert.equal(fiveMinuteRefreshScenario.location.reloads, 0);
fiveMinuteRefreshScenario.clock.advance(1);
assert.equal(
    fiveMinuteRefreshScenario.location.reloads,
    1,
    'an authenticated background tab must refresh after five minutes'
);

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

const rootDashboardButton = createLoginButton({
    hasPasswordField: false
});
const rootWithoutLoginFormScenario = createScenario({
    pathname: '/',
    candidates: [rootDashboardButton]
});

rootWithoutLoginFormScenario.clock.advance(5 * 60 * 1000 + 30_000);
assert.equal(rootDashboardButton.clicks, 0);
assert.equal(
    rootWithoutLoginFormScenario.location.reloads,
    0,
    'DIBS root without a verified password form must not enter login recovery'
);

const dashboardLoginButton = createLoginButton();
const dashboardLoginScenario = createScenario({
    pathname: '/dashboard',
    candidates: [dashboardLoginButton]
});

dashboardLoginScenario.clock.advance(0);
assert.equal(
    dashboardLoginButton.clicks,
    1,
    'a DIBS login form rendered on /dashboard must be submitted'
);

const timestampLoginButton = createLoginButton();
const timestampLoginScenario = createScenario({
    pathname: '/dashboard',
    search: '?_t=1788265261874',
    candidates: [timestampLoginButton]
});

timestampLoginScenario.clock.advance(0);
assert.equal(
    timestampLoginButton.clicks,
    1,
    'a DIBS dashboard URL with a cache-busting query must still log in'
);

const dashboardFormButton = createLoginButton({
    hasPasswordField: false
});
const authenticatedDashboardScenario = createScenario({
    pathname: '/dashboard',
    candidates: [dashboardFormButton]
});

authenticatedDashboardScenario.clock.advance(30_000);
assert.equal(
    dashboardFormButton.clicks,
    0,
    'an authenticated dashboard form must not be treated as the login form'
);

const delayedAutofillButton = createLoginButton({
    credentialsFilled: false
});
const delayedAutofillScenario = createScenario({
    pathname: '/dashboard',
    candidates: [delayedAutofillButton]
});

delayedAutofillScenario.clock.advance(10_000);
assert.equal(delayedAutofillButton.clicks, 0);
delayedAutofillButton.setCredentialsFilled(true);
delayedAutofillScenario.clock.advance(1_000);
assert.equal(
    delayedAutofillButton.clicks,
    1,
    'DIBS login must wait for Google Autofill before clicking once'
);

const disabledAutofillButton = createLoginButton({ disabled: true });
const disabledAutofillScenario = createScenario({
    pathname: '/dashboard',
    candidates: [disabledAutofillButton]
});

disabledAutofillScenario.clock.advance(10_000);
assert.equal(disabledAutofillButton.clicks, 0);
disabledAutofillButton.setDisabled(false);
disabledAutofillScenario.clock.advance(1_000);
assert.equal(
    disabledAutofillButton.clicks,
    1,
    'DIBS login detection must keep watching a temporarily disabled submit control'
);

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
assert.equal(
    ambiguousScenario.location.reloads,
    0,
    'multiple DIBS login forms must fail closed without forced reloads'
);

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
