'use strict';

// ── Reading activities out of the user document ───────────────────────────
// Activities are NOT their own Firestore documents. The entire app state
// lives in a single users/{uid} doc, and activities are nested three levels
// deep inside it:
//
//   users/{uid}.dimensions[].paths[].activities[]
//
// with `id` generated client-side as Date.now().toString() (app.js, the
// saveActivity path). There is no archived/deleted flag on an activity —
// anything present in the tree is live, and deleting one splices it out of
// the array. So "does this activity still exist" is simply "is it in the tree".
//
// This mirrors findActivityById() / getAllActivitiesFlat() in app.js. Keep
// the two in step if the client-side shape ever changes.

/**
 * Locate an activity by id anywhere in the user's dimension tree.
 * @returns {{activity: object, dimension: object, path: object}|null}
 */
function findActivity(userData, activityId) {
    if (!userData || activityId == null) return null;
    const wanted = String(activityId);
    const dimensions = userData.dimensions || [];

    for (const dimension of dimensions) {
        for (const path of (dimension.paths || [])) {
            for (const activity of (path.activities || [])) {
                if (String(activity.id) === wanted) {
                    return { activity, dimension, path };
                }
            }
        }
    }
    return null;
}

/**
 * Current display name for an activity, or null if it no longer exists.
 * Called at send time so a renamed activity doesn't keep announcing itself
 * under the name it had when the reminder was created.
 */
function resolveActivityName(userData, activityId) {
    const found = findActivity(userData, activityId);
    if (!found) return null;
    const name = found.activity.name;
    return (typeof name === 'string' && name.trim()) ? name.trim() : null;
}

module.exports = {
    findActivity,
    resolveActivityName,
};
