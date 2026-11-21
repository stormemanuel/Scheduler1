const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=__dirname+'/..',js=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const helpers={};vm.runInNewContext(js(fs.readFileSync(root+'/lib/booking-holds.ts','utf8')),{exports:helpers});
const source=fs.readFileSync(root+'/app/events/events-client.tsx','utf8'),ast=ts.createSourceFile('client.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let handler;
function walk(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='saveBookingHold')handler=n.getText(ast);ts.forEachChild(n,walk)}walk(ast);
const rows=['one','two','three'].map((id,i)=>({id,labor_day_id:'d'+i,notes:'Shift notes '+id,crew_needed:1}));
let requests=[],message,busy=false;const failures=new Set();
const context=vm.createContext({Error,bookingHoldBusy:false,bookingHoldRespondBy:'2026-12-01',crewAssignmentTargetCallIds:['one','two','two'],subCalls:rows.map(r=>({...r})),subCallById:new Map(rows.map(r=>[r.id,{...r}])),laborDayById:new Map(rows.map((r,i)=>[r.labor_day_id,{labor_date:'2026-12-'+(10+i)}])),assignments:[],assignmentCountsAsFilled:a=>a.status==='confirmed',crewById:new Map([['brian',{name:'Brian'}]]),holdsForCall:c=>helpers.activeBookingHolds(c.notes,[]),setBookingHoldBusy:v=>{busy=v;context.bookingHoldBusy=v},setMsg:v=>message=v,setSubCalls:fn=>{context.subCalls=fn(context.subCalls);context.subCallById=new Map(context.subCalls.map(r=>[r.id,r]));},request:async(_,method,payload)=>{
 requests.push(payload);if(failures.has(payload.sub_call_id))throw Error('Position is full or already reserved');
 const call=context.subCallById.get(payload.sub_call_id);const holds=helpers.readBookingHolds(call.notes);
 const next=payload.action==='booking_hold_release'?holds.filter(h=>h.id!==payload.hold_id):[...holds,{id:'hold-'+call.id,crew_id:payload.crew_id,respond_by:payload.respond_by,created_by:'storm',created_at:'2026-11-21T12:00:00Z'}];
 return {call:{id:call.id,notes:helpers.notesWithBookingHolds(call.notes,next)}};
}});vm.runInContext(js(handler),context);
(async()=>{
 await vm.runInContext('saveBookingHold(subCallById.get("three"),"brian")',context);
 assert.deepEqual(requests.map(r=>r.sub_call_id),['one','two']);assert.ok(requests.every(r=>r.crew_id==='brian'&&r.respond_by==='2026-12-01'));assert.equal(helpers.readBookingHolds(context.subCallById.get('three').notes).length,0);assert.equal(busy,false);
 console.log('PASS the same person and response date are held on all selected days, without including the unselected anchor day or duplicating IDs');
 requests=[];await vm.runInContext('saveBookingHold(subCallById.get("one"),"brian")',context);assert.equal(requests.length,0);assert.match(message.text,/2 selected shifts are already held or booked/);
 console.log('PASS retrying already-held selected days does not create duplicate reservations');
 context.crewAssignmentTargetCallIds=[];requests=[];await vm.runInContext('saveBookingHold(subCallById.get("one"),"brian")',context);assert.equal(requests.length,0);assert.equal(message.kind,'error');
 console.log('PASS clearing all selected days creates no hold');
 context.crewAssignmentTargetCallIds=['one','two'];requests=[];await vm.runInContext('saveBookingHold(subCallById.get("one"),"brian","hold-one")',context);assert.deepEqual(requests.map(r=>r.sub_call_id),['one']);assert.equal(helpers.readBookingHolds(context.subCallById.get('one').notes).length,0);assert.equal(helpers.readBookingHolds(context.subCallById.get('two').notes).length,1);
 console.log('PASS releasing one hold leaves the same person’s holds on other days intact');
 context.crewAssignmentTargetCallIds=['one','three'];failures.add('three');requests=[];await vm.runInContext('saveBookingHold(subCallById.get("one"),"brian")',context);assert.equal(helpers.readBookingHolds(context.subCallById.get('one').notes).length,1);assert.equal(helpers.readBookingHolds(context.subCallById.get('three').notes).length,0);assert.equal(message.kind,'error');assert.match(message.text,/1 hold saved/);assert.match(message.text,/2026-12-12: Position is full/);assert.equal(busy,false);
 console.log('PASS a failed day is reported explicitly while successful holds remain saved');
})().catch(e=>{console.error(e);process.exitCode=1});
