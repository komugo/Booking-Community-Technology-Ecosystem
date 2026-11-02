# WhatsApp-first Operators, staff keep setup

Putrajaya Operators already run on WhatsApp and won't learn a dashboard, so by default an Operator never signs in: staff keep its setup and Schedules, and its Operator contacts get one-way WhatsApp messages (Booking alerts, Closure done, Payout notice). Every Booking alert carries a signed Operator link to that day's Day list, where the counter can close a Timeslot or date on the day itself. Future-date Closures and other changes go through staff by WhatsApp. The operator dashboard stays for Members who want it, with Setup, weekly Schedules and Scan hidden, not removed; Check-in is off and the counter admits Customers by the Day list. Customers stay on email.

We dropped the 9pm Digest to keep it simple: a Booking alert for every change, each linking to its day's Day list, tells the counter everything the Digest did without a scheduled send or a "has the Digest gone out" rule.

## Consequences

- Sending is through WasenderAPI on a dedicated Komugo number linked by QR, which can be banned or silently disconnected. Messages are queued and sent one at a time with automatic retry to stay under its rate limit; Booking alerts are also emailed to owners, failed sends and a disconnected device show in the internal dashboard, and messages stay template-shaped so we can move to Meta's WhatsApp Cloud API (paid per message) at about 20–30 Operators.
- An alert for every change means more messages for a busy Operator than one Digest would, adding to the ban risk.
- Staff are the bottleneck for Operator setup and changes; this holds only at launch scale.
- With Check-in off there is no attendance or no-show data.
