# Firebase config — reference only, NOT deployed

The two files in this folder are **documentation**. They are deliberately not
referenced from `firebase.json`, so `firebase deploy` will never apply them.

Why: this repo has never contained any Firebase configuration — the live
Firestore security rules and indexes are managed in the Firebase Console, and
there is no copy of them here. A `firestore.rules` file wired into the deploy
would replace the entire live ruleset with only the rules someone could infer
from the client code, silently dropping whatever protects `publicProfiles`,
`friendRequests`, the group collections, and the rest.

So: apply these by hand in the Console, merging the reminders block into the
rules you already have.

- **`reminders.rules`** — the `match` block to paste into your existing rules.
- **`firestore.indexes.json`** — the composite index the per-minute due-query
  needs. Easiest path is to let Firestore generate it for you: run the query
  once, and the error in the Functions log contains a direct "create index"
  link. Otherwise create it manually from the values in that file.

Step-by-step instructions are in [`../DEPLOY.md`](../DEPLOY.md).
