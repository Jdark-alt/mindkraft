// ── One-time migration: user doc reminder time → reminders subcollection ──
//
// Reads the existing general reminder time off each user document and creates
// the corresponding users/{uid}/reminders/general singleton (spec §3.3).
//
// The old field is NOT deleted. It stays in place for a release cycle as a
// rollback net, and the GitHub Actions workflow keeps reading it until cutover.
//
// Usage (same service account the old workflow uses):
//
//   cd scripts
//   npm install
//   FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" node migrate-reminders.js --dry-run
//   FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" node migrate-reminders.js
//
// Flags:
//   --dry-run     report what would change, write nothing
//   --activate    create/flip the docs to active:true (cutover — see below)
//   --deactivate  flip every existing general reminder back to active:false
//                 (rollback — the old cron takes over again)
//   --only=UID    restrict to a single user, for the §9.5 soft launch
//
// By default migrated docs are created with active:false. That is deliberate:
// the GitHub Actions cron is still sending general reminders, so activating
// these at migration time would double-send. Run without --activate first,
// confirm the docs look right, then cut over per DEPLOY.md.

const admin = require('firebase-admin');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ACTIVATE = args.includes('--activate');
const DEACTIVATE = args.includes('--deactivate');

if (ACTIVATE && DEACTIVATE) {
    console.error('Pass --activate or --deactivate, not both.');
    process.exit(1);
}
const ONLY_ARG = args.find(function (a) { return a.indexOf('--only=') === 0; });
const ONLY_UID = ONLY_ARG ? ONLY_ARG.split('=')[1] : null;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function main() {
    console.log('Migration starting —',
        DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE',
        DEACTIVATE ? '| DEACTIVATING existing reminders' : '| active:' + (ACTIVATE ? 'true' : 'false'),
        ONLY_UID ? '| only ' + ONLY_UID : '');

    const users = ONLY_UID
        ? [await db.collection('users').doc(ONLY_UID).get()]
        : (await db.collection('users').get()).docs;

    const stats = { migrated: 0, alreadyDone: 0, noReminder: 0, badTime: 0, toggled: 0 };

    for (const userSnap of users) {
        if (!userSnap.exists) { console.warn('  user not found:', userSnap.id); continue; }

        const data = userSnap.data() || {};

        // The general reminder time is nested inside pushSubscription — it is
        // NOT a top-level reminderTime field. Verified against app.js and the
        // old send-reminders.js before writing this.
        const sub = data.pushSubscription;
        const localTime = sub && sub.reminderTime;

        if (!localTime) { stats.noReminder++; continue; }

        if (!TIME_RE.test(localTime)) {
            console.warn('  skipping', userSnap.id, '— unparseable time:', JSON.stringify(localTime));
            stats.badTime++;
            continue;
        }

        const reminderRef = userSnap.ref.collection('reminders').doc('general');
        const existing = await reminderRef.get();

        if (existing.exists) {
            // Already migrated. On an --activate/--deactivate pass, flip the
            // flag on the doc that's already there — this is what the cutover
            // and rollback steps actually run.
            const wanted = ACTIVATE;
            if ((ACTIVATE || DEACTIVATE) && existing.data().active !== wanted) {
                if (DRY_RUN) {
                    console.log('  would set active=' + wanted + ' for', userSnap.id);
                } else {
                    await reminderRef.update({
                        active: wanted,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                    console.log('  set active=' + wanted + ' for', userSnap.id);
                }
                stats.toggled++;
            } else {
                stats.alreadyDone++;
            }
            continue;
        }

        // --deactivate only ever touches existing docs; it must not create any.
        if (DEACTIVATE) { stats.noReminder++; continue; }

        // timezone is left null on purpose. The old data stores only a numeric
        // UTC offset (pushSubscription.tzOffset), and an offset cannot be
        // reversed into an IANA zone — several zones share any given offset and
        // differ on DST. The client backfills the real zone on next load
        // (spec §4.1); until then the sender applies the documented fallback
        // and logs it.
        const payload = {
            type: 'general',
            activityId: null,
            activityName: null,
            localTime: localTime,
            timezone: null,
            active: ACTIVATE,
            // nextSendAt is left null and computed by the onReminderWrite
            // trigger, so the scheduling maths exists in exactly one place.
            nextSendAt: null,
            lastSentDate: null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (DRY_RUN) {
            console.log('  would create', userSnap.id, '→ general @', localTime);
        } else {
            await reminderRef.set(payload);
            console.log('  created', userSnap.id, '→ general @', localTime);
        }
        stats.migrated++;
    }

    console.log('\nDone.',
        'Migrated:', stats.migrated,
        '| Toggled:', stats.toggled,
        '| Already correct:', stats.alreadyDone,
        '| No reminder set:', stats.noReminder,
        '| Bad time value:', stats.badTime);

    if (!ACTIVATE && stats.migrated > 0 && !DRY_RUN) {
        console.log('\nDocs were created INACTIVE. They will not send until you');
        console.log('activate them — see DEPLOY.md step 7 (cutover).');
    }
}

main().then(function () { process.exit(0); }).catch(function (err) {
    console.error('Fatal error:', err);
    process.exit(1);
});
