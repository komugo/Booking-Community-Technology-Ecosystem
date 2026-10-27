# Availability is derived from Resources, not fixed Timeslot capacity

Horses, instructors, belayers and lanes are shared across Options and have Welfare Rules. A fixed capacity number per Timeslot cannot stop the same horse from being double-booked or overworked. So each Option declares the Resources it consumes, and Komugo auto-assigns them. This is heavier than the Klook-style capacity count, and it was chosen on purpose.

Each Allocation holds one Resource for one Participant over the half-open block `[start, start + duration + rest gap)`. Allocation runs inside the Operator's Durable Object (ADR 0004): its SQLite is the source of truth, and every check (free Resource, rest gap, max sessions per KL day, max rider weight) and its write happen in one `transactionSync`, serialized per Operator. A SQLite trigger that rejects overlapping Allocations on the same Resource is the backstop. This replaces the earlier Postgres `EXCLUDE` constraint on Resource time ranges.

Consequences: stored blocks are fixed when allocated, so an Operator cannot lengthen an Option's duration or a horse's rest gap while live Allocations use it (they use a Closure or a new Option instead). Availability shown in the catalogue (`proj_timeslots.spots`) is a projection that ignores rider weight and Requirements; the Durable Object decides at Hold time.
