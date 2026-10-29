# Komugo

One-stop activity booking and ticketing marketplace. Launch scope: every sports court, facility and attraction in Putrajaya, listed; only those whose Operator has signed up are Bookable.

## Language

### Supply

**Operator**:
Business or public body that runs Activities. **Signed up** once Komugo staff approve it and agree Commission: it then has Members, can make Activities Bookable and receives Payouts. An Operator that hasn't signed up only attributes Info listings.
_Avoid_: Vendor, merchant, partner

**Activity**:
Something to do, run by one Operator at one Venue (e.g. trail riding at a stable, badminton court hire, a park walk). Bookable or not depends on its Listing mode.
_Avoid_: Product, listing, experience

**Option**:
A specific sellable variant of an Activity with its own price, duration and Resource needs.
_Avoid_: Package, variant, tier

**Booking unit**:
What one Option sale buys: **per person** (one Ticket per Participant) or **per court** (the whole court for one or more back-to-back Timeslots, one Ticket in the Customer's name admitting their group, priced per court).
_Avoid_: Pricing type, mode

**Add-on**:
An optional extra bought with an Option (gear rental, photo package).
_Avoid_: Extra, upsell

**Pack offer**:
What an Operator sells as a Pack on one Activity: name (EN/BM), sessions (1–50), price (≥ RM1), valid days (1–730), eligible Options (at least one, all of that Activity, per-person Timeslot Options only), active. Editing or deactivating an offer never changes a Pack already sold or an order already placed.
_Avoid_: Plan, bundle, product

**Pack**:
A prepaid bundle of sessions with one Operator, bought from a Pack offer. It snapshots the offer's sessions and eligible Options, and expires at the end of the KL day `valid days` after payment. Redeemable only on its eligible Options, for a Timeslot starting no later than expiry; one session = one Ticket, and no Add-ons on a Pack redemption. Customers redeem it at the Pay step ("Use Pack").
_Avoid_: Bundle, membership, credits

**Resource**:
A limited thing an Option consumes during a session: a horse, instructor, belayer, auto-belay lane or court.
_Avoid_: Asset, staff, inventory

**Allocation**:
One Resource assigned to one Participant for a Hold or Ticket, covering the session plus that Resource's rest gap.
_Avoid_: Assignment, reservation

**Welfare Rule**:
A limit on how a horse may be used (max sessions per day, rest gap, max rider weight).

**Ticket type**:
How an Option is scheduled: **Timeslot** (a fixed start time, e.g. courts, rides, cruise departures) or **Date ticket** (valid any time during the Activity's opening hours, or else its Venue's, on one chosen date, e.g. gym, pool, ice rink; sold until the Booking cutoff before that day's closing time).
_Avoid_: Ticket kind, booking type

**Weekend price**:
Optional Date ticket price for Saturdays, Sundays and, if the Operator opts in, Public holidays.

**Public holiday**:
A date on Komugo's staff-kept list of Malaysian and Putrajaya holidays.

**Daily limit**:
Optional cap on Date tickets sold for one Option on one date; unlimited when unset. Lowering it below what's sold stops new sales but keeps sold Tickets valid.
_Avoid_: Capacity, quota

**Timeslot**:
A start time at which an Option can be booked, available only if its Resources are free.
_Avoid_: Session, slot, schedule

**Booking cutoff**:
How many minutes before a Timeslot starts an Activity stops taking new bookings for it (default 60).

**Schedule**:
A weekly pattern of start times for some Options of one Activity, optionally with its own price for the Timeslots it generates (e.g. peak evenings). It keeps Timeslots generated 60 days ahead; a one-off Timeslot sits outside any Schedule.
_Avoid_: Recurrence, template

**Closed day**:
A day an Activity never runs, every week (every Monday) or by week of the month (1st and 3rd Monday). Schedules skip it; a one-off Timeslot may still be added.

**Listing mode**:
How an Activity appears in the catalogue: **Bookable** (Customers buy through Komugo checkout), **Info** (a page with hours, price note and how to go or book elsewhere; no checkout) or **Hidden**. An Activity becomes Bookable only once its Operator has signed up, and leaves Bookable only when it has no future Tickets; an Activity whose Operator is unknown stays Hidden. An Activity leaves Hidden only once it has a Venue with a map pin, a Category, an EN/BM description and a photo; missing hours, price or contact show as "Check with venue".
_Avoid_: Listing type, status

**Venue**:
A physical place in a City (sports complex, park, jetty, mall) with its address, Presint, location and opening hours. Kept by Komugo staff; hosts Activities from one or more Operators, each of which edits only its own Activities and may keep shorter hours than the Venue. Shown only while at least one of its Activities isn't Hidden.
_Avoid_: Location, facility, site

**Presint**:
A numbered district of Putrajaya (Presint 1–20) used to locate Venues.
_Avoid_: Precinct, zone

**City**:
Location hub grouping Activities (e.g. Putrajaya).

**Category**:
Activity type hub named the way people search (e.g. badminton, futsal, cruises & boats).

### Demand

**Interest**:
An email address asking to be told once when an Info Activity becomes Bookable with something on sale. Needs no Sign-in.
_Avoid_: Waitlist, subscription, lead

**Customer**:
The person who pays for a Booking or Pack.
_Avoid_: User, buyer, account

**Participant**:
A named person who attends an Activity; may differ from the Customer.
_Avoid_: Guest, rider, climber, attendee

**Requirement**:
An eligibility rule a Participant must meet for an Option (min age, max weight, certification).
_Avoid_: Restriction, criteria

**Waiver**:
A signed liability release for one Participant at one Operator, for one version of the text, required only by Activities that ask for one. On a per-court Ticket the Customer signs once for their group. An adult Participant signs for themselves; a parent or legal guardian ticks and types their own name for a Participant under 18 on the signing date. A new version replaces the old signature.

**Hold**:
A temporary reservation of Resources while a Customer pays.
_Avoid_: Lock, cart reservation

**Checkout**:
A Customer's in-progress purchase from Option pick to Booking; owns the current Hold and its bill. A new Hold for the Checkout replaces its previous Hold.
_Avoid_: Cart, order

**Sign-in**:
Proving an email address with a 6-digit code sent to it. The first Sign-in creates the Customer; the browser then keeps a session for 30 days. Happens in checkout or standalone (`/sign-in`) for My bookings and Pack purchase. The emailed Booking or Pack link (`k`) only lets its holder view it and make the Closure choice; a voluntary cancel or Reschedule needs the owner's Sign-in.
_Avoid_: Login, account creation

**Booking**:
One completed checkout by a Customer, containing one or more Tickets.
_Avoid_: Order, reservation

**Ticket**:
Admission to one Timeslot or, for a Date ticket, one date: for exactly one Participant on a per-person Option, or for the Customer's group on a per-court Option, over one or more back-to-back Timeslots on the same court (assigned by Komugo and shown on the Ticket).
_Avoid_: Pass, voucher

**Check-in**:
The Operator scanning a Ticket on arrival (its QR, or the first 8 characters of its code). Only on the day of the Timeslot; checking in twice changes nothing.

**Member**:
A person who signs in to the dashboard: **staff** (Komugo, acts for any Operator and publishes Activities) or **operator** (one Operator's team).
_Avoid_: User, admin, account

### Money and changes

**Cancellation Policy**:
Per-Activity free-cancel window (default 24h when all its Options are per-court or Date tickets, else 0; for a per-court Ticket counted from its first hour), shown before payment, in hours before the Timeslot starts (for a Date ticket, before that day's opening time), applied per Ticket against its current Timeslot. Inside the window (`hours > 0` and now ≤ start − hours; so 0 means no free cancel) the Ticket is cancelled with a full Refund of its price plus its fixed share of the Booking's Add-ons (a Pack session returns to the Pack); later it is **forfeited** (no Refund, Pack session stays used). No cancel or Reschedule once the Timeslot has started or the Ticket is checked in. A Ticket on a closed Timeslot is always a full Refund. The Customer sees the outcome before confirming; if it changed meanwhile, the cancel is refused.

**Closure**:
An Operator cancelling a Timeslot (or a date, for Date tickets), with a reason (weather, maintenance, event, horse unfit, other). Closing any hour of a per-court Ticket closes the whole Ticket. Each affected Customer is emailed once to choose a Refund or a Reschedule. The **Closure choice** is one per notice (one Booking, or one Customer's Pack Tickets, in that Timeslot) and applies to all its closed Tickets at once. For Pack Tickets a Refund returns the sessions. Unanswered Closures stay "Awaiting choice".
_Avoid_: Operator cancellation

**Payment**:
One Billplz bill received for a Hold, or for a Pack order (a Customer's purchase of a Pack offer; a late payment always issues the Pack). Either **paid** (it produced the Booking) or **refund_due** with a reason (duplicate, amount mismatch, Timeslot unavailable, unknown Hold), which a Refund then settles.
_Avoid_: Transaction, charge

**Refund**:
Money returned to the Customer by Komugo: one row per refund_due Payment or per cancel action, with a reason (duplicate, amount mismatch, unavailable, unknown Hold, cancel, Closure). It is **due** until staff mark it refunded on "Refunds to pay" after paying it out by hand. The Customer is emailed when it is due ("within 7 working days") and when it is sent.

**Reschedule**:
Moving Tickets of one Booking or Pack from one Timeslot (or date) to another of the same Option, same Ticket (QR unchanged), with Resources re-allocated; a per-court Ticket moves whole, to the same number of back-to-back hours on one court. By the Customer only inside the free-cancel window and only to a target of the same total price (Pack: to a Timeslot before expiry). After a Closure, free to any future open target at the same price or cheaper, with the difference refunded. Prices are fixed when the Hold is made.

**Commission**:
Komugo's cut of each sale: a percentage agreed with each Operator at sign-up, fixed on each Ticket and Pack sale at the time of sale.

**Payout**:
Komugo's monthly transfer to an Operator of that month's sales net of Commission and Refunds, paid by staff by hand and then marked paid. A Refund gives back its Commission; a negative month is carried into the Operator's next month instead of being paid.

## Relationships

- An **Operator** runs many **Activities** and owns many **Resources**
- An **Activity** has exactly one **Category**; a multi-sport Venue lists one **Activity** per sport
- An **Activity** runs at exactly one **Venue**; a **Venue** hosts many **Activities**, possibly from different **Operators**
- An **Activity** has one or more **Options**; an **Option** may offer **Add-ons**
- An **Option** consumes one or more **Resources** for its duration; **Resources** are assigned by Komugo, not chosen by the **Customer**
- A **Booking** belongs to one **Customer** and contains one or more **Tickets**
- A per-person **Ticket** is for exactly one **Participant** and one **Timeslot**, and is issued only after the **Participant** meets the **Requirements** and, if the **Activity** requires one, has a **Waiver**
- A **Participant** can't hold overlapping per-person Timeslot **Tickets** at one **Operator**; back-to-back is fine
- A **Customer** may hold at most 2 overlapping per-court **Tickets** per **Activity** (the Operator can change this); per-court Options have no **Requirements** and courts no rest gap
- A **Pack offer** belongs to one **Activity**; a **Pack** is redeemable only on its eligible **Options**
- A **Pack** belongs to one **Customer** and one **Operator**; any **Participant** on that **Customer**'s account may redeem it, and each redemption produces a **Ticket**
- A **Closure** lets the **Customer** choose a **Refund** or a **Reschedule**

## Example dialogue

> **Dev:** "A dad buys an 8-session riding **Pack**. Can his daughter use one session?"
> **Domain expert:** "Yes, she's a **Participant** on his account. But she still has to meet the **Requirements**, and he signs her **Waiver** as guardian before her **Ticket** is issued."
> **Dev:** "And if it rains that day?"
> **Domain expert:** "That's a **Closure**. He chooses a **Reschedule** or a **Refund**. For a **Pack** redemption, the refund returns the session to the **Pack**."

## Flagged ambiguities

- "Session" could mean a Timeslot, a Ticket or a Pack unit. Resolved: use **Timeslot** for the bookable time and **Ticket** for attendance. A Pack holds sessions only as a count.
- "Cancellation" covered both Customer and Operator actions. Resolved: the Customer **cancels** (Cancellation Policy applies); the Operator makes a **Closure**.
