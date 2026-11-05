// Regenerates samples/: deliberately irregular, multilingual statements, receipts and notes used
// to exercise the AI import. Run with `npm run samples`; the output is byte-for-byte reproducible.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import * as XLSX from 'xlsx';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'samples');
mkdirSync(OUT, { recursive: true });

const write = (name: string, data: string | Uint8Array): void => {
  writeFileSync(join(OUT, name), data);
  console.log(`  ${name}`);
};

// --- Legacy single-byte encodings ----------------------------------------------------------------

/** Windows-1252 differs from ISO-8859-1 only in 0x80-0x9F, where it puts € and typographic marks. */
const CP1252_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

function encodeSingleByte(text: string, charset: 'windows-1252' | 'iso-8859-1'): Uint8Array {
  return Uint8Array.from([...text], (ch) => {
    const extra = charset === 'windows-1252' ? CP1252_EXTRA[ch] : undefined;
    if (extra !== undefined) return extra;
    const code = ch.codePointAt(0)!;
    if (code > 0xff || (charset === 'windows-1252' && code >= 0x80 && code <= 0x9f)) {
      throw new Error(`"${ch}" cannot be encoded in ${charset}`);
    }
    return code;
  });
}

const csvField = (value: string, sep: string, alwaysQuote = false): string =>
  alwaysQuote || value.includes(sep) || value.includes('"') || value.includes('\n') ? `"${value.replaceAll('"', '""')}"` : value;

/** Italian money: 1.234,56 */
const itAmount = (n: number): string => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });

// --- 1. Intesa Sanpaolo CSV (Italian, windows-1252) -------------------------------------------------

function intesa(): void {
  type Row = [date: string, description: string, debit: number | null, credit: number | null, causale: string];
  const rows: Row[] = [
    ['01/10/2026', 'BONIFICO SEPA A FAVORE DI MARIO ROSSI CAUSALE: AFFITTO OTTOBRE 2026 VIA SOLARI 12 INT. 4', 850, null, '26'],
    ['01/10/2026', 'PAGAMENTO POS 01/10/2026 08.04 ATM SPA MILANO ABBONAMENTO MENSILE CARTA *4821', 39, null, '43'],
    ['02/10/2026', 'PAGAMENTO POS 02/10/2026 07.58 CAFFÈ DELLA PIAZZA MILANO CARTA *4821', 1.3, null, '43'],
    ['03/10/2026', 'BONIFICO A VOSTRO FAVORE\nORD. ACME ITALIA S.R.L.\nCAUSALE: RIMBORSO NOTA SPESE SETTEMBRE € 86,40', null, 86.4, '48'],
    ['04/10/2026', 'PAGAMENTO POS 04/10/2026 18.31 ESSELUNGA MILANO VIALE PAPINIANO CARTA *4821', 67.45, null, '43'],
    ['06/10/2026', 'ADDEBITO SDD FASTWEB SPA CID IT74ZZZ0000012878470 FATTURA M541228730', 29.95, null, '50'],
    ['07/10/2026', 'PAGAMENTO POS 07/10/2026 12.10 FARMACIA SOLARI SNC MILANO CARTA *4821', 12.8, null, '43'],
    ['09/10/2026', 'PRELIEVO BANCOMAT 09/10/2026 19.47 ATM 03069 MILANO VIA TORINO', 100, null, '05'],
    ['10/10/2026', 'ADDEBITO SDD MM SPA SERVIZIO IDRICO INTEGRATO BOLL. 7731942 - 3° TRIMESTRE', 44.12, null, '50'],
    ['11/10/2026', 'PAGAMENTO POS 11/10/2026 21.15 PIZZERIA BELLA NAPOLI MILANO CARTA *4821', 34.5, null, '43'],
    ['13/10/2026', 'PAGAMENTO POS 13/10/2026 19.02 LIDL ITALIA SRL MILANO VIA FORZE ARMATE CARTA *4821', 23.18, null, '43'],
    ['15/10/2026', 'PAGAMENTO CARTA *4821 15/10 AMZN Mktp IT*2K81L0QZ4 AMAZON.IT LU', 27.99, null, '43'],
    ['16/10/2026', 'ADDEBITO SDD ENEL ENERGIA SPA CID IT56ZZZ0000005512830 FATT. N. 0041873390', 61.22, null, '50'],
    ['17/10/2026', 'GIROCONTO VERSO CONTO REVOLUT - RICARICA', 300, null, '26'],
    ['18/10/2026', 'PAGAMENTO POS 18/10/2026 11.20 LIBRERIA DEL CORSO SOCIETÀ COOP. MILANO CARTA *4821', 18, null, '43'],
    ['20/10/2026', 'ADDEBITO SDD A2A ENERGIA S.P.A. - FORNITURA GAS PERIODO SETT. 2026', 41.3, null, '50'],
    ['21/10/2026', 'COMMISSIONE BONIFICO ISTANTANEO', 2, null, '18'],
    ['22/10/2026', 'PAGAMENTO POS 22/10/2026 20.48 TRATTORIA DA GINO SAS MILANO CARTA *4821', 58, null, '43'],
    ['24/10/2026', 'PAGAMENTO POS 24/10/2026 10.36 ESSELUNGA MILANO VIALE PAPINIANO CARTA *4821', 82.13, null, '43'],
    ['25/10/2026', "PAGAMENTO POS 25/10/2026 09.12 PASTICCERIA DELL'ANGOLO MILANO CARTA *4821", 9.6, null, '43'],
    ['27/10/2026', 'BONIFICO A VOSTRO FAVORE DA ACME ITALIA SRL CAUSALE: EMOLUMENTI OTTOBRE 2026', null, 2451.3, '48'],
    ['28/10/2026', 'ADDEBITO SDD MONEYFARM SIM SPA PIANO DI ACCUMULO MENSILE', 250, null, '50'],
    ['29/10/2026', 'PAGAMENTO POS 29/10/2026 17.55 PARCHEGGIO CITTÀ STUDI MILANO CARTA *4821', 6.5, null, '43'],
    ['30/10/2026', 'STORNO PAGAMENTO CARTA AMZN Mktp IT*2K81L0QZ4 AMAZON.IT LU', null, 27.99, '43'],
    ['31/10/2026', "COMMISSIONI - CANONE MENSILE CONTO 'PIÙ' OTTOBRE 2026", 3.95, null, '18'],
  ];
  const opening = 3412.57;
  const closing = rows.reduce((bal, [, , debit, credit]) => bal - (debit ?? 0) + (credit ?? 0), opening);

  const sep = ';';
  const line = (fields: string[]): string => fields.map((f) => csvField(f, sep)).join(sep);
  const lines = [
    'Elenco movimenti conto corrente',
    line(['Intestatario', 'Alex Bianchi']),
    line(['IBAN', 'IT** **** **** **** **** **48 21']),
    line(['Periodo', 'dal 01/10/2026 al 31/10/2026']),
    line(['Data esportazione', '03/11/2026 09:14']),
    line(['Valuta', 'EUR']),
    '',
    line(['Data operazione', 'Data valuta', 'Descrizione operazione', 'Dare', 'Avere', 'Causale']),
    line(['31/10/2026', '31/10/2026', 'Saldo finale', '', itAmount(closing), '']),
    // Newest first, as the bank exports it.
    ...[...rows].reverse().map(([date, desc, debit, credit, causale]) =>
      line([date, date, desc, debit === null ? '' : itAmount(debit), credit === null ? '' : itAmount(credit), causale]),
    ),
    line(['01/10/2026', '01/10/2026', 'Saldo iniziale', '', itAmount(opening), '']),
  ];
  write('it-intesa-estratto-conto-2026-10.csv', encodeSingleByte(lines.join('\r\n') + '\r\n', 'windows-1252'));
}

// --- 2. Sparkasse CSV-CAMT (German, ISO-8859-1) -------------------------------------------------------

function sparkasse(): void {
  const header = ['Auftragskonto', 'Buchungstag', 'Valutadatum', 'Buchungstext', 'Verwendungszweck', 'Glaeubiger ID', 'Mandatsreferenz', 'Auftraggeber/Empfänger', 'Kontonummer/IBAN', 'BIC (SWIFT-Code)', 'Betrag', 'Waehrung', 'Info'];
  const account = 'DE12100500000190123456';
  type Row = [day: number, text: string, purpose: string, creditorId: string, mandate: string, party: string, iban: string, bic: string, amount: string, info?: string];
  const rows: Row[] = [
    [1, 'DAUERAUFTRAG', 'Miete Oktober 2026 Whg. 3. OG links', '', '', 'Hausverwaltung Schulz GmbH', 'DE44100100100123456789', 'PBNKDEFFXXX', '-640,00'],
    [2, 'FOLGELASTSCHRIFT', 'Rundfunkbeitrag 10.2026 - 12.2026 Beitragsnr. 123456789', 'DE7000100000077777', 'M123456789', 'Rundfunk ARD, ZDF, DRadio', 'DE65500400000590062000', 'COBADEFFXXX', '-55,08'],
    [5, 'KARTENZAHLUNG', 'REWE Markt GmbH-Zw/Berlin/DE 2026-10-04T18:22 Debitk.12 2028-12', '', '', 'REWE Markt GmbH', 'DE11370400440532013000', 'COBADEFFXXX', '-34,87'],
    [6, 'FOLGELASTSCHRIFT', 'Vodafone Kabel Deutschland Kd-Nr. 0012345678 Rg-Nr. 202610', 'DE26ZZZ00000017890', 'KD0012345678', 'Vodafone Deutschland GmbH', 'DE95700700100205555500', 'DEUTDEMMXXX', '-39,99'],
    [7, 'KARTENZAHLUNG', 'dm-drogerie markt//Berlin/DE 2026-10-06T11:05', '', '', 'dm-drogerie markt GmbH + Co. KG', 'DE90660400180214601200', 'COBADEFF660', '-12,45'],
    [9, 'GUTSCHRIFT', 'Erstattung Einkommensteuer 2025 StNr. 34/123/45678', '', '', 'Finanzamt Berlin Friedrichshain-Kreuzberg', 'DE10100000000010001510', 'MARKDEF1100', '312,00'],
    [12, 'KARTENZAHLUNG', 'Bäckerei Siebert//Berlin/DE 2026-10-11T08:40', '', '', 'Bäckerei Siebert', 'DE22100500001234567890', 'BELADEBEXXX', '-6,80'],
    [14, 'FOLGELASTSCHRIFT', 'Abschlag Strom Oktober 2026 Vertragskonto 400123987', 'DE45ZZZ00000123456', 'VK400123987', 'Stadtwerke Berlin GmbH', 'DE77100700000123456700', 'DEUTDEBBXXX', '-48,00'],
    [15, 'ONLINE-UEBERWEISUNG', 'Geschenk für Oma - alles Gute zum 80.!', '', '', 'Gertrud Müller', 'DE02120300000000202051', 'BYLADEM1001', '-50,00'],
    [19, 'KARTENZAHLUNG', 'DB Fernverkehr AG//Berlin Hbf/DE 2026-10-18T07:12 ICE 1003', '', '', 'DB Fernverkehr AG', 'DE53500700100175526303', 'DEUTDEFFXXX', '-49,90'],
    [21, 'KARTENZAHLUNG', 'BVG Fahrschein AB Einzel//Berlin/DE', '', '', 'Berliner Verkehrsbetriebe', 'DE84100500000990013304', 'BELADEBEXXX', '-3,80'],
    [23, 'ENTGELTABSCHLUSS', 'Kontoführungsentgelt 10/2026 Abrechnung siehe Anlage', '', '', '', '', '', '-4,90'],
    [26, 'FOLGELASTSCHRIFT', 'Zusatzbeitrag Oktober 2026 Vers.-Nr. T123456789', 'DE91ZZZ00000032112', 'TK-T123456789', 'Techniker Krankenkasse', 'DE13200400000622001400', 'COBADEFFXXX', '-23,10'],
    [28, 'KARTENZAHLUNG', 'Späti am Görlitzer Park//Berlin/DE 2026-10-27T23:51', '', '', 'Späti am Görlitzer Park', 'DE29100500001066335599', 'BELADEBEXXX', '-7,20'],
    [30, 'GUTSCHRIFT', 'Honorar Oktober 2026 Rechnung 2026-041 Gestaltung', '', '', 'Müller & Söhne Design GmbH', 'DE89370400440532013000', 'COBADEFFXXX', '1250,00'],
    [31, 'KARTENZAHLUNG', 'Lieferando.de//Berlin/DE 2026-10-31T20:14', '', '', 'Lieferando', 'DE61100700240123456701', 'DEUTDEDB101', '-24,50', 'Umsatz vorgemerkt'],
  ];
  const date = (d: number): string => `${String(d).padStart(2, '0')}.10.26`;
  const sep = ';';
  // Every field quoted, as Sparkasse does; newest booking first.
  const line = (fields: string[]): string => fields.map((f) => csvField(f, sep, true)).join(sep);
  const lines = [
    line(header),
    ...[...rows].reverse().map(([d, text, purpose, creditor, mandate, party, iban, bic, amount, info]) =>
      line([account, date(d), date(d), text, purpose, creditor, mandate, party, iban, bic, amount, 'EUR', info ?? 'Umsatz gebucht']),
    ),
  ];
  write('de-sparkasse-umsaetze-2026-10.csv', encodeSingleByte(lines.join('\r\n') + '\r\n', 'iso-8859-1'));
}

// --- 3. Revolut CSV (English, UTF-8, several currencies) --------------------------------------------

function revolut(): void {
  type Row = [type: string, started: string, completed: string | null, description: string, amount: number, fee: number, currency: string, state: string];
  const rows: Row[] = [
    ['CARD_PAYMENT', '2026-10-12 06:14:02', '2026-10-13 04:21:10', 'Netflix', -13.99, 0, 'EUR', 'COMPLETED'],
    ['TOPUP', '2026-10-16 19:02:11', '2026-10-16 19:02:14', 'Top-up by *4821', 300, 0, 'EUR', 'COMPLETED'],
    ['EXCHANGE', '2026-10-16 19:05:40', '2026-10-16 19:05:40', 'Exchanged to GBP', -200, 0, 'EUR', 'COMPLETED'],
    ['EXCHANGE', '2026-10-16 19:05:40', '2026-10-16 19:05:40', 'Exchanged from EUR', 171.32, 0, 'GBP', 'COMPLETED'],
    ['CARD_PAYMENT', '2026-10-17 08:41:09', '2026-10-18 10:12:33', 'Pret A Manger', -6.45, 0, 'GBP', 'COMPLETED'],
    ['CARD_PAYMENT', '2026-10-17 09:02:51', '2026-10-19 03:40:02', 'TfL Travel Charge', -8.5, 0, 'GBP', 'COMPLETED'],
    ['CARD_PAYMENT', '2026-10-17 15:20:44', null, 'Premier Inn Deposit', -50, 0, 'GBP', 'REVERTED'],
    ['CARD_PAYMENT', '2026-10-18 13:42:51', '2026-10-19 09:15:27', 'Tesco Express', -8.26, 0, 'GBP', 'COMPLETED'],
    ['CARD_PAYMENT', '2026-10-18 18:05:13', '2026-10-19 09:15:27', 'The Harp', -14.8, 0, 'GBP', 'COMPLETED'],
    ['CARD_PAYMENT', '2026-10-18 20:31:09', '2026-10-20 02:11:45', 'Dishoom Shoreditch', -42.6, 0, 'GBP', 'COMPLETED'],
    ['CARD_PAYMENT', '2026-10-19 16:48:30', '2026-10-20 05:02:18', 'Uber', -21.3, 0, 'GBP', 'COMPLETED'],
    ['CARD_PAYMENT', '2026-10-20 07:00:12', '2026-10-21 03:58:40', 'Spotify', -11.99, 0, 'EUR', 'COMPLETED'],
    ['CARD_PAYMENT', '2026-10-25 22:17:05', '2026-10-26 08:44:19', 'Steam Purchase', -12, 0.12, 'USD', 'COMPLETED'],
    ['TRANSFER', '2026-10-27 12:30:00', '2026-10-27 12:30:02', 'To LUCA FERRARI', -25, 0, 'EUR', 'COMPLETED'],
    ['CARD_PAYMENT', '2026-11-02 11:09:47', null, 'Amazon.co.uk', -23.99, 0, 'GBP', 'PENDING'],
  ];
  const balance: Record<string, number> = { EUR: 126.4, GBP: 0, USD: 20 };
  const fmt = (n: number): string => n.toFixed(2);
  const lines = ['Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance'];
  for (const [type, started, completed, description, amount, fee, currency, state] of rows) {
    let bal = '';
    if (state === 'COMPLETED') {
      balance[currency] = (balance[currency] ?? 0) + amount - fee;
      bal = fmt(balance[currency]!);
    }
    lines.push([type, 'Current', started, completed ?? '', csvField(description, ','), fmt(amount), fmt(fee), currency, state, bal].join(','));
  }
  write('en-revolut-statement-2026-10.csv', lines.join('\n') + '\n');
}

// --- 4. OFX 1.x card statement (French, windows-1252) -------------------------------------------------

function ofx(): void {
  type Tx = [posted: string, user: string, amount: number, name: string, memo: string];
  const txs: Tx[] = [
    ['20261003', '20261002', -23.4, 'CB MONOPRIX PARIS 11', 'PAIEMENT CB 0210 PARIS'],
    ['20261003', '20261003', -4.6, 'CB BOULANGERIE DU MARCHÉ', 'PAIEMENT CB 0310 PARIS'],
    ['20261005', '20261004', -86, 'CB RATP NAVIGO', 'PASS NAVIGO MOIS OCTOBRE'],
    ['20261006', '20261006', -19.99, 'PRLV SEPA FREE MOBILE', 'FORFAIT FREE 5G OCT 2026'],
    ['20261008', '20261007', -45, 'CB SNCF INTERNET', 'BILLET PARIS LYON TGV INOUI'],
    ['20261010', '20261009', -12.35, 'CB PHARMACIE DE LA BASTILLE', 'PAIEMENT CB 0910 PARIS'],
    ['20261012', '20261011', -3.2, 'CB LE PETIT CAFÉ', 'PAIEMENT CB 1110 PARIS'],
    ['20261014', '20261013', -129.99, 'CB FNAC.COM', 'ACHAT INTERNET CASQUE AUDIO'],
    ['20261016', '20261015', -31.8, 'CB FRANPRIX', 'PAIEMENT CB 1510 PARIS'],
    ['20261019', '20261018', -22.4, 'CB UBER EATS', 'HELP.UBER.COM'],
    ['20261021', '20261021', 39.99, 'AVOIR CB DECATHLON', 'REMBOURSEMENT ARTICLE RETOURNÉ'],
    ['20261024', '20261023', -23.8, 'CB CINÉMA MK2 BASTILLE', '2 PLACES'],
    ['20261027', '20261026', -58.5, 'CB BRASSERIE BOFINGER', 'PAIEMENT CB 2610 PARIS'],
    ['20261031', '20261031', -2.5, 'FRAIS CARTE', 'COTISATION MENSUELLE CARTE VISA'],
  ];
  const balance = txs.reduce((s, [, , a]) => s + a, 0);
  const lines = [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'VERSION:102',
    'SECURITY:NONE',
    'ENCODING:USASCII',
    'CHARSET:1252',
    'COMPRESSION:NONE',
    'OLDFILEUID:NONE',
    'NEWFILEUID:NONE',
    '',
    '<OFX>',
    '<SIGNONMSGSRSV1>',
    '<SONRS>',
    '<STATUS>',
    '<CODE>0',
    '<SEVERITY>INFO',
    '</STATUS>',
    '<DTSERVER>20261103091500',
    '<LANGUAGE>FRA',
    '</SONRS>',
    '</SIGNONMSGSRSV1>',
    '<CREDITCARDMSGSRSV1>',
    '<CCSTMTTRNRS>',
    '<TRNUID>1',
    '<STATUS>',
    '<CODE>0',
    '<SEVERITY>INFO',
    '</STATUS>',
    '<CCSTMTRS>',
    '<CURDEF>EUR',
    '<CCACCTFROM>',
    '<ACCTID>4974XXXXXXXX1234',
    '</CCACCTFROM>',
    '<BANKTRANLIST>',
    '<DTSTART>20261001',
    '<DTEND>20261031',
    ...txs.flatMap(([posted, user, amount, name, memo], i) => [
      '<STMTTRN>',
      `<TRNTYPE>${amount < 0 ? 'DEBIT' : 'CREDIT'}`,
      `<DTPOSTED>${posted}`,
      `<DTUSER>${user}`,
      `<TRNAMT>${amount.toFixed(2)}`,
      `<FITID>${posted}${String(i + 1).padStart(5, '0')}`,
      `<NAME>${name}`,
      `<MEMO>${memo}`,
      '</STMTTRN>',
    ]),
    '</BANKTRANLIST>',
    '<LEDGERBAL>',
    `<BALAMT>${balance.toFixed(2)}`,
    '<DTASOF>20261031',
    '</LEDGERBAL>',
    '</CCSTMTRS>',
    '</CCSTMTTRNRS>',
    '</CREDITCARDMSGSRSV1>',
    '</OFX>',
  ];
  write('fr-releve-carte-2026-10.ofx', encodeSingleByte(lines.join('\r\n') + '\r\n', 'windows-1252'));
}

// --- 5. Spanish household spreadsheet (XLSX) ----------------------------------------------------------

function spreadsheet(): void {
  const serial = (y: number, m: number, d: number): number => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const date = (d: number): XLSX.CellObject => ({ t: 'n', v: serial(2026, 10, d), z: 'dd/mm/yyyy' });
  const s = (v: string): XLSX.CellObject => ({ t: 's', v });
  const n = (v: number): XLSX.CellObject => ({ t: 'n', v, z: '#,##0.00 "€"' });
  const blank = (): XLSX.CellObject => ({ t: 'z' });

  // Dates as real dates, as text in three different styles, amounts as numbers or as text.
  const data: XLSX.CellObject[][] = [
    [date(1), s('Alquiler piso'), n(750), s('Casa'), s('transferencia')],
    [s('3 oct'), s('Mercadona'), n(64.35), s('Comida'), blank()],
    [date(4), s('Luz Iberdrola'), s('48,20 €'), s('Facturas'), s('domiciliada')],
    [s('06/10'), s('Gasolina Repsol'), n(55), s('Coche'), blank()],
    [date(8), s('Cena con Lucía'), n(38.5), s('Ocio'), s('pagamos a medias, esta es mi parte')],
    [blank(), blank(), blank(), blank(), blank()],
    [date(12), s('Farmacia'), n(9.95), s('Salud'), blank()],
    [s('15-oct'), s('Netflix'), n(13.99), s('Suscripciones'), blank()],
    [date(18), s('Zara'), n(45.95), s('Ropa'), s('abrigo rebajado')],
    [date(20), s('Agua Canal de Isabel II'), n(31.4), s('Facturas'), blank()],
    [date(22), s('Mercadona'), n(71.2), s('Comida'), blank()],
    [date(25), s('Regalo cumpleaños Pablo'), n(30), s('Regalos'), blank()],
    [date(28), s('Gimnasio'), n(39.9), s('Deporte'), s('cuota mensual')],
    [s('30/10'), s('Devolución Amazon'), n(-19.99), s('Compras'), s('me devolvieron el cargador')],
  ];
  const firstDataRow = 6; // 1-based
  const lastDataRow = firstDataRow + data.length - 1;
  const total = data.reduce((sum, row) => sum + (row[2]?.t === 'n' ? Number(row[2].v) : 0), 0);

  const rows: XLSX.CellObject[][] = [
    [s('GASTOS DEL HOGAR — OCTUBRE 2026'), blank(), blank(), blank(), blank()],
    [s('Presupuesto: 1.800 €'), blank(), blank(), s('Actualizado el 31/10'), blank()],
    [blank(), blank(), blank(), blank(), blank()],
    [s('Fecha'), s('Concepto'), s('Importe'), s('Categoría'), s('Notas')],
    [blank(), blank(), s('(€)'), blank(), blank()],
    ...data,
    [s('TOTAL'), blank(), { t: 'n', v: Math.round(total * 100) / 100, f: `SUM(C${firstDataRow}:C${lastDataRow})`, z: '#,##0.00 "€"' }, blank(), s('falta el taxi del aeropuerto')],
  ];
  const sheet = XLSX.utils.aoa_to_sheet([]);
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell.t !== 'z') sheet[XLSX.utils.encode_cell({ r, c })] = cell;
    }),
  );
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: 4 } });
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
    { s: { r: 3, c: 0 }, e: { r: 4, c: 0 } },
    { s: { r: 3, c: 1 }, e: { r: 4, c: 1 } },
  ];
  sheet['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 14 }, { wch: 34 }];

  const notes = XLSX.utils.aoa_to_sheet([
    ['Notas'],
    ['- El alquiler se paga por transferencia el día 1.'],
    ['- La luz y el agua van domiciliadas en la cuenta del BBVA.'],
    ['- Cena con Lucía: el total fueron 77 €, pagué yo la mitad.'],
    ['- Falta apuntar el taxi del aeropuerto (unos 35 €).'],
  ]);
  notes['!cols'] = [{ wch: 60 }];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Octubre');
  XLSX.utils.book_append_sheet(book, notes, 'Notas');
  const fixed = new Date(Date.UTC(2026, 9, 31, 20, 0, 0));
  book.Props = { Title: 'Gastos octubre 2026', Author: 'Lucía', CreatedDate: fixed, ModifiedDate: fixed };
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }) as Uint8Array;
  write('es-gastos-octubre.xlsx', bytes);
}

// --- 6. Free-form notes (Italian + English, UTF-8) -----------------------------------------------------

function notes(): void {
  const text = `spese da segnare — aggiornato venerdì 30 ottobre 2026

- ieri pizza con Marco 23,50
- l'altro ieri benzina 60€ (Q8 viale Certosa)
- 26/10 cena sushi €38.40 diviso in due -> la mia parte è 19,20
- Netflix 13.99 rinnovo (ma non era già sulla Revolut??)
- yesterday: coffee + croissant 3,20
- regalo compleanno mamma ~40 euro (fiori + biglietto)
- parrucchiere 25
- taxi from Linate to home, 32 euros, paid by card
- mercato sabato: frutta e verdura 14,80
- farmacia: tachipirina e cerotti 9,90€
- ricevuti 20 € da Luca per la cena (Satispay)
- TODO: chiedere a Giulia i 15€ del cinema
`;
  write('it-note-spese.txt', text);
}

// --- 7. Utility bill (Italian, PDF with real text) ---------------------------------------------------

async function bill(): Promise<void> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const fixed = new Date(Date.UTC(2026, 10, 2, 8, 0, 0));
  doc.setTitle('Bolletta Enel Energia n. 0042198765');
  doc.setAuthor('Enel Energia S.p.A.');
  doc.setCreator('Spendlens sample generator');
  doc.setProducer('pdf-lib');
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);

  const page = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.12, 0.14);
  const muted = rgb(0.38, 0.38, 0.42);
  const brand = rgb(0.0, 0.29, 0.6);

  const text = (p: PDFPage, s: string, x: number, y: number, size = 10, font: PDFFont = regular, color = ink): void =>
    p.drawText(s, { x, y, size, font, color });
  const right = (p: PDFPage, s: string, xRight: number, y: number, size = 10, font: PDFFont = regular): void =>
    p.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, size, font, color: ink });

  page.drawRectangle({ x: 0, y: 770, width: 595.28, height: 71.89, color: brand });
  text(page, 'enel', 40, 795, 30, bold, rgb(1, 1, 1));
  text(page, 'Enel Energia S.p.A. – Mercato libero dell’energia', 300, 808, 9, regular, rgb(1, 1, 1));
  text(page, 'Viale Regina Margherita 125, 00198 Roma', 300, 795, 9, regular, rgb(1, 1, 1));

  text(page, 'Bolletta per la fornitura di energia elettrica', 40, 735, 15, bold);
  text(page, 'Bolletta n. 0042198765 del 02/11/2026', 40, 716, 10, regular, muted);

  const info: [string, string][] = [
    ['Intestatario', 'Alex Bianchi'],
    ['Indirizzo di fornitura', 'Via Solari 12, 20144 Milano (MI)'],
    ['Codice cliente', '912 345 678'],
    ['Codice POD', 'IT001E12345678'],
    ['Offerta', 'Enel Flex Luce – prezzo variabile'],
    ['Periodo di fornitura', '01/09/2026 - 31/10/2026'],
  ];
  info.forEach(([k, v], i) => {
    text(page, k, 40, 680 - i * 17, 10, regular, muted);
    text(page, v, 190, 680 - i * 17, 10, bold);
  });

  // The figure that matters, boxed like on a real bill.
  page.drawRectangle({ x: 360, y: 600, width: 195, height: 92, color: rgb(0.93, 0.96, 1), borderColor: brand, borderWidth: 1 });
  text(page, 'Totale da pagare', 375, 668, 11, bold, brand);
  text(page, '€ 87,40', 375, 638, 24, bold, brand);
  text(page, 'Scadenza: 20/11/2026', 375, 612, 10, regular);

  text(page, 'Consumi fatturati', 40, 560, 12, bold);
  const consumption: [string, string][] = [
    ['Fascia F1 (lun-ven 8-19)', '128 kWh'],
    ['Fascia F2 (lun-ven 7-8 e 19-23, sab 7-23)', '104 kWh'],
    ['Fascia F3 (notte, domenica e festivi)', '110 kWh'],
    ['Totale consumi del periodo', '342 kWh'],
  ];
  consumption.forEach(([k, v], i) => {
    text(page, k, 40, 538 - i * 16, 10, i === 3 ? bold : regular);
    right(page, v, 555, 538 - i * 16, 10, i === 3 ? bold : regular);
  });

  text(page, 'Sintesi degli importi', 40, 456, 12, bold);
  const lines: [string, string][] = [
    ['Spesa per la materia energia', '€ 58,20'],
    ['Spesa per il trasporto e la gestione del contatore', '€ 14,37'],
    ['Spesa per oneri di sistema', '€ 6,88'],
    ['Totale imponibile', '€ 79,45'],
    ['IVA 10% su € 79,45', '€ 7,95'],
  ];
  lines.forEach(([k, v], i) => {
    const y = 434 - i * 16;
    text(page, k, 40, y, 10, i === 3 ? bold : regular);
    right(page, v, 555, y, 10, i === 3 ? bold : regular);
  });
  page.drawLine({ start: { x: 40, y: 346 }, end: { x: 555, y: 346 }, thickness: 0.8, color: muted });
  text(page, 'TOTALE BOLLETTA', 40, 330, 12, bold);
  right(page, '€ 87,40', 555, 330, 12, bold);

  text(page, 'Modalità di pagamento: addebito diretto SEPA su IBAN IT** **** **** **** **** **48 21', 40, 292, 9, regular, muted);
  text(page, 'L’importo verrà addebitato alla data di scadenza. Non è necessario alcun pagamento manuale.', 40, 278, 9, regular, muted);

  text(page, 'Storico consumi (kWh)', 40, 240, 12, bold);
  const history: [string, number][] = [['nov-dic 25', 398], ['gen-feb 26', 421], ['mar-apr 26', 356], ['mag-giu 26', 318], ['lug-ago 26', 389], ['set-ott 26', 342]];
  history.forEach(([label, kwh], i) => {
    const x = 50 + i * 85;
    const h = (kwh / 421) * 90;
    page.drawRectangle({ x, y: 120, width: 34, height: h, color: i === 5 ? brand : rgb(0.72, 0.8, 0.9) });
    text(page, String(kwh), x + 4, 124 + h, 8, regular, muted);
    text(page, label, x - 4, 106, 8, regular, muted);
  });

  text(page, 'Servizio clienti 800 900 860 – enel.it – Pagina 1 di 1', 40, 50, 8, regular, muted);
  write('it-bolletta-enel-2026-10.pdf', await doc.save({ useObjectStreams: false }));
}

// --- 9. Wise multi-currency statement (English, UTF-8, two balances) ---------------------------------

function wise(): void {
  // Newest first, as Wise exports; EUR balance rows then GBP balance rows, each with its own
  // running balance. A conversion shows up once per balance; fees sit in their own column.
  interface WiseRow {
    id: string;
    dateTime: string;
    amount: number;
    currency: 'EUR' | 'GBP';
    description: string;
    reference?: string;
    exchange?: { from: string; to: string; rate: number; toAmount: number };
    payer?: string;
    payee?: string;
    merchant?: string;
    card?: boolean;
    fees?: number;
  }
  const eur: WiseRow[] = [
    { id: 'TRANSFER-1904417735', dateTime: '2026-10-29 21:14:08', amount: -32.5, currency: 'EUR', description: 'Sent money to Giulia Conti', reference: 'cena sushi 28/10', payee: 'Giulia Conti' },
    { id: 'CARD-3301958724', dateTime: '2026-10-24 10:02:51', amount: -186.4, currency: 'EUR', description: 'Card transaction of 186.40 EUR issued by Booking.com AMSTERDAM', merchant: 'Booking.com', card: true },
    { id: 'CARD-3299012547', dateTime: '2026-10-21 18:40:16', amount: 0, currency: 'EUR', description: 'Card transaction of 54.00 EUR cancelled by Zalando SE', merchant: 'Zalando', card: true },
    { id: 'BALANCE-2210559031', dateTime: '2026-10-16 19:05:40', amount: -250, currency: 'EUR', description: 'Converted 250.00 EUR to 213.71 GBP', exchange: { from: 'EUR', to: 'GBP', rate: 0.85712, toAmount: 213.71 }, fees: 0.68 },
    { id: 'TRANSFER-1897652210', dateTime: '2026-10-16 18:58:02', amount: 400, currency: 'EUR', description: 'Received money from Marco Bianchi with reference Ricarica Wise', reference: 'Ricarica Wise', payer: 'Marco Bianchi' },
  ];
  const gbp: WiseRow[] = [
    { id: 'CARD-3304471196', dateTime: '2026-10-22 09:15:33', amount: 8.26, currency: 'GBP', description: 'Card transaction of 8.26 GBP refunded by Tesco Stores', merchant: 'Tesco', card: true },
    { id: 'CARD-3302208651', dateTime: '2026-10-19 16:48:30', amount: -21.3, currency: 'GBP', description: 'Card transaction of 21.30 GBP issued by Uber *Trip LONDON', merchant: 'Uber', card: true },
    { id: 'CARD-3302188410', dateTime: '2026-10-18 20:31:09', amount: -42.6, currency: 'GBP', description: 'Card transaction of 42.60 GBP issued by Dishoom Shoreditch LONDON', merchant: 'Dishoom', card: true },
    { id: 'CARD-3302140077', dateTime: '2026-10-18 18:05:13', amount: -15.3, currency: 'GBP', description: 'Card transaction of 14.80 GBP issued by The Harp LONDON', merchant: 'The Harp', card: true, fees: 0.5 },
    { id: 'CARD-3301999870', dateTime: '2026-10-18 13:42:51', amount: -8.26, currency: 'GBP', description: 'Card transaction of 8.26 GBP issued by Tesco Express LONDON', merchant: 'Tesco', card: true },
    { id: 'CARD-3301870532', dateTime: '2026-10-17 09:02:51', amount: -8.5, currency: 'GBP', description: 'Card transaction of 8.50 GBP issued by TfL Travel Charge TFL.GOV.UK/CP', merchant: 'TfL', card: true },
    { id: 'CARD-3301861204', dateTime: '2026-10-17 08:41:09', amount: -6.45, currency: 'GBP', description: 'Card transaction of 6.45 GBP issued by Pret A Manger LONDON', merchant: 'Pret A Manger', card: true },
    { id: 'BALANCE-2210559031', dateTime: '2026-10-16 19:05:40', amount: 213.71, currency: 'GBP', description: 'Converted 250.00 EUR to 213.71 GBP', exchange: { from: 'EUR', to: 'GBP', rate: 0.85712, toAmount: 213.71 } },
  ];
  const header = [
    'TransferWise ID', 'Date', 'Date Time', 'Amount', 'Currency', 'Description', 'Payment Reference', 'Running Balance',
    'Exchange From', 'Exchange To', 'Exchange Rate', 'Payer Name', 'Payee Name', 'Payee Account Number', 'Merchant',
    'Card Last Four Digits', 'Card Holder Full Name', 'Attachment', 'Note', 'Total fees', 'Exchange To Amount',
  ];
  const lines = [header.map((h) => csvField(h, ',', true)).join(',')];
  const closing: Record<string, number> = { EUR: 212.53, GBP: 129.56 };
  for (const rows of [eur, gbp]) {
    let running = closing[rows[0]!.currency]!;
    for (const r of rows) {
      const [d, t] = r.dateTime.split(' ') as [string, string];
      const [y, m, day] = d.split('-');
      const fields = [
        r.id, `${day}-${m}-${y}`, `${day}-${m}-${y} ${t}.000`, r.amount.toFixed(2), r.currency, r.description, r.reference ?? '',
        running.toFixed(2), r.exchange?.from ?? '', r.exchange?.to ?? '', r.exchange ? r.exchange.rate.toFixed(5) : '',
        r.payer ?? '', r.payee ?? '', r.payee ? 'IT** **** 4410' : '', r.merchant ?? '', r.card ? '7731' : '', r.card ? 'Alex Rossi' : '',
        '', '', (r.fees ?? 0).toFixed(2), r.exchange ? r.exchange.toAmount.toFixed(2) : '',
      ];
      lines.push(fields.map((f) => csvField(f, ',', true)).join(','));
      // Walk back in time: the balance before this row.
      running = Math.round((running - r.amount) * 100) / 100;
    }
  }
  write('en-wise-statement-2026-10.csv', lines.join('\r\n') + '\r\n');
}

// --- 8. Receipt photo (English, PNG rendered by headless Chrome) ------------------------------------

// --- 10. Itemised supermarket receipt (Italian, PNG): food, baby products, household, pharmacy -----

function receipt(source: string, name: string, height: number, width = 420): void {
  const chrome = process.env['CHROME_PATH'] ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (!existsSync(chrome)) {
    console.warn(`  ${name} skipped: set CHROME_PATH to a Chrome/Chromium executable`);
    return;
  }
  const out = join(OUT, name);
  const html = pathToFileURL(join(ROOT, 'tools', source)).href;
  mkdirSync(dirname(out), { recursive: true });
  execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--screenshot=${out}`, `--window-size=${width},${height}`, html], {
    stdio: 'ignore',
  });
  console.log(`  ${name}`);
}

console.log(`Writing samples to ${OUT}`);
intesa();
sparkasse();
revolut();
ofx();
spreadsheet();
notes();
await bill();
wise();
receipt('receipt-tesco.html', 'en-receipt-tesco.png', 760);
receipt('receipt-esselunga.html', 'it-scontrino-esselunga-2026-10.png', 740, 520);
