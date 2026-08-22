export function getAuth() { return { currentUser: null }; }
export function signInWithPopup() { return Promise.resolve({ user: null }); }
export function GoogleAuthProvider() {}
GoogleAuthProvider.credentialFromResult = () => null;
// Never fires: the tests boot state directly rather than through the auth flow,
// so app.js's own sign-in path stays out of the way.
export function onAuthStateChanged() { return () => {}; }
export function signOut() { return Promise.resolve(); }
