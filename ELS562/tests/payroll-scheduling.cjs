const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const js=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function moduleFile(file){const exports={};vm.runInNewContext(js(fs.readFileSync(path.join(root,file),'utf8')),{exports});return exports;}
const schedule=moduleFile('lib/payroll-scheduling.ts'),owner=moduleFile('lib/owner-draws.ts');
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS '+name);}
const row={key:'show:crew',crewId:'crew',crewName:'Crew',showId:'show',calls:[{laborDate:'2026-11-01',clientRevenueAmount:500},{laborDate:'2026-10-31',clientRevenueAmount:200}],paid:false,paymentStatus:'unpaid',scheduledFor:null,paymentTermsDays:30,scheduleMode:'automatic',estimatedTotal:350,overrideAmount:null,notes:''};
check('Net 30 uses last worked date, not event end',()=>assert.equal(schedule.payrollScheduledBy(row),'2026-12-01'));
check('Net 15 uses last worked date',()=>assert.equal(schedule.payrollScheduledBy({...row,paymentTermsDays:15}),'2026-11-16'));
check('Net dates roll over a year correctly',()=>assert.equal(schedule.addNetDays('2026-12-20',30),'2027-01-19'));
check('leap day handled',()=>assert.equal(schedule.addNetDays('2028-02-20',15),'2028-03-06'));
check('manual date preserved when terms change',()=>assert.equal(schedule.payrollScheduledBy({...row,scheduleMode:'manual',scheduledFor:'2027-01-04',paymentTermsDays:15}),'2027-01-04'));
check('legacy saved dates remain manual',()=>assert.equal(schedule.readPayrollSchedule('', '2026-12-01').mode,'manual'));
check('new records default to Net 30 automatic',()=>assert.equal(schedule.readPayrollSchedule('').netDays,30));
check('saved payments do not replace refreshed work dates or owner event settings',()=>{const refreshed={...row,calls:[{laborDate:'2026-12-01'}],showFinancialNotes:'new event settings'};const merged=schedule.mergePayrollPaymentState(refreshed,{...row,paymentTermsDays:15});assert.equal(schedule.payrollScheduledBy(merged),'2026-12-16');assert.equal(merged.showFinancialNotes,'new event settings');});
check('missing work date does not invent a due date',()=>assert.equal(schedule.payrollScheduledBy({...row,calls:[]}),null));
for(const date of ['0026-12-01','2026-02-30','2026-13-01','2026-1-01','bad'])check('invalid date rejected '+date,()=>assert.equal(schedule.validPayrollDate(date),false));
const notes=schedule.mergePayrollSchedule('Visible note\n\n[[OTHER_METADATA]]',{netDays:15,mode:'manual',date:'2027-01-02',status:'scheduled'});
check('terms date and status survive database notes round trip',()=>{const saved=schedule.readPayrollSchedule(notes);assert.equal(saved.netDays,15);assert.equal(saved.date,'2027-01-02');assert.equal(saved.status,'scheduled');});
check('schedule metadata hidden without deleting other notes',()=>assert.equal(schedule.stripPayrollSchedule(notes),'Visible note\n\n[[OTHER_METADATA]]'));
check('editing terms does not duplicate metadata',()=>assert.equal(schedule.mergePayrollSchedule(notes,{netDays:30,mode:'automatic',date:null}).split('ELS_PAYROLL_SCHEDULE_V1').length,2));
const storm={...row,key:'show:owner',crewId:'owner',crewName:'Storm Leigh'};
check('owner identity matches exact normalized name',()=>{assert.equal(owner.isOwnerDrawPayee(' STORM  LEIGH '),true);assert.equal(owner.isOwnerDrawPayee('Storm Leigh Jr'),false);});
const flagged=owner.withOwnerTechEvent('Finance note',true);
check('event option persists without leaking marker into displayed notes',()=>{assert.equal(owner.isOwnerTechEvent(flagged),true);assert.equal(owner.ownerNotesText(flagged),'Finance note');});
check('full event revenue passes to Storm',()=>{const result=owner.applyOwnerPassThrough([{...storm,showFinancialNotes:flagged},row]);assert.equal(result[0].ownerPassThroughAmount,1400);assert.equal(result[1].ownerPassThroughAmount,undefined);});
check('explicit revenue override determines full pass-through',()=>assert.equal(owner.applyOwnerPassThrough([{...storm,showFinancialNotes:flagged,showRevenueOverride:1200}])[0].ownerPassThroughAmount,1200));
check('disabling pass-through restores normal payout source',()=>assert.equal(owner.applyOwnerPassThrough([{...storm,showFinancialNotes:owner.withOwnerTechEvent(flagged,false),ownerPassThroughAmount:700}])[0].ownerPassThroughAmount,undefined));
check('duplicate Storm contacts never duplicate full revenue',()=>assert.equal(owner.applyOwnerPassThrough([{...storm,showFinancialNotes:flagged},{...storm,key:'other',crewId:'other'}]).some(r=>r.ownerPassThroughAmount!==undefined),false));
const pay=r=>r.ownerPassThroughAmount??r.overrideAmount??r.estimatedTotal;
check('owner coordination also counted as owner draws',()=>assert.equal(owner.ownerDrawTotalForEvent({rows:[storm,row],coordinatorPayments:[{coordinatorName:'Storm Leigh',payableAmount:75}]},pay),425));
const client=fs.readFileSync(path.join(root,'app/payroll/payroll-client.tsx'),'utf8');
const ast=ts.createSourceFile('client.tsx',client,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),functions={};
function walk(n){if(ts.isFunctionDeclaration(n)&&n.name)functions[n.name.text]=n.getText(ast);ts.forEachChild(n,walk);}walk(ast);
async function yearRace(){
 const responses=new Map(),state={year:2026,message:''};
 const ctx={yearRequest:{current:0},year:2026,loadedYears:new Set(),window:{localStorage:{setItem:(k,v)=>{state.saved=v}},location:{href:'https://example.com/payroll'},history:{replaceState:(_,__,url)=>{state.url=String(url)}}},URL,
 setYear:v=>{state.year=v},setYearOptions:()=>{},setExpandedPaidEventIds:()=>{},setPaidShowsOpen:()=>{},setPaidShowsVisible:()=>{},setTaxCenterOpen:()=>{},setOpenRows:()=>{},setLoadingYear:()=>{},setMessage:v=>{state.message=v},setAttemptedYears:()=>{},setYearLoadProgress:()=>{},setRows:()=>{},setEventSummaries:()=>{},setDiagnostics:()=>{},setLoadedYears:()=>{},setYearErrors:()=>{},
 fetchPayrollRequest:url=>new Promise(resolve=>responses.set(Number(new URL(url,'https://example.com').searchParams.get('year')),resolve)),readPayrollResponse:async response=>response.result,eventPayrollIsFullyPaid:()=>true};
 vm.createContext(ctx);vm.runInContext(js(functions.selectPayrollYear),ctx);
 const old=vm.runInContext('selectPayrollYear(2025)',ctx),latest=vm.runInContext('selectPayrollYear(2027)',ctx);
 responses.get(2027)({ok:true,result:{loadedYear:2027,eventSummaries:[]}});await latest;
 responses.get(2025)({ok:true,result:{loadedYear:2025,eventSummaries:[]}});await old;
 check('slow older response cannot restore previous selected year',()=>assert.equal(state.year,2027));
 check('selected year stored and included in refresh URL',()=>{assert.equal(state.saved,'2027');assert.ok(state.url.includes('year=2027'));});
 const failed=vm.runInContext('selectPayrollYear(2028)',ctx);responses.get(2028)({ok:false,result:{message:'Load failed'}});await failed;
 check('failed year request does not silently revert year',()=>assert.equal(state.year,2028));
 const pending=vm.runInContext('selectPayrollYear(2020)',ctx);ctx.loadedYears.add(2029);await vm.runInContext('selectPayrollYear(2029)',ctx);responses.get(2020)({ok:true,result:{loadedYear:2020,eventSummaries:[]}});await pending;
 check('choosing a cached year invalidates earlier in-flight selection',()=>assert.equal(state.year,2029));
}
async function bulk(){let calls=[],message='';const ctx={eventDateDrafts:{show:'2027-01-05'},payrollScheduledBy:schedule.payrollScheduledBy,validPayrollDate:schedule.validPayrollDate,paymentStatusFor:r=>r.paymentStatus,setMessage:v=>{message=v},setSavingScheduledShowId:()=>{},setRowDateDrafts:()=>{},saveStatus:async(row,changes)=>{calls.push(changes);return row.crewId!=='fail';}};vm.createContext(ctx);vm.runInContext(js(functions.markEvent+'\n'+functions.applyScheduledForToEvent),ctx);ctx.event={showId:'show',showName:'Show',rows:[row]};await vm.runInContext('markEvent(event,"scheduled")',ctx);check('Scheduled action uses top event date and manual mode',()=>{assert.equal(calls[0].scheduled_for,'2027-01-05');assert.equal(calls[0].schedule_mode,'manual');assert.equal(calls[0].payment_status,'scheduled');});calls=[];ctx.event.rows=[{...row,crewId:'fail'},row];await vm.runInContext('applyScheduledForToEvent(event,"2027-01-05")',ctx);check('bulk date update stops on a failed save instead of claiming success',()=>{assert.equal(calls.length,1);assert.ok(!message.includes('date applied'));});
 calls=[];ctx.event.rows=[row];ctx.event.coordinatorPayment={coordinatorUserId:'owner',paymentStatus:'paid'};ctx.saveCoordinatorPayment=async(event,changes)=>{calls.push(changes);return true;};await vm.runInContext('applyScheduledForToEvent(event,"2027-01-05")',ctx);
 check('top date includes coordinator and preserves already-paid status',()=>{assert.equal(calls.length,2);assert.equal(calls[1].scheduled_for,'2027-01-05');assert.equal(calls[1].payment_status,'paid');});}

(async()=>{await yearRace();await bulk();console.log(passed+' scheduling and owner-draw checks passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
