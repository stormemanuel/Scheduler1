const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const ts=require('typescript');
const root=require('path').resolve(__dirname,'..')+'/';
const source=fs.readFileSync(root+'app/events/events-client.tsx','utf8');
const ast=ts.createSourceFile('events.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions={};let memo,openCallsMemo;
function walk(n){
 if(ts.isFunctionDeclaration(n)&&n.name)functions[n.name.text]=n.getText(ast);
 if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='availabilitySubCallOptions')openCallsMemo=n.initializer.arguments[0].getText(ast);
 if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='availabilityBookingStatus')memo=n.initializer.arguments[0].getText(ast);
 ts.forEachChild(n,walk);
}walk(ast);
function js(s){return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;}
const helperNames=['minutesFromTime','assignmentCountsAsFilled','assignmentStart','assignmentEnd'];
const helpers=helperNames.map(n=>functions[n]).join('\n');
const availabilityModule={exports:{}};
vm.runInNewContext(js(fs.readFileSync(root+'lib/availability-conflicts.ts','utf8')),{exports:availabilityModule.exports});
vm.runInNewContext(js(fs.readFileSync(root+'lib/availability-message.ts','utf8')),{exports:availabilityModule.exports});
const base={availabilityRequestMode:'specific',availabilityRangeError:'',availabilityRangeStart:'2026-12-08',availabilityRangeEnd:'2026-12-16',...availabilityModule.exports,selectedShow:{id:'show'},safeText:v=>String(v??'').trim()};
function calc({requested=['10:00','12:00'],booked=['11:00','13:00'],date='2026-10-21',bookedDate=date,status='confirmed',overrides={},includeBooking=true,mode='specific'}={}){
 const target={id:'target',labor_day_id:'target-day',start_time:requested[0],end_time:requested[1]};
 const call={id:'booked-call',labor_day_id:'booked-day',start_time:booked[0],end_time:booked[1]};
 const ctx={...base,availabilityRequestMode:mode,selectedAvailabilitySubCalls:[{day:{labor_date:date},call:target}],assignments:[{crew_id:'crew',sub_call_id:call.id,status,...overrides}],subCallById:new Map(includeBooking?[[call.id,call]]:[]),laborDayById:new Map([['booked-day',{labor_date:bookedDate,show_id:'show'}]])};
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
const openContext={...base,availabilityEventCalls:[{id:'full',labor_day_id:'day',crew_needed:2},{id:'partial',labor_day_id:'day',crew_needed:4},{id:'empty',labor_day_id:'day',crew_needed:3}],laborDayById:new Map([['day',{id:'day',labor_date:'2026-12-10'}]]),assignmentCountByCallId:new Map([['full',2],['partial',1]]),formatTimeRange:()=> '08:00–18:00',boothLabel:()=> 'Area',formatMessageDate:v=>v};
const getOpen=()=>vm.runInNewContext(js('('+openCallsMemo+')()'),openContext);
check('only unfilled sub-calls appear with remaining position counts',()=>{const options=getOpen();assert.equal(options.length,2);assert.equal(options.find(item=>item.call.id==='partial').openPositions,3);assert.equal(options.find(item=>item.call.id==='empty').openPositions,3);});
openContext.assignmentCountByCallId.set('partial',4);
check('sub-call disappears after final slot fills',()=>assert.equal(getOpen().some(item=>item.call.id==='partial'),false));
check('availability preview keeps staffing counts out of crew message',()=>{const ctx={...openContext,items:getOpen()};const text=vm.runInNewContext(js(functions.formatAvailabilityScheduleLines+'\nformatAvailabilityScheduleLines(items)'),ctx);assert.ok(!text.includes('positions open'));});
const mixedItems=[{day:{labor_date:'2026-12-10'},call:{start_time:'08:00',end_time:'18:00'},openPositions:2,rate:'$35/hr'},{day:{labor_date:'2026-12-11'},call:{start_time:'08:00',end_time:'18:00'},openPositions:1,rate:'$30/hr'}];
const rateContext={...base,items:mixedItems,formatMessageDate:v=>v,formatTimeRange:c=>`${c.start_time}–${c.end_time}`,cleanAvailabilityMessage:v=>v};
const rateCode=functions.formatAvailabilityScheduleLines+'\n'+functions.applyAvailabilityTemplatePreview;
check('mixed-rate availability preview preserves each shift rate',()=>{const text=vm.runInNewContext(js(rateCode+'\napplyAvailabilityTemplatePreview("Rate: {rate}\\n{availability_schedule}",{rate:"Varies by shift (see below)",availability_schedule:formatAvailabilityScheduleLines(items)})'),rateContext);assert.ok(text.includes('2026-12-10 · 08:00–18:00 · $35/hr'));assert.ok(text.includes('2026-12-11 · 08:00–18:00 · $30/hr'));assert.ok(text.includes('Rate: Varies by shift'));});
check('single-rate availability keeps rate out of individual schedule lines',()=>{const ctx={...rateContext,items:[mixedItems[0]]};const text=vm.runInNewContext(js(functions.formatAvailabilityScheduleLines+'\nformatAvailabilityScheduleLines(items)'),ctx);assert.ok(!text.includes('$35/hr'));});
const positionItems=[{day:{labor_date:'2026-12-08'},call:{role_name:'Warehouse (Truck Loaders)',area:'NMR LABOR SORTING CREW RO329510',start_time:'08:00',end_time:'18:00'},openPositions:1,rate:'$25/hr'},{day:{labor_date:'2026-12-09'},call:{role_name:'LED Stagehand',area:'GENENTECH',start_time:'18:00',end_time:'04:00'},openPositions:1,rate:'$35/hr'},{day:{labor_date:'2026-12-10'},call:{role_name:'LED Stagehand',area:'GENENTECH',start_time:'18:00',end_time:'04:00'},openPositions:1,rate:'$35/hr'}];
const positionContext={...rateContext,items:positionItems,cleanAvailabilityMessage:availabilityModule.exports.cleanAvailabilityMessage};
check('different positions have separated headings and their own shifts without staffing counts',()=>{const message=vm.runInNewContext(js(rateCode+'\napplyAvailabilityTemplatePreview("Position: {position}\\nArea: {area}\\nRate: {rate}\\nChecking Availability :\\n{availability_schedule}",{position:"See position details below",area:"See position details below",rate:"Varies by shift (see below)",availability_schedule:formatAvailabilityScheduleLines(items)})'),positionContext);assert.ok(message.includes('Position: Warehouse (Truck Loaders)\nArea: NMR LABOR SORTING CREW RO329510\n2026-12-08'));assert.ok(message.includes('\n\nPosition: LED Stagehand\nArea: GENENTECH\n2026-12-09'));assert.ok(message.includes('2026-12-10 · 18:00–04:00 · $35/hr'));assert.ok(!/positions? open|still needed|See position details below/.test(message));});
check('broad inquiry does not treat a partial booking as unavailable for every date',()=>{const result=calc({mode:'date_range'});assert.equal(result.conflicts,0);assert.equal(result.unknown,false);assert.equal(result.booked,1);});
(async()=>{
 let payload;
 const context={...base,selectedAvailabilityCrewIds:['crew'],automationDraft:{availability_template:'Hello'},unknownAvailabilityPlaceholders:()=>[],availabilityRequestDetails:{rate:'$30',position:'Crew',area:'A',schedule:'Today'},availabilityRateHasConflict:false,availabilityCandidateRole:'Crew',availabilityCandidateCity:'All cities',selectedAvailabilitySubCalls:[{day:{labor_date:'2026-10-21'},call:{start_time:'10:00',end_time:'12:00'}}],availabilityBookingStatus:new Map([['crew',{conflicts:1}]]),request:async(path,method,body)=>{payload=body;return{queue:[]}},mergeQueuedTexts:()=>{},boothLabel:()=>'',eventLocationLabel:()=>'',setMsg:()=>{}};
 await vm.runInNewContext(js(functions.queueSelectedAvailabilityMessages+'\nqueueSelectedAvailabilityMessages();'),context);
 check('SAFETY: selected crew that now conflicts must be rejected before POST',()=>assert.equal(payload,undefined));
 context.availabilityRequestMode='date_range';context.availabilityCandidateRole='';context.selectedAvailabilitySubCalls=[];context.automationDraft.availability_template='';
 await vm.runInNewContext(js(functions.queueSelectedAvailabilityMessages+'\nqueueSelectedAvailabilityMessages();'),context);
 check('date-range inquiry can queue without specific sub-calls or a custom template',()=>{assert.equal(payload.availability_mode,'date_range');assert.equal(payload.range_start,'2026-12-08');assert.equal(payload.range_end,'2026-12-16');assert.equal(payload.sub_call_ids.length,0);assert.equal(payload.role_name,'');});
 fs.writeFileSync(require('path').join(__dirname,'client-results.json'),JSON.stringify(results,null,2));
 for(const r of results)console.log(r.result+' '+r.name+(r.detail?' — '+r.detail:''));
 console.log(`${results.filter(r=>r.result==='PASS').length} passed; ${results.filter(r=>r.result==='FAIL').length} failed`);
 process.exitCode=results.some(r=>r.result==='FAIL')?1:0;
})();
