// ── In-memory Firestore stub ──────────────────────────────────────────────
// Enough of the modular v10 API for app.js: document paths, collection
// queries with equality filters, orderBy/limit, batches, and dotted-path
// updates. Every document is stored under its full slash path.
//
// `window.__store` is the raw map, `window.__fail` a set of path prefixes
// whose writes should be rejected — that is how the tests drive the failure
// branches (a refused gift write, a failed persist) without a network.

const store = new Map();
const fail  = new Set();
window.__store = store;
window.__fail  = fail;
window.__writes = [];

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function pathOf(x) { return typeof x === 'string' ? x : x.__path; }

function blocked(path) {
    for (const p of fail) if (path.startsWith(p)) return true;
    return false;
}

export function initializeApp() { return { name: 'stub' }; }
export function getFirestore() { return { __db: true }; }
export function getAnalytics() { return {}; }
export function logEvent() {}
export function getFunctions() { return {}; }
export function httpsCallable() { return async () => ({ data: {} }); }

export function doc(db, ...segs) {
    const parts = [];
    for (const s of segs) parts.push(typeof s === 'string' ? s : pathOf(s));
    return { __path: parts.join('/'), __doc: true, id: parts[parts.length - 1] };
}
export function collection(db, ...segs) {
    const parts = [];
    for (const s of segs) parts.push(typeof s === 'string' ? s : pathOf(s));
    return { __path: parts.join('/'), __col: true };
}

export function where(field, op, value) { return { kind: 'where', field, op, value }; }
export function orderBy(field, dir) { return { kind: 'orderBy', field, dir: dir || 'asc' }; }
export function limit(n) { return { kind: 'limit', n }; }
export function query(col, ...cs) { return { __query: true, col, cs }; }

function snapFor(path) {
    const data = store.get(path);
    return {
        id: path.split('/').pop(),
        exists: () => data !== undefined,
        data: () => clone(data),
        ref: { __path: path }
    };
}

export async function getDoc(ref) {
    const path = pathOf(ref);
    if (blocked('READ:' + path)) throw new Error('permission-denied');
    return snapFor(path);
}
export const getDocFromCache = getDoc;

function readField(obj, field) {
    return field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export async function getDocs(q) {
    const col = q.__query ? q.col : q;
    const cs  = q.__query ? q.cs : [];
    const prefix = pathOf(col) + '/';
    let rows = [];
    for (const [path, data] of store) {
        if (!path.startsWith(prefix)) continue;
        if (path.slice(prefix.length).includes('/')) continue;
        rows.push({ path, data });
    }
    for (const c of cs) {
        if (c.kind !== 'where') continue;
        rows = rows.filter(r => {
            const v = readField(r.data, c.field);
            if (c.op === '==') return v === c.value;
            if (c.op === 'in') return c.value.includes(v);
            if (c.op === 'array-contains') return Array.isArray(v) && v.includes(c.value);
            return true;
        });
    }
    const ob = cs.find(c => c.kind === 'orderBy');
    if (ob) {
        rows.sort((a, b) => {
            const x = readField(a.data, ob.field), y = readField(b.data, ob.field);
            const r = x < y ? -1 : x > y ? 1 : 0;
            return ob.dir === 'desc' ? -r : r;
        });
    }
    const lim = cs.find(c => c.kind === 'limit');
    if (lim) rows = rows.slice(0, lim.n);
    return {
        empty: rows.length === 0,
        size: rows.length,
        docs: rows.map(r => snapFor(r.path)),
        forEach(fn) { rows.forEach(r => fn(snapFor(r.path))); }
    };
}

function applyUpdate(path, patch) {
    const cur = store.get(path);
    if (cur === undefined) throw new Error('not-found: ' + path);
    const next = clone(cur);
    for (const k of Object.keys(patch)) {
        if (k.includes('.')) {
            const parts = k.split('.');
            let o = next;
            for (let i = 0; i < parts.length - 1; i++) {
                if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {};
                o = o[parts[i]];
            }
            o[parts[parts.length - 1]] = clone(patch[k]);
        } else {
            next[k] = clone(patch[k]);
        }
    }
    store.set(path, next);
}

export async function setDoc(ref, data) {
    const path = pathOf(ref);
    if (blocked(path)) throw new Error('permission-denied: ' + path);
    store.set(path, clone(data));
    window.__writes.push({ op: 'set', path });
}
export async function updateDoc(ref, patch) {
    const path = pathOf(ref);
    if (blocked(path)) throw new Error('permission-denied: ' + path);
    applyUpdate(path, patch);
    window.__writes.push({ op: 'update', path });
}
export async function deleteDoc(ref) {
    const path = pathOf(ref);
    if (blocked(path)) throw new Error('permission-denied: ' + path);
    store.delete(path);
    window.__writes.push({ op: 'delete', path });
}
export async function addDoc(col, data) {
    const id = 'auto-' + Math.random().toString(36).slice(2, 10);
    const path = pathOf(col) + '/' + id;
    store.set(path, clone(data));
    return { __path: path, id };
}
export function onSnapshot() { return () => {}; }
export function increment(n) { return { __inc: n }; }

export async function runTransaction(db, fn) {
    return fn({
        get: async (ref) => snapFor(pathOf(ref)),
        set: (ref, d) => { store.set(pathOf(ref), clone(d)); },
        update: (ref, p) => applyUpdate(pathOf(ref), p),
        delete: (ref) => { store.delete(pathOf(ref)); }
    });
}

export function writeBatch() {
    const ops = [];
    return {
        set(ref, d) { ops.push({ t: 'set', path: pathOf(ref), d }); },
        update(ref, p) { ops.push({ t: 'update', path: pathOf(ref), p }); },
        delete(ref) { ops.push({ t: 'delete', path: pathOf(ref) }); },
        async commit() {
            // A real batch is atomic: check every write before applying any.
            for (const o of ops) if (blocked(o.path)) throw new Error('permission-denied: ' + o.path);
            for (const o of ops) {
                if (o.t === 'set') store.set(o.path, clone(o.d));
                else if (o.t === 'update') applyUpdate(o.path, o.p);
                else store.delete(o.path);
            }
            window.__writes.push({ op: 'batch', paths: ops.map(o => o.path) });
        }
    };
}
