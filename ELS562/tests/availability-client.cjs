const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ts=require('typescript');
const root=require('path').resolve(__dirname,'..')+'/';
const source=fs.readFileSync(root+'app/events/events-client.tsx','utf8');
const ast=ts.createSourceFile('events.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions={};let memo;
function walk(n){
 if(ts.isFunctionDeclaration(n)&&n.name)functions[n.name.text]=n.getText(ast);
 if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='availabilityBookingStatus')memo=n.initializer.arguments[0].getText(ast);
 ts.forEachChild(n,walk);
}walk(ast);
function js(s){return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;}
const helperNames=['minutesFromTime','assignmentCountsAsFilled','assignmentStart','assignmentEnd'];
const helpers=helperNames.map(n=>functions[n]).join('\n');
const availabilityModule={exports:{}};
vm.runInNewContext(js(fs.readFileSync(root+'lib/availability-conflicts.ts','utf8')),{exports:availabilityModule.exports});
const base={...availabilityModule.exports,selectedShow:{id:'show'},safeText:v=>String(v??'').trim()};
function calc({requested=['10:00','12:00'],booked=['11:00','13:00'],date='2026-10-21',bookedDate=date,status='confirmed',overrides={},includeBooking=true}={}){
 const target={id:'target',labor_day_id:'target-day',start_time:requested[0],end_time:requested[1]};
 const call={id:'booked-call',labor_day_id:'booked-day',start_time:booked[0],end_time:booked[1]};
 const ctx={...base,selectedAvailabilitySubCalls:[{day:{labor_date:date},call:target}],assignments:[{crew_id:'crew',sub_call_id:call.id,status,...overrides}],subCallById:new Map(includeBooking?[[call.id,call]]:[]),laborDayById:new Map([['booked-day',{labor_date:bookedDate,show_id:'show'}]])};
 return vm.runInNewContext(js(helpers+'\nconst calculate='+memo+'; calculate();'),ctx).get('crew');
}
const results=[];
function check(name,fn){try{fn();results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',detail:e.message});}}
check('overlapping shifts are blocked',()=>assert.equal(calc().conflicts,1));
check('back-to-back shifts do not overlap',()=>assert.equal(calc({booked:['08:00','10:00']}).conflicts,0));
check('different days do not overlap',()=>assert.equal(calc({bookedDate:'2026-10-20'}).conflicts,0));
check('overnight booking conflicts on next day',()=>assert.equal(calc({requested:['00:30','02:00'],booked:['23:00','01:00'],bookedDate:'2026-10-20'}).conflicts,1));
check('assignment time overrides affect conflicts',()=>assert.equal(calc({booked:['08:00','09:00'],overrides:{start_time:'11:00',end_time:'13:00'}}).conflicts,1));
for(const status of ['cancelled','removed','declined','unavailable','no_show_replaced'])check(status+' assignment excluded',()=>assert.equal(calc({status}),undefined));
check('SAFETY: missing booking end time must not be advertised conflict-free',()=>assert.equal(calc({booked:['11:00','']}).unknown,true));
check('SAFETY: missing requested end time must not be advertised conflict-free',()=>assert.equal(calc({requested:['10:00','']}).unknown,true));
check('SAFETY: missing loaded booking must not be advertised conflict-free',()=>assert.equal(calc({includeBooking:false}).unknown,true));
for (const [date, start, end] of [['2026-02-30','10:00','12:00'],['2026-10-21','25:00','12:00'],['2026-10-21','10:99','12:00'],['2026-10-21','10:00oops','12:00'],['','10:00','12:00']]) {
 check('invalid schedule rejected: '+[date,start,end].join(' '),()=>assert.equal(base.availabilityInterval(date,start,end),null));
}
(async()=>{
 let payload;
 const context={...base,selectedAvailabilityCrewIds:['crew'],automationDraft:{availability_template:'Hello'},unknownAvailabilityPlaceholders:()=>[],availabilityRequestDetails:{rate:'$30',position:'Crew',area:'A',schedule:'Today'},availabilityRateHasConflict:false,availabilityCandidateRole:'Crew',availabilityCandidateCity:'All cities',selectedAvailabilitySubCalls:[{day:{labor_date:'2026-10-21'},call:{start_time:'10:00',end_time:'12:00'}}],availabilityBookingStatus:new Map([['crew',{conflicts:1}]]),request:async(path,method,body)=>{payload=body;return{queue:[]}},mergeQueuedTexts:()=>{},boothLabel:()=>'',eventLocationLabel:()=>'',setMsg:()=>{}};
 await vm.runInNewContext(js(functions.queueSelectedAvailabilityMessages+'\nqueueSelectedAvailabilityMessages();'),context);
 check('SAFETY: selected crew that now conflicts must be rejected before POST',()=>assert.equal(payload,undefined));
 fs.writeFileSync(require('path').join(__dirname,'client-results.json'),JSON.stringify(results,null,2));
 for(const r of results)console.log(r.result+' '+r.name+(r.detail?' — '+r.detail:''));
 console.log(`${results.filter(r=>r.result==='PASS').length} passed; ${results.filter(r=>r.result==='FAIL').length} failed`);
 process.exitCode=results.some(r=>r.result==='FAIL')?1:0;
})();
