# From Curiosity to Confident Participation

For a first-time user, the first successful outcome is not necessarily a trade.

It may be understanding what the wallet contains. It may be funding the correct network
without making a costly mistake. It may be seeing the AI review a market and choose to
hold. It may be learning where the Stop control is before deciding whether to start.

Moeazi Mobile is designed around that progression.

```text
curiosity
  -> simple Magic sign-in
  -> Arbitrum wallet ownership
  -> guided USDC funding
  -> bounded AI-managed amount
  -> visible market explanations
  -> monitored activity
  -> pause, stop, review, and learn
  -> deeper participation over time
```

## The first experience should build understanding

The app is intentionally beginner-first. A new user should be able to reach the point
where they can start the AI trader without first configuring model providers, venues,
routing systems, or blockchain infrastructure.

That does not mean those systems do not exist. It means the product does not make a new
user carry their complexity before the user has learned the basic relationship between
their wallet, their funds, the AI, and the market.

## Identity and funding come before automation

Magic provides the sign-in and owner-wallet boundary. The user controls the wallet and
the Universal Account associated with it. Moeazi Mobile does not accept an arbitrary
wallet address from the client or create a fallback owner key.

The first funding journey is deliberately specific:

- the active network is Arbitrum;
- the direct trading asset is canonical Arbitrum USDC;
- ETH is shown separately as money needed for network fees;
- the app explains the network and asset before revealing or copying the deposit
  address;
- stale or interrupted observations remain visible instead of being silently treated
  as current.

These details are not incidental implementation choices. They are part of teaching a
new user how onchain participation works without making them reverse-engineer the
system from an error message.

## Funding is not permission to trade

Money entering the wallet does not automatically approve a strategy, delegate an
authority, swap an asset, or move funds. Starting the AI later confirms a bounded amount
that the system is allowed to manage.

This separation is important for a beginner. It prevents a user from confusing “I
funded my wallet” with “the AI can do anything with my money.” It also gives the product
a clear explanation for every transition: wallet ownership, funding, managed amount,
AI activity, and execution are different states.

## The AI can act, but it can also hold

The mobile experience presents the AI trader as a bounded service, not as a machine that
must always produce a trade. It watches configured markets, reviews evidence, checks
limits, and may decide that no new action is justified.

“Hold” is a meaningful result. It can mean the evidence is not strong enough, risk is
outside the allowed conditions, information is stale, or the opportunity does not clear
the system's limits. A first-time user should learn that disciplined non-action is part
of trading—not a product failure.

## Visibility turns automation into a learning loop

The app gives the user several ways to understand the system:

- **Home** shows balance, managed amount, credits, current AI state, and the primary
  action.
- **Markets** gives short explanations before exposing deeper market detail.
- **Agent** shows the work sequence and readable evidence summaries where available.
- **Activity** records AI work, trades, money movement, credits, and safety events.
- **Account** exposes wallet, funding, limits, credits, and emergency controls.

The point is not to expose hidden private reasoning. The point is to expose useful
facts: what the system checked, what it concluded, what it did, what it did not do,
and what the user can do next.

## The adoption flywheel

The intended growth loop looks like this:

1. A curious person enters through a familiar mobile experience.
2. Guided language reduces the chance that the first funding step feels opaque.
3. A bounded managed amount lets the person begin with controlled exposure.
4. Visible activity helps the person learn markets and system behavior.
5. Pause, stop, and safety controls create confidence through reversibility.
6. A more confident user can explore additional markets, activity, and Arbitrum apps.

This is an adoption hypothesis. It must be validated through user behavior and education
outcomes, not assumed from the existence of the flow.

