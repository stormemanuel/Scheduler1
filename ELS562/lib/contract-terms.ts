export const CONTRACT_PAYMENT_TERMS_VERSION = "hours-worked-cancellation-sobriety-premiums-v4";

export const CONTRACT_PAYMENT_TERMS: Array<{ heading?: string; text: string }> = [
  { text: "Company shall compensate Contractor solely for hours actually worked at the agreed-upon rates, except that cancellation by Company or its client within twenty-four (24) hours before a confirmed workday's scheduled start shall entitle Contractor to the agreed compensation for that canceled workday, subject to a maximum of one (1) workday per canceled job or assignment. No compensation shall be due for the remaining unworked days." },
  { text: "Contractor shall submit an invoice detailing services rendered. Payment shall be made within thirty (30) days of receipt of an approved invoice. If payments are scheduled beyond thirty days, Contractor shall be notified and must agree to payment terms before accepting the contract." },
];

export const CONTRACT_CERTIFICATIONS = [
  "Contractor is an independent contractor and not an employee of the Company.",
  "Contractor maintains their own business and works with multiple companies.",
  "Contractor provides their own tools, equipment, and materials.",
  "Contractor determines how services are performed and is not under direct Company control.",
  "Contractor is responsible for their own insurance, taxes, and business expenses.",
  "Contractor acknowledges that they do not receive employee benefits from the Company.",
  "Contractor understands that failure to comply with client requirements may result in removal from a project.",
  "Contractor agrees to indemnify the Company against liabilities arising from their work.",
  "Contractor agrees to adhere to professional standards, including punctuality, attire, and conduct.",
];

export const CONTRACT_CONDUCT_TERMS = "Contractor shall maintain professional standards of punctuality, attire, and respectful conduct and shall report for and remain at work sober and unimpaired by alcohol, controlled substances, or any other impairing substance. If Company or its client reasonably determines, based on observable conduct or other objective evidence, that Contractor is intoxicated or impaired, Contractor may be immediately removed from the assignment for cause. No compensation shall be owed for hours not worked following such removal, and the cancellation-pay provision shall not apply to removal for cause. Compensation for hours actually worked shall remain payable in accordance with applicable law.";

export const CONTRACT_PREMIUM_TERMS = [
  "For hours actually worked in a workday, overtime shall be paid at one and one-half (1.5) times Contractor's agreed regular hourly rate for hours in excess of ten (10) through fourteen (14) completed hours. Double time shall be paid at two (2) times the regular hourly rate for hours in excess of fourteen (14) completed hours, beginning with the fifteenth (15th) hour of work.",
  "Hours actually worked after 12:00 a.m. during an overnight call shall be paid at no less than one and one-half (1.5) times the regular hourly rate. Crossing midnight shall not reset the daily hour count for a continuous shift. Overlapping premiums shall not be stacked; the highest applicable rate governs. For example, a 6:00 p.m. to 4:00 a.m. shift at a regular rate of $35.00 per hour consists of six (6) hours at $35.00 and four (4) hours at $52.50, totaling $420.00.",
  "Saturday and Sunday work shall be paid at the regular hourly rate, subject to the daily and overnight premiums stated above; weekend work alone does not trigger premium pay. A national holiday alone does not trigger overtime, double time, or any other holiday premium. Any holiday premium requires Company's prior written approval before the work is performed, subject to applicable law.",
];
