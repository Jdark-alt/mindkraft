const webpush   = require('web-push');
const admin     = require('firebase-admin');

// ── 1. Initialise Firebase Admin ──────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── 2. Initialise web-push with VAPID keys ────────────────────────────────
webpush.setVapidDetails(
    'mailto:' + process.env.VAPID_CONTACT_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
);

// ── 3. Build a set of UTC "HH:MM" strings for the past 5 minutes ─────────
function buildTimeWindow() {
    var times = new Set();
    var now   = Date.now();
    for (var i = 0; i <= 59; i++) {
        var t = new Date(now - i * 60 * 1000);
        var hh = String(t.getUTCHours()).padStart(2, '0');
        var mm = String(t.getUTCMinutes()).padStart(2, '0');
        times.add(hh + ':' + mm);
    }
    return times;
}

// ── 4. Convert a user's local reminder time to UTC ────────────────────────
function localToUTC(localTime, tzOffset) {
    var parts        = localTime.split(':');
    var localMinutes = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    var utcMinutes   = ((localMinutes + (tzOffset || 0)) % 1440 + 1440) % 1440;
    var hh = String(Math.floor(utcMinutes / 60)).padStart(2, '0');
    var mm = String(utcMinutes % 60).padStart(2, '0');
    return hh + ':' + mm;
}

// ── 5. Main ───────────────────────────────────────────────────────────────
async function main() {
    var timeWindow = buildTimeWindow();
    var todayUTC   = new Date().toISOString().slice(0, 10);

    console.log('Run at UTC:', new Date().toISOString());
    console.log('Checking window:', [...timeWindow].join(', '));

    var snapshot = await db.collection('users').get();
    var sent = 0, skipped = 0, errors = 0;

    for (var i = 0; i < snapshot.docs.length; i++) {
        var docRef = snapshot.docs[i].ref;
        var data   = snapshot.docs[i].data();
        var sub    = data.pushSubscription;

        if (!sub || !sub.reminderTime || !sub.endpoint || !sub.keys) {
            skipped++;
            continue;
        }

        if (data.reminderLastSent === todayUTC) {
            skipped++;
            continue;
        }

        var reminderUTC = localToUTC(sub.reminderTime, sub.tzOffset);
        if (!timeWindow.has(reminderUTC)) {
            skipped++;
            continue;
        }

        try {
            await webpush.sendNotification(
                { endpoint: sub.endpoint, keys: sub.keys },
                JSON.stringify({
                    title: 'Mindkraft ⚔️',
                    body:  "Don't forget to check off today's tasks!"
                })
            );
            await docRef.update({ reminderLastSent: todayUTC });
            sent++;
            console.log('Sent to user', snapshot.docs[i].id);
        } catch (err) {
            errors++;
            console.error('Failed for user', snapshot.docs[i].id, '— status:', err.statusCode);
            if (err.statusCode === 410 || err.statusCode === 404) {
                try {
                    await docRef.update({
                        pushSubscription: admin.firestore.FieldValue.delete()
                    });
                    console.log('Cleaned up stale subscription for', snapshot.docs[i].id);
                } catch (e) {}
            }
        }
    }

    console.log('Done. Sent:', sent, '| Skipped:', skipped, '| Errors:', errors);
}

main().catch(function(err) {
    console.error('Fatal error:', err);
    process.exit(1);
});
