'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../../cms/Pages.gs'),'utf8');
function fixture(options={}) {
 const state={events:[],copies:0,sheets:[],active:'existing',registry:[['Affiliation','Language','','','Page','','','','Journal'],['All','Common','','','research','','','','Existing journal'],['UBC','English','','','','','','','Another journal']],formulaRows:new Set(options.formulaRows||[]),restrictedRows:new Set(options.restrictedRows||[]),rows:[['Lab','Language','Function','Parameter1','Parameter2'],['UBC','English','H1','=lookup-title','=lookup-style'],['Osaka','English','H2','=lookup-title2','=lookup-style2'],['','','','=next-parameter','=next-style']]};
 const templateOriginal=JSON.stringify(state.rows),metadata={formats:'original',validation:'native dropdowns',widths:[100,100,160]};
 function sourceSheet(name,rows,meta) {
  const sheet={getName:()=>name,setName(n){if(options.renameFailure)throw Error('rename failed');name=n;return sheet;},showSheet(){return sheet;},getSheetId:()=>1234,
   getRange(r,c,height=1,width=1){return {
    getDisplayValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>rows[r+i-1]?.[c+j-1]||'')),
    setValues(values){values.forEach((v,i)=>v.forEach((x,j)=>{(rows[r+i-1]||=[])[c+j-1]=x;}));},
    clearContent(){for(let i=0;i<height;i++)for(let j=0;j<width;j++)rows[r+i-1][c+j-1]='';},
    setRichTextValue(v){rows[r-1][c-1]=v.text;state.literalTitle=v.text;},
   };},
   copyTo(target){assert.equal(target,book);state.events.push('copy');state.copies++;const clone=sourceSheet('Copy of template',JSON.parse(JSON.stringify(rows)),JSON.parse(JSON.stringify(meta)));state.copy=clone;state.copyRows=clone.rows;state.sheets.push(clone);return clone;},rows,metadata:meta
  };return sheet;
 }
 const template=sourceSheet('template',state.rows,metadata);
 const registry={getMaxRows:()=>state.registry.length,
  getRange(r,c,height=1,width=1){assert.equal(c,5);assert.equal(width,1);return {
   getValues:()=>Array.from({length:height},(_,i)=>[state.registry[r+i-1]?.[4]||'']),
   getFormulas:()=>Array.from({length:height},(_,i)=>[state.formulaRows.has(r+i)?'=empty()':'']),
   getValue:()=>state.registry[r-1]?.[4]||'',getFormula:()=>state.formulaRows.has(r)?'=empty()':'',getDataValidation:()=>state.restrictedRows.has(r)?{}:null,
   setValue(v){if(options.registrationFailure)throw Error('registry write failed');state.events.push('register');state.registry[r-1][4]=v;state.registrationRow=r;}
  };}
 };
 const book={getId:()=>options.wrongBook?'production':'preview',getSheets:()=>[template,...state.sheets],getSheetByName:n=>n==='template'?template:n==='item list'?registry:null,setActiveSheet(s){state.active=s.getName();}};
 const responses=(options.responses||[{button:'OK',text:'new-page'},{button:'OK',text:'New page'}]).slice();
 const ui={Button:{OK:'OK'},ButtonSet:{OK_CANCEL:'OK_CANCEL',OK:'OK'},prompt(){state.events.push('prompt');const r=responses.shift();return {getSelectedButton:()=>r.button,getResponseText:()=>r.text};},alert(){state.events.push('alert');}};
 const context={PREVIEW_SPREADSHEET_ID:'preview',PREVIEW_SITE_URL:'https://ponnhide.github.io/yachielab-preview',CMS_CONTEXT_:null,
  SpreadsheetApp:{getActiveSpreadsheet:()=>book,getUi:()=>ui,flush(){state.events.push('flush');},newRichTextValue(){return{setText(t){this.text=t;return this;},build(){return {text:this.text};}};}},
  LockService:{getScriptLock(){return{tryLock(){state.events.push('lock');return true;},releaseLock(){state.events.push('unlock');}};}},
  cmsContext_(){assert.equal(book.getId(),'preview');return{spreadsheet:book,pages:options.pages||['research'],parameters:{H1:['Lab','Language','Function','/* Title']}};},
  cmsSheetRows_(){return{values:state.registry};},cmsGithubSnapshot_(){state.events.push('snapshot');return{entries:options.entries||{}};}
 };
 vm.createContext(context);vm.runInContext(code,context);return{state,context,templateOriginal,metadata};
}
test('a page draft copies native structure and registers only the Page cell',()=>{
 const f=fixture();const before=JSON.parse(JSON.stringify(f.state.registry));const result=f.context.cmsCreatePageTab_('new-page','=Literal title');
 assert.equal(f.state.copies,1);assert.equal(JSON.stringify(f.state.rows),f.templateOriginal);assert.deepEqual(f.state.copy.metadata,f.metadata);
 assert.deepEqual(f.state.copyRows[1].slice(0,4),['All','Common','H1','=Literal title']);assert.deepEqual(f.state.copyRows[2].slice(0,3),['','','']);
 assert.equal(f.state.copyRows[2][3],'=lookup-title2');assert.equal(f.state.copyRows[3][3],'=next-parameter');
 before[2][4]='new-page';assert.deepEqual(f.state.registry,before);assert.equal(f.state.active,'new-page');assert.equal(result.url,'https://ponnhide.github.io/yachielab-preview/new-page.html');
});
test('reserved, unsafe, duplicate-tab and duplicate-HTML names stop before a copy',()=>{
 for(const n of ['index','blank','404','header','template','_cms_cache','name_old','../x','bad.html','UpperCase']){const f=fixture();assert.throws(()=>f.context.cmsCreatePageTab_(n,'Title'));assert.equal(f.state.copies,0);}
 const registered=fixture({pages:['research']});assert.throws(()=>registered.context.cmsCreatePageTab_('research','Title'),/already/);
 const tab=fixture();tab.state.sheets.push({getName:()=> 'New-Page'});assert.throws(()=>tab.context.cmsCreatePageTab_('new-page','Title'),/already/);assert.equal(tab.state.copies,0);
 const html=fixture({entries:{'NEW-PAGE.html':{type:'blob'}}});assert.throws(()=>html.context.cmsCreatePageTab_('new-page','Title'),/already/);assert.equal(html.state.copies,0);
});
test('registration skips formulas and restricted cells without altering independent lists',()=>{
 const f=fixture({formulaRows:[3],restrictedRows:[4]});f.state.registry.push(['All','Common','','','','','','','Third journal'],['All','Common','','','','','','','Fourth journal']);
 f.context.cmsCreatePageTab_('new-page','Title');assert.equal(f.state.registrationRow,5);assert.equal(f.state.registry[2][4],'');assert.equal(f.state.registry[3][4],'');assert.equal(f.state.registry[4][8],'Fourth journal');
});
test('cancelled dialogs perform no I/O and the lock starts after both dialogs close',()=>{
 for(const responses of [[{button:'CANCEL',text:''}],[{button:'OK',text:'new-page'},{button:'CANCEL',text:''}]]){const f=fixture({responses});f.context.create_page();assert.equal(f.state.copies,0);assert(!f.state.events.includes('lock'));assert(!f.state.events.includes('snapshot'));}
 const f=fixture();f.context.create_page();assert.deepEqual(f.state.events.slice(0,3),['prompt','prompt','lock']);assert(f.state.events.indexOf('unlock')<f.state.events.indexOf('alert'));
 const wrong=fixture({wrongBook:true});assert.throws(()=>wrong.context.create_page(),/restricted/);assert.deepEqual(wrong.state.events,[]);
});
test('a failed rename or registry write preserves the new tab for recovery',()=>{
 for(const options of [{renameFailure:true},{registrationFailure:true}]){const f=fixture(options);assert.throws(()=>f.context.cmsCreatePageTab_('new-page','Title'),/kept for recovery/);assert.equal(f.state.copies,1);assert.equal(f.state.registry[2][4],'');assert.equal(JSON.stringify(f.state.rows),f.templateOriginal);}
});
