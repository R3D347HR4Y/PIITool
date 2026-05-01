import { Database } from "bun:sqlite";
import { stableHash } from "./normalize.ts";

export interface NameEntry {
  value: string;
  locale: string;
  gender: string;
  tags: string;
}

const SEED_FIRST_NAMES: NameEntry[] = [
  // English - male
  ...["James", "Robert", "Michael", "William", "David", "Richard", "Thomas", "Daniel", "Matthew", "Andrew",
    "Christopher", "Joseph", "Charles", "Steven", "Edward", "Patrick", "Dennis", "Gregory", "Kenneth", "Raymond",
    "Nathan", "Bryan", "Keith", "Gerald", "Philip", "Russell", "Lawrence", "Craig", "Terry", "Wayne",
    "Roger", "Douglas", "Harold", "Carl", "Arthur", "Henry", "Eugene", "Martin", "Albert", "Leonard",
  ].map((v) => ({ value: v, locale: "en", gender: "male", tags: "" })),
  // English - female
  ...["Mary", "Patricia", "Jennifer", "Linda", "Barbara", "Elizabeth", "Susan", "Jessica", "Sarah", "Karen",
    "Lisa", "Nancy", "Betty", "Margaret", "Sandra", "Ashley", "Dorothy", "Kimberly", "Emily", "Donna",
    "Michelle", "Carol", "Amanda", "Melissa", "Deborah", "Stephanie", "Rebecca", "Sharon", "Laura", "Cynthia",
    "Kathleen", "Amy", "Angela", "Shirley", "Brenda", "Emma", "Grace", "Victoria", "Natalie", "Teresa",
  ].map((v) => ({ value: v, locale: "en", gender: "female", tags: "" })),
  // English - neutral
  ...["Jamie", "Taylor", "Morgan", "Casey", "Riley", "Jordan", "Alex", "Quinn", "Avery", "Cameron",
    "Dakota", "Drew", "Finley", "Harper", "Hayden", "Jesse", "Kendall", "Logan", "Parker", "Peyton",
    "Reese", "Robin", "Rowan", "Sage", "Skyler", "Sydney", "Terry", "Tracy", "Blair", "Shannon",
  ].map((v) => ({ value: v, locale: "en", gender: "neutral", tags: "" })),
  // French
  ...["Jean", "Pierre", "Michel", "Philippe", "Alain", "Bernard", "Jacques", "François", "René", "André",
    "Marie", "Jeanne", "Françoise", "Monique", "Catherine", "Sylvie", "Nathalie", "Isabelle", "Valérie", "Sophie",
  ].map((v) => ({ value: v, locale: "fr", gender: "neutral", tags: "" })),
  // Spanish
  ...["Carlos", "Miguel", "José", "Antonio", "Francisco", "Manuel", "Pedro", "Rafael", "Fernando", "Alejandro",
    "María", "Carmen", "Isabel", "Ana", "Rosa", "Lucia", "Elena", "Pilar", "Dolores", "Teresa",
  ].map((v) => ({ value: v, locale: "es", gender: "neutral", tags: "" })),
  // German
  ...["Hans", "Klaus", "Wolfgang", "Jürgen", "Helmut", "Dieter", "Gerhard", "Werner", "Manfred", "Rainer",
    "Ursula", "Helga", "Ingrid", "Monika", "Petra", "Sabine", "Renate", "Karin", "Gisela", "Brigitte",
  ].map((v) => ({ value: v, locale: "de", gender: "neutral", tags: "" })),
  // Italian
  ...["Marco", "Giuseppe", "Giovanni", "Andrea", "Francesco", "Alessandro", "Luca", "Matteo", "Lorenzo", "Stefano",
    "Giulia", "Francesca", "Chiara", "Sara", "Valentina", "Alessia", "Martina", "Elisa", "Federica", "Silvia",
  ].map((v) => ({ value: v, locale: "it", gender: "neutral", tags: "" })),
  // Japanese (romanized)
  ...["Takeshi", "Hiroshi", "Kenji", "Yuki", "Haruto", "Riku", "Sota", "Ren", "Kaito", "Daichi",
    "Yui", "Hana", "Sakura", "Aoi", "Rin", "Mio", "Akari", "Hinata", "Mei", "Sora",
  ].map((v) => ({ value: v, locale: "ja", gender: "neutral", tags: "" })),
  // Chinese (romanized)
  ...["Wei", "Jian", "Ming", "Hao", "Jun", "Lei", "Chao", "Long", "Peng", "Feng",
    "Xiu", "Yan", "Mei", "Ling", "Fang", "Jing", "Hui", "Yun", "Xia", "Qing",
  ].map((v) => ({ value: v, locale: "zh", gender: "neutral", tags: "" })),
  // Arabic (romanized)
  ...["Ahmed", "Mohamed", "Ali", "Omar", "Hassan", "Khalid", "Youssef", "Ibrahim", "Mustafa", "Tariq",
    "Fatima", "Aisha", "Layla", "Nour", "Amira", "Salma", "Hana", "Rania", "Dina", "Yasmin",
  ].map((v) => ({ value: v, locale: "ar", gender: "neutral", tags: "" })),
  // Portuguese
  ...["João", "Pedro", "Lucas", "Gabriel", "Rafael", "Mateus", "Tiago", "Bruno", "Diogo", "Gustavo",
    "Ana", "Beatriz", "Catarina", "Daniela", "Inês", "Mariana", "Rita", "Sofia", "Teresa", "Marta",
  ].map((v) => ({ value: v, locale: "pt", gender: "neutral", tags: "" })),
];

const SEED_LAST_NAMES: NameEntry[] = [
  // English
  ...["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
    "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White",
    "Harris", "Clark", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott",
    "Hill", "Green", "Adams", "Baker", "Nelson", "Carter", "Mitchell", "Perez", "Roberts", "Turner",
    "Phillips", "Campbell", "Parker", "Evans", "Edwards", "Collins", "Stewart", "Morris", "Murphy", "Cook",
    "Reed", "Morgan", "Bell", "Bailey", "Cooper", "Richardson", "Cox", "Howard", "Ward", "Peterson",
  ].map((v) => ({ value: v, locale: "en", gender: "neutral", tags: "" })),
  // French
  ...["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau",
    "Laurent", "Simon", "Michel", "Lefebvre", "Leroy", "Roux", "David", "Bertrand", "Morel", "Fournier",
  ].map((v) => ({ value: v, locale: "fr", gender: "neutral", tags: "" })),
  // Spanish
  ...["García", "Fernández", "López", "Martínez", "González", "Rodríguez", "Sánchez", "Pérez", "Gómez", "Ruiz",
    "Hernández", "Díaz", "Moreno", "Muñoz", "Álvarez", "Romero", "Alonso", "Navarro", "Torres", "Jiménez",
  ].map((v) => ({ value: v, locale: "es", gender: "neutral", tags: "" })),
  // German
  ...["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffmann",
    "Schäfer", "Koch", "Bauer", "Richter", "Klein", "Wolf", "Schröder", "Neumann", "Schwarz", "Braun",
  ].map((v) => ({ value: v, locale: "de", gender: "neutral", tags: "" })),
  // Italian
  ...["Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci", "Marino", "Greco",
    "Bruno", "Gallo", "Conti", "Costa", "Giordano", "Mancini", "Rizzo", "Lombardi", "Moretti", "Barbieri",
  ].map((v) => ({ value: v, locale: "it", gender: "neutral", tags: "" })),
  // Japanese (romanized)
  ...["Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato",
    "Yoshida", "Yamada", "Sasaki", "Yamaguchi", "Matsumoto", "Inoue", "Kimura", "Hayashi", "Shimizu", "Yamazaki",
  ].map((v) => ({ value: v, locale: "ja", gender: "neutral", tags: "" })),
  // Chinese (romanized)
  ...["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao", "Wu", "Zhou",
    "Xu", "Sun", "Ma", "Zhu", "Hu", "Guo", "Lin", "He", "Gao", "Luo",
  ].map((v) => ({ value: v, locale: "zh", gender: "neutral", tags: "" })),
  // Arabic (romanized)
  ...["Al-Rashid", "El-Amin", "Al-Farsi", "Mansour", "Nasser", "Haddad", "Khalil", "Khoury", "Saleh", "Bashir",
    "Abdallah", "Hammoud", "Najjar", "Saeed", "Shaheen", "Taha", "Zayed", "Bishara", "Darwish", "Farah",
  ].map((v) => ({ value: v, locale: "ar", gender: "neutral", tags: "" })),
  // Portuguese
  ...["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes",
    "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida", "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa",
  ].map((v) => ({ value: v, locale: "pt", gender: "neutral", tags: "" })),
];

const SEED_COMPANY_PREFIXES = [
  "Raylong", "Northstar", "Silverline", "Oakridge", "Clearhaven", "Bluepeak",
  "Ironwood", "Crestline", "Redstone", "Goldfield", "Brightshore", "Stonebridge",
  "Pinecrest", "Sunvale", "Foxhill", "Thornwood", "Windrose", "Maplecroft",
  "Brookhaven", "Ashford", "Cedarpoint", "Lakemont", "Ridgeview", "Summerfield",
  "Westmark", "Eastgate", "Highpoint", "Deepwater", "Crossfield", "Fairhaven",
  "Greenleaf", "Irongate", "Kingswood", "Longview", "Millbrook", "Newfield",
  "Oldcastle", "Riverdale", "Stonecrest", "Thornbury", "Valleyforge", "Whitecliff",
];

const REALISTIC_TLDS = [".com", ".net", ".co", ".io", ".org", ".biz", ".info", ".app", ".tech", ".dev"];

const PHONE_COUNTRY_PREFIXES: Record<string, string[]> = {
  en: ["+1"],
  fr: ["+33"],
  es: ["+34"],
  de: ["+49"],
  it: ["+39"],
  ja: ["+81"],
  zh: ["+86"],
  ar: ["+966", "+971", "+20"],
  pt: ["+55", "+351"],
};

const STREET_NAMES = [
  "Maple Street", "Cedar Road", "Pioneer Lane", "Harbor Way", "Elm Avenue",
  "Oak Boulevard", "Park Drive", "Lake Road", "Forest Avenue", "Highland Way",
  "River Street", "Valley Road", "Sunset Boulevard", "Spring Lane", "Hillside Drive",
  "Meadow Lane", "Garden Street", "Bridge Road", "Church Street", "Mill Road",
  "Station Road", "Main Street", "High Street", "King Street", "Queen Street",
  "Victoria Road", "Albert Street", "George Street", "Market Street", "Chapel Lane",
];

const MIN_POOL_SIZE = 10;

export class NamePool {
  private db: Database;
  private ollamaBaseUrl: string;
  private ollamaModel: string;

  constructor(db: Database, ollamaBaseUrl = "http://localhost:11434", ollamaModel = "qwen2.5:7b") {
    this.db = db;
    this.ollamaBaseUrl = ollamaBaseUrl;
    this.ollamaModel = ollamaModel;
    this.migratePool();
    this.seedIfEmpty();
  }

  pickFirstName(seed: string, locale = "en", gender = "neutral"): string {
    return this.pickFromPool("first", seed, locale, gender);
  }

  pickLastName(seed: string, locale = "en"): string {
    return this.pickFromPool("last", seed, locale, "neutral");
  }

  pickCompanyPrefix(seed: string): string {
    const hash = stableHash(seed);
    const idx = Number.parseInt(hash.slice(0, 8), 16) % SEED_COMPANY_PREFIXES.length;
    return SEED_COMPANY_PREFIXES[idx]!;
  }

  pickTld(seed: string): string {
    const hash = stableHash(seed);
    return REALISTIC_TLDS[Number.parseInt(hash.slice(0, 8), 16) % REALISTIC_TLDS.length]!;
  }

  pickStreet(seed: string): string {
    const hash = stableHash(seed);
    return STREET_NAMES[Number.parseInt(hash.slice(0, 8), 16) % STREET_NAMES.length]!;
  }

  phonePrefix(locale = "en"): string {
    const prefixes = PHONE_COUNTRY_PREFIXES[locale] ?? PHONE_COUNTRY_PREFIXES.en!;
    return prefixes[0]!;
  }

  async expandPoolIfNeeded(type: "first" | "last", locale: string, gender: string): Promise<void> {
    const available = this.countUnused(type, locale, gender);
    if (available >= MIN_POOL_SIZE) return;

    const needed = MIN_POOL_SIZE * 3;
    try {
      const names = await this.generateNamesViaLlm(type, locale, gender, needed);
      for (const name of names) {
        this.insertPoolEntry(type, name, locale, gender);
      }
    } catch {
      // LLM unavailable; pool will work with what it has
    }
  }

  markUsed(type: "first" | "last", value: string): void {
    this.db.query("update name_pool set used = 1 where type = ? and value = ?").run(type, value);
  }

  private pickFromPool(type: "first" | "last", seed: string, locale: string, gender: string): string {
    const hash = stableHash(seed);

    const localeRows = this.db
      .query<{ value: string }, [string, string, string]>(
        `select value from name_pool where type = ? and locale = ? and (gender = ? or gender = 'neutral') and used = 0
         order by value`,
      )
      .all(type, locale, gender);

    const rows = localeRows.length > 0
      ? localeRows
      : this.db
          .query<{ value: string }, [string]>("select value from name_pool where type = ? and used = 0 order by value")
          .all(type);

    if (rows.length === 0) {
      const allRows = this.db
        .query<{ value: string }, [string]>("select distinct value from name_pool where type = ? order by value")
        .all(type);
      if (allRows.length === 0) return type === "first" ? "Alex" : "Smith";
      return allRows[Number.parseInt(hash.slice(0, 8), 16) % allRows.length]!.value;
    }

    return rows[Number.parseInt(hash.slice(0, 8), 16) % rows.length]!.value;
  }

  private countUnused(type: "first" | "last", locale: string, gender: string): number {
    const row = this.db
      .query<{ cnt: number }, [string, string, string]>(
        "select count(*) as cnt from name_pool where type = ? and locale = ? and (gender = ? or gender = 'neutral') and used = 0",
      )
      .get(type, locale, gender);
    return row?.cnt ?? 0;
  }

  private async generateNamesViaLlm(type: "first" | "last", locale: string, gender: string, count: number): Promise<string[]> {
    const typeLabel = type === "first" ? "first names" : "last names / family names";
    const genderHint = gender === "neutral" ? "" : ` (${gender})`;
    const prompt = `Generate ${count} realistic ${typeLabel}${genderHint} common in locale "${locale}". Return ONLY a JSON array of strings. No duplicates. No explanations.`;

    const response = await fetch(`${this.ollamaBaseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.ollamaModel,
        stream: false,
        format: { type: "array", items: { type: "string" } },
        options: { temperature: 0.7 },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return [];
    const payload = (await response.json()) as { message?: { content?: string } };
    const parsed = JSON.parse(payload.message?.content ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v: unknown): v is string => typeof v === "string" && v.length >= 2);
  }

  private insertPoolEntry(type: "first" | "last", value: string, locale: string, gender: string): void {
    this.db
      .query("insert or ignore into name_pool (type, value, locale, gender, used) values (?, ?, ?, ?, 0)")
      .run(type, value, locale, gender);
  }

  private migratePool(): void {
    this.db.exec(`
      create table if not exists name_pool (
        type text not null,
        value text not null,
        locale text not null,
        gender text not null default 'neutral',
        used integer not null default 0,
        primary key (type, value, locale)
      )
    `);
    this.db.exec(`
      create table if not exists family_map (
        real_hash text primary key,
        fake_last text not null,
        locale text not null
      )
    `);
  }

  private seedIfEmpty(): void {
    const count = this.db.query<{ cnt: number }, []>("select count(*) as cnt from name_pool").get();
    if (count && count.cnt > 0) return;

    const insert = this.db.query("insert or ignore into name_pool (type, value, locale, gender, used) values (?, ?, ?, ?, 0)");
    this.db.exec("begin transaction");
    for (const entry of SEED_FIRST_NAMES) insert.run("first", entry.value, entry.locale, entry.gender);
    for (const entry of SEED_LAST_NAMES) insert.run("last", entry.value, entry.locale, entry.gender);
    this.db.exec("commit");
  }

  resolveFamilyName(realLastName: string, seed: string, locale = "en"): string {
    const normalized = realLastName.trim().toLowerCase();
    const hash = stableHash(`family:${normalized}`);
    const existing = this.db
      .query<{ fake_last: string }, [string]>("select fake_last from family_map where real_hash = ?")
      .get(hash);
    if (existing) return existing.fake_last;

    const fakeLast = this.pickLastName(`family:${seed}:${normalized}`, locale);
    this.db.query("insert or ignore into family_map (real_hash, fake_last, locale) values (?, ?, ?)").run(hash, fakeLast, locale);
    this.markUsed("last", fakeLast);
    return fakeLast;
  }
}
