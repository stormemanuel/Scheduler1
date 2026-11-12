const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const source=fs.readFileSync(__dirname+'/../app/api/text-automation/route.ts','utf8');
const ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['markCombinedPlanItemSent','logicalReminderKey','safeText','queueRowsFromImmediateSchedulePlan','queueRowsFromReminderPlan','combinedScheduleSummary']);
const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const js=ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const row={crew_id:'brian',crew_name:'Brian',phone:'5550000000',message_type:'schedule',reminder_key:'full_show_schedule',scheduled_for:'2026-12-10T12:00:00Z',body:'Current schedule'};
const user={id:'storm'};
const existing=[
 {id:'old',crew_id:'brian',message_type:'schedule',reminder_key:'full_show_schedule_requeue_123',status:'scheduled'},
 {id:'other',crew_id:'jorge',message_type:'schedule',reminder_key:'full_show_schedule',status:'scheduled'},
 {id:'reminder',crew_id:'brian',message_type:'reminder',reminder_key:'day_before_2026-12-10',status:'scheduled'},
 {id:'email',crew_id:'brian',message_type:'schedule',reminder_key:'full_show_schedule',status:'scheduled',delivery_mode:'resend_email'},
];
function setup(rows=existing,fail=false){let writes=[],sync=[],updates=[];
 const q={update(p){updates.push(p);return q},eq(field,value){assert.equal(field,'show_id');assert.equal(value,'show');return q},in(field,ids){assert.equal(field,'id');updates.at(-1).ids=ids;return q},neq(){return q},then(resolve,reject){return Promise.resolve({error:fail?{message:'Write failed'}:null}).then(resolve,reject)}};
 const ctx=vm.createContext({stampRows:(r,u,mode)=>r.map(x=>({...x,queued_by_user_id:u.id,delivery_mode:mode})),admin:{from:()=>q},row,user,
 readExistingQueueRowsForPlanning:async(_,show)=>{assert.equal(show,'show');return rows},upsertTextQueueRows:async(_,r)=>{writes.push(...r);return r},syncAssignmentChecklistFromSentMessage:async(_,r)=>sync.push(r)});
 vm.runInContext(js,ctx);return {ctx,writes,sync,updates};}
(async()=>{
 const a=setup();await vm.runInContext('markCombinedPlanItemSent(admin,"show",row,user,"apple_shortcut")',a.ctx);
 assert.deepEqual(Array.from(a.updates[0].ids),['old']);assert.equal(a.writes[0].status,'sent');assert.ok(a.writes[0].sent_at);assert.equal(a.writes[0].queued_by_user_id,'storm');assert.equal(a.sync.length,1);
 console.log('PASS marking a preview schedule persists sent status and checklist without touching other crew, reminders or email');
 const b=setup([{...existing[0],status:'sending'}]);await assert.rejects(vm.runInContext('markCombinedPlanItemSent(admin,"show",row,user,"apple_shortcut")',b.ctx),/currently being sent/);assert.equal(b.writes.length,0);
 console.log('PASS in-flight message is rejected before writing');
 const c=setup(existing,true);await assert.rejects(vm.runInContext('markCombinedPlanItemSent(admin,"show",row,user,"apple_shortcut")',c.ctx),/Write failed/);assert.equal(c.writes.length,0);
 console.log('PASS database failure prevents claiming successful marking');
 const d=setup();d.ctx.row={...row,message_type:'reminder',reminder_key:'day_before_2026-12-10'};await vm.runInContext('markCombinedPlanItemSent(admin,"show",row,user,"apple_shortcut")',d.ctx);assert.deepEqual(Array.from(d.updates[0].ids),['reminder']);
 console.log('PASS marking a reminder leaves initial schedule and other stages untouched');
 a.ctx.schedules=[{...row,result:'already_sent'},{...row,crew_id:'jorge',result:'will_queue'}];
 a.ctx.reminders=[{...row,result:'already_sent'},{...row,reminder_key:'day_of_2026-12-10',result:'will_schedule'}];
 const queued=vm.runInContext('[...queueRowsFromImmediateSchedulePlan("show",schedules,user),...queueRowsFromReminderPlan("show",reminders,user,true)]',a.ctx);
 assert.equal(queued.length,2);assert.equal(queued[0].crew_id,'jorge');assert.equal(queued[1].reminder_key,'day_of_2026-12-10');
 const summary=vm.runInContext('combinedScheduleSummary(schedules,reminders)',a.ctx);assert.equal(summary.schedules_now,1);assert.equal(summary.future,1);assert.equal(summary.already_sent,2);
 console.log('PASS confirmation and totals skip only already-sent rows while retaining other schedules and future reminders');
 const builderNames=new Set(['buildImmediateFullShowSchedulePlan','resultForExisting']);
 const builder=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&builderNames.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
 Object.assign(a.ctx,{readExistingQueueRowsForPlanning:async()=>a.writes,nextScheduleByCrew:()=>new Map([['brian',{crew:{name:'Brian',phone:'555'},values:{client:'Client'}}]]),cleanQueueIds:()=>[],cleanPhone:v=>v,normalizeEmail:v=>v||'',normalizeRole:v=>v,existingQueueNeedsSender:()=>false,chooseExistingQueueState:(_,r)=>r,ensureScheduleHeader:v=>v,ensureSenderIdentity:v=>v,applyTemplate:()=> 'Schedule',defaultScheduleTemplate:'',settings:{show_id:'show'},bundle:{}});
 vm.runInContext(ts.transpileModule(builder,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,a.ctx);
 const refreshed=await vm.runInContext('buildImmediateFullShowSchedulePlan(admin,settings,bundle,"Storm", "")',a.ctx);
 assert.equal(refreshed[0].result,'already_sent');
 console.log('PASS fresh preview after reload reads persisted status and skips the marked schedule');

})().catch(e=>{console.error(e);process.exitCode=1});
