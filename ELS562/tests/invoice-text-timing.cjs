const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=__dirname+'/..';
function functions(file,names){const source=fs.readFileSync(root+'/'+file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),parts=[];function walk(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))parts.push(n.getText(ast));ts.forEachChild(n,walk)}walk(ast);return ts.transpileModule(parts.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;}
const now='2026-11-17T18:00:00.000Z';class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return Date.parse(now)}}
let payload;
const context=vm.createContext({Date:Clock,selectedShow:{id:'show'},eventInvoiceMessageBody:'Please send your invoice.',selectedInvoiceCrewIds:['crew'],automationDraft:{timezone:'America/Phoenix'},setMsg:()=>{},request:async(_,method,body)=>{payload=body;return {queue:[]}},mergeQueuedTexts:()=>{}});
vm.runInContext(functions('app/events/events-client.tsx',['queueEventInvoiceMessage']),context);
(async()=>{
 await vm.runInContext('queueEventInvoiceMessage()',context);assert.equal(payload.send_now,true);assert.equal(payload.scheduled_local,undefined);assert.equal(payload.event_wide,true);assert.deepEqual(Array.from(payload.crew_ids),['crew']);
 console.log('PASS invoice button requests immediate delivery without a device-local date');
 const bundle={show:{},days:[{id:'day'}],calls:[{id:'call',labor_day_id:'day'}],assignments:[{crew_id:'crew',sub_call_id:'call'}],crewRows:[],masterRates:[]};
 Object.assign(context,{bundle,safeText:v=>String(v??'').trim(),nextScheduleByCrew:()=>new Map([['crew',{crew:{name:'Brian',phone:'555'},values:{}}]]),cleanPhone:v=>v,ensureSenderIdentity:v=>v,applyTemplate:v=>v});
 vm.runInContext(functions('app/api/text-automation/route.ts',['buildCustomQueueRows','scheduledLocalToUtcIso','zonedDateTimeToUtcIso']),context);
 for(const timezone of ['America/Phoenix','America/Chicago','America/New_York','UTC']){
 context.settings={show_id:'show',timezone};context.options={eventWide:true,sendNow:true,scheduledLocal:'2026-11-17T12:00',body:'Invoice please'};
 const rows=vm.runInContext('buildCustomQueueRows(settings,bundle,"Storm",options)',context);assert.equal(rows.length,1);assert.equal(rows[0].scheduled_for,now);
 console.log('PASS immediate invoice is due at server time in '+timezone);
 }
 context.settings={show_id:'show',timezone:'America/Phoenix'};context.options={eventWide:true,scheduledLocal:'2026-11-18T09:00',body:'Later message'};
 const later=vm.runInContext('buildCustomQueueRows(settings,bundle,"Storm",options)',context);assert.equal(later[0].scheduled_for,'2026-11-18T16:00:00.000Z');
 console.log('PASS explicitly scheduled custom messages retain their event-local delivery time');
 context.bundle={...bundle,assignments:[{crew_id:'crew',sub_call_id:'call'},{crew_id:'other',sub_call_id:'call'},{crew_id:'crew',sub_call_id:'call'}]};
 context.nextScheduleByCrew=(_,days,calls,assignments)=>new Map(assignments.map(a=>[a.crew_id,{crew:{name:a.crew_id,phone:'555'},values:{}}]));
 context.options={eventWide:true,sendNow:true,crewIds:['crew'],body:'Invoice please'};
 const chosen=vm.runInContext('buildCustomQueueRows(settings,bundle,"Storm",options)',context);
 assert.equal(chosen.length,1);assert.equal(chosen[0].crew_id,'crew');assert.equal(chosen[0].scheduled_for,now);
 console.log('PASS selected tech gets one due-now invoice across multiple assignments while unselected tech is excluded');
 context.options.crewIds=[];assert.equal(vm.runInContext('buildCustomQueueRows(settings,bundle,"Storm",options)',context).length,0);
 console.log('PASS empty explicit recipient list cannot fall back to sending to everyone');
 context.options.crewIds=['not-on-show'];assert.equal(vm.runInContext('buildCustomQueueRows(settings,bundle,"Storm",options)',context).length,0);
 console.log('PASS IDs outside the event cannot become recipients');
 payload=null;context.selectedInvoiceCrewIds=[];await vm.runInContext('queueEventInvoiceMessage()',context);assert.equal(payload,null);
 console.log('PASS invoice button refuses an empty selection without making a queue request');

})().catch(e=>{console.error(e);process.exitCode=1});
