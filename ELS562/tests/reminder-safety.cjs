const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const helpers={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname+'/../lib/reminder-safety.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:helpers});
const check=helpers.reminderSendBlockReason;
const now=new Date('2026-11-11T15:00:00Z');
const row={reminder_key:'day_before_2026-11-12',scheduled_for:'2026-11-11T14:00:00Z',body:'Hi Brian\nYour Shift: November 12 · 8:00 AM–6:00 PM'};
let n=0;function test(name,fn){fn();console.log('PASS '+name);n++;}
test('current intended delivery day is allowed',()=>assert.equal(check(row,'America/Phoenix',now),''));
test('yesterday delivery expires despite a future assignment',()=>assert.match(check({...row,scheduled_for:'2026-11-10T14:00:00Z'},'America/Phoenix',now),/delivery day has passed/));
test('past shift is blocked even if requeued today',()=>assert.match(check({...row,reminder_key:'day_before_2026-11-10'},'America/Phoenix',now),/already past/));
test('fresh key cannot authorize old screenshot message',()=>assert.match(check({...row,body:'Your Shift: November 10 · 8:00 AM–6:00 PM'},'America/Phoenix',now),/does not match/));
test('legacy split-line Call is also checked',()=>assert.match(check({...row,body:'Call:\n\nNovember 10 · 8:00 AM–6:00 PM'},'America/Phoenix',now),/does not match/));
test('undated legacy reminders require regeneration',()=>assert.match(check({...row,reminder_key:'day_before'},'America/Phoenix',now),/date is missing/));
test('UTC midnight does not prematurely expire local same-day delivery',()=>assert.equal(check({...row,scheduled_for:'2026-11-11T23:00:00Z'},'America/Phoenix',new Date('2026-11-12T01:00:00Z')),''));
test('invalid delivery date fails closed',()=>assert.match(check({...row,scheduled_for:'oops'},'America/Phoenix',now),/invalid/));
test('requeue suffix preserves original shift date',()=>assert.equal(check({...row,reminder_key:'day_before_2026-11-12_requeue_123'},'America/Phoenix',now),''));
console.log(`${n} reminder safety checks passed; no live messages sent.`);

// Exercise the real send-time gate with a mock database, not just the date helper.
const source=fs.readFileSync(__dirname+'/../app/api/text-automation/route.ts','utf8');
const ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['revalidateActiveEventMessageQueue','safeText','dateFromReminderKey','standardReminderFamily','logicalReminderKey']);
const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.has(node.name?.text)).map(node=>node.getText(ast).replace(/^export /,'')).join('\n');
async function gate(name,overrides,plan,expected){
  const queued={id:'q',show_id:'show',crew_id:'crew',message_type:'reminder',status:'scheduled',queued_by_name:'Storm',...row,...overrides};
  const admin={from(table){let patch;const q={select(){return q},in(){return q},eq(){return q},limit(){return q},lte(){return q},update(p){patch=p;return q},then(resolve,reject){if(patch)Object.assign(queued,patch);return Promise.resolve({data:patch?[]:table==='text_message_queue'?[queued]:[],error:null}).then(resolve,reject)}};return q}};
  const ctx=vm.createContext({admin,ACTIVE_QUEUE_STATUSES:['scheduled'],reminderSendBlockReason:(r,t)=>check(r,t,now),normalizeSettings:()=>({timezone:'America/Phoenix'}),localDateKey:()=> '2026-11-11',fetchShowBundle:async()=>({}),activeAssignmentRows:()=>[{crew:{id:'crew'},day:{labor_date:'2026-11-12'},call:{start_time:'08:00'},assignment:{}}],assignmentStartTime:()=> '08:00',zonedDateTimeToUtcIso:()=> '2099-11-12T15:00:00Z',buildFullShowReminderPlan:async()=>plan,blockOutdatedQueueRows:async(_,ids,reason)=>{queued.status='schedule_outdated';queued.error=reason;return ids.length;}});
  vm.runInContext(ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
  await vm.runInContext('revalidateActiveEventMessageQueue(admin)',ctx);
  assert.equal(queued.status,'schedule_outdated');assert.match(queued.error,expected);console.log('PASS send gate '+name);
}
(async()=>{
 await gate('expires original date before any rebuilding',{scheduled_for:'2026-11-10T14:00:00Z'},[],/delivery day has passed/);
 await gate('blocks key and screenshot body mismatch',{body:'Your Shift: November 10 · 8:00 AM–6:00 PM'},[],/does not match/);
 await gate('does not retarget a missing dated reminder to another shift',{},[{crew_id:'crew',reminder_key:'day_before_2026-11-15',body:row.body,scheduled_for:row.scheduled_for}],/could not be rebuilt/);
 await gate('blocks a reminder already recorded as sent',{},[{crew_id:'crew',reminder_key:row.reminder_key,result:'already_sent'}],/already been sent/);
 await gate('checks rebuilt body again',{},[{crew_id:'crew',reminder_key:row.reminder_key,scheduled_for:row.scheduled_for,body:'Your Shift: November 10 · 8:00 AM–6:00 PM'}],/does not match/);
})().catch(e=>{console.error(e);process.exitCode=1});
const shortcutSource=fs.readFileSync(__dirname+'/../app/api/text-automation/shortcut/route.ts','utf8');
const shortcutAst=ts.createSourceFile('shortcut.ts',shortcutSource,ts.ScriptTarget.Latest,true);
const recovery=shortcutAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='recoverStaleSendingRows').getText(shortcutAst);
(async()=>{
 let patch;
 const q={update(p){patch=p;return q},eq(){return q},or(){return q},in(){return q},select(){return q},limit(){return Promise.resolve({error:null})}};
 const ctx=vm.createContext({admin:{from:()=>q},SENDING_LEASE_MINUTES:10});
 vm.runInContext(ts.transpileModule(recovery,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 await vm.runInContext('recoverStaleSendingRows(admin,["show"],"sender")',ctx);
 assert.equal(patch.status,'needs_sender_review');assert.match(patch.error,/automatic resend is blocked/);
 console.log('PASS unacknowledged phone sends require review instead of automatic retry');
})().catch(e=>{console.error(e);process.exitCode=1});
