var ADMIN_SHEET_ID_='1zhNRetv5gNYuaQtlZ8hxsW7GBdX7VpMbSN9boXkuYT8';
var ADMIN_TAB_='Listings';
var DRAFT_TAB_='Admin Drafts';
var ACTIVITY_TAB_='Admin Activity';
var DRAFT_HEADERS_=['Draft ID','Version','Record ID','Public ID','Base Revision','Data','Updated At','State','Live Revision'];
var ACTIVITY_HEADERS_=['Request ID','Record ID','Public ID','Name','Saved At','Status','Payload','Workflow URL','Previous Record'];

function owner_() {
  var active=Session.getActiveUser().getEmail(), effective=Session.getEffectiveUser().getEmail();
  if(!active || !effective || active.toLowerCase()!==effective.toLowerCase())throw new Error('This admin is restricted to its deploying Google account.');
  var configured=PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if(!configured || active.toLowerCase()!==configured.toLowerCase())throw new Error('Set ADMIN_EMAIL to the deploying Google account in Script Properties.');
  return active;
}
function origin_() { return 'https://grain-list.vercel.app'; }
function hash_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value),Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join(''); }
function copy_(o) {return JSON.parse(JSON.stringify(o));}
function sourceRevision_(o) {return hash_(JSON.stringify([o.recordId,o.publicId,o.status,GrainAdminDomain.revision(o,hash_)]));}
function publicRevision_(o) {return hash_(JSON.stringify([o.status||'Partial',GrainAdminDomain.revision(o,hash_)]));}
function lock_(fn) {var lock=LockService.getScriptLock();if(!lock.tryLock(15000))throw new Error('Another save is in progress. Please retry.');try{return fn();}finally{lock.releaseLock();}}
function book_() {return SpreadsheetApp.openById(ADMIN_SHEET_ID_);}
function table_(name) {
  var sheet=book_().getSheetByName(name);if(!sheet)throw new Error('Initialize the admin connection first.');
  // Read through the same API used for writes; SpreadsheetApp caches can hide REST saves.
  SpreadsheetApp.flush();
  var range="'"+name.replace(/'/g,"''")+"'";
  var rows=(sheets_('get','/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE').values||[]).map(function(row){return row.map(function(v){return String(v==null?'':v);});});
  var headers=rows.shift()||[];
  if(!headers.length)throw new Error('The admin Sheet tab has no headers. Initialize its connection first.');
  if(name===ADMIN_TAB_)headers=headers.map(function(h){return h==='Website'?'URL':(h==='Sources'?'Source':h);});
  if(new Set(headers).size!==headers.length)throw new Error('The Sheet has duplicate column names.');
  return {sheet:sheet,headers:headers,rows:rows};
}
function sheets_(method,path,body) {
  var response=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+ADMIN_SHEET_ID_+path,{method:method,headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},contentType:'application/json',payload:body?JSON.stringify(body):undefined,muteHttpExceptions:true});
  if(response.getResponseCode()>=300)throw new Error('Google Sheets could not save this change. No publication was requested.');
  return JSON.parse(response.getContentText()||'{}');
}
function writeCells_(sheet, cells) {
  // Explicit stringValue prevents submitted text from becoming a Sheet formula.
  sheets_('post',':batchUpdate',{requests:cells.map(function(c){return {updateCells:{start:{sheetId:sheet.getSheetId(),rowIndex:c.row,columnIndex:c.col},rows:[{values:[{userEnteredValue:{stringValue:String(c.value==null?'':c.value)}}]}],fields:'userEnteredValue'}};})});
}
function append_(table,values) {
  var range="'"+table.sheet.getName().replace(/'/g,"''")+"'!A1";
  sheets_('post','/values/'+encodeURIComponent(range)+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{values:[values]});
}
function writeRecord_(table,recordId,fields) {
  var key=hash_(recordId), lookup={metadataKey:'grainListRecord',metadataValue:key,locationType:'ROW',visibility:'DOCUMENT'};
  var found=sheets_('post','/developerMetadata:search',{dataFilters:[{developerMetadataLookup:lookup}]}).matchedDeveloperMetadata||[];
  if(found.length>1)throw new Error('This record has duplicate row metadata. Resolve it before saving.');
  if(!found.length) {
    var fresh=readRecords_(null,recordId).records[0];if(!fresh)throw new Error('The source row no longer exists.');
    var created=sheets_('post',':batchUpdate',{requests:[{createDeveloperMetadata:{developerMetadata:{metadataKey:'grainListRecord',metadataValue:key,visibility:'DOCUMENT',location:{dimensionRange:{sheetId:table.sheet.getSheetId(),dimension:'ROWS',startIndex:fresh._row,endIndex:fresh._row+1}}}}}]});
    found=[{developerMetadata:created.replies[0].createDeveloperMetadata.developerMetadata}];
  }
  var filter={developerMetadataLookup:{metadataId:found[0].developerMetadata.metadataId}};
  var response=sheets_('post','/values:batchGetByDataFilter',{dataFilters:[filter],valueRenderOption:'UNFORMATTED_VALUE'}), matched=response.valueRanges||[], values=matched.length===1?matched[0].valueRange.values:[];
  if(!values || values.length!==1 || String(values[0][table.headers.indexOf('Record ID')])!==recordId)throw new Error('The source row moved during identity setup. Reload before saving.');
  var update=table.headers.map(function(h){return Object.prototype.hasOwnProperty.call(fields,h)?String(fields[h]==null?'':fields[h]):null;});
  // Developer metadata follows the organization through Sheet sorting. Null cells are not written.
  sheets_('post','/values:batchUpdateByDataFilter',{valueInputOption:'RAW',data:[{dataFilter:filter,majorDimension:'ROWS',values:[update]}]});
}
function sheetObjects_(table) {return table.rows.map(function(row,index){var o={_row:index+1};table.headers.forEach(function(h,i){o[h]=row[i]||'';});return o;});}
function live_() {
  var response=UrlFetchApp.fetch(origin_()+'/data/organizations.json?admin='+Date.now(),{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('The published directory could not be loaded. Retry before saving.');
  var payload=JSON.parse(response.getContentText());if(!Array.isArray(payload.organizations)||!payload.organizations.length)throw new Error('The published directory is invalid.');
  return payload.organizations;
}
function schema_() {return JSON.parse(HtmlService.createHtmlOutputFromFile('Schema').getContent());}
function readRecords_(table,recordId) {
  table=table||table_(ADMIN_TAB_);var seen={}, publicIds={};
  if(GrainAdminDomain.extraHeaders.some(function(h){return table.headers.indexOf(h)<0;}))throw new Error('Initialize the admin connection first.');
  var rows=sheetObjects_(table).filter(function(r){return r.Name;});
  rows.forEach(function(r){
    if(!r['Record ID'] || seen[r['Record ID']])throw new Error('A source Record ID is missing or repeated. Repair it before editing.');seen[r['Record ID']]=true;
    var id=r['Public ID'] || GrainAdminDomain.publicId(r['Record ID'],hash_);
    if(!/^grain-[a-f0-9]{16}$/.test(id))throw new Error('A Public ID is invalid.');
    if(publicIds[id])throw new Error('Two source rows use the same Public ID. Resolve the identity conflict first.');publicIds[id]=true;
  });
  // A draft only needs the selected record's expensive revision and map hashes.
  var records=rows.filter(function(r){return !recordId||r['Record ID']===recordId;}).map(function(r){
    var id=r['Public ID'] || GrainAdminDomain.publicId(r['Record ID'],hash_);
    var o={recordId:r['Record ID'],publicId:id,_row:r._row,status:r.Status||'Partial'};
    Object.keys(GrainAdminDomain.fields).forEach(function(k){o[k]=r[GrainAdminDomain.fields[k]]||'';});
    ['functions','grains'].forEach(function(k){o[k]=GrainAdminDomain.list(o[k]);});
    o.sources=o.sources.split(/[;\n]/).map(function(s){return s.trim();}).filter(Boolean);
    o.operationalStatus=o.operationalStatus==='Closed'?'Closed':'Active';
    o.location=r.Latitude!==''&&r.Longitude!==''?{lat:Number(r.Latitude),lng:Number(r.Longitude),precision:r['Location Precision']}:null;
    o.locationChecked=!!o.location && r['Map Fingerprint']===hash_(GrainAdminDomain.mapKey(o));
    o.revision=sourceRevision_(o);
    return o;
  });
  var ids=records.map(function(r){return r.publicId;});if(new Set(ids).size!==ids.length)throw new Error('Two source rows use the same Public ID. Resolve the identity conflict first.');
  return {table:table,records:records};
}
function drafts_(table) {return sheetObjects_(table||table_(DRAFT_TAB_)).map(function(r){return {draftId:r['Draft ID'],version:Number(r.Version),recordId:r['Record ID'],publicId:r['Public ID'],baseRevision:r['Base Revision'],data:JSON.parse(r.Data),updatedAt:r['Updated At'],state:r.State,liveRevision:r['Live Revision'],_row:r._row};});}
function doGet() {owner_();return HtmlService.createTemplateFromFile('Index').evaluate().setTitle('Grain List Admin').addMetaTag('viewport','width=device-width, initial-scale=1');}
function getAdminState() {
  var email=owner_(), table=table_(ADMIN_TAB_);
  if(GrainAdminDomain.extraHeaders.some(function(h){return table.headers.indexOf(h)<0;}) || !book_().getSheetByName(DRAFT_TAB_) || !book_().getSheetByName(ACTIVITY_TAB_))return {needsSetup:true,email:email};
  var records=readRecords_(table).records, published=live_();
  return {email:email,records:records,drafts:drafts_(),published:published,unlinked:published.filter(function(o){return !records.some(function(r){return r.publicId===o.id;});}),functions:schema_().allowed_functions,states:GrainAdminDomain.states,sheetUrl:'https://docs.google.com/spreadsheets/d/'+ADMIN_SHEET_ID_+'/edit#gid='+table.sheet.getSheetId(),activity:activity_().slice(-20).reverse().map(function(a){delete a.Payload;return a;})};
}
function initializeAdmin() {
  owner_();return lock_(function(){
    var table=table_(ADMIN_TAB_), published=live_(), source=sheetObjects_(table), byName={}, nameCounts={}, byId={}, byUrl={}, urlCounts={};
    function urlKey(value){return String(value||'').trim().toLowerCase().replace(/^https?:\/\/(?:www\.)?/,'').replace(/\/$/,'');}
    published.forEach(function(o){var k=GrainAdminDomain.identity(o);byName[k]=(byName[k]||[]).concat([o]);});
    published.forEach(function(o){byId[o.id]=o;var k=urlKey(o.url);if(k)byUrl[k]=(byUrl[k]||[]).concat([o]);});
    source.forEach(function(r){if(r.Name){var k=GrainAdminDomain.identity({name:r.Name,state:r.State});nameCounts[k]=(nameCounts[k]||0)+1;var u=urlKey(r.URL);if(u)urlCounts[u]=(urlCounts[u]||0)+1;}});
    var required=['Name','Category','State','Function','Grains','Address','Phone','Email','URL','Source','Record ID'];
    if(required.some(function(h){return table.headers.indexOf(h)<0;}))throw new Error('The Organizations headers do not match the publication source.');
    var headers=table.headers.concat(GrainAdminDomain.extraHeaders.filter(function(h){return table.headers.indexOf(h)<0;})), cells=[];
    if(table.sheet.getMaxColumns()<headers.length)table.sheet.insertColumnsAfter(table.sheet.getMaxColumns(),headers.length-table.sheet.getMaxColumns());
    headers.forEach(function(h,i){if(i>=table.headers.length)cells.push({row:0,col:i,value:h});});
    var seen={}, seenRaw={}, seeded=0;
    source.forEach(function(r){
      if(!r.Name)return;
      var k=GrainAdminDomain.identity({name:r.Name,state:r.State}), match=(byName[k]||[]).length===1&&nameCounts[k]===1?byName[k][0]:null;
      var raw=r['Record ID']||'org-'+Utilities.getUuid(), hashed=GrainAdminDomain.publicId(raw,hash_), u=urlKey(r.URL);
      if(byId[hashed])match=byId[hashed];
      if(!match && u && urlCounts[u]===1 && (byUrl[u]||[]).length===1 && byUrl[u][0].state===r.State)match=byUrl[u][0];
      var id=r['Public ID']||(match?match.id:hashed);
      if(!/^grain-[a-f0-9]{16}$/.test(id))throw new Error('An existing Public ID is invalid: '+r.Name);
      if(seen[id]||seenRaw[raw])throw new Error('An ambiguous duplicate needs review: '+r.Name);seen[id]=true;seenRaw[raw]=true;
      [['Record ID',raw],['Public ID',id]].forEach(function(pair){if(!r[pair[0]])cells.push({row:r._row,col:headers.indexOf(pair[0]),value:pair[1]});});
      if(!r.Status)cells.push({row:r._row,col:headers.indexOf('Status'),value:match?match.status||'Partial':'Partial'});
      if(!r['Operational Status'])cells.push({row:r._row,col:headers.indexOf('Operational Status'),value:'Active'});
      if(match && match.location && !r.Latitude && !r.Longitude && GrainAdminDomain.key(r.Address)===GrainAdminDomain.key(match.address) && r.State===match.state) {
        var identity={name:r.Name,state:r.State,address:r.Address,location:match.location};
        [['Latitude',match.location.lat],['Longitude',match.location.lng],['Location Precision',match.location.precision],['Map Fingerprint',hash_(GrainAdminDomain.mapKey(identity))],['City',r.City||match.city||'']].forEach(function(pair){cells.push({row:r._row,col:headers.indexOf(pair[0]),value:pair[1]});});seeded++;
      }
    });
    // Validate the complete identity plan before the first write.
    for(var i=0;i<cells.length;i+=300)writeCells_(table.sheet,cells.slice(i,i+300));
    [[DRAFT_TAB_,DRAFT_HEADERS_],[ACTIVITY_TAB_,ACTIVITY_HEADERS_]].forEach(function(pair){
      var sheet=book_().getSheetByName(pair[0]);if(!sheet){sheet=book_().insertSheet(pair[0]);sheet.getRange(1,1,1,pair[1].length).setValues([pair[1]]);sheet.setFrozenRows(1);}
    });
    return {initialized:true,locationsRetained:seeded};
  });
}
function saveAdminDraft(request) {
  owner_();return lock_(function(){
    var input=request||{}, current=input.recordId?readRecords_(null,input.recordId):{records:[]}, data=GrainAdminDomain.normalize(input.data,schema_().allowed_functions,true), table=table_(DRAFT_TAB_), draftList=drafts_(table);
    var prior=draftList.find(function(d){return d.draftId===input.draftId;}), row=current.records.find(function(r){return r.recordId===input.recordId;});
    if(input.recordId && !row && !prior)throw new Error('This source record no longer exists. Reload the directory.');
    if(row && row.revision!==input.baseRevision)throw new Error('The Google Sheet changed since you opened this record. Reload before saving.');
    if(input.draftId && !/^[a-f0-9-]{36}$/.test(input.draftId))throw new Error('Invalid draft identity.');
    if(prior && prior.version!==input.version) {
      // Repeating the same acknowledged-or-lost save must not create a second draft.
      if(prior.state==='Draft' && prior.version===Number(input.version||0)+1 && prior.baseRevision===(input.baseRevision||'') && JSON.stringify(prior.data)===JSON.stringify(data)) {
        prior.publishedBefore=live_().find(function(o){return o.id===prior.publicId;})||null;return prior;
      }
      throw new Error('This draft changed in another tab. Reload it before saving.');
    }
    var id=prior?prior.recordId:(row?row.recordId:'org-'+Utilities.getUuid()), publicId=prior?prior.publicId:(row?row.publicId:GrainAdminDomain.publicId(id,hash_));
    var publishedBefore=live_().find(function(o){return o.id===publicId;})||null;
    var draft={draftId:prior?prior.draftId:(input.draftId||Utilities.getUuid()),version:prior?prior.version+1:1,recordId:id,publicId:publicId,baseRevision:row?row.revision:'',data:data,updatedAt:new Date().toISOString(),state:'Draft',liveRevision:publishedBefore?publicRevision_(publishedBefore):'new'};
    var values=[draft.draftId,draft.version,id,publicId,draft.baseRevision,JSON.stringify(data),draft.updatedAt,draft.state,draft.liveRevision];
    if(prior)writeCells_(table.sheet,values.map(function(v,i){return {row:prior._row,col:i,value:v};}));else append_(table,values);
    draft.publishedBefore=publishedBefore;return draft;
  });
}
function writeOrganization_(draft,current) {
  var table=current.table, row=current.records.find(function(r){return r.recordId===draft.recordId;}), o=draft.data, fields={};
  Object.keys(GrainAdminDomain.fields).forEach(function(k){var v=o[k];fields[GrainAdminDomain.fields[k]]=Array.isArray(v)?v.join(k==='sources'?'; ':', '):v;});
  Object.assign(fields,{'Record ID':draft.recordId,'Public ID':draft.publicId,'Latitude':o.location?o.location.lat:'','Longitude':o.location?o.location.lng:'','Location Precision':o.location?o.location.precision:'','Map Fingerprint':o.locationChecked?hash_(GrainAdminDomain.mapKey(o)):''});
  if(!row && table.headers.indexOf('Grain List Profile')>=0)fields['Grain List Profile']=origin_()+'/organizations/'+draft.publicId+'/';
  if(row) {
    // Re-resolve the ID immediately before writing; never trust a client row number.
    var fresh=readRecords_(null,draft.recordId).records[0];
    if(!fresh || fresh.revision!==draft.baseRevision)throw new Error('The Sheet changed before save. Reload this draft.');
    writeRecord_(table,draft.recordId,fields);
  } else { fields.Status='Partial';append_(table,table.headers.map(function(h){return fields[h]===undefined?'':fields[h];})); }
  var saved=readRecords_(null,draft.recordId).records[0];
  if(!saved || GrainAdminDomain.revision(saved,hash_)!==GrainAdminDomain.revision(o,hash_))throw new Error('Could not confirm the Sheet save. Reload before retrying; publication has not started.');
  return saved;
}
function github_(path,method,body) {
  var token=PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');if(!token)throw new Error('Publishing is not configured. Set the private GITHUB_TOKEN Script Property.');
  var response=UrlFetchApp.fetch('https://api.github.com/repos/efbroderick/grain-list/'+path,{method:method||'get',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},contentType:'application/json',payload:body?JSON.stringify(body):undefined,muteHttpExceptions:true});
  if(response.getResponseCode()>=300)throw new Error('GitHub could not start or inspect publication. The saved Sheet data is retained. Check the private publishing token.');
  return JSON.parse(response.getContentText()||'{}');
}
function activity_() {return sheetObjects_(table_(ACTIVITY_TAB_));}
function updateActivity_(row,status,url) {var table=table_(ACTIVITY_TAB_);writeCells_(table.sheet,[{row:row,col:table.headers.indexOf('Status'),value:status},{row:row,col:table.headers.indexOf('Workflow URL'),value:url||''}]);}
function publishAdminDraft(request) {
  owner_();return lock_(function(){
    var input=request||{}, draft=drafts_().find(function(d){return d.draftId===input.draftId;});
    if(!draft || draft.version!==input.version)throw new Error('Reload this draft before publishing.');
    var active=PropertiesService.getScriptProperties().getProperty('ACTIVE_PUBLICATION');
    if(active) {var a=JSON.parse(active);if(Date.now()-a.time<20*60*1000)throw new Error('Another publication is in progress. Check its status in Activity before publishing again.');}
    var current=readRecords_(), source=current.records.find(function(r){return r.recordId===draft.recordId;}), data=GrainAdminDomain.normalize(draft.data,schema_().allowed_functions);
    if((source?source.revision:'')!==draft.baseRevision)throw new Error('The source Sheet changed. Reload the organization before publishing.');
    GrainAdminDomain.assertPublish(data,current.records,draft.recordId);
    var published=live_(), before=published.find(function(r){return r.id===draft.publicId;});
    if((before?publicRevision_(before):'new')!==draft.liveRevision)throw new Error('The live listing changed after this draft was reviewed. Reopen it and review the latest changes.');
    if((GrainAdminDomain.cleared(before,data).length || data.operationalStatus==='Closed') && input.confirmRemoval!==true)throw new Error('Confirm removed fields or the closure before publishing.');
    // Refuse to write the master Sheet unless publication is configured.
    if(!PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN'))throw new Error('Publishing is not configured. Your draft is safely saved in Google Sheets.');
    draft.data=data;
    var requestId=Utilities.getUuid(), publicRecord=GrainAdminDomain.toPublic(data,draft.publicId,source?source.status:'Partial');
    var payload={requestId:requestId,upserts:data.operationalStatus==='Closed'?[]:[publicRecord],removals:data.operationalStatus==='Closed'?[draft.publicId]:[]};
    append_(table_(ACTIVITY_TAB_),[requestId,draft.recordId,draft.publicId,data.name,new Date().toISOString(),'Saving master',JSON.stringify(payload),'',JSON.stringify({source:source||null,published:before||null})]);
    var saved=writeOrganization_(draft,current);
    var table=table_(DRAFT_TAB_);draft.baseRevision=saved.revision;draft.state='Saved to master';draft.version++;
    writeCells_(table.sheet,[{row:draft._row,col:table.headers.indexOf('Base Revision'),value:draft.baseRevision},{row:draft._row,col:table.headers.indexOf('State'),value:draft.state},{row:draft._row,col:table.headers.indexOf('Version'),value:draft.version}]);
    var audit=activity_().find(function(a){return a['Request ID']===requestId;});updateActivity_(audit._row,'Saved; not published','');
    PropertiesService.getScriptProperties().setProperty('ACTIVE_PUBLICATION',JSON.stringify({id:requestId,time:Date.now()}));
    try {github_('actions/workflows/admin-publish.yml/dispatches','post',{ref:'main',inputs:{request_id:requestId,publication:JSON.stringify(payload)}});}
    catch(error){PropertiesService.getScriptProperties().deleteProperty('ACTIVE_PUBLICATION');return {requestId:requestId,status:'Saved; not published',message:error.message,draft:draft,record:saved};}
    updateActivity_(audit._row,'Queued','');
    return {requestId:requestId,status:'Queued',draft:draft,record:saved};
  });
}
function getAdminPublicationStatus(requestId) {
  owner_();if(!/^[a-f0-9-]{36}$/.test(String(requestId)))throw new Error('Invalid publication request.');
  return lock_(function(){
    var item=activity_().find(function(a){return a['Request ID']===requestId;});if(!item)throw new Error('Publication not found.');
    var payload=JSON.parse(item.Payload), published=live_(), matches=payload.upserts.every(function(o){var found=published.find(function(p){return p.id===o.id;});return found && publicRevision_(found)===publicRevision_(o);}) && payload.removals.every(function(id){return !published.some(function(p){return p.id===id;});});
    var runs=github_('actions/workflows/admin-publish.yml/runs?event=workflow_dispatch&per_page=30').workflow_runs||[], run=runs.find(function(r){return r.display_title==='Admin publication '+requestId;});
    var status=run && run.status==='completed' && run.conclusion!=='success'?'Publication failed':(matches && run && run.conclusion==='success'?'Published':(run && run.status==='completed'?'Deploying':(run? 'Validating':'Queued')));
    if(['Saving master','Saved; not published'].indexOf(item.Status)>=0 && !run)status='Saved; not published';
    updateActivity_(item._row,status,run?run.html_url:'');
    if(['Published','Publication failed','Saved; not published'].indexOf(status)>=0) {
      var active=PropertiesService.getScriptProperties().getProperty('ACTIVE_PUBLICATION');if(active && JSON.parse(active).id===requestId)PropertiesService.getScriptProperties().deleteProperty('ACTIVE_PUBLICATION');
      if(status==='Published') {var draft=drafts_().find(function(d){return d.recordId===item['Record ID'] && (payload.removals.indexOf(d.publicId)>=0?d.data.operationalStatus==='Closed':GrainAdminDomain.revision(GrainAdminDomain.toPublic(d.data,d.publicId),hash_)===GrainAdminDomain.revision(payload.upserts[0]||{},hash_));});if(draft){var t=table_(DRAFT_TAB_);writeCells_(t.sheet,[{row:draft._row,col:t.headers.indexOf('State'),value:'Published'}]);}}
    }
    return {requestId:requestId,status:status,workflowUrl:run?run.html_url:'',sheetSaved:true,recordId:item['Record ID'],publicId:item['Public ID'],published:status==='Published'?(published.find(function(o){return o.id===item['Public ID'];})||null):null};
  });
}
function lookupAdminAddress(input) {
  owner_();var address=GrainAdminDomain.text(input && input.address,500), state=GrainAdminDomain.text(input && input.state,2);
  if(!address || GrainAdminDomain.states.indexOf(state)<0)throw new Error('Enter the address and state first.');
  var response=UrlFetchApp.fetch('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address='+encodeURIComponent(address+', '+state)+'&benchmark=Public_AR_Current&format=json',{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('Address lookup is unavailable. You can place and confirm the map pin manually.');
  var matches=(JSON.parse(response.getContentText()).result||{}).addressMatches||[];
  return matches.filter(function(m){return m.addressComponents && m.addressComponents.state===state;}).slice(0,5).map(function(m){return {address:m.matchedAddress,location:{lat:m.coordinates.y,lng:m.coordinates.x,precision:'address'}};});
}
