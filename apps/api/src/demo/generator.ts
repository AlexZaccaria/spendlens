import { addDays, daysInMonth, monthsEndingAt, monthKeyOf, todayIso, toMinor, type LocalizedText, type MonthKey } from '@spendlens/contracts';
import type { NewTransaction } from '../repo/transactions.ts';
import { Rng } from './rng.ts';

/**
 * Demo data: thirteen months of a person living in Milan, ending today. Deterministic — the same
 * seed and the same `today` always give the same rows — and written like the AI pipeline writes
 * real imports: raw lines in the style of Italian (and, abroad, German and English) bank
 * statements, a clean merchant, a title in every UI language, a few rows left for review.
 */

export const DEFAULT_DEMO_SEED = 20261105;
export const DEFAULT_DEMO_MONTHS = 13;

/** Fixed approximate rates (1 unit = x EUR) for the demo's foreign-currency rows. Real imports use
 *  the daily ECB rates; the demo stays offline and reproducible. */
export const DEMO_FX_TO_EUR = { EUR: 1, GBP: 1.17, USD: 0.9 } as const;
type DemoCurrency = keyof typeof DEMO_FX_TO_EUR;

export const DEMO_ACCOUNTS = { main: 'Conto Fineco', card: 'Carta Revolut' } as const;

export interface DemoOptions {
  readonly seed?: number;
  /** Last day with data, `YYYY-MM-DD`; defaults to the real today. */
  readonly today?: string;
  readonly months?: number;
}

interface Entry {
  readonly date: string;
  readonly raw: string;
  readonly merchant: string | null;
  readonly title: LocalizedText;
  /** Signed, major units of `currency`: negative = money out. */
  readonly amount: number;
  readonly categoryId: string;
  readonly currency?: DemoCurrency;
  readonly account?: string;
  readonly confidence?: number;
  readonly needsReview?: boolean;
  readonly note?: LocalizedText;
  /** Receipt lines (signed, major units), for the itemised receipts. */
  readonly items?: readonly { raw: string; title: LocalizedText; quantity: number | null; amount: number; categoryId: string }[];
}

const MONTHS_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number): string => String(n).padStart(2, '0');
const t = (it: string, en: string): LocalizedText => ({ it, en });
const monthIndex = (m: MonthKey): number => Number(m.slice(5, 7)) - 1;
const year = (m: MonthKey): string => m.slice(0, 4);
const day = (m: MonthKey, d: number): string => `${m}-${pad(Math.min(d, daysInMonth(m)))}`;
/** 0 = Sunday … 6 = Saturday */
const weekday = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
const dmy = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const dm = (date: string): string => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const dotted = (date: string): string => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

/** The last weekday on or before `date` (salaries and direct debits skip weekends). */
function businessDay(date: string): string {
  let d = date;
  while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1);
  return d;
}

class Builder {
  readonly rows: NewTransaction[] = [];
  private readonly today: string;
  readonly rng: Rng;

  constructor(today: string, rng: Rng) {
    this.today = today;
    this.rng = rng;
  }

  time(): string {
    return `${pad(this.rng.int(7, 21))}.${pad(this.rng.int(0, 59))}`;
  }

  pos(date: string, merchantText: string): string {
    return `PAGAMENTO POS ${dmy(date)} ${this.time()} ${merchantText} CARTA *4821`;
  }

  online(date: string, merchantText: string): string {
    return `PAGAMENTO CARTA *4821 ${dm(date)} ${merchantText}`;
  }

  code(length: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    return Array.from({ length }, () => this.rng.pick([...chars])).join('');
  }

  add(e: Entry): void {
    if (e.date > this.today) return;
    const currency = e.currency ?? 'EUR';
    const amountMinor = toMinor(e.amount, currency);
    this.rows.push({
      date: e.date,
      rawDescription: e.raw,
      title: e.title,
      merchant: e.merchant,
      amountMinor,
      currency,
      baseAmountMinor: currency === 'EUR' ? amountMinor : toMinor(e.amount * DEMO_FX_TO_EUR[currency], 'EUR'),
      categoryId: e.categoryId,
      confidence: e.confidence ?? 0.97,
      needsReview: e.needsReview ?? false,
      account: e.account ?? DEMO_ACCOUNTS.main,
      note: e.note ?? null,
      importId: null,
      source: 'demo',
      ...(e.items && {
        items: e.items.map((i) => ({ description: i.raw, title: i.title, quantity: i.quantity, amountMinor: toMinor(i.amount, currency), categoryId: i.categoryId })),
      }),
    });
  }
}

// --- Everyday life, generated day by day ---------------------------------------------------------

const GROCERIES = [
  { name: 'Esselunga', raw: 'ESSELUNGA MILANO VIALE PAPINIANO', w: 35, min: 24, max: 88 },
  { name: 'Coop', raw: 'COOP LOMBARDIA MILANO VIA ARCHIMEDE', w: 20, min: 15, max: 62 },
  { name: 'Lidl', raw: 'LIDL ITALIA SRL MILANO VIA FORZE ARMATE', w: 20, min: 12, max: 48 },
  { name: 'Carrefour', raw: 'CARREFOUR EXPRESS MILANO C.SO GENOVA', w: 15, min: 6, max: 32 },
  { name: 'Pam', raw: 'PAM PANORAMA MILANO VIA OLONA', w: 10, min: 9, max: 40 },
] as const;

interface Product {
  readonly raw: string;
  readonly title: LocalizedText;
  readonly min: number;
  readonly max: number;
  readonly categoryId: string;
  /** Relative frequency on a receipt. */
  readonly w: number;
}

const p = (raw: string, it: string, en: string, min: number, max: number, categoryId: string, w = 1): Product => ({ raw, title: t(it, en), min, max, categoryId, w });

/** What ends up on a supermarket receipt; the title is the generic product, the line keeps the brand. */
const PRODUCTS: readonly Product[] = [
  p('PANE COMUNE KG 0,5', 'Pane', 'Bread', 1.4, 2.6, 'food.groceries', 4),
  p('LATTE PS GRANAROLO 1L', 'Latte', 'Milk', 1.29, 1.69, 'food.groceries', 4),
  p('YOGURT BIANCO MULLER X4', 'Yogurt', 'Yoghurt', 2.19, 3.49, 'food.groceries', 2),
  p('PASTA BARILLA SPAGHETTI 500G', 'Pasta', 'Pasta', 0.89, 1.79, 'food.groceries', 4),
  p('POLPA CIRIO 400G', 'Pomodori pelati', 'Tinned tomatoes', 0.89, 1.49, 'food.groceries', 2),
  p('MOZZARELLA S.LUCIA 125G', 'Mozzarella', 'Mozzarella', 1.19, 2.49, 'food.groceries', 2),
  p('PARMIGIANO REGG. 24M 300G', 'Parmigiano', 'Parmesan', 4.5, 8.9, 'food.groceries', 1),
  p('MELE GOLDEN SFUSE', 'Mele', 'Apples', 1.9, 3.5, 'food.groceries', 2),
  p('BANANE CHIQUITA', 'Banane', 'Bananas', 1.5, 2.8, 'food.groceries', 2),
  p('INSALATA MISTA BUSTA', 'Insalata', 'Salad', 1.2, 2.2, 'food.groceries', 2),
  p('PETTO POLLO AIA 400G', 'Petto di pollo', 'Chicken breast', 4.9, 8.4, 'food.groceries', 2),
  p('CAFFE LAVAZZA ORO 250G', 'Caffè', 'Coffee', 3.9, 6.9, 'food.groceries', 1),
  p('UOVA BIO X6', 'Uova', 'Eggs', 2.19, 3.29, 'food.groceries', 2),
  p('OLIO EVO MONINI 1L', 'Olio extravergine', 'Extra virgin olive oil', 6.9, 9.9, 'food.groceries', 0.6),
  p('ACQUA S.BENEDETTO 6X1,5L', 'Acqua minerale', 'Mineral water', 2.4, 3.6, 'food.groceries', 2),
  p('VINO CHIANTI DOCG 75CL', 'Vino', 'Wine', 4.9, 12.9, 'food.groceries', 0.8),
  p('BISCOTTI MULINO BIANCO', 'Biscotti', 'Biscuits', 1.9, 3.4, 'food.groceries', 1.5),
  p('PROSCIUTTO CRUDO 100G', 'Prosciutto crudo', 'Cured ham', 2.9, 5.9, 'food.groceries', 1.2),
  p('DASH PODS X30', 'Detersivo lavatrice', 'Laundry detergent', 5.9, 12.9, 'shopping.home', 0.6),
  p('SVELTO PIATTI 1L', 'Detersivo piatti', 'Dish soap', 1.5, 3.2, 'shopping.home', 0.8),
  p('SCOTTEX CARTA IGIEN. X8', 'Carta igienica', 'Toilet paper', 2.9, 5.9, 'shopping.home', 0.8),
  p('SACCHI RIFIUTI 50L X20', 'Sacchetti spazzatura', 'Bin bags', 1.9, 3.4, 'shopping.home', 0.5),
  p('SHAMPOO PANTENE 250ML', 'Shampoo', 'Shampoo', 2.9, 5.9, 'shopping.personal', 0.5),
  p('DENTIFRICIO AZ 75ML', 'Dentifricio', 'Toothpaste', 1.6, 3.2, 'shopping.personal', 0.6),
  p('BAGNOSCHIUMA NIVEA 500ML', 'Bagnoschiuma', 'Shower gel', 2.4, 4.9, 'shopping.personal', 0.4),
  p('CEROTTI HANSAPLAST X20', 'Cerotti', 'Plasters', 2.9, 4.9, 'health.pharmacy', 0.15),
];

/** A plausible receipt: distinct products, now and then two of the same. */
function receiptLines(r: Rng, count: number): { raw: string; title: LocalizedText; quantity: number | null; amount: number; categoryId: string }[] {
  const chosen = new Set<Product>();
  while (chosen.size < count) chosen.add(r.weighted(PRODUCTS.map((x) => [x, x.w] as const)));
  return [...chosen].map((x) => {
    const quantity = r.chance(0.18) ? 2 : 1;
    const price = r.amount(x.min, x.max);
    return { raw: quantity > 1 ? `${x.raw} X${quantity}` : x.raw, title: x.title, quantity, amount: Math.round(price * quantity * 100) / 100, categoryId: x.categoryId };
  });
}

const CAFES = [
  { name: 'Bar Centrale', raw: 'BAR CENTRALE SNC MILANO' },
  { name: 'Caffè della Piazza', raw: 'CAFFE DELLA PIAZZA MILANO P.ZA SANT AGOSTINO' },
  { name: 'Pasticceria Rossi', raw: 'PASTICCERIA ROSSI SRL MILANO' },
  { name: 'Bar Tabacchi Solari', raw: 'BAR TABACCHI SOLARI MILANO VIA SOLARI' },
] as const;

const RESTAURANTS = [
  { name: 'Pizzeria Bella Napoli', raw: 'PIZZERIA BELLA NAPOLI MILANO', min: 18, max: 42 },
  { name: 'Trattoria Da Gino', raw: 'TRATTORIA DA GINO SAS MILANO', min: 28, max: 64 },
  { name: 'Osteria Navigli', raw: 'OSTERIA NAVIGLI SRL MILANO ALZAIA NAVIGLIO', min: 32, max: 72 },
  { name: 'Sushi Sakura', raw: 'SUSHI SAKURA DI CHEN MILANO', min: 24, max: 58 },
  { name: 'Burger Lab', raw: 'BURGER LAB MILANO CORSO GENOVA', min: 16, max: 34 },
] as const;

const DELIVERY = [
  { name: 'Glovo', raw: 'GLOVOAPP23 MILANO' },
  { name: 'Deliveroo', raw: 'DELIVEROO ITALY SRL MILANO' },
  { name: 'Just Eat', raw: 'JUST EAT ITALY MILANO' },
] as const;

const AMAZON_ITEMS = [
  t('cavo USB-C', 'USB-C cable'),
  t('libro', 'book'),
  t('lampadine LED', 'LED bulbs'),
  t('cuffie wireless', 'wireless headphones'),
  t('accessori cucina', 'kitchen accessories'),
  t('cover telefono', 'phone case'),
  t('borraccia', 'water bottle'),
  t('detersivo lavatrice', 'laundry detergent'),
  t('filtri caffè', 'coffee filters'),
] as const;

const CLOTHING = [
  { name: 'Zara', raw: 'ZARA ITALIA SRL MILANO C.SO VITTORIO EMANUELE' },
  { name: 'H&M', raw: 'H & M HENNES MAURITZ MILANO VIA TORINO' },
  { name: 'Uniqlo', raw: 'UNIQLO MILANO P.ZA CORDUSIO' },
] as const;

function everyday(b: Builder, date: string): void {
  const r = b.rng;
  const wd = weekday(date);
  const weekend = wd === 0 || wd === 6;

  // Coffee almost every day, now and then a second one.
  if (r.chance(weekend ? 0.4 : 0.65)) {
    const bar = r.pick(CAFES);
    const coffees = r.chance(0.15) ? 2 : 1;
    for (let i = 0; i < coffees; i++) {
      b.add({
        date,
        raw: b.pos(date, bar.raw),
        merchant: bar.name,
        title: t(`Caffè – ${bar.name}`, `Coffee – ${bar.name}`),
        amount: -r.pick([1.2, 1.3, 1.5, 2.4, 2.8, 3.2, 3.6]),
        categoryId: 'food.cafes',
      });
    }
  }

  // Groceries two or three times a week, the big shop at the weekend. Part of the Esselunga and
  // Coop runs come with their itemised receipt (food, household, toiletries on the same ticket).
  if (r.chance(weekend ? 0.42 : 0.3)) {
    const shop = r.weighted(GROCERIES.map((g) => [g, g.w] as const));
    const itemised = (shop.name === 'Esselunga' || shop.name === 'Coop') && r.chance(0.55);
    if (itemised) {
      const lines = receiptLines(r, weekend ? r.int(8, 14) : r.int(4, 8));
      const discount = shop.name === 'Esselunga' && r.chance(0.35) ? 1.5 : 0;
      const total = Math.round((lines.reduce((s, l) => s + l.amount, 0) - discount) * 100) / 100;
      b.add({
        date,
        raw: b.pos(date, shop.raw),
        merchant: shop.name,
        title: t(`Spesa da ${shop.name}`, `Groceries at ${shop.name}`),
        amount: -total,
        categoryId: 'food.groceries',
        items: lines.map((l) => ({ ...l, amount: -l.amount })),
        ...(discount > 0 && { note: t('Sconto Fidaty di 1,50 € sul totale', '€1.50 Fidaty loyalty discount on the total') }),
      });
    } else {
      const amount = r.amount(shop.min, weekend ? shop.max : shop.max * 0.7);
      b.add({
        date,
        raw: b.pos(date, shop.raw),
        merchant: shop.name,
        title: t(`Spesa da ${shop.name}`, `Groceries at ${shop.name}`),
        amount: -Math.max(shop.min, amount),
        categoryId: 'food.groceries',
      });
    }
  }

  // Saturday: bakery and the covered market.
  if (wd === 6) {
    if (r.chance(0.7)) {
      b.add({
        date,
        raw: b.pos(date, 'PANIFICIO SANTA RITA MILANO'),
        merchant: 'Panificio Santa Rita',
        title: t('Pane e focaccia – Panificio Santa Rita', 'Bread and focaccia – Panificio Santa Rita'),
        amount: -r.amount(4.5, 12.5, 0.1),
        categoryId: 'food.specialty',
      });
    }
    if (r.chance(0.5)) {
      b.add({
        date,
        raw: b.pos(date, 'MERCATO COMUNALE WAGNER BANCO 14'),
        merchant: 'Mercato Comunale Wagner',
        title: t('Frutta e verdura al mercato Wagner', 'Fruit and vegetables at the Wagner market'),
        amount: -r.amount(9, 26, 0.1),
        categoryId: 'food.specialty',
      });
    }
  }

  // Eating out, mostly at the weekend.
  if (r.chance(wd === 5 || wd === 6 ? 0.42 : 0.05)) {
    const place = r.pick(RESTAURANTS);
    const dinner = wd === 5 || wd === 6 || r.chance(0.5);
    b.add({
      date,
      raw: b.pos(date, place.raw),
      merchant: place.name,
      title: dinner ? t(`Cena da ${place.name}`, `Dinner at ${place.name}`) : t(`Pranzo da ${place.name}`, `Lunch at ${place.name}`),
      amount: -r.amount(place.min, place.max, 0.5),
      categoryId: 'food.restaurants',
    });
  }

  if (r.chance(0.075)) {
    const app = r.pick(DELIVERY);
    b.add({
      date,
      raw: b.online(date, app.raw),
      merchant: app.name,
      title: t(`Cena a domicilio con ${app.name}`, `${app.name} food delivery`),
      // Wide spread on purpose: a takeaway habit is not a subscription.
      amount: -r.amount(10, 42),
      categoryId: 'food.delivery',
    });
  }

  if (r.chance(0.035)) {
    const service = r.pick([
      { name: 'Enjoy', raw: 'ENJOY ENI CAR SHARING MILANO' },
      { name: 'Share Now', raw: 'SHARE NOW GMBH BERLIN' },
    ]);
    b.add({
      date,
      raw: b.online(date, service.raw),
      merchant: service.name,
      title: t(`Car sharing ${service.name}`, `${service.name} car sharing`),
      amount: -r.amount(5.5, 17),
      categoryId: 'transport.taxi',
    });
  }

  if (r.chance(0.018)) {
    b.add({
      date,
      raw: b.online(date, 'ITTAXI MILANO 028585'),
      merchant: 'itTaxi',
      title: t('Taxi a Milano', 'Taxi in Milan'),
      amount: -r.amount(11, 27, 0.1),
      categoryId: 'transport.taxi',
    });
  }

  if (r.chance(0.045)) {
    b.add({
      date,
      raw: b.pos(date, 'FARMACIA SOLARI SNC MILANO'),
      merchant: 'Farmacia Solari',
      title: t('Farmacia Solari', 'Solari pharmacy'),
      amount: -r.amount(5.9, 29.5, 0.1),
      categoryId: 'health.pharmacy',
    });
  }

  if (r.chance(0.05)) {
    const amount = r.pick([50, 50, 100]);
    b.add({
      date,
      raw: `PRELIEVO BANCOMAT ${dmy(date)} ${b.time()} ATM 0${r.int(1000, 9999)} MILANO VIA TORINO`,
      merchant: null,
      title: t(`Prelievo contanti ${amount} €`, `Cash withdrawal €${amount}`),
      amount: -amount,
      categoryId: 'other.cash',
    });
  }
}

// --- Monthly obligations and occasional purchases ----------------------------------------------------

function monthly(b: Builder, m: MonthKey): void {
  const r = b.rng;
  const mi = monthIndex(m);
  const monthIt = MONTHS_IT[mi]!;
  const monthEn = MONTHS_EN[mi]!;
  const winter = [10, 11, 0, 1].includes(mi);
  const summer = [5, 6, 7].includes(mi);

  // Income.
  const payday = businessDay(day(m, 27));
  b.add({
    date: payday,
    raw: `BONIFICO A VOSTRO FAVORE DA ACME ITALIA SRL CAUSALE: EMOLUMENTI ${monthIt.toUpperCase()} ${year(m)}`,
    merchant: 'Acme Italia',
    title: t(`Stipendio di ${monthIt}`, `${monthEn} salary`),
    amount: r.amount(3068, 3112),
    categoryId: 'income.salary',
  });
  if (mi === 11) {
    const date = businessDay(day(m, 18));
    b.add({
      date,
      raw: `BONIFICO A VOSTRO FAVORE DA ACME ITALIA SRL CAUSALE: TREDICESIMA MENSILITA ${year(m)}`,
      merchant: 'Acme Italia',
      title: t('Tredicesima', 'Christmas bonus (13th month salary)'),
      amount: 2890,
      categoryId: 'income.salary',
    });
  }
  if (mi === 6) {
    b.add({
      date: payday,
      raw: `BONIFICO A VOSTRO FAVORE DA ACME ITALIA SRL CAUSALE: PREMIO DI RISULTATO ${year(m)}`,
      merchant: 'Acme Italia',
      title: t('Premio di risultato', 'Performance bonus'),
      amount: 600,
      categoryId: 'income.salary',
    });
  }

  // Housing.
  const rentDay = day(m, r.int(1, 3));
  b.add({
    date: rentDay,
    raw: `BONIFICO SEPA A FAVORE DI MARIO ROSSI IBAN IT60X0542811101000000123456 CAUSALE: AFFITTO ${monthIt.toUpperCase()} ${year(m)} VIA SOLARI 12 INT. 4`,
    merchant: 'Mario Rossi',
    title: t(`Affitto di ${monthIt}`, `${monthEn} rent`),
    amount: -850,
    categoryId: 'housing.rent',
  });
  if (mi % 3 === 0) {
    const quarter = mi / 3 + 1;
    b.add({
      date: businessDay(day(m, 12)),
      raw: `BONIFICO SEPA A FAVORE DI STUDIO AMMINISTRAZIONI FERRI CAUSALE: RATA CONDOMINIALE Q${quarter} ${year(m)} SOLARI 12`,
      merchant: 'Studio Amministrazioni Ferri',
      title: t(`Spese condominiali, ${quarter}° trimestre`, `Building fees, Q${quarter}`),
      amount: -r.amount(186, 214),
      categoryId: 'housing.condo',
    });
  }

  // Utilities.
  b.add({
    date: businessDay(day(m, 16)),
    raw: `ADDEBITO SDD ENEL ENERGIA SPA CID IT56ZZZ0000005512830 FATT. N. 00${r.int(10000000, 99999999)} DEL ${dmy(day(m, 2))}`,
    merchant: 'Enel Energia',
    title: t(`Bolletta luce Enel – ${monthIt}`, `Enel electricity bill – ${monthEn}`),
    amount: -(winter ? r.amount(62, 74) : summer ? r.amount(56, 68) : r.amount(49, 59)),
    categoryId: 'utilities.electricity',
  });
  b.add({
    date: businessDay(day(m, 21)),
    raw: `ADDEBITO SDD A2A ENERGIA SPA CID IT32ZZZ0000012883420 FORNITURA GAS RIF. ${r.int(100000, 999999)}`,
    merchant: 'A2A Energia',
    title: t(`Bolletta gas A2A – ${monthIt}`, `A2A gas bill – ${monthEn}`),
    amount: -(winter ? r.amount(84, 118) : summer ? r.amount(14, 22) : r.amount(34, 52)),
    categoryId: 'utilities.gas',
  });
  if (mi % 3 === 0) {
    b.add({
      date: businessDay(day(m, 10)),
      raw: `ADDEBITO SDD MM SPA SERVIZIO IDRICO INTEGRATO CID IT11ZZZ0000003317520 BOLL. ${r.int(1000000, 9999999)}`,
      merchant: 'MM Servizio Idrico',
      title: t('Bolletta acqua MM (trimestrale)', 'MM water bill (quarterly)'),
      amount: -r.amount(38, 52),
      categoryId: 'utilities.water',
    });
  }
  b.add({
    date: businessDay(day(m, 7)),
    raw: `ADDEBITO SDD FASTWEB SPA CID IT74ZZZ0000012878470 FATTURA M${r.int(100000000, 999999999)}`,
    merchant: 'Fastweb',
    title: t('Internet fibra Fastweb', 'Fastweb fibre internet'),
    amount: -29.95,
    categoryId: 'utilities.internet',
  });
  b.add({
    date: day(m, 11),
    raw: `ADDEBITO SDD ILIAD ITALIA SPA CID IT09ZZZ0000013970161 OFFERTA GIGA 150`,
    merchant: 'Iliad',
    title: t('Telefono Iliad', 'Iliad mobile plan'),
    amount: -9.99,
    categoryId: 'utilities.phone',
  });
  if (mi === 5 || mi === 11) {
    const rata = mi === 5 ? 1 : 2;
    b.add({
      date: businessDay(day(m, mi === 5 ? 16 : 2)),
      raw: `PAGAMENTO F24 COMUNE DI MILANO TRIBUTO 3944 TARI ${year(m)} RATA ${rata}/2`,
      merchant: 'Comune di Milano',
      title: t(`TARI – tassa rifiuti (rata ${rata}/2)`, `TARI waste tax (instalment ${rata}/2)`),
      amount: -148.5,
      categoryId: 'utilities.waste',
    });
  }

  // Transport.
  b.add({
    date: day(m, 1),
    raw: `PAGAMENTO POS ${dmy(day(m, 1))} 08.04 ATM SPA MILANO ABBONAMENTO MENSILE CARTA *4821`,
    merchant: 'ATM Milano',
    title: t(`Abbonamento ATM di ${monthIt}`, `ATM transit pass – ${monthEn}`),
    amount: -39,
    categoryId: 'transport.public',
  });
  if (r.chance(0.6)) {
    const trip = r.pick([t('Milano–Bologna', 'Milan–Bologna'), t('Milano–Torino', 'Milan–Turin'), t('Milano–Verona', 'Milan–Verona')]);
    const date = day(m, r.int(4, 26));
    b.add({
      date,
      raw: b.online(date, `TRENITALIA.COM ROMA PNR ${b.code(6)}`),
      merchant: 'Trenitalia',
      title: t(`Treno ${trip.it} (Trenitalia)`, `Train ${trip.en} (Trenitalia)`),
      amount: -r.amount(19.9, 54.9, 0.1),
      categoryId: 'transport.public',
    });
  }
  if (r.chance(0.25)) {
    const date = day(m, r.int(4, 26));
    b.add({
      date,
      raw: b.online(date, `ITALO NTV SPA ROMA ${b.code(8)}`),
      merchant: 'Italo',
      title: t('Treno Milano–Roma (Italo)', 'Train Milan–Rome (Italo)'),
      amount: -r.amount(29.9, 69.9, 0.1),
      categoryId: 'transport.public',
    });
  }
  if ([1, 4, 7, 9].includes(mi)) {
    const date = day(m, r.int(5, 25));
    b.add({
      date,
      raw: b.pos(date, 'Q8 STAZIONE DI SERVIZIO VIALE CERTOSA'),
      merchant: 'Q8',
      title: t('Rifornimento carburante Q8', 'Q8 fuel'),
      amount: -r.amount(42, 61),
      categoryId: 'transport.fuel',
    });
  }
  if (mi === 8) {
    b.add({
      date: businessDay(day(m, 18)),
      raw: 'ADDEBITO SDD PRIMA ASSICURAZIONI SPA POLIZZA RCA AUTO RINNOVO ANNUALE',
      merchant: 'Prima Assicurazioni',
      title: t('Assicurazione auto (rinnovo annuale)', 'Car insurance (annual renewal)'),
      amount: -312.4,
      categoryId: 'transport.car',
    });
  }

  // Subscriptions, on the Revolut card.
  const subscriptions = [
    { d: 12, raw: 'Netflix.com', merchant: 'Netflix', title: t('Abbonamento Netflix', 'Netflix subscription'), amount: 13.99, cat: 'subscriptions.streaming' },
    { d: 20, raw: `Spotify P${b.code(9)}`, merchant: 'Spotify', title: t('Spotify Premium', 'Spotify Premium'), amount: 11.99, cat: 'subscriptions.streaming' },
    { d: 8, raw: 'Apple.com/bill', merchant: 'Apple iCloud', title: t('Spazio iCloud 50 GB', 'iCloud 50 GB storage'), amount: 2.99, cat: 'subscriptions.software' },
    { d: 15, raw: 'CLAUDE.AI SUBSCRIPTION ANTHROPIC.COM', merchant: 'Claude.ai', title: t('Abbonamento Claude Pro', 'Claude Pro subscription'), amount: 21.96, cat: 'subscriptions.software' },
  ];
  for (const s of subscriptions) {
    b.add({ date: day(m, s.d), raw: s.raw, merchant: s.merchant, title: s.title, amount: -s.amount, categoryId: s.cat, account: DEMO_ACCOUNTS.card });
  }
  b.add({
    date: day(m, 2),
    raw: b.online(day(m, 2), 'IL POST ABBONAMENTO MILANO'),
    merchant: 'Il Post',
    title: t('Abbonamento Il Post', 'Il Post subscription'),
    amount: -8,
    categoryId: 'subscriptions.news',
  });

  // Gym, cinema, books, concerts.
  b.add({
    date: businessDay(day(m, 5)),
    raw: 'ADDEBITO SDD VIRGIN ACTIVE ITALIA SPA QUOTA MENSILE CLUB MILANO CORSO COMO',
    merchant: 'Virgin Active',
    title: t('Palestra Virgin Active', 'Virgin Active gym membership'),
    amount: -64,
    categoryId: 'leisure.sport',
  });
  // Zero to two films a month: an irregular habit, not a subscription.
  const films = r.weighted([[0, 2], [1, 5], [2, 3]] as const);
  for (let i = 0; i < films; i++) {
    const date = day(m, r.int(1, 28));
    const cinema = r.pick([
      { name: 'UCI Cinemas Bicocca', raw: 'UCI CINEMAS BICOCCA MILANO' },
      { name: 'Cinema Anteo', raw: 'ANTEO PALAZZO DEL CINEMA MILANO' },
      { name: 'The Space Cinema Odeon', raw: 'THE SPACE CINEMA ODEON MILANO' },
    ]);
    b.add({
      date,
      raw: b.pos(date, cinema.raw),
      merchant: cinema.name,
      title: t(`Cinema – ${cinema.name}`, `Cinema – ${cinema.name}`),
      amount: -r.pick([9, 10.5, 18, 21, 27, 31.5]),
      categoryId: 'leisure.entertainment',
    });
  }
  if (r.chance(0.4)) {
    const date = day(m, r.int(3, 27));
    b.add({
      date,
      raw: b.pos(date, 'LA FELTRINELLI MILANO P.ZA PIEMONTE'),
      merchant: 'La Feltrinelli',
      title: t('Libri da La Feltrinelli', 'Books at La Feltrinelli'),
      amount: -r.amount(12, 34, 0.1),
      categoryId: 'leisure.hobbies',
    });
  }
  if ([1, 5, 9].includes(mi)) {
    const date = day(m, r.int(3, 20));
    b.add({
      date,
      raw: b.online(date, `TICKETONE SPA MILANO ORD ${r.int(10000000, 99999999)}`),
      merchant: 'TicketOne',
      title: t('Biglietti concerto (TicketOne)', 'Concert tickets (TicketOne)'),
      amount: -r.amount(45, 79, 0.5),
      categoryId: 'leisure.entertainment',
    });
  }

  // Shopping and personal care.
  const amazonOrders = r.int(1, 3);
  for (let i = 0; i < amazonOrders; i++) {
    const date = day(m, r.int(1, 28));
    const item = r.pick(AMAZON_ITEMS);
    b.add({
      date,
      raw: b.online(date, `AMZN Mktp IT*${b.code(9)} AMAZON.IT LU`),
      merchant: 'Amazon',
      title: t(`Amazon – ${item.it}`, `Amazon – ${item.en}`),
      amount: -r.amount(8.99, 59.9),
      categoryId: 'shopping.online',
    });
  }
  if (r.chance(0.5)) {
    const date = day(m, r.int(1, 28));
    const shop = r.pick(CLOTHING);
    b.add({
      date,
      raw: b.pos(date, shop.raw),
      merchant: shop.name,
      title: t(`Abbigliamento da ${shop.name}`, `Clothes at ${shop.name}`),
      amount: -r.amount(25.95, 79.9, 0.05),
      categoryId: 'shopping.clothing',
    });
  }
  {
    const date = day(m, r.int(6, 26));
    b.add({
      date,
      raw: b.pos(date, 'BARBERIA NAVIGLI DI ESPOSITO MILANO'),
      merchant: 'Barberia Navigli',
      title: t('Taglio di capelli', 'Haircut'),
      amount: -r.pick([18, 20, 22]),
      categoryId: 'shopping.personal',
    });
  }
  {
    const date = day(m, r.int(1, 28));
    b.add({
      date,
      raw: b.pos(date, 'TIGOTA SPA MILANO VIA FOPPA'),
      merchant: 'Tigotà',
      title: t('Prodotti per la casa da Tigotà', 'Household supplies at Tigotà'),
      amount: -r.amount(9, 26, 0.1),
      categoryId: 'shopping.home',
    });
  }

  // Bank fees and transfers.
  const monthEnd = businessDay(day(m, 31));
  b.add({
    date: monthEnd,
    raw: `COMMISSIONI - CANONE MENSILE CONTO ${monthIt.toUpperCase()} ${year(m)}`,
    merchant: 'Fineco',
    title: t('Canone mensile del conto', 'Monthly account fee'),
    amount: -3.95,
    categoryId: 'fees.bank',
  });
  if (mi % 3 === 2) {
    b.add({
      date: monthEnd,
      raw: `IMPOSTA DI BOLLO E/C - RENDICONTO AL ${dmy(day(m, 31))}`,
      merchant: 'Fineco',
      title: t('Imposta di bollo trimestrale', 'Quarterly stamp duty'),
      amount: -8.55,
      categoryId: 'fees.taxes',
    });
  }
  b.add({
    date: businessDay(day(m, 28)),
    raw: 'ADDEBITO SDD MONEYFARM SIM SPA PIANO DI ACCUMULO MENSILE',
    merchant: 'Moneyfarm',
    title: t('Piano di accumulo Moneyfarm', 'Moneyfarm savings plan'),
    amount: -250,
    categoryId: 'transfer.savings',
  });
  b.add({
    date: day(m, 2),
    raw: 'RICARICA CARTA REVOLUT DA CONTO FINECO TOP-UP',
    merchant: 'Revolut',
    title: t('Ricarica carta Revolut', 'Revolut card top-up'),
    amount: -150,
    categoryId: 'transfer.internal',
  });
}

// --- One-off events at fixed points of the year ----------------------------------------------------

/** The year of the first occurrence of month index `mi` (0-11) inside the window. */
function yearOf(months: readonly MonthKey[], mi: number): string | null {
  const m = months.find((x) => monthIndex(x) === mi);
  return m ? year(m) : null;
}

function events(b: Builder, months: readonly MonthKey[]): void {
  const on = (mi: number, d: number): string | null => {
    const y = yearOf(months, mi);
    return y ? `${y}-${pad(mi + 1)}-${pad(d)}` : null;
  };
  const add = (date: string | null, e: Omit<Entry, 'date'>): void => {
    if (date) b.add({ ...e, date });
  };

  // Black Friday, an IKEA trip, a dentist, a specialist.
  add(on(10, 28), { raw: 'PAGAMENTO POS 28/11 MEDIAWORLD MILANO CORSO VERCELLI CARTA *4821', merchant: 'MediaWorld', title: t('Robot aspirapolvere (Black Friday)', 'Robot vacuum (Black Friday)'), amount: -249, categoryId: 'shopping.electronics' });
  add(on(4, 9), { raw: 'PAGAMENTO POS IKEA ITALIA RETAIL SRL CORSICO CARTA *4821', merchant: 'IKEA', title: t('Libreria e lampade IKEA', 'IKEA bookcase and lamps'), amount: -189.4, categoryId: 'housing.furnishing' });
  add(on(4, 21), { raw: 'PAGAMENTO POS STUDIO DENTISTICO DR. GALLI MILANO CARTA *4821', merchant: 'Studio Dentistico Galli', title: t('Pulizia dei denti dal dentista', 'Dental cleaning'), amount: -120, categoryId: 'health.doctor' });
  add(on(1, 17), { raw: 'PAGAMENTO POS CENTRO MEDICO SANTAGOSTINO MILANO CARTA *4821', merchant: 'Centro Medico Santagostino', title: t('Visita dermatologica', 'Dermatology appointment'), amount: -140, categoryId: 'health.doctor', note: t('Visita detraibile: conserva la fattura per il 730', 'Tax-deductible visit: keep the invoice for the tax return') });
  add(on(2, 14), { raw: 'PAGAMENTO POS FERRAMENTA SOLARI MILANO CARTA *4821', merchant: 'Ferramenta Solari', title: t('Ferramenta: tasselli e silicone', 'Hardware store: wall plugs and sealant'), amount: -23.5, categoryId: 'housing.maintenance' });

  // Foreign-currency purchases online.
  add(on(2, 6), { raw: 'UDEMY.COM SAN FRANCISCO USD 49.99', merchant: 'Udemy', title: t('Corso online Udemy', 'Udemy online course'), amount: -49.99, currency: 'USD', categoryId: 'education.courses', account: DEMO_ACCOUNTS.card, note: t('Pagato in dollari: importo convertito a un cambio fisso di 0,90', 'Paid in US dollars: converted at a fixed 0.90 rate') });
  add(on(0, 19), { raw: 'HUMBLEBUNDLE.COM SAN FRANCISCO USD 12.00', merchant: 'Humble Bundle', title: t('Bundle di videogiochi', 'Video game bundle'), amount: -12, currency: 'USD', categoryId: 'leisure.hobbies', account: DEMO_ACCOUNTS.card });

  // A London weekend in April (GBP on the Revolut card).
  const london = yearOf(months, 3);
  if (london) {
    add(on(1, 9), { raw: b.online(`${london}-02-09`, 'EASYJET AIRLINE LUTON EZY4521'), merchant: 'easyJet', title: t('Volo Milano–Londra (easyJet)', 'Flight Milan–London (easyJet)'), amount: -112.4, categoryId: 'travel.flights' });
    add(on(2, 3), { raw: b.online(`${london}-03-03`, 'BOOKING.COM HOTEL AMSTERDAM'), merchant: 'Booking.com', title: t('Hotel a Londra, 2 notti', 'London hotel, 2 nights'), amount: -238, categoryId: 'travel.lodging' });
    const gbp = t('Pagato in sterline: importo convertito a un cambio fisso di 1,17', 'Paid in pounds: converted at a fixed 1.17 rate');
    const spend: [number, string, string, LocalizedText, number, string][] = [
      [17, 'Card payment to Pret A Manger (Kings Cross) London', 'Pret A Manger', t('Colazione da Pret A Manger', 'Breakfast at Pret A Manger'), 6.45, 'food.cafes'],
      [17, 'TfL Travel Charge', 'Transport for London', t('Metro di Londra (TfL)', 'London Underground (TfL)'), 8.5, 'transport.public'],
      [18, 'Card payment to Tesco Express Covent Garden', 'Tesco', t('Spesa da Tesco Express', 'Groceries at Tesco Express'), 8.26, 'food.groceries'],
      [18, 'Card payment to British Museum Shop', 'British Museum', t('Libreria del British Museum', 'British Museum shop'), 18, 'leisure.entertainment'],
      [18, 'Card payment to The Harp Pub', 'The Harp', t('Birre al pub The Harp', 'Pints at The Harp pub'), 14.8, 'food.cafes'],
      [18, 'Card payment to Dishoom Shoreditch', 'Dishoom', t('Cena da Dishoom', 'Dinner at Dishoom'), 42.6, 'food.restaurants'],
      [19, 'TfL Travel Charge', 'Transport for London', t('Metro di Londra (TfL)', 'London Underground (TfL)'), 8.5, 'transport.public'],
      [19, 'Uber *Trip London', 'Uber', t('Uber per l\'aeroporto di Luton', 'Uber to Luton airport'), 21.3, 'transport.taxi'],
    ];
    for (const [d, raw, merchant, title, amount, categoryId] of spend) {
      b.add({ date: `${london}-04-${pad(d)}`, raw, merchant, title, amount: -amount, currency: 'GBP', categoryId, account: DEMO_ACCOUNTS.card, note: gbp });
    }
  }

  // A summer week in Berlin (EUR on the Revolut card, German statement lines).
  const berlin = yearOf(months, 7);
  if (berlin) {
    add(on(5, 22), { raw: b.online(`${berlin}-06-22`, 'LUFTHANSA 2203456789012 FRANKFURT'), merchant: 'Lufthansa', title: t('Volo Milano–Berlino (Lufthansa)', 'Flight Milan–Berlin (Lufthansa)'), amount: -186.4, categoryId: 'travel.flights' });
    add(on(5, 22), { raw: b.online(`${berlin}-06-22`, 'RYANAIR DAC DUBLIN FR8KQ2'), merchant: 'Ryanair', title: t('Volo Berlino–Milano (Ryanair)', 'Flight Berlin–Milan (Ryanair)'), amount: -64.99, categoryId: 'travel.flights' });
    add(on(6, 4), { raw: b.online(`${berlin}-07-04`, 'AIRBNB * HMQ8ZK2XRT LONDON'), merchant: 'Airbnb', title: t('Airbnb a Berlino, 4 notti', 'Berlin Airbnb, 4 nights'), amount: -412, categoryId: 'travel.lodging' });
    const spend: [number, string, string, LocalizedText, number, string][] = [
      [10, `KARTENZAHLUNG ${dotted(`${berlin}-08-10`)} BVG FAHRKARTENAUTOMAT U ALEXANDERPLATZ`, 'BVG', t('Biglietto settimanale BVG', 'BVG 7-day transit ticket'), 41.5, 'transport.public'],
      [10, `KARTENZAHLUNG ${dotted(`${berlin}-08-10`)} REWE MARKT GMBH BERLIN-FRIEDRICHSHAIN`, 'REWE', t('Spesa da REWE', 'Groceries at REWE'), 23.4, 'food.groceries'],
      [11, `KARTENZAHLUNG ${dotted(`${berlin}-08-11`)} CURRYWURST IMBISS KREUZBERG BERLIN`, 'Curry 36', t('Currywurst a Kreuzberg', 'Currywurst in Kreuzberg'), 8.9, 'food.restaurants'],
      [11, `KARTENZAHLUNG ${dotted(`${berlin}-08-11`)} STAATLICHE MUSEEN ZU BERLIN EINTRITT`, 'Staatliche Museen zu Berlin', t('Ingresso ai musei di Berlino', 'Berlin State Museums admission'), 19, 'leisure.entertainment'],
      [12, `KARTENZAHLUNG ${dotted(`${berlin}-08-12`)} SPAETKAUF WARSCHAUER STRASSE BERLIN`, 'Späti Warschauer Straße', t('Spesa al Späti', 'Late-night shop (Späti)'), 6.2, 'food.specialty'],
      [12, `KARTENZAHLUNG ${dotted(`${berlin}-08-12`)} RESTAURANT SCHWARZWALDSTUBEN BERLIN-MITTE`, 'Schwarzwaldstuben', t('Cena alla Schwarzwaldstuben', 'Dinner at Schwarzwaldstuben'), 54.8, 'food.restaurants'],
      [13, `KARTENZAHLUNG ${dotted(`${berlin}-08-13`)} PRATER GARTEN BIERGARTEN BERLIN`, 'Prater Garten', t('Birreria Prater Garten', 'Prater Garten beer garden'), 18.5, 'food.cafes'],
      [14, `KARTENZAHLUNG ${dotted(`${berlin}-08-14`)} DUSSMANN DAS KULTURKAUFHAUS BERLIN`, 'Dussmann', t('Libri da Dussmann', 'Books at Dussmann'), 27.9, 'leisure.hobbies'],
    ];
    for (const [d, raw, merchant, title, amount, categoryId] of spend) {
      b.add({ date: `${berlin}-08-${pad(d)}`, raw, merchant, title, amount: -amount, categoryId, account: DEMO_ACCOUNTS.card });
    }
  }

  // December: presents and a donation.
  const xmas = yearOf(months, 11);
  if (xmas) {
    const gifts: [number, string, string, LocalizedText, number][] = [
      [6, 'LA RINASCENTE MILANO DUOMO', 'La Rinascente', t('Regalo di Natale per Giulia', 'Christmas present for Giulia'), 89],
      [9, 'LA FELTRINELLI MILANO P.ZA PIEMONTE', 'La Feltrinelli', t('Libri da regalare', 'Books as presents'), 32],
      [12, 'PROFUMERIA DOUGLAS MILANO VIA TORINO', 'Douglas', t('Profumo per la mamma', 'Perfume for mum'), 54],
      [14, 'FLYING TIGER COPENHAGEN MILANO', 'Flying Tiger', t('Pensierini per i colleghi', 'Small gifts for colleagues'), 18.5],
      [19, 'MARKET NATALE PIAZZA DUOMO BANCO 7', 'Mercatino di Natale', t('Mercatino di Natale in Duomo', 'Christmas market at the Duomo'), 26.4],
    ];
    for (const [d, raw, merchant, title, amount] of gifts) {
      const date = `${xmas}-12-${pad(d)}`;
      b.add({ date, raw: b.pos(date, raw), merchant, title, amount: -amount, categoryId: 'gifts.gifts' });
    }
    b.add({ date: `${xmas}-12-20`, raw: 'BONIFICO SEPA A FAVORE DI EMERGENCY ONG ONLUS CAUSALE: DONAZIONE NATALE', merchant: 'Emergency', title: t('Donazione a Emergency', 'Donation to Emergency'), amount: -50, categoryId: 'gifts.donations' });
  }

  // Refunds and a credit-card settlement.
  add(on(5, 9), { raw: 'BONIFICO A VOSTRO FAVORE DA TRENITALIA SPA CAUSALE: RIMBORSO PNR K2X9QA', merchant: 'Trenitalia', title: t('Rimborso treno in ritardo', 'Refund for a delayed train'), amount: 24.9, categoryId: 'income.refunds' });
  const returnDate = on(9, 14);
  add(returnDate, { raw: 'STORNO PAGAMENTO AMZN Mktp IT*R7Q2K9L01 AMAZON.IT LU', merchant: 'Amazon', title: t('Rimborso reso Amazon', 'Amazon return refund'), amount: 39.99, categoryId: 'income.refunds', note: t('Reso delle cuffie difettose', 'Faulty headphones returned') });
  add(on(1, 15), { raw: 'ADDEBITO SALDO CARTA DI CREDITO FINECO VISA E/C GENNAIO', merchant: 'Fineco', title: t('Saldo carta di credito', 'Credit card repayment'), amount: -412.3, categoryId: 'transfer.internal' });

}

// --- Rows the AI could not file with confidence ------------------------------------------------------

const AMBIGUOUS: readonly Omit<Entry, 'date'>[] = [
  { raw: 'SUMUP *MARCO BELLI MILANO', merchant: null, title: t('Pagamento a Marco Belli (SumUp)', 'Payment to Marco Belli (SumUp)'), amount: -15, categoryId: 'other.misc', confidence: 0.45 },
  { raw: 'PAYPAL *ELENAR 35314369001', merchant: null, title: t('Pagamento PayPal a "ELENAR"', 'PayPal payment to "ELENAR"'), amount: -32.5, categoryId: 'shopping.online', confidence: 0.5 },
  { raw: 'SATISPAY*BOTTEGA 27 MILANO', merchant: 'Bottega 27', title: t('Acquisto da Bottega 27 (Satispay)', 'Purchase at Bottega 27 (Satispay)'), amount: -9.8, categoryId: 'food.specialty', confidence: 0.55 },
  { raw: 'BONIFICO SEPA A FAVORE DI GIULIA BIANCHI CAUSALE: GRAZIE!', merchant: 'Giulia Bianchi', title: t('Bonifico a Giulia Bianchi', 'Transfer to Giulia Bianchi'), amount: -60, categoryId: 'gifts.gifts', confidence: 0.4 },
  { raw: 'PAGAMENTO POS 4421 MILANO CARTA *4821', merchant: null, title: t('Pagamento POS non identificato', 'Unidentified card payment'), amount: -23.7, categoryId: 'other.misc', confidence: 0.4 },
  { raw: 'ADDEBITO SDD 0099213 CREDITORE IT44ZZZ0000099213', merchant: null, title: t('Addebito diretto da creditore sconosciuto', 'Direct debit from an unknown creditor'), amount: -12, categoryId: 'subscriptions.software', confidence: 0.45 },
  { raw: 'PAYPAL *STEAMGAMES 4029357733', merchant: 'Steam', title: t('Acquisto su Steam via PayPal', 'Steam purchase via PayPal'), amount: -19.99, categoryId: 'leisure.hobbies', confidence: 0.6 },
  { raw: 'SQ *LA CANTINA DI P MILANO', merchant: 'La Cantina di P', title: t('La Cantina di P', 'La Cantina di P'), amount: -41, categoryId: 'food.restaurants', confidence: 0.55 },
  { raw: 'ZETTLE_*STUDIO YOGA SHANTI', merchant: 'Studio Yoga Shanti', title: t('Lezione allo Studio Yoga Shanti', 'Class at Studio Yoga Shanti'), amount: -25, categoryId: 'leisure.sport', confidence: 0.5 },
  { raw: 'VERSAMENTO CONTANTI SPORTELLO EVOLUTO MILANO', merchant: null, title: t('Versamento di contanti', 'Cash deposit'), amount: 200, categoryId: 'income.other', confidence: 0.5 },
];

const REVIEW_NOTE = t(
  'Categoria incerta: il beneficiario non è riconoscibile dalla descrizione. Verifica e correggi se serve.',
  'Uncertain category: the payee cannot be recognised from the description. Check it and correct it if needed.',
);

/** Days before `today` of each ambiguous row: spread over the last two months. */
const AMBIGUOUS_DAYS_BACK = [2, 5, 9, 14, 19, 25, 31, 38, 47, 58] as const;

export function generateDemo(options: DemoOptions = {}): NewTransaction[] {
  const today = options.today ?? todayIso();
  const months = monthsEndingAt(monthKeyOf(today), options.months ?? DEFAULT_DEMO_MONTHS);
  const b = new Builder(today, new Rng(options.seed ?? DEFAULT_DEMO_SEED));

  for (const m of months) {
    for (let d = 1; d <= daysInMonth(m); d++) everyday(b, day(m, d));
    monthly(b, m);
  }
  events(b, months);

  const first = `${months[0]}-01`;
  AMBIGUOUS.forEach((entry, i) => {
    const date = addDays(today, -AMBIGUOUS_DAYS_BACK[i]!);
    if (date >= first) b.add({ ...entry, date, needsReview: true, note: REVIEW_NOTE });
  });

  return b.rows.filter((row) => row.date >= first).sort((x, y) => x.date.localeCompare(y.date));
}
