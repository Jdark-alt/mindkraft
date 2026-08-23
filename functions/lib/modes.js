'use strict';

const { resolveActivityName, completedOnLocalDate } = require('./activities');

// ══════════════════════════════════════════════════════════════════════════
// MODE REMINDERS
// ══════════════════════════════════════════════════════════════════════════
//
// Modes (Pursuits › Modes) write reminder documents with `type: 'mode'` into
// the same users/{uid}/reminders collection everything else uses, so they get
// nextSendAt computation, the per-minute due query, DST handling and dead-
// subscription cleanup for free. What they need on top is a decision at SEND
// time, because the right thing to say depends on state:
//
//   • a habit already logged today should not be nudged at all
//   • the day after a miss, the nudge is the user's OWN words, verbatim
//
// The user document is already in hand when this runs (processUser reads it
// once per user per batch), so none of this costs an extra read.
//
// NO GENERATED COPY. Every string below is either hand-written here or the
// user's own `why`/`anchor` text passed through untouched — never summarised,
// never paraphrased, never sent to a model.

/** Yesterday's local date string, relative to `todayLocal`. */
function previousLocalDate(todayLocal) {
    const parts = String(todayLocal || '').split('-');
    if (parts.length !== 3) return null;
    const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    if (isNaN(d.getTime())) return null;
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

/**
 * What (if anything) a mode reminder should say right now.
 * @returns {{body: string}|null} — null means "send nothing this time".
 */
function modeReminderCopy(reminder, userData, timezone, todayLocal, getLocalDateString) {
    const modes = (userData && userData.modes) || {};
    const active = modes.active || null;

    // The mode is over, or a different one is running. The client removes its
    // own reminder documents when a mode ends; this is the backstop for when
    // that write never landed.
    if (!active || String(active.id) !== String(reminder.modeId)) return null;

    if (reminder.modeKind === 'focus') {
        return {
            body: 'Your focus window opens at ' + String(reminder.windowStart || '') +
                  '. Anything you log inside it earns extra XP.',
        };
    }

    if (reminder.modeKind !== 'habit') return null;

    const name = resolveActivityName(userData, reminder.activityId) ||
                 reminder.activityName || 'Your habit';
    const anchor = typeof reminder.anchor === 'string' ? reminder.anchor.trim() : '';
    const why = typeof reminder.why === 'string' ? reminder.why.trim() : '';

    // Done already — there is nothing to nudge about, in either phase.
    if (completedOnLocalDate(userData, reminder.activityId, todayLocal, timezone, getLocalDateString)) {
        return null;
    }

    if (reminder.phase === 'post') {
        return { body: name + ' — the window has closed, but there is still time today if you can.' };
    }

    // Pre-window. If yesterday went by without it, this is the moment the
    // user's own reason comes back to them — word for word (spec §1).
    const yesterday = previousLocalDate(todayLocal);
    const missedYesterday = yesterday
        ? !completedOnLocalDate(userData, reminder.activityId, yesterday, timezone, getLocalDateString)
        : false;

    if (missedYesterday && why) {
        return { body: 'You said this mattered to you: “' + why + '” Never too late — try again today.' };
    }
    if (missedYesterday) {
        return { body: 'Yesterday slipped past. ' + name + ' is up again in an hour — never too late.' };
    }
    return {
        body: name + ' — your window opens in an hour' + (anchor ? ', ' + anchor : '') + '.',
    };
}

module.exports = {
    previousLocalDate,
    modeReminderCopy,
};
