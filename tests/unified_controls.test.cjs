'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const {TARGET,bundle} = require('../scripts/unified_sheet.cjs');
function setup({id=TARGET.spreadsheetId, tab='research', token=true}={}) {
  const calls={items:[],alerts:[],updates:0,properties:{},cells:{}};
  const sheet={getName:()=>tab};
  const status={getRange:a1=>({setValue:value=>{calls.cells[a1]=value;}})};
  const book={getId:()=>id,getActiveSheet:()=>sheet,getSheetByName:()=>status};
  const menu={addItem(label,handler){calls.items.push([label,handler]);return this;},addToUi(){}};
  const ui={ButtonSet:{OK:'OK'},createMenu:name=>{calls.menu=name;return menu;},alert:(...args)=>calls.alerts.push(args)};
  const context={SpreadsheetApp:{getActiveSpreadsheet:()=>book,getUi:()=>ui},PropertiesService:{getScriptProperties:()=>({getProperty:()=>token?'configured':null,setProperty:(k,v)=>{calls.properties[k]=v;}})},cmsUnifiedShowStatus_:()=>{},update_webpage:()=>{calls.updates++;return {changed:true};},console:{warn:()=>{}}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../cms/unified/Release.gs'),'utf8'),context);context.cmsUnifiedShowStatus_=()=>{};vm.runInContext(fs.readFileSync(path.join(__dirname,'../cms/unified/Controls.gs'),'utf8'),context);
  return {context,calls};
}
test('unified menu exposes exactly the two requested actions',()=>{
  const {context,calls}=setup();context.cmsUnifiedOnOpen_();
  assert.equal(calls.menu,'Website');
  assert.deepEqual(calls.items,[['Update preview from current sheet','cmsPreviewAction'],['Publish entire preview to production','cmsProductionAction']]);
});
test('neither original spreadsheet may invoke unified controls',()=>{
  for(const id of ['1TRYhl0WmqhEykYCvFtZzJG4J17YChKiqausAxT8iwHk','1B8zqUodJlrqBv7hkLq8g-Gmb-o0fkkSkj6CfUza1ImI']){
    const {context,calls}=setup({id});
    assert.throws(()=>context.cmsPreviewAction());assert.throws(()=>context.cmsProductionAction());assert.equal(calls.updates,0);
  }
});
test('preview delegates to existing differential updater only with configuration and content tab',()=>{
  const {context,calls}=setup();context.cmsPreviewAction();assert.equal(calls.updates,1);
  for(const options of [{token:false},{tab:'公開状況'},{tab:'parameters'},{tab:'item list'},{tab:'_cms_cache'}]){
    const state=setup(options);state.context.cmsPreviewAction();assert.equal(state.calls.updates,0);assert.equal(state.calls.alerts.length,1);
  }
});
test('production fails closed when no preview has been recorded',()=>{
  const {context,calls}=setup({token:false});const result=context.cmsProductionAction();
  assert.equal(result.published,false);assert.equal(calls.updates,0);
  assert.match(calls.alerts[0][1],/PRODUCTION_GITHUB_TOKEN/);
});
test('GitHub save records an unverified deployment, never a releasable version',()=>{
  const {context,calls}=setup();context.cmsUnifiedPreviewSaved_({commit:'a'.repeat(40)});
  const record=JSON.parse(calls.properties.UNIFIED_PREVIEW_SAVE);assert.equal(record.deploymentVerified,false);assert.equal(record.commit,'a'.repeat(40));assert.match(calls.cells.B7,/未確認/);
});
test('invalid update results do not create a publication record',()=>{
  const {context,calls}=setup();context.cmsUnifiedPreviewSaved_({commit:'not-a-commit'});assert.deepEqual(calls.properties,{});
});
test('bundle changes only the new workbook target and preserves preview repository guard',()=>{
  const built=bundle();assert.match(built.files['PreviewIsolation.gs'],new RegExp(TARGET.spreadsheetId));
  assert.match(built.files['PreviewIsolation.gs'],/ponnhide\/yachielab-preview/);
  assert.match(built.files['Cms.gs'],/function onOpen\(\) \{\n  cmsUnifiedOnOpen_\(\);/);
  assert.match(built.files['Cms.gs'],/cmsUnifiedPreviewSaved_\(result\)/);
  assert.match(built.fingerprint,/^[a-f0-9]{64}$/);
});
