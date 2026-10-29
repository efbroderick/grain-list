const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function client() {
  const nodes=new Map(),fields=new Map(),calls=[],pending=[];
  const node=key=>{if(!nodes.has(key))nodes.set(key,{value:'',textContent:'',innerHTML:'',hidden:true,disabled:false,dataset:{},addEventListener(){},setAttribute(){}});return nodes.get(key);};
  const field=name=>{if(!fields.has(name))fields.set(name,{value:'',checked:false});return fields.get(name);};
  const root={querySelector:s=>s==='#ga-publish'||s==='#ga-confirm-removal'?null:node(s),querySelectorAll:()=>[],addEventListener(){}};
  node('#ga-form').elements={namedItem:field};node('#ga-form').reportValidity=()=>true;
  const runner=(success,failure)=>new Proxy({}, {get(_,key){if(key==='withSuccessHandler')return fn=>runner(fn,failure);if(key==='withFailureHandler')return fn=>runner(success,fn);return (...args)=>{calls.push({method:key,args});pending.push({resolve:success,reject:failure});};}});
  const context={document:{querySelector:()=>root},window:{google:{script:{run:runner(()=>{},()=>{})}},addEventListener(){},confirm:()=>true},crypto,URL,console,setTimeout(){return 1;},clearTimeout(){}};
  const source=fs.readFileSync(path.join(__dirname,'../admin/apps-script/Client.html'),'utf8').replace(/^<script>\s*/,'').replace(/<\/script>\s*$/,'').replace('action(()=>load());icons();',`window.test={save,check,go,readForm,getState:()=>state,getEditing:()=>editing,getDirty:()=>dirty,getView:()=>currentView,setContext:(value)=>{state=value.state||state;editing=value.editing;editorSession=value.session;currentView=value.view||'editor';viewRevision++;dirty=true;}};`);
  vm.runInNewContext(source,context);
  const api=context.window.test,state={records:[],drafts:[],published:[],activity:[]};
  function open(id,session=1){field('name').value=id;field('operationalStatus').value='Active';api.setContext({state,editing:{draftId:id,version:0,recordId:'org-'+id,baseRevision:'base'},session});}
  function finish(index=0){const payload=calls[index].args[0];pending[index].resolve({...payload,version:1,state:'Draft',updatedAt:'2026-10-28T00:00:00Z'});}
  return {api,state,open,field,calls,pending,finish,node};
}
test('late draft completion cannot navigate away from or overwrite another editor',async()=>{
  const c=client();c.open('first');const saving=c.api.save(true);assert.equal(c.node('#ga-save').disabled,true);
  c.open('second',2);c.field('email').value='new@second.test';c.finish();await saving;
  assert.equal(c.api.getEditing().draftId,'second');assert.equal(c.api.getDirty(),true);assert.equal(c.api.getView(),'editor');assert.equal(c.field('email').value,'new@second.test');assert.equal(c.state.drafts[0].draftId,'first');assert.equal(c.node('#ga-save').disabled,false);
});
test('typing during a save retains the newer unsaved changes and advances draft version',async()=>{
  const c=client();c.open('first');const saving=c.api.save(true);c.field('name').value='Later edit';c.finish();await saving;
  assert.equal(c.api.getDirty(),true);assert.equal(c.api.getEditing().version,1);assert.equal(c.field('name').value,'Later edit');assert.equal(c.api.getView(),'editor');
});
test('a saved draft does not force navigation and duplicate clicks make one request',async()=>{
  const c=client();c.open('first');const saving=c.api.save();assert.equal(await c.api.save(),null);assert.equal(c.calls.length,1);c.finish();await saving;
  assert.equal(c.api.getDirty(),false);assert.equal(c.api.getView(),'editor');assert.equal(c.node('#ga-save').disabled,false);
});
test('failed saves retain an immutable payload for retry after another record is opened',async()=>{
  const c=client();c.open('first');const data=c.api.readForm(),payload={...c.api.getEditing(),data};const saving=c.api.save();c.open('second',2);c.pending[0].reject(new Error('Temporary outage'));await saving;
  assert.match(c.node('#ga-work').innerHTML,/Retry save/);const retry=c.api.save(false,{payload,session:1});c.finish(1);await retry;
  assert.equal(c.calls[1].args[0].data.name,'first');assert.equal(c.api.getEditing().draftId,'second');assert.equal(c.state.drafts.length,1);
});
test('background publication completion updates status without a full reload or navigation',async()=>{
  const c=client();c.open('second',2);c.state.drafts.push({recordId:'org-first',state:'Saved to master'});const checking=c.api.check('request');
  c.pending[0].resolve({status:'Published',recordId:'org-first',publicId:'grain-first',published:{id:'grain-first',name:'First'}});await checking;
  assert.deepEqual(c.calls.map(c=>c.method),['getAdminPublicationStatus']);assert.equal(c.api.getView(),'editor');assert.equal(c.api.getDirty(),true);assert.equal(c.api.getEditing().draftId,'second');assert.equal(c.state.drafts[0].state,'Published');
});
