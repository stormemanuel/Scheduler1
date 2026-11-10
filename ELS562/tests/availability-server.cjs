const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require('typescript');
const root=require('path').resolve(__dirname,'..')+'/';
function js(s){return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;}
const exportsObj={};vm.runInNewContext(js(fs.readFileSync(root+'lib/availability-conflicts.ts','utf8')),{exports:exportsObj});
vm.runInNewContext(js(fs.readFileSync(root+'lib/availability-message.ts','utf8')),{exports:exportsObj});
for(const file of ['lib/broad-availability.ts','lib/schedule-locations.ts'])vm.runInNewContext(js(fs.readFileSync(root+file,'utf8')),{exports:exportsObj});
const clean=exportsObj.cleanAvailabilityMessage;
assert.throws(()=>exportsObj.availabilityDateRange('2026-02-30','2026-03-01'),/valid/);
assert.throws(()=>exportsObj.availabilityDateRange('2026-01-01','2028-01-01'),/one year/);
assert.throws(()=>exportsObj.broadAvailabilityRate('Varies by shift'),/hourly rate/);
assert.equal(exportsObj.broadAvailabilityRate('$35/hr'),'$35/hr');
assert.equal(exportsObj.broadAvailabilityEventLabel('ASH26 | Test','ASH26'),'ASH26 | Test');
console.log('PASS date-range dates, rates, and event label are validated');
for(const line of ['I have some days in between this span that I am looking to book for December.','I have some days in between that range that I am booking.',"I have some days between those dates I’m looking to get filled."]){assert.equal(clean('Dates:\n12/5\n\n'+line+'\n\nPlease respond ASAP.'),'Dates:\n12/5\n\nPlease respond ASAP.');}
assert.equal(clean('Custom instructions.\nPlease respond ASAP.'),'Custom instructions.\nPlease respond ASAP.');
console.log('PASS retired availability sentence removed from saved wording; dates and custom instructions preserved');
assert.equal(clean('Rate: $35/hr\nChecking Availability :\n12/10/26'),'Rate: $35/hr\n\nChecking Availability :\n12/10/26');
assert.equal(clean('Rate: {rate}\n\nChecking availability for these dates:\n{availability_schedule}'),'Rate: {rate}\n\nChecking availability for these dates:\n{availability_schedule}');
console.log('PASS availability rate is separated from dates by exactly one blank line');
const ast=ts.createSourceFile('route.ts',fs.readFileSync(root+'app/api/text-automation/route.ts','utf8'),ts.ScriptTarget.Latest,true);
const names=['cleanQueueIds','readAvailabilityRows','validateAvailabilityBookings','queueAvailabilityCandidates','assignmentStartTime','assignmentEndTime'];const fns=[];
function walk(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))fns.push(n.getText(ast));ts.forEachChild(n,walk);}walk(ast);
const code=js(fns.join('\n')+'\nqueueAvailabilityCandidates(admin,body,{id:"tester"});');
async function run(opts={}){
 const bookedDate=opts.bookedDate||'2026-10-21';
 const tables={shows:[{id:'show',name:'Test',show_start:'2026-10-21',show_end:'2026-10-21'}],crew:[{id:'crew',name:'Tester',phone:'+15555550123'}],sub_calls:[{id:'target',crew_needed:opts.needed??2,labor_day_id:'target-day',start_time:'11:00',end_time:opts.targetEnd??'12:00'},...(!opts.missingCall?[{id:'booked',labor_day_id:'booked-day',start_time:'10:00',end_time:opts.end??'14:00'}]:[])],labor_days:[{id:'target-day',show_id:opts.wrongShow?'other':'show',labor_date:'2026-10-21'},{id:'booked-day',show_id:'hidden-show',labor_date:bookedDate}],assignments:opts.noBooking?[]:[{id:'assignment',crew_id:'crew',sub_call_id:'booked',status:opts.status||'confirmed',...opts.overrides}]};
 if(opts.paginated){tables.assignments=Array.from({length:101},(_,i)=>({id:String(i).padStart(3,'0'),crew_id:'crew',sub_call_id:'booked',status:i===100?'confirmed':'cancelled'}));}
 if(opts.crewCount){tables.crew=Array.from({length:opts.crewCount},(_,i)=>({id:'crew-'+i,name:'Crew '+i,phone:'+15555550123'}));}
 if(opts.staffed){for(let i=0;i<opts.staffed;i++)tables.assignments.push({id:'staff'+i,crew_id:'other'+i,sub_call_id:'target',status:opts.staffStatus||'confirmed'});}
 if(opts.mixed)tables.sub_calls.push({id:'target2',crew_needed:2,labor_day_id:'target-day',start_time:'14:00',end_time:'18:00',role_name:'General AV'});
 const queried=[],written=[];
 const admin={from(table){queried.push(table);let filter,ids,one=false,lo=0,hi=Infinity;const q={select(){return q},eq(k,v){filter=k;ids=[v];return q},in(k,v){filter=k;ids=v;return q},single(){one=true;return q},order(){return q},range(a,b){lo=a;hi=b;return q},then(resolve,reject){if(opts.dbError&&table==='assignments')return Promise.resolve({data:null,error:{message:'denied'}}).then(resolve,reject);let rows=(tables[table]||[]).filter(r=>!filter||ids.includes(r[filter])).slice(lo,hi+1);return Promise.resolve({data:one?rows[0]:rows,error:null}).then(resolve,reject)}};return q;}};
 const ctx={...exportsObj,messageRateForCall:call=>call.role_name==='General AV'?'$30/hr':'$35/hr',admin,body:{availability_mode:opts.range?'date_range':undefined,range_start:opts.rangeStart||'2026-12-08',range_end:opts.rangeEnd||'2026-12-16',show_id:'show',crew_ids:opts.crewCount?tables.crew.map(c=>c.id):['crew'],sub_call_ids:opts.noCallIds?[]:opts.mixed?['target','target2']:['target'],availability_rate:opts.range?'$35/hr':opts.mixed?'$999/hr':undefined,body:'Test only',availability_calls:[{labor_date:'2000-01-01',start_time:'01:00',end_time:'02:00'}]},safeText:v=>String(v??'').trim(),senderNameForMessage:()=> 'Tester',formatAvailabilityScheduleLines:c=>JSON.stringify(c),formatDate:v=>v,cleanPhone:v=>v,firstName:v=>v,queueIdentity:()=>({}),ensureSenderIdentity:v=>v,enforceAvailabilityRate:v=>v,applyTemplate:(v,values)=>values.availability_schedule,upsertTextQueueRows:async(a,rows)=>{written.push(...rows);return rows;}};
 try{return {result:await vm.runInNewContext(code,ctx),written,queried}}catch(error){return {error:error.message,written,queried}};
}
const rateFunctions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&['enforceAvailabilityRate','formatAvailabilityScheduleLines'].includes(node.name?.text)).map(node=>node.getText(ast)).join('\n');
const rateCtx={formatAvailabilityGroups:exportsObj.formatAvailabilityGroups,safeText:v=>String(v??'').trim(),cleanAvailabilityMessage:clean,formatDate:v=>v,formatTime:v=>v};vm.createContext(rateCtx);vm.runInContext(js(rateFunctions),rateCtx);
const outgoing=vm.runInContext('enforceAvailabilityRate("Rate: $99/hr\\n"+formatAvailabilityScheduleLines([{labor_date:"2026-12-10",start_time:"08:00",end_time:"18:00",rate:"$35/hr",open_positions:2},{labor_date:"2026-12-11",start_time:"08:00",end_time:"18:00",rate:"$30/hr",open_positions:1}]),"Varies by shift (see below)")',rateCtx);
assert.ok(outgoing.includes('2026-12-10 · 08:00–18:00 · $35/hr'));assert.ok(outgoing.includes('2026-12-11 · 08:00–18:00 · $30/hr'));assert.ok(!outgoing.includes('$99/hr'));assert.ok(!/positions? open/.test(outgoing));console.log('PASS mixed availability rates survive outgoing message formatting');
const results=[];
async function check(name,opts,blocked){const r=await run(opts);try{if(blocked){assert.ok(r.error);assert.equal(r.written.length,0);}else{assert.equal(r.error,undefined);assert.equal(r.written.length,opts.crewCount||1);assert.ok(r.written[0].body.includes('2026-10-21'));assert.ok(!r.written[0].body.includes('2000-01-01'));if(opts.staffed===1)assert.ok(r.written[0].body.includes('\"open_positions\":1'));if(opts.mixed){assert.ok(r.written[0].body.includes('$35/hr'));assert.ok(r.written[0].body.includes('$30/hr'));assert.ok(!r.written[0].body.includes('$999/hr'));} }results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',error:r.error||e.message});}}
(async()=>{
 const broad=await run({range:true,noCallIds:true});assert.equal(broad.error,undefined);assert.equal(broad.written.length,1);assert.ok(broad.written[0].body.includes('December 8, 2026 through December 16, 2026'));assert.ok(broad.written[0].body.includes('$35/hr'));assert.ok(broad.written[0].body.includes('any of these days'));assert.ok(!broad.queried.includes('assignments'));assert.ok(!broad.queried.includes('sub_calls'));console.log('PASS broad inquiry needs no sub-calls and does not claim crew are conflict-free');
 const reversed=await run({range:true,rangeStart:'2026-12-16',rangeEnd:'2026-12-08'});assert.ok(reversed.error);assert.equal(reversed.written.length,0);console.log('PASS invalid date range cannot queue messages');

 await check('mixed rates come from saved calls rather than client override',{noBooking:true,mixed:true},false);
 await check('reject fully staffed call without queueing',{noBooking:true,staffed:2},true);
 await check('reject overstaffed call',{noBooking:true,staffed:3},true);
 await check('allow partly staffed call',{noBooking:true,staffed:1},false);
 await check('cancelled assignments leave slots open',{noBooking:true,staffed:2,staffStatus:'cancelled'},false);
 await check('zero requested positions cannot solicit availability',{noBooking:true,needed:0},true);
 await check('reject conflict on hidden show',{},true);
 await check('reject missing booking time',{end:''},true);
 await check('reject missing requested time',{targetEnd:''},true);
 await check('reject missing related call',{missingCall:true},true);
 await check('reject cross-event requested call',{wrongShow:true},true);
 await check('reject missing requested call IDs',{noCallIds:true},true);
 await check('fail closed on database error',{dbError:true},true);
 await check('read beyond first 100 bookings',{paginated:true},true);
 await check('allow different date; ignore forged client times',{bookedDate:'2026-10-20'},false);
 await check('allow cancelled booking',{status:'cancelled'},false);
 await check('allow no bookings',{noBooking:true},false);
 await check('use per-assignment time overrides',{overrides:{start_time:'08:00',end_time:'10:00'}},false);
 await check('queue all 300 selected crew without truncating',{crewCount:300,noBooking:true},false);
 await check('reject oversized batch without queueing a partial selection',{crewCount:501,noBooking:true},true);
 console.log(results);fs.writeFileSync(require('path').join(__dirname,'server-results.json'),JSON.stringify(results,null,2));process.exitCode=results.some(r=>r.result==='FAIL')?1:0;
})();
