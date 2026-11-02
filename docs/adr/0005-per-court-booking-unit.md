# Courts are booked per court, not per person

Komugo was built around one Ticket, one Waiver and one Allocation per Participant (horses, climbing). Courts in Putrajaya (badminton, futsal, tennis, takraw) are rented whole by a group, priced per court per hour, with no waiver. Modelling each player as a Participant would consume one court per player and force names and birth dates for a whole futsal team. So each Option has a Booking unit: per person (unchanged) or per court, where one Ticket in the Customer's name admits their group, takes one court Resource and is priced per court. Waivers become an Activity setting; a per-court Activity that requires one gets a single signature from the Customer for the group.

Consequence: "Ticket" no longer always means one Participant, and per-court Tickets carry no Participant-level Requirements (age, weight).
