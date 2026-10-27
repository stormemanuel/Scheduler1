const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require('typescript');
const root=require('path').resolve(__dirname,'..')+'/';
function js(s){return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;}
const exportsObj={};vm.runInNewContext(js(fs.readFileSync(root+'lib/availability-conflicts.ts','utf8')),{exports:exportsObj});
const ast=ts.createSourceFile('route.ts',fs.readFileSync(root+'app/api/text-automation/route.ts','utf8'),ts.ScriptTarget.Latest,true);
const names=['cleanQueueIds','readAvailabilityRows','validateAvailabilityBookings','queueAvailabilityCandidates','assignmentStartTime','assignmentEndTime'];const fns=[];
function walk(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))fns.push(n.getText(ast));ts.forEachChild(n,walk);}walk(ast);
const code=js(fns.join('\n')+'\nqueueAvailabilityCandidates(admin,body,{id:"tester"});');
async function run(opts={}){
 const bookedDate=opts.bookedDate||'2026-10-21';
 const tables={shows:[{id:'show',name:'Test',show_start:'2026-10-21',show_end:'2026-10-21'}],crew:[{id:'crew',name:'Tester',phone:'+15555550123'}],sub_calls:[{id:'target',labor_day_id:'target-day',start_time:'11:00',end_time:opts.targetEnd??'12:00'},...(!opts.missingCall?[{id:'booked',labor_day_id:'booked-day',start_time:'10:00',end_time:opts.end??'14:00'}]:[])],labor_days:[{id:'target-day',show_id:opts.wrongShow?'other':'show',labor_date:'2026-10-21'},{id:'booked-day',show_id:'hidden-show',labor_date:bookedDate}],assignments:opts.noBooking?[]:[{id:'assignment',crew_id:'crew',sub_call_id:'booked',status:opts.status||'confirmed',...opts.overrides}]};
 if(opts.paginated){tables.assignments=Array.from({length:101},(_,i)=>({id:String(i).padStart(3,'0'),crew_id:'crew',sub_call_id:'booked',status:i===100?'confirmed':'cancelled'}));}
 if(opts.crewCount){tables.crew=Array.from({length:opts.crewCount},(_,i)=>({id:'crew-'+i,name:'Crew '+i,phone:'+15555550123'}));}
 const queried=[],written=[];
 const admin={from(table){queried.push(table);let filter,ids,one=false,lo=0,hi=Infinity;const q={select(){return q},eq(k,v){filter=k;ids=[v];return q},in(k,v){filter=k;ids=v;return q},single(){one=true;return q},order(){return q},range(a,b){lo=a;hi=b;return q},then(resolve,reject){if(opts.dbError&&table==='assignments')return Promise.resolve({data:null,error:{message:'denied'}}).then(resolve,reject);let rows=(tables[table]||[]).filter(r=>!filter||ids.includes(r[filter])).slice(lo,hi+1);return Promise.resolve({data:one?rows[0]:rows,error:null}).then(resolve,reject)}};return q;}};
 const ctx={...exportsObj,admin,body:{show_id:'show',crew_ids:opts.crewCount?tables.crew.map(c=>c.id):['crew'],sub_call_ids:opts.noCallIds?[]:['target'],body:'Test only',availability_calls:[{labor_date:'2000-01-01',start_time:'01:00',end_time:'02:00'}]},safeText:v=>String(v??'').trim(),senderNameForMessage:()=> 'Tester',formatAvailabilityScheduleLines:c=>JSON.stringify(c),formatDate:v=>v,cleanPhone:v=>v,firstName:v=>v,queueIdentity:()=>({}),ensureSenderIdentity:v=>v,enforceAvailabilityRate:v=>v,applyTemplate:(v,values)=>values.availability_schedule,upsertTextQueueRows:async(a,rows)=>{written.push(...rows);return rows;}};
 try{return {result:await vm.runInNewContext(code,ctx),written,queried}}catch(error){return {error:error.message,written,queried}};
}
const results=[];
async function check(name,opts,blocked){const r=await run(opts);try{if(blocked){assert.ok(r.error);assert.equal(r.written.length,0);}else{assert.equal(r.error,undefined);assert.equal(r.written.length,opts.crewCount||1);assert.ok(r.written[0].body.includes('2026-10-21'));assert.ok(!r.written[0].body.includes('2000-01-01'));}results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',error:r.error||e.message});}}
(async()=>{
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
