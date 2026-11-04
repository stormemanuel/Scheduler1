const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function load(file, mocks = {}) { const exports = {}; vm.runInNewContext(transpile(fs.readFileSync(path.join(root, file), 'utf8').replaceAll('import.meta.url', JSON.stringify(__filename))), { exports, require: name => { if (!(name in mocks)) throw Error(name); return mocks[name]; } }); return exports; }
const calc = load('lib/payroll-calculations.ts', { '@/lib/rates-types': { halfDayFromFullDay: v => v / 2 } });
const parser = load('lib/event-import.ts', { '@/lib/crew-types': { phoneDigitsForMatch: v => String(v || '').replace(/\D/g, '') }, '@/lib/payroll-calculations': calc });
const source = fs.readFileSync(path.join(root, 'lib/event-import-server.ts'), 'utf8');
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true);
const render = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'renderPdfPageVisually').getText(ast);
const context = vm.createContext({}); vm.runInContext(transpile(render), context);
let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
(async () => {
  check('existing estimate regression suite remains supported', () => parser.runEstimateGroupHeaderSelfTest());
  check('estimate CSV total mismatch still reports a review warning', () => { const csv='Service Date,Role,Qty,Rate,Amount,Client,Start Time,End Time,Estimate Total\n12/05/2026,LED Stagehand,2,500,1000,NMR Events,8:00AM,6:00PM,1200'; assert.ok(parser.parseImportedEventFile('estimate.csv',csv,{}).needsReview.includes('Estimate total does not match parsed lines')); });
  let text;
  if (process.argv[2]) {
    const pdf = require('pdf-parse/lib/pdf-parse.js');
    text = (await pdf(fs.readFileSync(process.argv[2]), { pagerender: context.renderPdfPageVisually })).text;
    fs.writeFileSync('/tmp/invoice1060-visual.txt', text);
  } else text = fs.readFileSync(path.join(__dirname, 'fixtures/invoice-1060-labor.txt'), 'utf8');
  const parsed = parser.parseImportedEventFile('Invoice 1060 ASH26 (2).pdf', text, {});
  if (process.argv[2]) console.log(JSON.stringify({ show: parsed.show, count: parsed.rows.length, groups: [...new Set(parsed.rows.map(r => r.area))], review: parsed.needsReview, rejected: parsed.importDebug.rejectedRows }, null, 2));
  check('all 78 dated labor rows and 15 areas are retained', () => { assert.equal(parsed.rows.length, 78); assert.equal(new Set(parsed.rows.map(r => r.area)).size, 15); assert.equal(parsed.importDebug.rejectedRows.length, 0); });
  check('invoice enters quote preview and merge workflow', () => { assert.equal(parsed.importFormat, 'estimate'); assert.equal(parsed.show.document_type, 'invoice'); });
  check('invoice identity and event reference stay separate', () => { assert.equal(parsed.show.estimate_number, '1060'); assert.equal(parsed.show.show_reference_number, 'ASH26'); assert.equal(parsed.show.estimate_date, '2026-10-29'); });
  check('labor dates exclude invoice and payment dates', () => { assert.equal(parsed.show.show_start, '2026-12-05'); assert.equal(parsed.show.show_end, '2026-12-16'); });
  check('invoice totals exclude deposit and balance due', () => { assert.equal(parsed.show.estimate_total, 116475); assert.equal(parsed.show.parsed_line_total, 116475); });
  check('client and venue resolve from Bill to and Ship to', () => { assert.equal(parsed.show.client, 'NMR Events'); assert.match(parsed.show.venue, /Ernest Morial Convention Center/i); assert.equal(parsed.show.rate_city, 'New Orleans'); });
  check('overnight shift and invoice rate preserved', () => { const row = parsed.rows.find(r => r.date === '2026-12-08' && r.startTime === '17:00'); assert.ok(row); assert.equal(row.endTime, '03:00'); assert.equal(row.crewNeeded, 3); assert.equal(row.clientRate, 575); assert.equal(row.amount, 1725); assert.equal(row.poNumber, 'PO174811'); assert.equal(row.boothNumber, '2939'); assert.match(row.area, /SANOFI.*RO327688/); });
  check('half-day qualifiers preserved', () => { const row = parsed.rows.find(r => /COGENT/.test(r.area) && r.date === '2026-12-14'); assert.equal(row.dayType, 'half_day'); assert.equal(row.clientRate, 250); });
  check('summary and zero-dollar headers never create labor', () => assert.ok(parsed.rows.every(row => row.date && row.amount > 0 && row.clientRate > 0 && row.name === '')));
  check('invoice number alone never becomes the event reference', () => { const sample = text.replace(/Event:\s*MCCNO\s*\|\s*ASH26/, 'Event: ASH26'); assert.equal(parser.parseImportedEventFile('invoice.pdf', sample, {}).show.show_reference_number, 'ASH26'); });
  check('changed totals produce review warning', () => { const changed = parser.parseImportedEventFile('invoice.pdf', text.replace('Total $116,475.00', 'Total $116,500.00'), {}); assert.ok(changed.needsReview.includes('Invoice total does not match parsed lines')); });
  check('invoice metadata overrides remain supported', () => { const changed = parser.parseImportedEventFile('invoice.pdf', text, {name:'ASH 2026', show_reference_number:'ASH26', rate_city:'New Orleans'}); assert.equal(changed.show.name,'ASH 2026'); assert.equal(changed.rows.length,78); });
  const server = load('lib/event-import-server.ts', { 'node:module': require('node:module'), '@/lib/event-import': parser, '@/lib/payroll-calculations': calc });
  const payload = parser.buildImportedEventPayload(parsed);
  const days = payload.laborDays.map((day, i) => ({...day, id:'day'+i, show_id:'ash'}));
  const calls = payload.subCallGroups.map((call, i) => ({...call, id:'call'+i, labor_day_id:days.find(day => day.labor_date === call.labor_date).id}));
  const admin = {from(table) { const query = {select(){return query},eq(){return query},order(){return query},in(){return query},then(resolve){resolve({data:table === 'labor_days'?days:calls,error:null})}};return query;}};
  const comparison = await server.buildImportComparison(admin,payload,{id:'ash',name:'ASH26',match_type:'selected_event',confidence:'strong'});
  check('invoice can compare against existing event without adding duplicate labor', () => { assert.equal(comparison.summary.newSubCalls,0); assert.equal(comparison.summary.newLaborDays,0); assert.equal(comparison.summary.removedLabor,0); });
  const changed = parser.buildImportedEventPayload(parser.parseImportedEventFile('invoice.pdf',text.replace('3 $575.00 $1,725.00','4 $575.00 $2,300.00'),{}));
  const update = await server.buildImportComparison(admin,changed,{id:'ash',name:'ASH26',match_type:'selected_event',confidence:'strong'});
  check('invoice updates identify crew-count changes for review', () => assert.equal(update.summary.crewCountIncreases,1));
  console.log(`${passed} invoice import checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
