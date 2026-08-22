# Firestore rules tests

Runs the real rules against the Firestore emulator, as a hostile client.

    cd test/rules
    npm install
    npm test

`firestore.rules` at the repo root is the canonical copy. It is deliberately
NOT wired into `firebase.json` — rules are managed in the Firebase console, so
`firebase deploy` will never push this file. Keep the two in sync by hand, and
re-run these tests after editing either.

## The 1000-expression budget

Firestore caps a single rule evaluation at 1000 expressions, and a **denied**
write is the expensive case: it has to evaluate every branch before it can
conclude. Exceeding the cap denies the write with a limit error that looks
exactly like a real refusal — including for writes that should have been
allowed.

The first version of these rules blew that ceiling: 22 of the hostile-client
denials were the limit firing, not the logic. That is why the `/challenges`
block uses `diff().affectedKeys()` rather than field-by-field comparison, and
puts a cheap status discriminator in front of every transition so at most one
heavy branch is ever evaluated.

If you add a clause, re-run this suite and check the output for
`maximum of 1000 expressions` — any occurrence means the budget is blown again,
even if every assertion still passes.

## A note on `firebase.json`

The emulator config here deliberately declares no `firestore.rules` path.
Newer `firebase-tools` refuses a rules file outside the project directory, and
the canonical rules live at the repo root. It makes no difference to what is
tested: `initializeTestEnvironment` reads `../../firestore.rules` itself and
installs it in the emulator, so every assertion runs against the real file.
