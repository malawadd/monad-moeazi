# Instrument lifecycle registry

Feature 07 is a local, fixture-only registry for exact native instrument identity,
immutable definition versions, aliases, lifecycle events and operation decisions.
It does not load venue metadata, operate a product catalog, route a trade, sign,
broadcast, migrate a position, settle an account, or call a network.

The isolated Test Center evaluates frozen identities and events. Missing,
ambiguous, stale, disputed, or rebaseline-required records block new exposure.
The safe lanes (`cancel`, `reduce`, `settle`, and `reconcile`) are independently
checked against the local synthetic lifecycle matrix.

Timescale migration 017 reserves immutable local fixture history. Convex does not
own Feature 07 state, Redis only retains the existing expiring Test Center control
lease, and the command reducer is deliberately unregistered with Temporal.

Product availability is unavailable. Future activation needs authoritative native
metadata and lifecycle-event owners, production storage review, independent
continuity review, routing integration, and separate approval for any paid or live
validation work.
