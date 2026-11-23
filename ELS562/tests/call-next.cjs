const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=__dirname+'/..',js=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const helpers={};vm.runInNewContext(js(fs.readFileSync(root+'/lib/call-next.ts','utf8')),{exports:helpers});
const entry={id:'a',crew_id:'tech1',created_by:'owner',created_at:'2026-11-23T12:00:00Z',note:'LED additions'};
const note='Meet-up: Lobby\n[[ELS_EVENT_MESSAGE_DETAILS]]\n{"city":"New Orleans"}\n[[/ELS_EVENT_MESSAGE_DETAILS]]';
assert.equal(helpers.stripCallNext(helpers.notesWithCallNext(note,[entry])),note);assert.equal(helpers.readCallNext(helpers.notesWithCallNext(note,[entry]))[0].note,'LED additions');
console.log('PASS persistent Call Next metadata preserves operational notes and event settings');
let actor='owner',authenticated=true,stale=false,uuid=0;
const tables={profiles:[{id:'owner',role:'owner'},{id:'coord',role:'coordinator'},{id:'outsider',role:'coordinator'},{id:'viewer',role:'viewer'}],shows:[{id:'show',notes:note,created_by:'owner',assigned_coordinator_user_id:'coord'},{id:'other',notes:'Other event',created_by:'owner'}],crew:[{id:'tech1'},{id:'tech2'}],event_user_access:[],labor_days:[],sub_calls:[]};
const admin={from(table){let patch,single=false,limit=Infinity;const filters=[];const q={select(){return q},eq(k,v){filters.push(row=>row[k]===v);return q},is(k,v){filters.push(row=>row[k]==null&&v==null);return q},in(k,values){filters.push(row=>values.includes(row[k]));return q},limit(n){limit=n;return q},maybeSingle(){single=true;return q},update(p){patch=p;return q},then(resolve,reject){let data=tables[table].filter(row=>filters.every(f=>f(row))).slice(0,limit);if(patch){if(stale)data=[];else data.forEach(row=>Object.assign(row,patch));}return Promise.resolve({data:single?data[0]||null:data,error:null}).then(resolve,reject)}};return q}};
const source=fs.readFileSync(root+'/app/api/events/call-next/route.ts','utf8'),ast=ts.createSourceFile('route.ts',source,ts.ScriptTarget.Latest,true);
const post=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='POST').getText(ast).replace(/^export /,'');
const ctx=vm.createContext({...helpers,Error,Request,randomUUID:()=> 'id'+(++uuid),createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:authenticated?{id:actor}:null}})}}),createSupabaseAdminClient:()=>admin,NextResponse:{json:(body,init)=>({body,status:init?.status||200})}});vm.runInContext(js(post),ctx);
async function action(body){ctx.request=new Request('http://localhost/api/events/call-next',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({show_id:'show',...body})});return vm.runInContext('POST(request)',ctx)}
(async()=>{
 authenticated=false;assert.equal((await action({action:'add',crew_id:'tech1'})).status,401);authenticated=true;actor='outsider';assert.equal((await action({action:'list'})).status,403);actor='viewer';assert.equal((await action({action:'list'})).status,403);
 console.log('PASS authentication and event access are required before list reads or writes');
 actor='owner';assert.equal((await action({action:'add',crew_id:'tech1',note:'LED additions'})).status,200);await action({action:'add',crew_id:'tech2'});await action({action:'add',crew_id:'tech1'});let entries=helpers.readCallNext(tables.shows[0].notes);assert.equal(entries.length,2);assert.equal(tables.shows[1].notes,'Other event');assert.equal(helpers.stripCallNext(tables.shows[0].notes),note);
 console.log('PASS additions persist per event without duplicate crew or changes to another show');
 const listed=await action({action:'list'});assert.equal(helpers.readCallNext(listed.body.show.notes).length,2);await action({action:'up',id:entries[1].id});assert.equal(helpers.readCallNext(tables.shows[0].notes)[0].crew_id,'tech2');
 console.log('PASS reloading and priority ordering use the saved event list');
 actor='coord';await action({action:'add',crew_id:'tech1'});const foreign=await action({action:'remove',id:entries[0].id});assert.equal(foreign.status,400);assert.equal(helpers.readCallNext(tables.shows[0].notes).length,3);
 console.log('PASS coordinators can maintain their own entries without removing another coordinator’s entries');
 actor='owner';const before=tables.shows[0].notes;stale=true;assert.equal((await action({action:'remove',id:entries[0].id})).status,409);assert.equal(tables.shows[0].notes,before);stale=false;
 console.log('PASS concurrent edits cannot overwrite a newer list');
 await action({action:'remove',id:entries[0].id});assert.equal(helpers.readCallNext(tables.shows[0].notes).length,2);assert.equal((await action({action:'add',crew_id:'missing'})).status,400);
 console.log('PASS removal is durable and nonexistent crew cannot be added');
 // Normal event edits must preserve the list and reject a stale notes revision.
 const showSource=fs.readFileSync(root+'/app/api/shows/[id]/route.ts','utf8'),showAst=ts.createSourceFile('show.ts',showSource,ts.ScriptTarget.Latest,true);
 const save=showAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='updateShowWithSchemaFallback').getText(showAst);Object.assign(ctx,{admin,optionalShowColumns:[],missingShowColumnFromMessage:()=>null});vm.runInContext(js(save),ctx);
 const fresh=helpers.notesWithCallNext('Updated venue note',helpers.readCallNext(tables.shows[0].notes));ctx.patch={notes:fresh};ctx.revision=tables.shows[0].notes;const saved=await vm.runInContext('updateShowWithSchemaFallback(admin,"show",patch,revision)',ctx);assert.equal(saved.data.length,1);assert.equal(helpers.readCallNext(tables.shows[0].notes).length,2);
 ctx.patch={notes:'stale overwrite'};const blocked=await vm.runInContext('updateShowWithSchemaFallback(admin,"show",patch,revision)',ctx);assert.equal(blocked.data.length,0);assert.equal(tables.shows[0].notes,fresh);
 console.log('PASS event edits preserve Call Next and stale event saves cannot erase it');
})().catch(e=>{console.error(e);process.exitCode=1});
