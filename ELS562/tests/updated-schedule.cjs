const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../app/api/text-automation/route.ts'), 'utf8');
const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set(['safeText', 'ensureScheduleHeader', 'isUpdatedScheduleMessage', 'prependUpdatedScheduleNotice', 'scheduleEmailSubject', 'revalidateActiveEventMessageQueue']);
const parts = [];
function walk(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) parts.push(node.getText(ast).replace(/^export /, ''));
  ts.forEachChild(node, walk);
}
walk(ast);
const header = 'Emanuel Labor Services Labor Call';
const notice = '*****UPDATED SCHEDULE PLEASE CONFIRM CHANGES*****';
const legacy = '*****SCHEDULE UPDATED PLEASE CONFIRM CHANGES*****';
const js = ts.transpileModule(`const scheduleHeader = ${JSON.stringify(header)}; const updatedScheduleNotice = ${JSON.stringify(notice)};\n${parts.join('\n')}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
async function check(name, body, key, updated) {
  const row = { id: 'queue', show_id: 'show', crew_id: 'crew', message_type: 'schedule', reminder_key: key, scheduled_for: '2099-01-01', status: 'scheduled', body, queued_by_name: 'Coordinator' };
  const admin = { from(table) {
    let patch;
    const query = {
      select() { return query; }, in() { return query; }, eq() { return query; }, limit() { return query; }, lte() { return query; },
      update(value) { patch = value; return query; },
      then(resolve, reject) {
        if (patch) Object.assign(row, patch);
        return Promise.resolve({ data: patch ? [] : table === 'text_message_queue' ? [row] : [], error: null }).then(resolve, reject);
      }
    };
    return query;
  }};
  const context = vm.createContext({ admin, ACTIVE_QUEUE_STATUSES: ['scheduled'], fetchShowBundle: async () => ({ show: {}, days: [], calls: [], assignments: [], crewRows: [], masterRates: [] }), normalizeSettings: () => ({}), localDateKey: () => '2026-10-27', activeAssignmentRows: () => [{ crew: { id: 'crew' }, day: { labor_date: '2099-01-01' } }], dateFromReminderKey: () => '', standardReminderFamily: () => '', logicalReminderKey: value => value, nextScheduleByCrew: () => new Map([['crew', { values: { client: 'Client' } }]]), applyTemplate: () => 'Fresh schedule with latest shift times', ensureSenderIdentity: value => value, defaultScheduleTemplate: '', blockOutdatedQueueRows: async () => { throw new Error('Unexpected cancellation'); } });
  vm.runInContext(js, context);
  for (let refresh = 0; refresh < 2; refresh++) {
    const result = await vm.runInContext('revalidateActiveEventMessageQueue(admin)', context);
    assert.equal(result.cancelled, 0);
    assert.ok(row.body.includes('Fresh schedule with latest shift times'));
    assert.ok(row.body.startsWith(header));
    assert.equal(row.body.includes(notice), updated);
    if (updated) {
      assert.equal(row.body.split('\n').filter(Boolean)[1], notice);
      assert.equal(row.body.split(notice).length - 1, 1);
      assert.ok(!row.body.includes(legacy));
    }
  }
  context.row = row;
  const subject = vm.runInContext('scheduleEmailSubject(row, {name: "Test Event"})', context);
  assert.equal(subject.startsWith('ELS Updated Schedule'), updated);
  console.log('PASS ' + name + ' (two live refreshes and email subject)');
}
(async () => {
  await check('legacy notice below company heading survives refresh', `${header}\n\n${legacy}\n\nOld times`, 'full_show_schedule', true);
  await check('new notice below heading survives refresh', `${header}\n\n${notice}\n\nOld times`, 'full_show_schedule', true);
  await check('historical notice before heading is normalized', `${legacy}\n\n${header}\n\nOld times`, 'full_show_schedule', true);
  await check('update key restores already stripped notice', `${header}\n\nOld times`, 'full_show_schedule_update_20261027120000', true);
  await check('normal schedule stays normal', `${header}\n\nOld times`, 'full_show_schedule', false);
  console.log('5 updated-schedule regression cases passed. No live messages sent.');
})().catch(error => { console.error(error); process.exitCode = 1; });
