const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('typescript'),crypto=require('crypto');
const root=path.resolve(__dirname,'..');
function load(file,mocks={},globals={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,Error,require:name=>{if(!(name in mocks))throw new Error('Unexpected '+name);return mocks[name]},...globals});return exports;}
const calc=load('lib/payroll-calculations.ts',{'@/lib/rates-types':{halfDayFromFullDay:v=>v/2}}),owner=load('lib/owner-draws.ts'),review=load('lib/purchase-order-review.ts');
const types=load('lib/coordinator-purchase-order-types.ts',{'@/lib/owner-draws':owner});
const sends=[];const service=load('lib/coordinator-purchase-orders.ts',{'crypto':crypto,'@/lib/payroll-calculations':calc,'@/lib/purchase-order-review':review},{process:{env:{ELS_RESEND_API_KEY:'test-only-key',RESEND_EMAIL_DOMAIN:'example.com'}},fetch:async(url,options)=>{sends.push({url,...options,body:JSON.parse(options.body||'{}')});return{ok:true,json:async()=>url.includes('/emails/')?{last_event:'opened'}:{id:'email-id'}}}});
let role='owner',signedIn=true,schemaMissing=false;
const rows=[],claims=new Set();const copy=value=>JSON.parse(JSON.stringify(value));
const matches=(row,column,value)=>{const [head,key]=column.split('->>');return (key?row[head]?.[key]:row[column])===value;};
const db={from(table){let operation='read',patch,filters=[],order,limit=Infinity,cursor;
 const q={select(){return q},eq(k,v){filters.push(row=>matches(row,k,v));return q},in(k,values){filters.push(row=>values.some(v=>matches(row,k,v)));return q},order(k){order=k;return q},limit(n){limit=n;return q},gt(k,v){cursor={k,v};return q},maybeSingle(){operation+=':single';return q},update(value){operation='update';patch=value;return q},delete(){operation='delete';return q},then(resolve,reject){
  if(schemaMissing&&table==='coordinator_purchase_orders')return Promise.resolve({data:null,error:{code:'PGRST205',message:'missing'}}).then(resolve,reject);
  if(!['coordinator_purchase_orders','profiles'].includes(table))throw new Error('Unexpected table mutation/read '+table);
  let data=table==='profiles'?[{id:'coordinator',email:'coordinator@example.com'}]:rows;
  data=data.filter(row=>filters.every(fn=>fn(row))&&(!cursor||row[cursor.k]>cursor.v));if(order)data=[...data].sort((a,b)=>String(a[order]).localeCompare(String(b[order])));data=data.slice(0,limit);
  if(operation.startsWith('update'))for(const row of data)Object.assign(row,copy(patch));
  if(operation==='delete')for(const row of data){rows.splice(rows.indexOf(row),1);for(const line of row.document.showLines)claims.delete(row.coordinator_user_id+':'+line.showId);}
  return Promise.resolve({data:copy(operation.includes('single')?data[0]||null:data),error:null}).then(resolve,reject);
 }};return q;},
 rpc:async(name,args)=>{assert.equal(name,'create_coordinator_purchase_order');if(schemaMissing)return{error:{code:'PGRST202'}};if(args.p_show_ids.some(id=>claims.has(args.p_coordinator+':'+id)))return{error:{code:'23505'}};const at=new Date().toISOString(),row={id:crypto.randomUUID(),coordinator_user_id:args.p_coordinator,token:args.p_token,document:copy(args.p_document),created_by:args.p_created_by,created_at:at,updated_at:at};rows.push(row);for(const id of args.p_show_ids)claims.add(args.p_coordinator+':'+id);return{data:copy(row),error:null}},auth:{admin:{getUserById:async()=>({data:{user:{email:'coordinator@example.com'}},error:null})}}};
const events=[['show1',100],['show2',250]].map(([id,amount])=>({showId:id,showName:'Show '+id,showStart:'2026-11-01',showEnd:'2026-11-02',coordinatorPayments:[{coordinatorUserId:'coordinator',coordinatorName:'Coordinator',payableAmount:amount,paymentStatus:'unpaid',paid:false,fullDayTechDays:5,halfDayTechs:2}]}));
const next={NextResponse:{json:(body,init={})=>({body,status:init.status||200,headers:init.headers})}};
const auth={getSessionUser:async()=>({user:signedIn?{id:'owner'}:null,profile:{role},access:{}}),normalizeRole:v=>v,canUsePage:()=>true};
const api=load('app/api/coordinator-purchase-orders/route.ts',{'next/server':next,'@/lib/auth':auth,'@/lib/supabase-server':{createSupabaseAdminClient:()=>db},'@/lib/payroll-data':{getPayrollSummaryData:async()=>({setupMissing:false,error:null,eventSummaries:copy(events)})},'@/lib/coordinator-purchase-order-types':types,'@/lib/coordinator-purchase-orders':service},{process:{env:{}},URL});
const publicApi=load('app/api/coordinator-purchase-orders/review/route.ts',{'next/server':next,'@/lib/supabase-server':{createSupabaseAdminClient:()=>db},'@/lib/auth':auth,'@/lib/coordinator-purchase-orders':service},{URL});
const post=body=>api.POST({url:'https://example.com/api/coordinator-purchase-orders',json:async()=>body});
const reviewPost=body=>publicApi.POST({json:async()=>body});
let passed=0;function check(name,test){test();passed++;console.log('PASS '+name);}
(async()=>{
 signedIn=false;let result=await post({action:'create'});check('anonymous cannot create documents',()=>assert.equal(result.status,401));
 signedIn=true;role='coordinator';result=await post({action:'create'});check('coordinator cannot create their own payable document',()=>assert.equal(result.status,403));role='owner';
 const selection={year:2026,coordinator_id:'coordinator',show_ids:['show1','show2'],net_days:15};
 result=await post({action:'preview',...selection});check('preview combines authoritative per-show balances',()=>{assert.equal(result.status,200);assert.equal(result.body.quote.total,350);assert.equal(result.body.quote.lines.length,2);});
 result=await post({action:'create',...selection,quote_hash:'stale'});check('stale preview cannot create a PO',()=>assert.equal(result.status,409));
 result=await post({action:'create',...selection,quote_hash:(await post({action:'preview',...selection})).body.hash,total:1,coordinator_email:'attacker@example.com'});
 check('create ignores client totals and recipient overrides',()=>{assert.equal(result.status,200);assert.equal(result.body.order.document.total,350);assert.equal(result.body.order.document.coordinatorEmail,'coordinator@example.com');assert.equal(sends.length,0);});
 let order=result.body.order;const originalToken=order.token;
 result=await post({action:'create',...selection,quote_hash:order.document.quoteHash});check('duplicate selection reports existing PO without creating another',()=>{assert.equal(result.status,409);assert.equal(rows.length,1);});
 events[1].coordinatorPayments[0].payableAmount=275;
 result=await post({action:'send',id:order.id,version:order.updated_at});check('changed live balances block send',()=>{assert.equal(result.status,409);assert.equal(sends.length,0);});
 result=await post({action:'revise',id:order.id,version:order.updated_at,show_ids:['forged']});order=result.body.order;
 check('revision refreshes original shows and keeps claims',()=>{assert.equal(order.document.total,375);assert.equal(order.document.showLines.length,2);assert.equal(claims.size,2);});
 result=await post({action:'send',id:order.id,version:order.updated_at});order=result.body.order;
 check('one email contains every show, total, Net terms and approval link',()=>{assert.equal(result.status,200);assert.equal(sends.length,1);assert.ok(sends[0].body.text.includes('Show show1'));assert.ok(sends[0].body.text.includes('Show show2'));assert.ok(sends[0].body.text.includes('$375.00'));assert.ok(sends[0].body.text.includes('Net 15'));assert.ok(sends[0].body.text.includes('/coordinator-purchase-order/'));assert.equal(sends[0].body.to[0],'coordinator@example.com');});
 result=await post({action:'send',id:order.id,version:order.updated_at});check('repeated send does not email again',()=>{assert.equal(result.status,409);assert.equal(sends.length,1);});
 result=await post({action:'discard',id:order.id,version:order.updated_at});check('sent document cannot be discarded to free duplicate claims',()=>assert.equal(result.status,409));
 result=await publicApi.GET({url:'https://example.com/api/coordinator-purchase-orders/review?token=bad'});check('invalid approval token rejected',()=>assert.equal(result.status,404));
 result=await publicApi.GET({url:'https://example.com/api/coordinator-purchase-orders/review?preview=1&token='+order.token});check('admin preview does not start coordinator review clock',()=>assert.equal(result.body.order.status,'sent_awaiting_delivery'));
 result=await publicApi.GET({url:'https://example.com/api/coordinator-purchase-orders/review?token='+order.token});let pub=result.body.order;
 check('secure public view starts delivery review and hides private email',()=>{assert.equal(result.status,200);assert.equal(pub.status,'delivered');assert.ok(pub.approvalDueAt);assert.equal('coordinatorEmail' in pub,false);assert.equal('coordinatorUserId' in pub,false);});
 result=await reviewPost({token:order.token,revision:0,version:pub.version,action:'approve'});check('stale revision cannot approve',()=>assert.equal(result.status,409));
 result=await reviewPost({token:order.token,revision:pub.revision,version:pub.version,action:'request_changes',change_request:''});check('change request must explain needed correction',()=>assert.equal(result.status,400));
 result=await reviewPost({token:order.token,revision:pub.revision,version:pub.version,action:'request_changes',change_request:'Please fix Show 2'});pub=result.body.order;check('one change request covers complete combined PO',()=>{assert.equal(pub.status,'changes_requested');assert.equal(pub.changeRequest,'Please fix Show 2');});
 order=copy(rows[0]);result=await post({action:'revise',id:order.id,version:order.updated_at});order=result.body.order;
 check('new revision preserves approval URL',()=>{assert.equal(order.token,originalToken);assert.ok(order.document.revision>pub.revision);});
 result=await post({action:'send',id:order.id,version:order.updated_at});order=result.body.order;
 result=await publicApi.GET({url:'https://example.com/api/coordinator-purchase-orders/review?token='+order.token});pub=result.body.order;
 result=await reviewPost({token:order.token,revision:pub.revision,version:pub.version,action:'approve'});pub=result.body.order;
 check('approval records one approval without marking shows paid',()=>{assert.equal(pub.status,'approved');assert.ok(pub.approvedAt);assert.ok(events.every(e=>e.coordinatorPayments[0].paymentStatus==='unpaid'));assert.equal(claims.size,2);});
 order=copy(rows[0]);result=await post({action:'revise',id:order.id,version:order.updated_at});check('approved document cannot be revised',()=>assert.equal(result.status,409));
 await assert.rejects(()=>service.saveCoordinatorOrder(db,{...order,updated_at:'2000-01-01T00:00:00.000Z'},order.document),error=>error.status===409);check('compare-and-swap prevents stale approval overwrite',()=>assert.equal(rows[0].document.status,'approved'));
 // Exercise overdue review with a separate fixture state; no payroll writes exist.
 rows[0].document={...rows[0].document,status:'delivered',approvalDueAt:new Date(Date.now()-1000).toISOString()};order=copy(rows[0]);
 result=await reviewPost({token:order.token,revision:order.document.revision,version:order.updated_at,action:'approve'});
 check('elapsed 48-hour review is auto-approved before late response',()=>{assert.equal(result.status,409);assert.equal(rows[0].document.status,'auto_approved');assert.ok(events.every(e=>!e.coordinatorPayments[0].paid));});
 const quote=types.coordinatorOrderQuote(events,'coordinator',['show1']);
 check('quote sums cents correctly',()=>assert.equal(quote.total,100));
 for(const status of ['paid','zero','owner']){const sample=copy(events);if(status==='paid')sample[0].coordinatorPayments[0].paymentStatus='paid';if(status==='zero')sample[0].coordinatorPayments[0].payableAmount=0;if(status==='owner')sample[0].coordinatorPayments[0].coordinatorName='Storm Leigh';check(status+' balances cannot become coordinator POs',()=>assert.throws(()=>types.coordinatorOrderQuote(sample,'coordinator',['show1'])));}
 const safe=service.coordinatorOrderEmail({...order,document:{...order.document,showLines:[{...order.document.showLines[0],showName:'<script>alert(1)</script>'}]}},'https://example.com');check('email escapes show HTML',()=>{assert.ok(!safe.html.includes('<script>'));assert.ok(safe.html.includes('&lt;script&gt;'));});
 schemaMissing=true;result=await api.GET({url:'https://example.com/api/coordinator-purchase-orders?year=2026'});check('missing migration produces explicit setup action',()=>{assert.equal(result.status,503);assert.ok(result.body.message.includes('coordinator_purchase_orders.sql'));});
 const cron=await service.processCoordinatorPurchaseOrders(db,'https://example.com');check('new schema missing does not break existing email cron',()=>assert.equal(cron.setupMissing,true));
 schemaMissing=false;
 rows[0].document={...rows[0].document,status:'sent_awaiting_delivery',deliveredAt:null,approvalDueAt:null,approvedAt:null,resendEmailId:'email-id',reminderSentAt:null,audit:[]};
 await service.processCoordinatorPurchaseOrders(db,'https://example.com');check('background job recognizes opened email as delivery proof',()=>assert.equal(rows[0].document.status,'delivered'));
 rows[0].document.deliveredAt=new Date(Date.now()-25*60*60*1000).toISOString();rows[0].document.approvalDueAt=new Date(Date.now()+23*60*60*1000).toISOString();
 const mailCount=()=>sends.filter(send=>send.body.to).length;let before=mailCount();
 await service.processCoordinatorPurchaseOrders(db,'https://example.com');check('24-hour reminder is sent and recorded once',()=>{assert.equal(mailCount(),before+1);assert.ok(rows[0].document.reminderSentAt);});
 before=mailCount();await service.processCoordinatorPurchaseOrders(db,'https://example.com');check('repeated cron does not send another reminder',()=>assert.equal(mailCount(),before));
 rows[0].document.approvalDueAt=new Date(Date.now()-1000).toISOString();await service.processCoordinatorPurchaseOrders(db,'https://example.com');check('background job automatically approves overdue combined order',()=>assert.equal(rows[0].document.status,'auto_approved'));
 const fixture=copy(rows[0]);rows.length=0;
 for(let i=0;i<105;i++)rows.push({...copy(fixture),id:crypto.randomUUID(),document:{...copy(fixture.document),status:'delivered',approvedAt:null,deliveredAt:new Date().toISOString(),approvalDueAt:new Date(Date.now()+48*60*60*1000).toISOString(),reminderSentAt:null}});
 const scanned=await service.processCoordinatorPurchaseOrders(db,'https://example.com');check('background job paginates beyond 100 outstanding orders',()=>assert.equal(scanned.checked,105));
 const nextMock={NextResponse:{next:()=>({next:true,cookies:{set:()=>{}}}),redirect:url=>({redirect:String(url)}),json:body=>({body})}};
 const middleware=load('middleware.ts',{'next/server':nextMock,'@supabase/ssr':{createServerClient:()=>({auth:{getUser:async()=>({data:{user:null}})}})}},{process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test'}},Headers});
 class NextUrl extends URL{clone(){return new NextUrl(String(this));}}
 for(const [pathname,isPublic] of [['/api/coordinator-purchase-orders/review',true],['/coordinator-purchase-order/token',true],['/api/coordinator-purchase-orders',false],['/api/coordinator-purchase-orders/review-other',false]]){
 const response=await middleware.middleware({headers:new Headers(),nextUrl:new NextUrl('https://example.com'+pathname),method:'GET',cookies:{getAll:()=>[],get:()=>undefined}});
 check('middleware '+(isPublic?'allows token route ':'protects management route ')+pathname,()=>assert.equal(Boolean(response.next),isPublic));
 }
 console.log(passed+' combined coordinator Purchase Order checks passed; database and email operations mocked.');
})().catch(error=>{console.error(error);process.exitCode=1;});
