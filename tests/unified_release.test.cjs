'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup() {
  const data={},requests=[],cells={};let response=204;
  const c={console,Date,Number,JSON,Error,Utilities:{getUuid:()=> 'request-123'},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>data[k]||null,setProperty:(k,v)=>{data[k]=v;}})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    UrlFetchApp:{fetch:(url,options)=>{requests.push({url,options});return {getResponseCode:()=>response,getContentText:()=> '{}'};}},
    cmsUnifiedBook_:()=>({getSheetByName:()=>({getRange:k=>({setValue:v=>{cells[k]=v;}})})})};
  vm.createContext(c);vm.runInContext(fs.readFileSync('cms/unified/Release.gs','utf8'),c);
  return {c,data,requests,cells,setResponse:n=>{response=n;}};
}
function candidate(){return {schema:1,repository:'ponnhide/yachielab-preview',branch:'codex/preview',commit:'a'.repeat(40),runId:'123',runAttempt:1,contentHash:'b'.repeat(64)};}
test('release API permits production workflow dispatch, never production content writes or arbitrary hosts',()=>{
  const {c,data,requests}=setup();data.PRODUCTION_GITHUB_TOKEN='test-only';
  for(const args of [['evil/repo','/actions/workflows/production-release.yml/dispatches','post',{}],['yachielab/yachielab.github.io','/contents/index.html','put',{}],['ponnhide/yachielab-preview','/actions/workflows/production-release.yml/dispatches','post',{}]])assert.throws(()=>c.cmsReleaseApi_(...args));
  assert.equal(requests.length,0);
  const body={ref:'main',inputs:{preview_commit:'a'.repeat(40),preview_run_id:'123',request_id:'request-1',dry_run:'false'}};
  c.cmsReleaseApi_('yachielab/yachielab.github.io','/actions/workflows/production-release.yml/dispatches','post',body);
  assert.equal(requests.length,1);assert.equal(requests[0].options.followRedirects,false);
  for(const changes of [{preview_commit:'main'},{preview_run_id:'../123'},{dry_run:'yes'},{extra:'untrusted'}])assert.throws(()=>c.cmsReleaseApi_('yachielab/yachielab.github.io','/actions/workflows/production-release.yml/dispatches','post',{ref:'main',inputs:{...body.inputs,...changes}}));
});
test('confirmation pins a version and refuses a changed preview',()=>{
  const {c,data,requests}=setup();data.PRODUCTION_GITHUB_TOKEN='test-only';c.cmsReleaseCandidate_=()=>({...candidate(),commit:'c'.repeat(40)});
  assert.throws(()=>c.cmsReleaseStart_(candidate(),false),/プレビューが更新/);assert.equal(requests.length,0);
});
test('publication confirmation states whole-site scope and cancellation never dispatches',()=>{
  const {c,data,requests}=setup(),alerts=[];data.PRODUCTION_GITHUB_TOKEN='test-only';
  c.cmsReleaseCandidate_=candidate;
  c.SpreadsheetApp={getUi:()=>({ButtonSet:{YES_NO:'yes-no',OK:'ok'},Button:{YES:'yes'},alert:(...args)=>{alerts.push(args);return 'no';}})};
  assert.equal(c.cmsProductionAction().cancelled,true);
  assert.equal(alerts[0][0],'Publish entire preview to production');
  assert.match(alerts[0][1],/entire preview site, including changes on other pages, not just the current sheet/);
  assert.match(alerts[0][1],/Sheet edits that have not been deployed to preview are excluded/);
  assert.ok(alerts[0][1].includes(candidate().commit));
  assert.equal(requests.length,0);assert.equal(data.UNIFIED_PRODUCTION_REQUEST,undefined);
});
test('dispatch contains only the fixed preview version and dry-run flag, no current Sheet content',()=>{
  const {c,data,requests}=setup();data.PRODUCTION_GITHUB_TOKEN='test-only';c.cmsReleaseCandidate_=candidate;
  const record=c.cmsReleaseStart_(candidate(),true);
  assert.equal(record.dryRun,true);assert.equal(requests.length,1);
  assert.deepEqual(JSON.parse(requests[0].options.payload),{ref:'main',inputs:{preview_commit:'a'.repeat(40),preview_run_id:'123',request_id:'request-123',dry_run:'true'}});
  assert.equal(JSON.parse(data.UNIFIED_PRODUCTION_REQUEST).finished,false);
});
test('HTTP rejection can be retried after fixing credentials; uncertain dispatch is not duplicated',()=>{
  const {c,data,setResponse}=setup();data.PRODUCTION_GITHUB_TOKEN='test-only';c.cmsReleaseCandidate_=candidate;
  setResponse(403);assert.throws(()=>c.cmsReleaseStart_(candidate(),false),/403/);assert.equal(JSON.parse(data.UNIFIED_PRODUCTION_REQUEST).finished,true);
  c.cmsReleasePending_=()=>null;setResponse(500);assert.throws(()=>c.cmsReleaseStart_(candidate(),false),/500/);assert.equal(JSON.parse(data.UNIFIED_PRODUCTION_REQUEST).finished,false);
});
test('run validation rejects skipped deploy, wrong workflow, failed checks and wrong revision',()=>{
  const {c}=setup(),marker=candidate();
  const run={id:123,head_sha:marker.commit,head_branch:'codex/preview',event:'push',path:'.github/workflows/checks.yml',status:'completed',conclusion:'success',run_attempt:1,repository:{full_name:marker.repository},head_repository:{full_name:marker.repository}};
  const jobs={jobs:[{name:'Deploy checked preview',conclusion:'success'}]};
  c.cmsReleaseValidateRun_(marker,run,jobs);
  for(const change of [{conclusion:'failure'},{path:'evil.yml'},{head_sha:'c'.repeat(40)},{event:'pull_request'}])assert.throws(()=>c.cmsReleaseValidateRun_(marker,{...run,...change},jobs));
  assert.throws(()=>c.cmsReleaseValidateRun_(marker,run,{jobs:[{name:'Deploy checked preview',conclusion:'skipped'}]}));
});

test('initialization checkpoints pages, retries a failure, and resumes through shared components',()=>{
  const {c,data}=setup();data.PREVIEW_GITHUB_TOKEN='test-only';
  let elapsed=0,fail=true,shown=0,released=0;const calls=[];
  c.Date={now:()=>elapsed};
  c.LockService.getDocumentLock=()=>({tryLock:()=>true,releaseLock:()=>released++});
  c.cmsContext_=()=>({pages:['news','people']});
  c.cmsRun_=work=>work();
  c.cmsUpdateTab_=page=>{calls.push(page);if(page==='people'&&fail)throw new Error('source unavailable');elapsed+=95000;return {changed:true};};
  c.update_shared_components=()=>{calls.push('shared');return {changed:true};};
  c.cmsUnifiedShowStatus_=()=>shown++;
  assert.equal(c.cmsInitializeUnifiedPreview().complete,false);
  assert.equal(JSON.parse(data.UNIFIED_INITIALIZE_STATE).next,1);
  assert.throws(()=>c.cmsReleaseCandidate_(),/初回生成/);
  assert.throws(()=>c.cmsInitializeUnifiedPreview(),/source unavailable/);
  assert.equal(JSON.parse(data.UNIFIED_INITIALIZE_STATE).next,1);
  fail=false;
  assert.equal(c.cmsInitializeUnifiedPreview().complete,false);
  assert.equal(c.cmsInitializeUnifiedPreview().complete,true);
  assert.deepEqual(calls,['news','people','people','shared']);
  assert.equal(shown,0);assert.equal(released,4);
  assert.equal(c.cmsInitializeUnifiedPreview().complete,true);
  assert.deepEqual(calls,['news','people','people','shared']);
});

test('initialization rejects a second concurrent setup execution',()=>{
  const {c,data}=setup();data.PREVIEW_GITHUB_TOKEN='test-only';
  c.LockService.getDocumentLock=()=>({tryLock:()=>false,releaseLock(){}});
  assert.throws(()=>c.cmsInitializeUnifiedPreview(),/既に実行中/);
  assert.equal(data.UNIFIED_INITIALIZE_STATE,undefined);
});

test('editor connection check polls its existing dry run without duplicate dispatch or UI',()=>{
  const {c,data,requests}=setup();data.PRODUCTION_GITHUB_TOKEN='test-only';c.cmsReleaseCandidate_=candidate;
  c.cmsUnifiedShowStatus_=()=>{throw new Error('No editor UI');};
  const record=c.cmsValidateProductionConnection();assert.equal(record.dryRun,true);assert.equal(requests.length,1);
  c.cmsReleasePending_=()=>({done:false,message:'running'});
  assert.equal(c.cmsValidateProductionConnection().done,false);assert.equal(requests.length,1);
  data.UNIFIED_PRODUCTION_REQUEST=JSON.stringify({...record,finished:true,conclusion:'validated'});
  assert.equal(c.cmsValidateProductionConnection().done,true);assert.equal(requests.length,1);
});

test('native update status distinguishes pending deployment from verified completion',()=>{
  const {c}=setup(),alerts=[];
  c.SpreadsheetApp={getUi:()=>({ButtonSet:{OK:'ok'},alert:(...args)=>alerts.push(args)})};
  c.cmsUnifiedPoll=()=>({done:false,message:'GitHub保存済み'});
  assert.equal(c.cmsUnifiedShowStatus_('preview').done,false);
  assert.match(alerts[0][1],/継続しています/);assert.match(alerts[0][1],/ponnhide.github.io/);
  c.cmsUnifiedPoll=()=>({done:true,message:'プレビュー公開完了',url:'https://ponnhide.github.io/yachielab-preview/'});
  c.cmsUnifiedShowStatus_('preview');assert.doesNotMatch(alerts[1][1],/継続しています/);
});
