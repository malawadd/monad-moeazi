# Moderated novice usability study

Status: **planned; no participants recruited or observed.** The session uses
only the clickable prototype and fictional balances. Never request a passkey,
wallet secret, real funds or a live trade.

## Participants and setup

Recruit five adults with no prior trading experience, spanning age groups. Aim
for one person in each band: 18–29, 30–44, 45–59, 60–69, and 70+. Record age
band, device familiarity and prior wallet use without collecting unnecessary
personal details. Include large-text and assistive-technology use where
participants volunteer it; do not exclude someone for needing accessibility
support.

Test on an Android emulator at a small phone viewport and at the captured
1080 × 2400 emulator geometry. Also inspect large text and reduced-motion
settings. Prototype values are labeled simulated. The reviewer panel may set
empty, funded, active, completed, unavailable and recovery states; explain that
these are scenarios, not live account data.

## Moderator opening

“We are testing the screen, not you. This is a simulation using test balances.
There is no real wallet or transaction. Please think aloud and do what you would
normally do. I will not help unless you are blocked. You may stop at any time.”

Avoid explaining the interface, the location of controls, or what the product
should do. Ask “What do you expect will happen?” before each primary action.

## Tasks

1. **Understand the balance:** “You have just opened Moeazi. What do you have,
   and which balance would pay a network fee?” Ask participant to describe what
   test AUSD does and does not represent.
2. **Get test MON:** “You need network funds before you continue. Show me how you
   would get them.” Use the simulated faucet return; observe whether they expect
   opening the external faucet to confirm arrival.
3. **Request test AUSD:** “Now get test AUSD.” Ask who receives the claim, what
   they expect to know about the amount before confirming, and what the
   fee/permission means. Stop before any real signature (prototype contains
   none).
4. **Start autonomy:** “Find a strategy you might try and show me what you would
   review before enabling it.” Ask what is fixed, how long it can run, what can
   happen to the balance, and whether profit is guaranteed.
5. **Check an active run:** Set the active scenario. “You want the run to stop.
   What would you do, and when would you expect the money back?” Observe whether
   the person separates stop request from settlement and returned funds.
6. **Find manual trading:** “Suppose you want to buy a token yourself. Where
   would you go? How is that different from opening a Perpl position?”
7. **Find advanced screens:** “A support guide asks you to switch to Developer
   Mode. Show me where you would look, then return to the simpler experience.”
   Ask what they think the switch changes.

If time is short, prioritize tasks 1–5. Never coach before recording a blocked
task; offer help only after the unassisted attempt is logged.

## Interaction detail checklist

For each task, note the tap path and count, scroll distance/return behavior,
keyboard type and dismissal, Back behavior, loading feedback, copy-address
confirmation, touch-target misses, motion/reduced-motion behavior, and whether
an external-page return resumes the prior step. Capture error/recovery wording
for offline, stale balances, insufficient MON, faucet rejection, rejected
passkey, expired quote and uncertain submission. These are planned observations;
the baseline screenshots do not establish them.

## Measures and success threshold

Record task completion unaided / with hint / incomplete, first action, wrong
turns, route clarity, time only if the participant consents, and a 1–5 confidence
rating after tasks 1, 3, 4 and 5. Ask open recall questions rather than leading.

Principal flows are balance comprehension, funding (MON then AUSD), strategy
review, and stop/settlement comprehension. Target at least **4 of 5** participants
completing each critical flow without coaching. This is a design target, not a
result or statistical claim. Treat any belief that test balances are cash or
that profit/instant withdrawal is guaranteed as a serious comprehension issue.

## Notes template

Use anonymous participant IDs P1–P5. For each task, record:

| Field | Note |
|---|---|
| Scenario/state | |
| Completion | Unaided / hint / incomplete |
| First action and route | |
| Misclicks or hesitation | |
| Words misunderstood | |
| Risk/amount/fee recalled | |
| Confidence (1–5) | |
| Quote or observation | |
| Severity and proposed change | |

Record no participant results until sessions have actually occurred. Summarize
what was observed, sample limitations, and what remains untested in
[findings.md](findings.md).
