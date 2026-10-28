const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('node:assert/strict'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, require: (name) => { if (!(name in mocks)) throw new Error('Unexpected import ' + name); return mocks[name]; } });
  return exports;
}
const { summarizeCrewRatings } = load('lib/crew-ratings.ts');
const row = (id, rating, source, client = null) => ({ id, rating, rating_source: source, client_id: client, crew_id: 'crew', show_id: 'show', assignment_id: 'assignment', notes: '', created_at: '', updated_at: null });
let passed = 0;
function check(name, test) { test(); passed++; console.log('PASS ' + name); }
check('unrated crew has no score rather than zero', () => assert.equal(summarizeCrewRatings([]).overall.average, null));
const rows = [row('els', 5, 'admin', 'clientA'), row('a', 1, 'client_feedback', 'clientA'), row('b', 3, 'client_feedback', 'clientB')];
const summary = summarizeCrewRatings(rows);
check('overall average weights each approved rating equally', () => assert.equal(summary.overall.average, 3));
check('ELS is separate from client feedback', () => { assert.equal(summary.els.average, 5); assert.equal(summary.els.count, 1); });
check('clients grouped by identity rather than ELS event client', () => { assert.equal(summary.clients.length, 2); assert.equal(summary.clients.find(c => c.clientId === 'clientA').average, 1); });
check('invalid scores excluded', () => assert.equal(summarizeCrewRatings([...rows, row('bad', NaN, 'admin'), row('zero', 0, 'admin'), row('high', 6, 'admin')]).overall.count, 3));
async function request(method, body = {}, opts = {}) {
  const writes = [];
  const ratings = [rows[0]];
  const page = { setupMissing: false, error: null, crewRecords: opts.hidden ? [] : [{ id: 'crew' }], techRatings: [...ratings, row('approved', 4, 'client_feedback', 'clientA'), { ...row('other', 5, 'admin'), crew_id: 'other' }] };
  const admin = { from(table) {
    let payload;
    const q = { select() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, eq() { return q; }, single() { return q; },
      upsert(value, options) { payload = value; writes.push({ payload, options }); return q; },
      then(resolve, reject) { const data = table === 'tech_ratings' ? { id: 'els', ...payload } : body.show_id && table === 'shows' ? { id: 'show', business_client_id: 'server-client', client_contact_id: 'contact' } : table === 'shows' ? [{ id: 'show', name: 'Event' }] : [{ id: 'clientA', name: 'Client A' }]; return Promise.resolve({ data, error: opts.dbError ? { message: 'Database failed' } : null }).then(resolve, reject); }
    }; return q;
  }};
  const api = load('app/api/crew/[id]/ratings/route.ts', {
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    '@/lib/auth': { getSessionUser: async () => ({ user: opts.anonymous ? null : { id: 'user' }, profile: { role: opts.role || 'owner' }, access: {} }), normalizeRole: role => role, canUsePage: () => !opts.denied },
    '@/lib/crew-data': { getCrewPageData: async () => page },
    '@/lib/supabase-server': { createSupabaseAdminClient: () => admin }
  });
  return { result: await api[method]({ json: async () => body }, { params: Promise.resolve({ id: 'crew' }) }), writes };
}
(async () => {
  let r = await request('GET', {}, { anonymous: true }); check('anonymous cannot read', () => assert.equal(r.result.status, 401));
  r = await request('GET', {}, { denied: true }); check('crew page permission enforced', () => assert.equal(r.result.status, 403));
  r = await request('GET', {}, { hidden: true }); check('scoped-out crew cannot be read', () => assert.equal(r.result.status, 404));
  r = await request('GET', {}, { role: 'coordinator' }); check('read-only viewers receive only selected crew ratings', () => { assert.equal(r.result.status, 200); assert.equal(r.result.body.canRate, false); assert.ok(r.result.body.ratings.every(row => row.crew_id === 'crew')); });
  r = await request('POST', { show_id: 'show', rating: 5 }, { role: 'coordinator' }); check('coordinators cannot write ELS ratings', () => { assert.equal(r.result.status, 403); assert.equal(r.writes.length, 0); });
  for (const rating of [0, 6, 2.5, '5', null]) { r = await request('POST', { show_id: 'show', rating }); check('invalid star value rejected: ' + rating, () => { assert.equal(r.result.status, 400); assert.equal(r.writes.length, 0); }); }
  r = await request('POST', { show_id: 'show', rating: 4, client_id: 'forged-client', notes: ' Reliable ' });
  check('save uses authoritative event client and preserves assignment', () => { assert.equal(r.result.status, 200); assert.equal(r.writes[0].payload.client_id, 'server-client'); assert.equal(r.writes[0].payload.assignment_id, 'assignment'); assert.equal(r.writes[0].payload.notes, 'Reliable'); });
  check('updates same event and crew rather than adding another vote', () => assert.equal(r.writes[0].options.onConflict, 'show_id,crew_id'));
  r = await request('POST', { show_id: 'show', rating: 4 }, { dbError: true }); check('database failures are not reported as saves', () => assert.notEqual(r.result.status, 200));
  console.log(passed + ' crew ratings checks passed; no live records changed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
