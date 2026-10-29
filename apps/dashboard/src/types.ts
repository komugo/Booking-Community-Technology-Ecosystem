import type { Weekday } from "@komugo/types/rules";

export type Locale = "en" | "ms";
export type Named = { nameEn: string; nameMs: string };
export type Waiver = "signed" | "guardian" | "outdated" | "missing" | "not_required";
export type ResourceKind = "horse" | "instructor" | "belayer" | "auto_belay_lane";
export type ClosureReason = "weather" | "horse_unfit" | "other";
export type Outcome = "checked_in" | "already" | "not_today" | "closed" | "cancelled" | "not_found" | "ambiguous";

export type Member = { email: string; name: string; role: "staff" | "operator" };
export type Me = { member: Member; operators: { id: string; name: string }[] };

export type Ticket = {
  id: string;
  code: string;
  checkedInAt: number | null;
  resources: string[];
  participant: { name: string; age: number | null; weightKg: number | null };
  waiver: Waiver;
  signerName: string | null;
};
export type Group = {
  bookingId: string | null;
  packId: string | null;
  customerId: string;
  contact: { name: string; phone: string | null; email: string | null };
  addOns: (Named & { quantity: number })[];
  notice: { emailedAt: number | null; choice: "refund" | "reschedule" | null; chosenAt: number | null } | null;
  tickets: Ticket[];
};
export type Timeslot = {
  id: string;
  startsAt: number;
  closedAt: number | null;
  closedReason: string | null;
  spots: number;
  option: Named & { id: string; durationMinutes: number };
  groups: Group[];
};

export type CheckIn = {
  outcome: Outcome;
  ticket: null | {
    id: string;
    code: string;
    bookingId: string | null;
    timeslotId: string;
    startsAt: number;
    checkedInAt: number | null;
    option: Named;
    participant: Ticket["participant"];
    waiver: Waiver;
    signerName: string | null;
  };
};

export type Option = Named & {
  id: string;
  activityId: string;
  priceSen: number;
  durationMinutes: number;
  minAge: number | null;
  maxAge: number | null;
  maxWeightKg: number | null;
  requiredCert: string | null;
  minParticipants: number | null;
  active: boolean;
  needs: { kind: ResourceKind; quantity: number }[];
};
export type AddOn = Named & { id: string; activityId: string; priceSen: number; active: boolean };
export type Resource = {
  id: string;
  kind: ResourceKind;
  name: string;
  active: boolean;
  maxSessionsPerDay: number | null;
  restMinutes: number;
  maxRiderWeightKg: number | null;
};
export type Schedule = {
  id: string;
  activityId: string;
  optionIds: string[];
  weekdays: Weekday[];
  times: string[];
  startsOn: string;
  endsOn: string | null;
  active: boolean;
};
export type PackOffer = Named & {
  id: string;
  activityId: string;
  sessions: number;
  priceSen: number;
  validDays: number;
  optionIds: string[];
  active: boolean;
};
export type RefundRow = {
  id: string;
  operatorName: string;
  amountSen: number;
  reason: "duplicate" | "amount_mismatch" | "unavailable" | "unknown_hold" | "cancel" | "closure";
  createdAt: number;
  refundedAt: number | null;
  billId: string | null;
  bookingId: string | null;
  customer: { name: string | null; email: string | null; phone: string | null };
};
export type ListingMode = "bookable" | "info" | "hidden";
export type PayoutRow = {
  operatorId: string;
  operatorName: string;
  month: string;
  salesSen: number;
  commissionSen: number;
  refundsSen: number;
  amountSen: number;
  paidSen: number | null;
  paidAt: number | null;
};
export type Setup = {
  activities: { id: string; freeCancelHours: number; bookingCutoffMinutes: number; closedDays: string[]; requiresWaiver: boolean }[];
  options: Option[];
  addOns: AddOn[];
  resources: Resource[];
  schedules: Schedule[];
  packOffers: PackOffer[];
  commissionBps: number | null;
  catalogue: (Named & { id: string; slugEn: string; slugMs: string; listingMode: ListingMode })[];
};
export type Generated = { created: number; removed: number; kept: { id: string; optionId: string; startsAt: number }[] };
