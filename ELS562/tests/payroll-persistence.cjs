const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const js=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function load(file,mocks={}){const exports={};vm.runInNewContext(js(fs.readFileSync(path.join(root,file),'utf8')),{exports,require:name=>mocks[name]});return exports;}
function functions(file,names){const source=fs.readFileSync(path.join(root,file),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);let parts=[];function walk(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))parts.push(n.getText(ast).replace(/^export /,''));ts.forEachChild(n,walk);}walk(ast);return parts.join('\n');}
const scheduling=load('lib/payroll-scheduling.ts'),owner=load('lib/owner-draws.ts'),po=load('lib/payroll-calculations.ts',{'@/lib/rates-types':{halfDayFromFullDay:v=>v/2}});
let passed=0;function check(name,test){test();passed++;console.log('PASS '+name);}
const row={key:'show:crew',showId:'show',showName:'Show',crewId:'crew',crewName:'Crew',showYear:2026,calls:[{laborDate:'2026-11-01',clientRevenueAmount:700}],notes:'Internal notes',estimatedTotal:350,paymentStatus:'unpaid',paid:false,scheduledFor:null,scheduleMode:'automatic',paymentTermsDays:30,overrideAmount:null,roles:['Tech']};
async function api(){
 let stored={id:'status',notes:po.mergePurchaseOrderIntoNotes('Internal notes',{version:1,token:'token',referenceNumber:'PO',revision:1,status:'ready',baseAmount:350,days:[],adjustments:po.normalizePurchaseOrderAdjustments({}),total:350,createdAt:'2026-01-01',updatedAt:'2026-01-01',audit:[]}),paid:false,payment_status:'unpaid',scheduled_for:null,payout_override:null};
 const ctx={...scheduling,...owner,...po,getSessionUser:async()=>({user:{id:"user"},profile:{role:"owner"}}),normalizeRole:value=>value,requireSignedIn:async()=>({ok:true,user:{id:'user'}}),createSupabaseAdminClient:()=>({from:()=>({select(){return this},eq(){return this},single:async()=>({data:{name:"Storm Leigh"},error:null})})}),safeText:v=>String(v??'').trim(),existingPayrollRow:async()=>stored,payrollSnapshotMessage:async()=>'',upsertWithSchemaFallback:async(_,payload)=>{stored={...stored,...payload};return{data:stored,missing:[]}},NextResponse:{json:(body,init={})=>({body,status:init.status||200})}};
 vm.createContext(ctx);vm.runInContext(js(functions('app/api/payroll/route.ts',['POST','optionalDate','optionalMoney','normalizePaymentStatus','publicRow'])),ctx);
 async function post(body){ctx.request={json:async()=>({show_id:'show',crew_id:'crew',...body})};return vm.runInContext('POST(request)',ctx);}
 let result=await post({scheduled_for:'2027-01-04',schedule_mode:'manual',payment_terms_days:15,payment_status:'scheduled',notes:'Edited note'});
 check('API persists full date including changed year',()=>assert.equal(stored.scheduled_for,'2027-01-04'));
 check('API round trip preserves Net 15 manual terms',()=>{const saved=scheduling.readPayrollSchedule(stored.notes);assert.equal(saved.netDays,15);assert.equal(saved.mode,'manual');assert.equal(saved.date,'2027-01-04');});
 check('API preserves existing Purchase Order metadata',()=>assert.equal(po.extractPurchaseOrderFromNotes(stored.notes).referenceNumber,'PO'));
 check('API returns clean user notes',()=>assert.equal(result.body.row.notes,'Edited note'));
 await post({payout_override:450});
 check('later partial edit does not clear date terms status or PO',()=>{assert.equal(stored.scheduled_for,'2027-01-04');assert.equal(stored.payment_status,'scheduled');assert.equal(scheduling.readPayrollSchedule(stored.notes).netDays,15);assert.equal(po.extractPurchaseOrderFromNotes(stored.notes).referenceNumber,'PO');});
 const count=stored;
 for(const date of ['0027-01-04','2027-02-30']){result=await post({scheduled_for:date});check('API rejects incomplete or impossible date '+date,()=>{assert.equal(result.status,400);assert.equal(stored,count);});}
 result=await post({payment_terms_days:45});check('API rejects unsupported terms',()=>assert.equal(result.status,400));
 result=await post({scheduled_for:null,payment_status:'scheduled'});check('Scheduled requires a real date',()=>assert.equal(result.status,400));
 result=await post({action:'save_purchase_order'});check('owner draw cannot be saved as contractor Purchase Order',()=>assert.equal(result.status,400));
 // Simulate an older installation which omits scheduled_for/payment_status.
 const saved=scheduling.readPayrollSchedule(stored.notes,null);
 check('date and status survive reload without optional DB columns',()=>{assert.equal(saved.date,'2027-01-04');assert.equal(saved.status,'scheduled');});
}
async function serialization(){
 let state=[row],responses=[],bodies=[];
 const ctx={...scheduling,row,savedRows:{current:new Map()},rowSaveQueues:{current:new Map()},setSavingRowKeys:()=>{},setMessage:()=>{},setRows:update=>{state=update(state)},paymentStatusFor:r=>r.paymentStatus,derivePaymentStatus:(status,date)=>status==='paid'?'paid':date?'scheduled':'unpaid',fetch:(_,opts)=>new Promise(resolve=>{bodies.push(JSON.parse(opts.body));responses.push(resolve)})};
 vm.createContext(ctx);vm.runInContext(js(functions('app/payroll/payroll-client.tsx',['saveStatus','saveStatusNow'])),ctx);
 const first=vm.runInContext('saveStatus(row,{scheduled_for:"2027-01-04",schedule_mode:"manual",payment_status:"scheduled"})',ctx);
 const second=vm.runInContext('saveStatus(row,{payout_override:450})',ctx);
 await new Promise(setImmediate);check('overlapping row edits send in order',()=>assert.equal(bodies.length,1));
 const respond=i=>responses[i]({ok:true,json:async()=>({ok:true,row:{...bodies[i],id:'status'}})});
 respond(0);await first;await new Promise(setImmediate);
 check('second edit carries newly saved date and status',()=>{assert.equal(bodies[1].scheduled_for,'2027-01-04');assert.equal(bodies[1].payment_status,'scheduled');assert.equal(bodies[1].schedule_mode,'manual');});respond(1);await second;
 check('final row keeps both date and money edits',()=>{assert.equal(state[0].scheduledFor,'2027-01-04');assert.equal(state[0].overrideAmount,450);});
}
function summaries(){
 const storm={...row,crewName:'Storm Leigh',showFinancialNotes:owner.withOwnerTechEvent('',true)};
 for(const [file,deps] of [['app/payroll/payroll-client.tsx',{payable:r=>r.ownerPassThroughAmount??r.overrideAmount??r.estimatedTotal,paymentStatusFor:r=>r.paymentStatus,coordinatorPaymentsForEvent:()=>[],coordinatorCostForEvent:()=>0,expenseTotal:()=>0}],['lib/payroll-data.ts',{payrollRowPayable:r=>r.ownerPassThroughAmount??r.overrideAmount??r.estimatedTotal,coordinatorPaymentsForPayrollEvent:()=>[],coordinatorCostForPayrollEvent:()=>0,safeText:v=>String(v??'')} ]]){
 const ctx={...owner,...deps,rows:[storm]};vm.createContext(ctx);vm.runInContext(js(functions(file,['buildEventSummaries'])),ctx);const event=vm.runInContext('buildEventSummaries(rows)[0]',ctx);
 check(file+' allocates entire revenue to owner',()=>{assert.equal(event.payableTotal,700);assert.equal(event.ownerDrawTotal,700);});
 check(file+' excludes owner draws from labor expense and preserves revenue',()=>{assert.equal(event.estimatedProfit,700);assert.equal(event.estimatedRevenue,700);});
 if(file==='lib/payroll-data.ts'){ctx.event=event;vm.runInContext(js(functions(file,['payrollSnapshotPayload'])),ctx);check('saved paid-show snapshot preserves owner draw classification',()=>assert.equal(vm.runInContext('payrollSnapshotPayload(event,"test").event.ownerDrawTotal',ctx),700));}
 }
 const ctx={...owner,payable:r=>r.estimatedTotal,paymentStatusFor:r=>r.paymentStatus,cleanText:(v,def='')=>String(v||def),rows:[{...storm,paymentStatus:'paid'},{...row,paymentStatus:'paid'}]};vm.createContext(ctx);vm.runInContext(js(functions('app/payroll/payroll-client.tsx',['buildYearSummary'])),ctx);
 check('1099 summary excludes Storm and keeps contractor pay',()=>{const summaries=vm.runInContext('buildYearSummary(rows)',ctx);assert.equal(summaries.length,1);assert.equal(summaries[0].crewName,'Crew');assert.equal(summaries[0].paidTotal,350);});
}
async function emails(){
 let sent;
 const ctx={resendApiKey:()=> 'test-key',resendDomain:()=> 'example.com',purchaseOrderDisplayNumber:()=> 'PO',purchaseOrderLines:()=>[],escapeHtml:String,money:v=>String(v),fetch:async(_,options)=>{sent=JSON.parse(options.body);return{ok:true,json:async()=>({id:'mock-email'})}}};vm.createContext(ctx);vm.runInContext(js(functions('app/api/payroll/route.ts',['sendPurchaseOrderEmail'])),ctx);
 for(const terms of [15,undefined]){ctx.args={to:'test@example.com',crewName:'Crew',showName:'Show',showClient:'Client',showDates:'Dates',link:'https://example.com',po:{total:100,paymentTermsDays:terms}};await vm.runInContext('sendPurchaseOrderEmail(args)',ctx);check('PO email states Net '+(terms||30)+' in text and HTML',()=>{assert.ok(sent.text.includes('Net '+(terms||30)));assert.ok(sent.html.includes('within '+(terms||30)+' days'));});}
}
(async()=>{await api();await serialization();summaries();await emails();console.log(passed+' payroll persistence and accounting checks passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
