export type CrewPayDefault = {
  fullDay: number;
  halfDay: number | null;
};

export function normalizeCrewPayRole(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const crewPayDefaults: Record<string, CrewPayDefault> = {
  "general av": { fullDay: 350, halfDay: 175 },
  gav: { fullDay: 350, halfDay: 175 },
  avt: { fullDay: 350, halfDay: 175 },
  "av tech": { fullDay: 350, halfDay: 175 },
  "audio visual tech": { fullDay: 350, halfDay: 175 },
  "audio visual technician": { fullDay: 350, halfDay: 175 },
  floater: { fullDay: 350, halfDay: 175 },
  "float tech": { fullDay: 350, halfDay: 175 },
  stagehand: { fullDay: 300, halfDay: 150 },
  "stage hand": { fullDay: 300, halfDay: 150 },

  "led stagehand": { fullDay: 350, halfDay: 175 },
  "led assist": { fullDay: 350, halfDay: 175 },
  "led tech": { fullDay: 350, halfDay: 175 },
  "led technician": { fullDay: 350, halfDay: 175 },

  "audio assist": { fullDay: 350, halfDay: 175 },
  "a2 audio assist": { fullDay: 350, halfDay: 175 },
  "a2 audio engineer": { fullDay: 350, halfDay: 175 },
  "a2": { fullDay: 350, halfDay: 175 },
  "video assist": { fullDay: 350, halfDay: 175 },
  "v2 video assist": { fullDay: 350, halfDay: 175 },
  "v2": { fullDay: 350, halfDay: 175 },
  "lighting assist": { fullDay: 350, halfDay: 175 },
  "l2 lighting assist": { fullDay: 350, halfDay: 175 },
  "l2": { fullDay: 350, halfDay: 175 },
  "audio setup and strike": { fullDay: 350, halfDay: 175 },
  "video set strike": { fullDay: 350, halfDay: 175 },
  "lighting setup strike": { fullDay: 350, halfDay: 175 },
  "lighting set strike": { fullDay: 350, halfDay: 175 },
  decoration: { fullDay: 300, halfDay: 150 },

  "client facing audio visual tech": { fullDay: 400, halfDay: 200 },
  "client facing av tech": { fullDay: 400, halfDay: 200 },
  "cf avt": { fullDay: 400, halfDay: 200 },
  "breakout operator": { fullDay: 400, halfDay: 200 },
  "breakout tech": { fullDay: 400, halfDay: 200 },
  "breakout technician": { fullDay: 400, halfDay: 200 },
  bo: { fullDay: 400, halfDay: 200 },
  "bo tech": { fullDay: 400, halfDay: 200 },

  "crew lead": { fullDay: 500, halfDay: null },
  "working crew lead": { fullDay: 500, halfDay: null },
  "breakout lead": { fullDay: 500, halfDay: null },
  "audio engineer": { fullDay: 500, halfDay: null },
  "a1 audio engineer": { fullDay: 500, halfDay: null },
  "a1": { fullDay: 500, halfDay: null },
  "lead video engineer": { fullDay: 500, halfDay: null },
  "v1 lead video engineer": { fullDay: 500, halfDay: null },
  "v1": { fullDay: 500, halfDay: null },
  "lighting designer": { fullDay: 500, halfDay: null },
  ld: { fullDay: 500, halfDay: null },
  "speaker ready": { fullDay: 500, halfDay: null },
  "graphics operator": { fullDay: 500, halfDay: null },
  "playback operator": { fullDay: 500, halfDay: null },
  "zoom operator": { fullDay: 500, halfDay: null },
  "record operator": { fullDay: 500, halfDay: null },
  "camera operator": { fullDay: 500, halfDay: null },
  "camera operator ptz": { fullDay: 500, halfDay: null },
  "down rigger": { fullDay: 400, halfDay: 200 },
  "audio show support": { fullDay: 400, halfDay: 200 },
};


export type CrewRoleRateOption = {
  roleName: string;
  fullDay: number;
  halfDay: number | null;
  featured?: boolean;
};

export const crewRoleRateOptions: CrewRoleRateOption[] = [
  { roleName: "GAV", fullDay: 350, halfDay: 175, featured: true },
  { roleName: "LED Stagehand", fullDay: 350, halfDay: 175, featured: true },
  { roleName: "Stagehand", fullDay: 300, halfDay: 150, featured: true },
  { roleName: "BO Tech", fullDay: 400, halfDay: 200, featured: true },
  { roleName: "Floater", fullDay: 350, halfDay: 175, featured: true },
  { roleName: "Crew Lead", fullDay: 500, halfDay: null, featured: true },
  { roleName: "AVT", fullDay: 350, halfDay: 175 },
  { roleName: "General AV", fullDay: 350, halfDay: 175 },
  { roleName: "LED Assist", fullDay: 350, halfDay: 175 },
  { roleName: "A2-Audio Assist", fullDay: 350, halfDay: 175 },
  { roleName: "V2-Video Assist", fullDay: 350, halfDay: 175 },
  { roleName: "L2-Lighting Assist", fullDay: 350, halfDay: 175 },
  { roleName: "CF AVT", fullDay: 400, halfDay: 200 },
  { roleName: "Breakout Operator", fullDay: 400, halfDay: 200 },
  { roleName: "Audio Show Support", fullDay: 400, halfDay: 200 },
  { roleName: "Breakout Lead", fullDay: 500, halfDay: null },
  { roleName: "A1-Audio Engineer", fullDay: 500, halfDay: null },
  { roleName: "V1-Lead Video Engineer", fullDay: 500, halfDay: null },
  { roleName: "LD-Lighting Designer", fullDay: 500, halfDay: null },
  { roleName: "Graphics Operator", fullDay: 500, halfDay: null },
  { roleName: "Camera Operator", fullDay: 500, halfDay: null },
];

export function getDefaultCrewPay(roleName: string | null | undefined): CrewPayDefault | null {
  const role = normalizeCrewPayRole(roleName);
  if (!role) return null;
  if (crewPayDefaults[role]) return crewPayDefaults[role];

  if (/\bgav\b|\bavt\b|general av|audio visual tech/.test(role)) return crewPayDefaults["general av"];
  if (/client facing|\bcf\b/.test(role)) return crewPayDefaults["client facing audio visual tech"];
  if (/floater|float tech/.test(role)) return crewPayDefaults.floater;
  if (/led/.test(role)) return crewPayDefaults["led assist"];
  if (/breakout/.test(role) && /lead/.test(role)) return crewPayDefaults["breakout lead"];
  if (/breakout|\bbo\b/.test(role)) return crewPayDefaults["breakout operator"];
  if (/crew lead|working lead/.test(role)) return crewPayDefaults["crew lead"];
  if (/\ba1\b|audio engineer/.test(role)) return crewPayDefaults["audio engineer"];
  if (/\bv1\b|lead video/.test(role)) return crewPayDefaults["lead video engineer"];
  if (/\ba2\b|audio assist|audio tech/.test(role)) return crewPayDefaults["audio assist"];
  if (/\bv2\b|video assist|video tech/.test(role)) return crewPayDefaults["video assist"];
  if (/\bl2\b|lighting assist|lighting tech/.test(role)) return crewPayDefaults["lighting assist"];
  if (/stagehand|stage hand/.test(role)) return crewPayDefaults.stagehand;
  if (/speaker ready|graphics|playback|zoom|record|camera|lighting designer|\bld\b/.test(role)) return crewPayDefaults["speaker ready"];
  return null;
}

export function getDefaultCrewPayRate(roleName: string | null | undefined) {
  return getDefaultCrewPay(roleName)?.fullDay ?? 0;
}
