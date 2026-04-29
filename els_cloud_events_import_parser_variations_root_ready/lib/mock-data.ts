import type { CityPool, CrewMember, Show, LaborDay, SubCall, PayrollRow } from "@/lib/types";

export const cityPools: CityPool[] = [
  { id: "new-orleans", name: "New Orleans, LA" },
  { id: "nashville", name: "Nashville, TN" },
  { id: "atlanta", name: "Atlanta, GA" },
];

export const crew: CrewMember[] = [
  {
    id: "crew-1",
    name: "Example Tech One",
    city: "New Orleans, LA",
    group: "Tier 1 New Orleans",
    tier: "1",
    email: "tech1@example.com",
    phone: "(504) 555-0101",
    positions: [
      { role: "Crew Lead", rate: 700 },
      { role: "Breakout Lead", rate: 700 },
    ],
    conflictCompanies: ["Example AV Co"],
    notes: "Seed this with your real crew list.",
  },
  {
    id: "crew-2",
    name: "Example Tech Two",
    city: "Atlanta, GA",
    group: "Tier 2 Atlanta",
    tier: "2",
    email: "tech2@example.com",
    phone: "(404) 555-0202",
    positions: [
      { role: "Breakout Operator", rate: 600 },
      { role: "General AV", rate: 450 },
    ],
    conflictCompanies: [],
    notes: "Use the CSV rebuild as your next import source.",
  },
];

export const shows: Show[] = [
  {
    id: "show-1",
    name: "VS EXCHANGE26",
    client: "Example Client",
    rateCity: "New Orleans, LA",
    showStart: "2026-04-27",
    showEnd: "2026-05-02",
    status: "Upcoming",
  },
];

export const laborDays: LaborDay[] = [
  { id: "day-1", showId: "show-1", date: "2026-04-27", label: "Load In" },
  { id: "day-2", showId: "show-1", date: "2026-04-29", label: "Show Day" },
];

export const subCalls: SubCall[] = [
  {
    id: "call-1",
    laborDayId: "day-1",
    area: "General Session",
    role: "Crew Lead",
    startTime: "07:00",
    endTime: "17:00",
    crewNeeded: 1,
  },
  {
    id: "call-2",
    laborDayId: "day-1",
    area: "Breakouts",
    role: "Breakout Operator",
    startTime: "08:00",
    endTime: "16:00",
    crewNeeded: 4,
  },
];

export const payrollRows: PayrollRow[] = [
  {
    id: "pay-1",
    showId: "show-1",
    crewId: "crew-1",
    role: "Crew Lead",
    baseEstimate: 700,
    payType: "Regular",
    paid: false,
  },
];
