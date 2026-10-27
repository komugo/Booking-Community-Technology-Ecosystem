# Komugo

One-stop activity booking and ticketing marketplace. Launch scope: equestrian and climbing activities in Putrajaya.

## Language

### Supply

**Operator**:
Business that runs activities and receives Payouts from Komugo.
_Avoid_: Vendor, merchant, partner

**Activity**:
A bookable experience run by one Operator at one place (e.g. trail riding at a stable).
_Avoid_: Product, listing, experience

**Option**:
A specific sellable variant of an Activity with its own price, duration and Resource needs.
_Avoid_: Package, variant, tier

**Add-on**:
An optional extra bought with an Option (gear rental, photo package).
_Avoid_: Extra, upsell

**Pack**:
A prepaid bundle of sessions with one Operator, redeemable before expiry.
_Avoid_: Bundle, membership, credits

**Resource**:
A limited thing an Option consumes during a session: a horse, instructor, belayer or auto-belay lane.
_Avoid_: Asset, staff, inventory

**Welfare Rule**:
A limit on how a horse may be used (max sessions per day, rest gap, max rider weight).

**Timeslot**:
A start time at which an Option can be booked, available only if its Resources are free.
_Avoid_: Session, slot, schedule

**City**:
Location hub grouping Activities (e.g. Putrajaya).

**Category**:
Activity type hub (e.g. horse riding, rock climbing).

### Demand

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
A signed liability release for one Participant; signed by a guardian for minors.

**Hold**:
A temporary reservation of Resources while a Customer pays.
_Avoid_: Lock, cart reservation

**Booking**:
One completed checkout by a Customer, containing one or more Tickets.
_Avoid_: Order, reservation

**Ticket**:
Admission for exactly one Participant to one Timeslot.
_Avoid_: Pass, voucher

**Check-in**:
The Operator scanning a Ticket on arrival.

### Money and changes

**Cancellation Policy**:
Per-Activity rule for refunds when a Customer cancels.

**Closure**:
An Operator cancelling a Timeslot (weather, horse unfit).
_Avoid_: Operator cancellation

**Refund**:
Money returned to the Customer by Komugo.

**Reschedule**:
Moving a Ticket to another Timeslot of the same Option.

**Commission**:
Komugo's cut of each sale.

**Payout**:
Komugo's scheduled transfer to an Operator, net of Commission and Refunds.

## Relationships

- An **Operator** runs many **Activities** and owns many **Resources**
- An **Activity** has one or more **Options**; an **Option** may offer **Add-ons**
- An **Option** consumes one or more **Resources** for its duration; **Resources** are assigned by Komugo, not chosen by the **Customer**
- A **Booking** belongs to one **Customer** and contains one or more **Tickets**
- A **Ticket** is for exactly one **Participant** and one **Timeslot**, and is issued only after the **Participant** meets the **Requirements** and has a **Waiver**
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
