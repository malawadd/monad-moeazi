# Live validation gate

This local implementation must not be activated from this repository state. It needs independently owned authoritative market/route adapters, certified actual execution receipts, data-rights and retention approval, reviewers, and a separate explicit cost and activation approval. Cost is currently unknown.

Before any future activation, collect chronological exact-cell data (venue, order/TIF, size bucket, regime), preserve immutable receipt/match evidence, require at least 100 effective certified actual matches per cell, and review a holdout whose MAE improvement interval excludes zero without optimism or tail regression. Abort on source drift, missing cost fields, sequence gaps, lifecycle invariant breaches, or any route/signer/provider boundary reachability. Roll back by disabling new simulations while preserving immutable history; no product setting may change automatically.
