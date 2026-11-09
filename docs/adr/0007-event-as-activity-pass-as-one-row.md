# An Event is an Activity, and a Pass is one row spanning all Event days

Komugo adds event ticketing (concerts, bazaars, fun runs). Rather than a separate Event entity with its own tiers, tickets, checkout and payouts, an Event is an Activity whose Options are all Event tickets: each tier is an Option, each Event day is a `timeslots` row with `starts_at`/`ends_at` entered by the Operator (as ADR-0006 does for Date tickets), capacity is the Option's Daily limit, and Holds, CHIP checkout, Refunds, Closures, Commission, Payouts and the Day list work unchanged.

A Pass (every Event day) is stored as a single row from the first day's start to the last day's end, so a Ticket keeps exactly one `timeslot_id`.

## Considered Options

- Separate Event entity: clearer naming, but duplicates the whole booking and money path.
- Pass as one Ticket per Event day: per-day Closure and Check-in come free, but one purchase becomes several Tickets with split prices, cancels and QRs.

## Consequences

- Closing one Event day doesn't touch the Pass row, so a Pass needs its own rule: an automatic partial Refund of price ÷ number of Event days (remainder on the last day), reason Closure, no Closure choice.
- Check-in on a Pass is once per Event day, so a Ticket can have more than one check-in.
- Cutoff, cancel window and Reschedule for a Pass all count from the first Event day; a Pass can't be rescheduled.
- A Pass's Daily limit is separate from day tickets: there is no shared Event capacity.
