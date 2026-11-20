const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=__dirname+'/..',js=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const helpers={};vm.runInNewContext(js(fs.readFileSync(root+'/lib/booking-holds.ts','utf8')),{exports:helpers});
const hold={id:'h',crew_id:'brian',respond_by:'2026-12-01',created_by:'storm',created_at:'2026-11-20T10:00:00Z'};
const notes=helpers.notesWithBookingHolds('Meet by dock\n[[ELS_BOOTH_NUMBER:2639]]',[hold]);
assert.equal(helpers.readBookingHolds(notes)[0].crew_id,'brian');assert.equal(helpers.stripBookingHolds(notes),'Meet by dock\n[[ELS_BOOTH_NUMBER:2639]]');assert.equal(helpers.activeBookingHolds(notes,['brian']).length,0);
assert.equal(helpers.validHoldDate('2026-02-30'),false);assert.equal(helpers.validHoldDate(''),true);
console.log('PASS holds persist separately from assignments, preserve notes, hide internal metadata and validate dates');
function extract(file,names){const source=fs.readFileSync(root+'/'+file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),parts=[];function walk(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))parts.push(n.getText(ast).replace(/^export /,''));ts.forEachChild(n,walk)}walk(ast);return parts.join('\n');}
const call={id:'call',notes:'Keep original notes',crew_needed:2},assignments=[{id:'assigned',sub_call_id:'call',crew_id:'other',status:'confirmed'}];
const writes=[];let clash=false;
const admin={from(table){let patch;const filters=[];const q={select(){return q},eq(k,v){filters.push(row=>row[k]===v);return q},is(k,v){filters.push(row=>row[k]===v);return q},update(p){patch=p;return q},maybeSingle(){return q},then(resolve,reject){const data=(table==='sub_calls'?[call]:table==='assignments'?assignments:[{id:'brian'}]).filter(row=>filters.every(f=>f(row)));if(patch&&!clash){data.forEach(row=>Object.assign(row,patch));writes.push(patch)}return Promise.resolve({data:patch?(clash?null:data[0]):table==='assignments'?data:data[0]||null,error:null}).then(resolve,reject)}};return q}};
const ctx=vm.createContext({...helpers,randomUUID:()=> 'new-hold',admin});vm.runInContext(js(extract('lib/booking-holds-server.ts',['updateBookingHold','consumeBookingHoldsForCrew'])+'\n'+extract('app/api/assignments/route.ts',['canAddToSubCall','assignmentCountsAsFilled'])),ctx);
(async()=>{
 await vm.runInContext('updateBookingHold(admin,"call","storm",true,"booking_hold_add","brian","","2026-12-01")',ctx);
 assert.equal(helpers.readBookingHolds(call.notes).length,1);assert.equal(assignments.length,1);
 console.log('PASS placing a hold reserves a remaining position without creating a booking or payroll assignment');
 assert.equal((await vm.runInContext('canAddToSubCall(admin,"call",null,"someone-else")',ctx)).ok,false);
 assert.equal((await vm.runInContext('canAddToSubCall(admin,"call",null,"brian")',ctx)).ok,true);
 console.log('PASS another tech cannot consume a held slot while its named tech can confirm normally');
 await assert.rejects(vm.runInContext('updateBookingHold(admin,"call","storm",true,"booking_hold_add","third","","")',ctx),/All positions/);
 await assert.rejects(vm.runInContext('updateBookingHold(admin,"call","other-coordinator",false,"booking_hold_release","brian","new-hold","")',ctx),/Only the coordinator/);
 console.log('PASS full shifts and another coordinator’s holds are protected');
 await vm.runInContext('updateBookingHold(admin,"call","storm",true,"booking_hold_release","brian","new-hold","")',ctx);assert.equal(helpers.readBookingHolds(call.notes).length,0);assert.equal(call.notes,'Keep original notes');
 console.log('PASS releasing a hold reopens the position and preserves unrelated notes');
 call.notes=helpers.notesWithBookingHolds('Keep original notes',[hold]);
 await vm.runInContext('consumeBookingHoldsForCrew(admin,"call","brian")',ctx);assert.equal(helpers.readBookingHolds(call.notes).length,0);
 console.log('PASS confirmed bookings remove their holds permanently so cancellation cannot revive an old reservation');

 clash=true;await assert.rejects(vm.runInContext('updateBookingHold(admin,"call","storm",true,"booking_hold_add","brian","","")',ctx),/changed while saving/);
 console.log('PASS simultaneous edits fail safely rather than overwriting newer notes');
 // Execute the actual Booking View grouping callback to verify held-only shifts stay in Needs Crew.
 const source=fs.readFileSync(root+'/app/events/events-client.tsx','utf8'),ast=ts.createSourceFile('client.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let memo;
 function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='bookingBoothSections')memo=n.initializer.arguments[0].getText(ast);ts.forEachChild(n,walk)}walk(ast);
 call.notes=helpers.notesWithBookingHolds('',[hold]);call.crew_needed=1;
 Object.assign(ctx,{displayCalls:[{call,day:{labor_date:'2026-12-10'},callAssignments:[]}],holdsForCall:c=>helpers.activeBookingHolds(c.notes,[]),boothLabel:()=> 'MERCK',bookingBoothKey:v=>v,assignmentCountsAsFilled:()=>true,compareBoothViewCallItems:()=>0});
 const sections=vm.runInContext(js('('+memo+')()'),ctx);assert.equal(sections[0].fullyBooked,false);assert.equal(sections[0].openCount,1);assert.equal(sections[0].calls[0].holdCount,1);assert.equal(sections[0].calls[0].availableCount,0);
 console.log('PASS a shift whose only position is held stays unfilled and visible under Needs Crew');
})().catch(e=>{console.error(e);process.exitCode=1});
