/**
 * Expense categories for a Canadian medical aesthetics practice.
 * `line` is the CRA T2125 line most accountants map the category to (guidance only).
 */
export interface Category {
  name: string;
  description: string;
  line: string;
  keywords: string[];
}

export const CATEGORIES: Category[] = [
  {
    name: "Medical & Clinical Supplies",
    description: "Consumables used in treatments: needles, cannulas, gloves, gauze, syringes, numbing cream, sharps disposal.",
    line: "8810 Supplies",
    keywords: ["medical", "clinical", "cannula", "needle", "syringe", "glove", "gauze", "lidocaine", "sharps", "mckesson", "medline", "stevens", "henry schein", "cardinal"],
  },
  {
    name: "Injectables & Skincare Products",
    description: "Neuromodulators, dermal fillers, biostimulators, PRP kits, retail/professional skincare for resale or treatment.",
    line: "8320 Purchases / cost of goods",
    keywords: ["botox", "dysport", "xeomin", "nuceiva", "juvederm", "restylane", "sculptra", "radiesse", "belkyra", "allergan", "galderma", "merz", "teoxane", "skinceuticals", "zo skin", "alastin", "prp", "filler", "toxin", "skincare"],
  },
  {
    name: "Equipment & Devices",
    description: "Lasers, microneedling devices, chairs, lamps, sterilizers, computers and other capital equipment.",
    line: "CCA (capital)",
    keywords: ["laser", "device", "equipment", "microneedling", "morpheus", "ultherapy", "chair", "autoclave", "sterilizer", "apple store", "macbook", "ipad", "dell", "lenovo"],
  },
  {
    name: "Office Supplies",
    description: "Paper, printer ink, stationery, small office items.",
    line: "8810 Office / supplies",
    keywords: ["staples", "office depot", "paper", "ink", "toner", "stationery", "amazon"],
  },
  {
    name: "Software & Subscriptions",
    description: "EMR, booking, payments, email, cloud, design and other SaaS subscriptions.",
    line: "8810 / 8760 Business taxes, fees",
    keywords: ["subscription", "software", "saas", "jane app", "janeapp", "aesthetic record", "vagaro", "mindbody", "square", "stripe", "shopify", "google workspace", "microsoft 365", "zoom", "canva", "adobe", "dropbox", "notion", "slack", "openai", "anthropic", "vercel", "github", "apple.com/bill", "icloud"],
  },
  {
    name: "Rent & Utilities",
    description: "Clinic rent, condo fees, electricity, water, heating.",
    line: "8910 Rent / 8690 Utilities",
    keywords: ["rent", "lease", "hydro", "electric", "gas bill", "enbridge", "utility", "water bill", "property management"],
  },
  {
    name: "Telephone & Internet",
    description: "Mobile, landline, VoIP and internet service.",
    line: "9220 Telephone and utilities",
    keywords: ["rogers", "bell", "telus", "fido", "freedom", "koodo", "virgin", "shaw", "internet", "phone", "ooma", "ringcentral"],
  },
  {
    name: "Advertising & Marketing",
    description: "Ads, social media, website, photography, printing, promotional items.",
    line: "8520 Advertising",
    keywords: ["meta", "facebook", "instagram", "google ads", "tiktok", "marketing", "advertis", "website", "squarespace", "wix", "vistaprint", "photograph", "promo", "yelp"],
  },
  {
    name: "Professional Fees",
    description: "Accounting, legal, bookkeeping, consulting.",
    line: "8860 Professional fees",
    keywords: ["accountant", "accounting", "bookkeep", "legal", "lawyer", "law office", "consult", "cpa"],
  },
  {
    name: "Licenses, Dues & Insurance",
    description: "College registration, CMPA, association memberships, malpractice and business insurance.",
    line: "8760 Business taxes, licences, memberships / 8690 Insurance",
    keywords: ["cmpa", "cpso", "college of physicians", "license", "licence", "membership", "dues", "association", "insurance", "cma", "oma", "casam"],
  },
  {
    name: "Education & Conferences",
    description: "Courses, training, CME, conferences, books and journals.",
    line: "8810 / 9270 Other expenses",
    keywords: ["course", "training", "conference", "symposium", "cme", "webinar", "workshop", "masterclass", "tuition", "certification", "udemy", "journal"],
  },
  {
    name: "Travel",
    description: "Flights, hotels, taxis, parking and mileage for business travel.",
    line: "9200 Travel",
    keywords: ["air canada", "westjet", "porter", "flight", "hotel", "marriott", "hilton", "airbnb", "uber", "lyft", "taxi", "parking", "via rail", "expedia"],
  },
  {
    name: "Meals & Entertainment",
    description: "Business meals and client entertainment (generally 50% deductible).",
    line: "8523 Meals and entertainment",
    keywords: ["restaurant", "cafe", "coffee", "starbucks", "tim hortons", "doordash", "uber eats", "skip", "catering", "bistro", "grill", "pizza", "sushi"],
  },
  {
    name: "Salaries & Contractors",
    description: "Staff wages, payroll fees, nurse injectors and other contractors.",
    line: "9060 Salaries / 8360 Subcontracts",
    keywords: ["payroll", "wagepoint", "adp", "ceridian", "contractor", "invoice for services", "nurse"],
  },
  {
    name: "Bank & Payment Fees",
    description: "Bank charges, merchant/terminal fees, interest.",
    line: "8710 Interest and bank charges",
    keywords: ["bank fee", "merchant fee", "moneris", "clover", "terminal", "interest", "service charge", "chargeback"],
  },
  {
    name: "Repairs & Maintenance",
    description: "Cleaning, repairs, equipment servicing, laundry.",
    line: "8960 Repairs and maintenance",
    keywords: ["repair", "maintenance", "cleaning", "janitorial", "laundry", "service call", "plumb", "electrician"],
  },
  {
    name: "Vehicle",
    description: "Fuel, vehicle insurance, repairs attributable to business use.",
    line: "9281 Motor vehicle expenses",
    keywords: ["petro", "esso", "shell", "fuel", "gas station", "car wash", "tire", "canadian tire auto"],
  },
  {
    name: "Other",
    description: "Business expenses that fit no other category.",
    line: "9270 Other expenses",
    keywords: [],
  },
];

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);
export const UNCATEGORIZED = "Uncategorized";
export const ALL_CATEGORY_NAMES = [...CATEGORY_NAMES, UNCATEGORIZED];

export function isKnownCategory(name: string): boolean {
  return ALL_CATEGORY_NAMES.includes(name);
}

/** Cheap keyword-based category guess used when Claude is unavailable. */
export function guessCategory(text: string): string {
  const hay = text.toLowerCase();
  let best: { name: string; score: number } = { name: UNCATEGORIZED, score: 0 };
  for (const c of CATEGORIES) {
    let score = 0;
    for (const k of c.keywords) if (hay.includes(k)) score += k.length > 4 ? 2 : 1;
    if (score > best.score) best = { name: c.name, score };
  }
  return best.name;
}

export function categoryPromptList(): string {
  return CATEGORIES.map((c) => `- ${c.name}: ${c.description}`).join("\n");
}
