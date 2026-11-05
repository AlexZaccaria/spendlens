import type { LocalizedText } from './i18n.ts';

/** expense = counts as spending; income = money in; transfer = moves between own accounts
 *  (card payoff, savings, investments) and is excluded from both totals. */
export type CategoryKind = 'expense' | 'income' | 'transfer';

export interface CategoryDef {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: CategoryKind;
  readonly label: LocalizedText;
  /** Lucide icon name. */
  readonly icon: string;
  /** Fixed categorical colour slot (1-8) of a top-level expense category. Colour follows the
   *  category, never its rank; categories without a slot are drawn in the neutral "other" tone. */
  readonly slot: number | null;
  /** Multilingual merchant and keyword examples, given to the model as categorisation hints. */
  readonly hints: readonly string[];
}

type Child = Omit<CategoryDef, 'parentId' | 'kind' | 'slot' | 'icon'> & { icon?: string };
type Root = Omit<CategoryDef, 'parentId' | 'hints'> & { hints?: readonly string[]; children: readonly Child[] };

const TREE: readonly Root[] = [
  {
    id: 'housing', kind: 'expense', slot: 1, icon: 'house', label: { it: 'Casa', en: 'Housing' },
    children: [
      { id: 'housing.rent', label: { it: 'Affitto', en: 'Rent' }, hints: ['affitto', 'canone locazione', 'Miete', 'rent', 'loyer', 'alquiler'] },
      { id: 'housing.mortgage', label: { it: 'Mutuo', en: 'Mortgage' }, hints: ['rata mutuo', 'Hypothek', 'Darlehen', 'mortgage', 'prêt immobilier'] },
      { id: 'housing.condo', label: { it: 'Condominio', en: 'Building fees' }, hints: ['spese condominiali', 'amministratore', 'Hausgeld', 'Nebenkosten', 'HOA', 'service charge'] },
      { id: 'housing.maintenance', label: { it: 'Manutenzione', en: 'Maintenance' }, hints: ['idraulico', 'elettricista', 'ferramenta', 'Handwerker', 'plumber', 'Leroy Merlin', 'Bricoman', 'OBI'] },
      { id: 'housing.furnishing', label: { it: 'Arredamento', en: 'Furnishing' }, hints: ['IKEA', 'Maisons du Monde', 'Mondo Convenienza', 'mobili', 'Möbel', 'furniture'] },
    ],
  },
  {
    id: 'utilities', kind: 'expense', slot: 3, icon: 'zap', label: { it: 'Bollette', en: 'Utilities' },
    children: [
      { id: 'utilities.electricity', label: { it: 'Luce', en: 'Electricity' }, hints: ['Enel Energia', 'Edison', 'A2A', 'Hera', 'Iren', 'Sorgenia', 'Octopus', 'Strom', 'Stadtwerke', 'electricity', 'EDF'] },
      { id: 'utilities.gas', label: { it: 'Gas', en: 'Gas' }, hints: ['Eni Plenitude', 'gas naturale', 'Italgas', 'Gasag', 'British Gas', 'Engie'] },
      { id: 'utilities.water', label: { it: 'Acqua', en: 'Water' }, hints: ['MM Spa servizio idrico', 'Acea Ato', 'acquedotto', 'Wasser', 'Thames Water'] },
      { id: 'utilities.internet', label: { it: 'Internet', en: 'Internet' }, hints: ['Fastweb', 'TIM fibra', 'Vodafone casa', 'WindTre fibra', 'Iliad box', 'Telekom', 'Vodafone Kabel', 'broadband'] },
      { id: 'utilities.phone', label: { it: 'Telefono', en: 'Phone' }, hints: ['Iliad', 'ho. mobile', 'Very Mobile', 'TIM ricarica', 'ricarica telefonica', 'Handyvertrag', 'Giffgaff', 'mobile plan'] },
      { id: 'utilities.waste', label: { it: 'Rifiuti', en: 'Waste' }, hints: ['TARI', 'tassa rifiuti', 'Müllgebühr', 'council tax'] },
      { id: 'utilities.other', label: { it: 'Altre utenze', en: 'Other utilities' }, hints: ['canone RAI', 'TV licence', 'Rundfunkbeitrag', 'teleriscaldamento'] },
    ],
  },
  {
    id: 'food', kind: 'expense', slot: 2, icon: 'utensils', label: { it: 'Cibo', en: 'Food' },
    children: [
      { id: 'food.groceries', label: { it: 'Spesa', en: 'Groceries' }, hints: ['Esselunga', 'Coop', 'Conad', 'Carrefour', 'Lidl', 'Aldi', 'Eurospin', 'Pam', 'Penny', 'Rewe', 'Edeka', 'Tesco', 'Sainsbury', 'Mercadona', 'supermercato', 'Supermarkt'] },
      { id: 'food.restaurants', label: { it: 'Ristoranti', en: 'Restaurants' }, hints: ['ristorante', 'trattoria', 'osteria', 'pizzeria', 'sushi', 'Restaurant', 'bistro', 'brasserie'] },
      { id: 'food.delivery', label: { it: 'Consegne a domicilio', en: 'Food delivery' }, hints: ['Glovo', 'Deliveroo', 'Just Eat', 'Uber Eats', 'Lieferando', 'Wolt'] },
      { id: 'food.cafes', label: { it: 'Bar e caffè', en: 'Cafés & bars' }, hints: ['bar', 'caffetteria', 'pasticceria', 'Starbucks', 'Café', 'Bäckerei', 'pub', 'aperitivo'] },
      { id: 'food.specialty', label: { it: 'Alimentari', en: 'Specialty food' }, hints: ['panificio', 'forno', 'macelleria', 'pescheria', 'fruttivendolo', 'mercato', 'enoteca', 'Metzgerei', 'butcher', 'bakery'] },
    ],
  },
  {
    id: 'transport', kind: 'expense', slot: 4, icon: 'car', label: { it: 'Trasporti', en: 'Transport' },
    children: [
      { id: 'transport.fuel', label: { it: 'Carburante', en: 'Fuel' }, hints: ['Eni Station', 'Q8', 'IP', 'Tamoil', 'Esso', 'Shell', 'Aral', 'benzina', 'gasolio', 'Tankstelle', 'petrol'] },
      { id: 'transport.public', label: { it: 'Mezzi pubblici', en: 'Public transport' }, hints: ['ATM Milano', 'ATAC', 'GTT', 'Trenord', 'Trenitalia', 'Italo', 'BVG', 'Deutsche Bahn', 'TfL', 'abbonamento mensile', 'Monatskarte'] },
      { id: 'transport.taxi', label: { it: 'Taxi e sharing', en: 'Taxi & sharing' }, hints: ['Uber', 'FreeNow', 'Bolt', 'taxi', 'itTaxi', 'Lime', 'Tier', 'Dott', 'ShareNow', 'Enjoy'] },
      { id: 'transport.car', label: { it: 'Auto', en: 'Car' }, hints: ['assicurazione auto', 'RCA', 'bollo auto', 'officina', 'tagliando', 'gommista', 'Kfz-Versicherung', 'car insurance', 'MOT'] },
      { id: 'transport.parking', label: { it: 'Parcheggi e pedaggi', en: 'Parking & tolls' }, hints: ['Autostrade per l\'Italia', 'Telepass', 'EasyPark', 'parcheggio', 'Parkhaus', 'Maut', 'parking'] },
    ],
  },
  {
    id: 'shopping', kind: 'expense', slot: 5, icon: 'shopping-bag', label: { it: 'Shopping', en: 'Shopping' },
    children: [
      { id: 'shopping.clothing', label: { it: 'Abbigliamento', en: 'Clothing' }, hints: ['Zara', 'H&M', 'Uniqlo', 'OVS', 'Decathlon abbigliamento', 'Zalando', 'Primark', 'scarpe', 'Kleidung'] },
      { id: 'shopping.electronics', label: { it: 'Elettronica', en: 'Electronics' }, hints: ['MediaWorld', 'Unieuro', 'Euronics', 'Apple Store', 'Media Markt', 'Saturn', 'Currys'] },
      { id: 'shopping.online', label: { it: 'Acquisti online', en: 'Online shopping' }, hints: ['Amazon', 'AMZN Mktp', 'eBay', 'AliExpress', 'Temu', 'Shein', 'Vinted'] },
      { id: 'shopping.personal', label: { it: 'Cura della persona', en: 'Personal care' }, hints: ['parrucchiere', 'barbiere', 'estetista', 'Sephora', 'Douglas', 'Acqua & Sapone', 'dm-drogerie', 'Rossmann', 'Boots'] },
      { id: 'shopping.home', label: { it: 'Casa e pulizia', en: 'Household' }, hints: ['detersivi', 'Tigotà', 'Kasanova', 'Haushalt', 'household supplies'] },
    ],
  },
  {
    id: 'health', kind: 'expense', slot: 6, icon: 'heart-pulse', label: { it: 'Salute', en: 'Health' },
    children: [
      { id: 'health.pharmacy', label: { it: 'Farmacia', en: 'Pharmacy' }, hints: ['farmacia', 'parafarmacia', 'Apotheke', 'pharmacy', 'pharmacie'] },
      { id: 'health.doctor', label: { it: 'Visite ed esami', en: 'Doctors & tests' }, hints: ['ticket sanitario', 'visita specialistica', 'dentista', 'Centro Medico', 'Synlab', 'Arzt', 'Zahnarzt', 'dentist', 'GP'] },
      { id: 'health.insurance', label: { it: 'Assicurazione sanitaria', en: 'Health insurance' }, hints: ['assicurazione salute', 'fondo sanitario', 'Krankenversicherung', 'TK', 'AOK', 'Bupa'] },
    ],
  },
  {
    id: 'leisure', kind: 'expense', slot: 7, icon: 'party-popper', label: { it: 'Tempo libero', en: 'Leisure' },
    children: [
      { id: 'leisure.entertainment', label: { it: 'Cinema ed eventi', en: 'Entertainment' }, hints: ['cinema', 'UCI', 'The Space', 'TicketOne', 'Ticketmaster', 'Eventim', 'concerto', 'museo', 'teatro', 'Kino'] },
      { id: 'leisure.sport', label: { it: 'Sport e palestra', en: 'Sport & fitness' }, hints: ['palestra', 'McFit', 'Virgin Active', 'Anytime Fitness', 'piscina', 'Decathlon', 'Fitnessstudio', 'gym'] },
      { id: 'leisure.hobbies', label: { it: 'Hobby e giochi', en: 'Hobbies & games' }, hints: ['Steam', 'PlayStation Store', 'Nintendo eShop', 'Feltrinelli', 'Mondadori', 'Thalia', 'libreria', 'books'] },
    ],
  },
  {
    id: 'subscriptions', kind: 'expense', slot: null, icon: 'repeat', label: { it: 'Abbonamenti', en: 'Subscriptions' },
    children: [
      { id: 'subscriptions.streaming', label: { it: 'Streaming', en: 'Streaming' }, hints: ['Netflix', 'Spotify', 'Disney+', 'Prime Video', 'DAZN', 'NOW TV', 'Apple Music', 'YouTube Premium', 'Crunchyroll'] },
      { id: 'subscriptions.software', label: { it: 'Software e cloud', en: 'Software & cloud' }, hints: ['iCloud', 'Google One', 'Microsoft 365', 'Adobe', 'ChatGPT', 'Claude.ai', 'Anthropic', 'GitHub', 'Dropbox', 'Notion', '1Password'] },
      { id: 'subscriptions.news', label: { it: 'Notizie e riviste', en: 'News & magazines' }, hints: ['Corriere', 'Repubblica', 'Il Post', 'The Economist', 'Spiegel', 'NYTimes', 'Medium', 'Substack'] },
    ],
  },
  {
    id: 'travel', kind: 'expense', slot: 8, icon: 'plane', label: { it: 'Viaggi', en: 'Travel' },
    children: [
      { id: 'travel.flights', label: { it: 'Voli', en: 'Flights' }, hints: ['Ryanair', 'easyJet', 'ITA Airways', 'Wizz Air', 'Lufthansa', 'Vueling', 'volo', 'Flug'] },
      { id: 'travel.lodging', label: { it: 'Alloggi', en: 'Lodging' }, hints: ['Booking.com', 'Airbnb', 'hotel', 'albergo', 'B&B', 'Expedia', 'Unterkunft'] },
      { id: 'travel.other', label: { it: 'Altre spese di viaggio', en: 'Other travel' }, hints: ['noleggio auto', 'Hertz', 'Europcar', 'traghetto', 'GetYourGuide', 'souvenir', 'travel insurance'] },
    ],
  },
  {
    id: 'education', kind: 'expense', slot: null, icon: 'graduation-cap', label: { it: 'Istruzione', en: 'Education' },
    children: [
      { id: 'education.courses', label: { it: 'Corsi e scuola', en: 'Courses & school' }, hints: ['università', 'tasse universitarie', 'Udemy', 'Coursera', 'corso', 'retta', 'Schulgeld', 'tuition'] },
      { id: 'education.supplies', label: { it: 'Libri e materiale', en: 'Books & supplies' }, hints: ['libri scolastici', 'cartoleria', 'Schulbedarf', 'stationery'] },
    ],
  },
  {
    id: 'family', kind: 'expense', slot: null, icon: 'baby', label: { it: 'Famiglia e animali', en: 'Family & pets' },
    children: [
      { id: 'family.kids', label: { it: 'Figli', en: 'Kids' }, hints: ['asilo', 'baby sitter', 'Prenatal', 'giocattoli', 'Kita', 'nursery', 'childcare'] },
      { id: 'family.pets', label: { it: 'Animali', en: 'Pets' }, icon: 'paw-print', hints: ['veterinario', 'Arcaplanet', 'Isola dei Tesori', 'Zooplus', 'Fressnapf', 'Tierarzt', 'vet'] },
    ],
  },
  {
    id: 'gifts', kind: 'expense', slot: null, icon: 'gift', label: { it: 'Regali e donazioni', en: 'Gifts & donations' },
    children: [
      { id: 'gifts.gifts', label: { it: 'Regali', en: 'Gifts' }, hints: ['regalo', 'fiorista', 'Geschenk', 'gift', 'Interflora'] },
      { id: 'gifts.donations', label: { it: 'Donazioni', en: 'Donations' }, hints: ['donazione', 'Emergency', 'UNICEF', 'Medici Senza Frontiere', 'Spende', 'charity', 'Wikimedia'] },
    ],
  },
  {
    id: 'fees', kind: 'expense', slot: null, icon: 'landmark', label: { it: 'Tasse e commissioni', en: 'Taxes & fees' },
    children: [
      { id: 'fees.bank', label: { it: 'Commissioni bancarie', en: 'Bank fees' }, hints: ['canone conto', 'commissione bonifico', 'imposta di bollo', 'spese tenuta conto', 'Kontoführungsgebühr', 'account fee', 'FX fee'] },
      { id: 'fees.taxes', label: { it: 'Tasse e imposte', en: 'Taxes' }, hints: ['F24', 'IMU', 'IRPEF', 'Agenzia delle Entrate', 'Finanzamt', 'HMRC', 'tax'] },
      { id: 'fees.fines', label: { it: 'Multe', en: 'Fines' }, hints: ['multa', 'contravvenzione', 'verbale', 'Bußgeld', 'penalty notice'] },
    ],
  },
  {
    id: 'other', kind: 'expense', slot: null, icon: 'circle-question-mark', label: { it: 'Altro', en: 'Other' },
    children: [
      { id: 'other.cash', label: { it: 'Prelievi contanti', en: 'Cash withdrawals' }, icon: 'banknote', hints: ['prelievo bancomat', 'prelievo ATM', 'Bargeldauszahlung', 'Geldautomat', 'ATM withdrawal', 'cash'] },
      { id: 'other.misc', label: { it: 'Varie', en: 'Miscellaneous' }, hints: [] },
    ],
  },
  {
    id: 'income', kind: 'income', slot: null, icon: 'wallet', label: { it: 'Entrate', en: 'Income' },
    children: [
      { id: 'income.salary', label: { it: 'Stipendio', en: 'Salary' }, hints: ['stipendio', 'emolumenti', 'retribuzione', 'Gehalt', 'Lohn', 'salary', 'payroll'] },
      { id: 'income.refunds', label: { it: 'Rimborsi', en: 'Refunds' }, hints: ['rimborso', 'storno', 'reso', 'Erstattung', 'Gutschrift', 'refund', 'chargeback'] },
      { id: 'income.other', label: { it: 'Altre entrate', en: 'Other income' }, hints: ['bonifico ricevuto', 'interessi', 'dividendi', 'Zinsen', 'interest', 'Satispay ricevuto'] },
    ],
  },
  {
    id: 'transfer', kind: 'transfer', slot: null, icon: 'arrow-left-right', label: { it: 'Trasferimenti', en: 'Transfers' },
    children: [
      { id: 'transfer.internal', label: { it: 'Giroconti', en: 'Between own accounts' }, hints: ['giroconto', 'trasferimento tra conti', 'ricarica carta prepagata', 'saldo carta di credito', 'Umbuchung', 'Kreditkartenabrechnung', 'top-up', 'card repayment'] },
      { id: 'transfer.savings', label: { it: 'Risparmi e investimenti', en: 'Savings & investments' }, hints: ['salvadanaio', 'PAC', 'Trade Republic', 'Scalable Capital', 'Moneyfarm', 'Sparplan', 'Depot', 'savings vault', 'investment'] },
    ],
  },
];

export const CATEGORIES: readonly CategoryDef[] = TREE.flatMap((root) => [
  { id: root.id, parentId: null, kind: root.kind, label: root.label, icon: root.icon, slot: root.slot, hints: root.hints ?? [] },
  ...root.children.map((c) => ({
    id: c.id,
    parentId: root.id,
    kind: root.kind,
    label: c.label,
    icon: c.icon ?? root.icon,
    slot: root.slot,
    hints: c.hints,
  })),
]);

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** Leaves are what a transaction is filed under; roots group them. */
export const LEAF_CATEGORY_IDS = CATEGORIES.filter((c) => c.parentId !== null).map((c) => c.id) as [string, ...string[]];
export const ROOT_CATEGORY_IDS = CATEGORIES.filter((c) => c.parentId === null).map((c) => c.id);

export const FALLBACK_EXPENSE_CATEGORY = 'other.misc';

export function isCategoryId(id: string): boolean {
  return BY_ID.has(id);
}

export function getCategory(id: string): CategoryDef | undefined {
  return BY_ID.get(id);
}

export function rootOf(id: string): CategoryDef {
  const c = BY_ID.get(id) ?? BY_ID.get(FALLBACK_EXPENSE_CATEGORY)!;
  return c.parentId === null ? c : BY_ID.get(c.parentId)!;
}

export function childrenOf(rootId: string): readonly CategoryDef[] {
  return CATEGORIES.filter((c) => c.parentId === rootId);
}
