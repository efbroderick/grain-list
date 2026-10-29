const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {applyPublication}=require('../../tools/apply_admin_publication.cjs');
const root=path.join(__dirname,'../..'), allowed=require('../../config/functions.json').allowed_functions;
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const domainContext={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(root,'admin/apps-script/Domain.gs'),'utf8'),domainContext);
const domain=domainContext.module.exports;
const data={name:'Sample Farm',category:'Farm',state:'CO',functions:['Grain Grower'],grains:['Hard Red Winter Wheat'],address:'10 Main Street, Denver, CO 80202',city:'Denver',phone:'303-555-1234',email:'hello@sample.test',url:'https://sample.test/',sources:['https://sample.test/products'],operationalStatus:'Active',location:{lat:39.74,lng:-104.99,precision:'address'},locationChecked:true};
const clone=v=>JSON.parse(JSON.stringify(v));

function fixture(options={}) {
  const properties=new Map([['ADMIN_EMAIL','owner@private.test'],['GITHUB_TOKEN','test-only-not-a-credential']]);
  const headers=[...new Set(['Category','Function','Name','State','Grains','Address','Phone','Email','URL','Status','Confidence','Source','Notes','Record ID','Operational Status',...domain.extraHeaders])];
  const rawId='org-001',publicId=domain.publicId(rawId,hash), row={Category:data.category,Function:data.functions.join(', '),Name:data.name,State:data.state,Grains:data.grains.join(', '),Address:data.address,Phone:data.phone,Email:data.email,URL:data.url,Status:'Partial',Confidence:'0.9',Source:data.sources.join('; '),Notes:'Private note preserved','Record ID':rawId,'Operational Status':'Active','Public ID':publicId,City:data.city,Latitude:String(data.location.lat),Longitude:String(data.location.lng),'Location Precision':'address','Map Fingerprint':hash(domain.mapKey(data))};
  const tables=new Map();let nextId=1;
  function addSheet(name,rows) {
    const sheet={id:nextId++,name,rows,getName(){return this.name;},getSheetId(){return this.id;},getMaxColumns(){return Math.max(...this.rows.map(r=>r.length));},insertColumnsAfter(){},setFrozenRows(){},getDataRange(){return {getValues:()=>this.rows.map(r=>[...r])};},getRange(r,c,h,w){return {setValues:values=>{for(let y=0;y<h;y++){this.rows[r-1+y]||=[];for(let x=0;x<w;x++)this.rows[r-1+y][c-1+x]=values[y][x];}}};}};
    tables.set(name,sheet);return sheet;
  }
  addSheet('Listings',[headers,headers.map(h=>row[h]??'')]);
  const draftHeaders=['Draft ID','Version','Record ID','Public ID','Base Revision','Data','Updated At','State','Live Revision'];
  const activityHeaders=['Request ID','Record ID','Public ID','Name','Saved At','Status','Payload','Workflow URL','Previous Record'];
  addSheet('Admin Drafts',[draftHeaders]);addSheet('Admin Activity',[activityHeaders]);
  const env={live:[clone(domain.toPublic(data,publicId,'Partial'))],runs:[],dispatches:[],metadata:[],writes:[],failDispatch:false,lockBusy:false};
  const book={getSheetByName:name=>tables.get(name),insertSheet:name=>addSheet(name,[[]])};
  function reply(value,code=200){return {getResponseCode:()=>code,getContentText:()=>JSON.stringify(value)};}
  const context={console,Set,Map,JSON,Date,Math,Number,String,Object,Array,isFinite,
    Session:{getActiveUser:()=>({getEmail:()=>options.activeEmail===undefined?'owner@private.test':options.activeEmail}),getEffectiveUser:()=>({getEmail:()=> 'owner@private.test'})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k)||null,setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k)})},
    SpreadsheetApp:{openById:()=>book},ScriptApp:{getOAuthToken:()=> 'test-only-google-token'},
    Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]},
    LockService:{getScriptLock:()=>({tryLock:()=>!env.lockBusy,releaseLock(){}})},
    HtmlService:{createHtmlOutputFromFile:()=>({getContent:()=>JSON.stringify({allowed_functions:allowed})}),createTemplateFromFile:()=>({evaluate:()=>({setTitle:()=>({addMetaTag:(name,value)=>({name,value})})})})},
    UrlFetchApp:{fetch(url,opts={}){
      const body=opts.payload?JSON.parse(opts.payload):null;
      if(url.startsWith('https://grain-list.vercel.app/'))return reply({organizations:env.live});
      if(url.includes('api.github.com')){if(url.includes('/dispatches')){if(env.failDispatch)return reply({},403);env.dispatches.push(body);return reply({},204);}return reply({workflow_runs:env.runs});}
      if(url.includes('geocoding.geo.census.gov'))return reply({result:{addressMatches:[]}});
      if(!url.includes('sheets.googleapis.com'))throw new Error('Unexpected test network request');
      if(url.endsWith('/developerMetadata:search'))return reply({matchedDeveloperMetadata:env.metadata.filter(m=>m.metadataValue===body.dataFilters[0].developerMetadataLookup.metadataValue).map(m=>({developerMetadata:m}))});
      if(url.endsWith('/values:batchGetByDataFilter')){const m=env.metadata.find(m=>m.metadataId===body.dataFilters[0].developerMetadataLookup.metadataId);return reply({valueRanges:m?[{valueRange:{values:[m.row]}}]:[]});}
      if(url.endsWith('/values:batchUpdateByDataFilter')){for(const d of body.data){const m=env.metadata.find(m=>m.metadataId===d.dataFilter.developerMetadataLookup.metadataId);d.values[0].forEach((v,i)=>{if(v!==null)m.row[i]=v;});}return reply({});}
      if(url.includes(':append?')){const name=decodeURIComponent(url.split('/values/')[1].split(':append')[0]).match(/^'(.+)'!A1$/)[1];tables.get(name).rows.push(body.values[0].map(String));return reply({});}
      if(url.endsWith(':batchUpdate')){const replies=[];for(const request of body.requests){if(request.updateCells){const u=request.updateCells,s=[...tables.values()].find(s=>s.id===u.start.sheetId);s.rows[u.start.rowIndex]||=[];u.rows[0].values.forEach((v,i)=>s.rows[u.start.rowIndex][u.start.columnIndex+i]=v.userEnteredValue.stringValue);env.writes.push(u);}else if(request.createDeveloperMetadata){const m=request.createDeveloperMetadata.developerMetadata,s=[...tables.values()].find(s=>s.id===m.location.dimensionRange.sheetId);const meta={...m,metadataId:env.metadata.length+1,row:s.rows[m.location.dimensionRange.startIndex]};env.metadata.push(meta);replies.push({createDeveloperMetadata:{developerMetadata:meta}});}}return reply({replies});}
      throw new Error('Unsupported Sheets request in test');
    }}
  };
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'admin/apps-script/Domain.gs'),'utf8'),context);vm.runInContext(fs.readFileSync(path.join(root,'admin/apps-script/Code.gs'),'utf8'),context);
  const state=()=>context.getAdminState();
  const save=(changes={})=>{const r=state().records[0];return context.saveAdminDraft({recordId:r.recordId,baseRevision:r.revision,data:{...data,...changes}});};
  return {context,env,properties,tables,headers,rawId,publicId,state,save};
}

module.exports={fixture,domain,data,hash,allowed,clone,root,applyPublication};
