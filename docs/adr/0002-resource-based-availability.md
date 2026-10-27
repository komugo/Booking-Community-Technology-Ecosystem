# Availability is derived from Resources, not fixed Timeslot capacity

Horses, instructors, belayers and lanes are shared across Options and have Welfare Rules. A fixed capacity number per Timeslot cannot stop the same horse from being double-booked or overworked. So each Option declares the Resources it consumes, and Komugo auto-assigns them. Postgres exclusion constraints on Resource time ranges prevent double-booking. This is heavier than the Klook-style capacity count, and it was chosen on purpose.
