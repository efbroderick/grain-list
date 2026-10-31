var LOCATION_TAB_='Locations';
var LOCATION_HEADERS_=['Location ID','Organization Record ID','Organization Public ID','Location Name','Type','Address','City','State','Phone','Email','URL','Function','Grains','Source','Operational Status','Latitude','Longitude','Location Precision','Map Fingerprint'];

function locationRows_(recordId) {
  if(!book_().getSheetByName(LOCATION_TAB_))return [];
  var table=table_(LOCATION_TAB_), seen={};
  if(LOCATION_HEADERS_.some(function(h){return table.headers.indexOf(h)<0;}))throw new Error('The Locations tab headers have changed. Restore the documented columns before saving.');
  var rows=sheetObjects_(table).filter(function(r){return r['Location Name'];});
  rows.forEach(function(r){var id=r['Location ID'];if(!/^loc-[a-f0-9]{16}(?:[a-f0-9]{16})?$/.test(id)||seen[id])throw new Error('A Location ID is missing, invalid, or repeated.');seen[id]=true;});
  return rows.filter(function(r){return !recordId||r['Organization Record ID']===recordId;}).map(function(r){
    var id=r['Location ID'];
    var l={id:id,name:r['Location Name'],type:r.Type||'Other',address:r.Address,city:r.City,state:r.State,phone:r.Phone,email:r.Email,url:r.URL,functions:GrainAdminDomain.list(r.Function),grains:GrainAdminDomain.list(r.Grains),sources:r.Source.split(/[;\n]/).map(function(s){return s.trim();}).filter(Boolean),operationalStatus:r['Operational Status']==='Closed'?'Closed':'Active',location:r.Latitude!==''&&r.Longitude!==''?{lat:Number(r.Latitude),lng:Number(r.Longitude),precision:r['Location Precision']}:null};
    l.locationChecked=!!l.location&&r['Map Fingerprint']===hash_(GrainAdminDomain.mapKey(l));
    return {recordId:r['Organization Record ID'],publicId:r['Organization Public ID'],data:l};
  });
}

function ensureLocationTable_() {
  if(!book_().getSheetByName(LOCATION_TAB_)) {
    var sheet=book_().insertSheet(LOCATION_TAB_);sheet.getRange(1,1,1,LOCATION_HEADERS_.length).setValues([LOCATION_HEADERS_]);sheet.setFrozenRows(1);
  }
  return table_(LOCATION_TAB_);
}

function locationFields_(l,draft) {
  return {'Location ID':l.id,'Organization Record ID':draft.recordId,'Organization Public ID':draft.publicId,'Location Name':l.name,Type:l.type,Address:l.address,City:l.city,State:l.state,Phone:l.phone,Email:l.email,URL:l.url,Function:l.functions.join(', '),Grains:l.grains.join(', '),Source:l.sources.join('; '),'Operational Status':l.operationalStatus,Latitude:l.location?l.location.lat:'',Longitude:l.location?l.location.lng:'','Location Precision':l.location?l.location.precision:'','Map Fingerprint':l.locationChecked?hash_(GrainAdminDomain.mapKey(l)):''};
}

// Row metadata survives Sheet sorting; identity is rechecked before every write.
function rowUpdate_(table,idField,id,namespace,fields,parentId) {
  var fresh=table_(table.sheet.getName()), rows=sheetObjects_(fresh).filter(function(r){return r[idField]===id;});
  if(rows.length!==1||(parentId&&rows[0]['Organization Record ID']!==parentId))throw new Error('A linked Sheet row is missing or ambiguous. Reload before saving.');
  var lookup={metadataKey:namespace,metadataValue:hash_(id),locationType:'ROW',visibility:'DOCUMENT'};
  var found=sheets_('post','/developerMetadata:search',{dataFilters:[{developerMetadataLookup:lookup}]}).matchedDeveloperMetadata||[];
  if(found.length>1)throw new Error('Duplicate row identity metadata. Resolve before saving.');
  if(!found.length) {
    var created=sheets_('post',':batchUpdate',{requests:[{createDeveloperMetadata:{developerMetadata:{metadataKey:namespace,metadataValue:hash_(id),visibility:'DOCUMENT',location:{dimensionRange:{sheetId:fresh.sheet.getSheetId(),dimension:'ROWS',startIndex:rows[0]._row,endIndex:rows[0]._row+1}}}}}]});
    found=[{developerMetadata:created.replies[0].createDeveloperMetadata.developerMetadata}];
  }
  var filter={developerMetadataLookup:{metadataId:found[0].developerMetadata.metadataId}}, response=sheets_('post','/values:batchGetByDataFilter',{dataFilters:[filter],valueRenderOption:'UNFORMATTED_VALUE'}), matched=response.valueRanges||[], values=matched.length===1?matched[0].valueRange.values:[];
  if(!values||values.length!==1||String(values[0][fresh.headers.indexOf(idField)])!==id||(parentId&&String(values[0][fresh.headers.indexOf('Organization Record ID')])!==parentId))throw new Error('A row moved during identity setup. Reload before saving.');
  return {dataFilter:filter,majorDimension:'ROWS',values:[fresh.headers.map(function(h){return Object.prototype.hasOwnProperty.call(fields,h)?String(fields[h]==null?'':fields[h]):null;})]};
}

function writeOrganizationLocations_(draft,current,fields) {
  var o=draft.data, before=current.records.find(function(r){return r.recordId===draft.recordId;}), table=ensureLocationTable_(), existing=locationRows_().filter(function(l){return l.recordId===draft.recordId;});
  if(existing.some(function(l){return !o.locations.some(function(n){return n.id===l.data.id;});}))throw new Error('Close an existing location instead of deleting its history.');
  var raw=sheetObjects_(table);
  o.locations.forEach(function(l){
    var found=raw.filter(function(r){return r['Location ID']===l.id;});
    if(found.length>1||found.some(function(r){return r['Organization Record ID']!==draft.recordId||r['Organization Public ID']!==draft.publicId;}))throw new Error('A Location ID already belongs to another organization.');
    if(!found.length)append_(table,table.headers.map(function(h){return h==='Location ID'?l.id:h==='Organization Record ID'?draft.recordId:h==='Organization Public ID'?draft.publicId:'';}));
  });
  if(!before&&!sheetObjects_(table_(ADMIN_TAB_)).some(function(r){return r['Record ID']===draft.recordId;}))append_(current.table,current.table.headers.map(function(h){return h==='Record ID'?draft.recordId:h==='Public ID'?draft.publicId:'';}));
  var updates=[rowUpdate_(current.table,'Record ID',draft.recordId,'grainListRecord',fields)];
  o.locations.forEach(function(l){updates.push(rowUpdate_(table,'Location ID',l.id,'grainListLocation',locationFields_(l,draft),draft.recordId));});
  var fresh=readRecords_(null,draft.recordId).records[0];
  if((fresh?fresh.revision:'')!==draft.baseRevision)throw new Error('The Sheet changed before save. Reload this draft.');
  // All public field values commit together. Unfinished identity placeholders have no name.
  sheets_('post','/values:batchUpdateByDataFilter',{valueInputOption:'RAW',data:updates});
}
