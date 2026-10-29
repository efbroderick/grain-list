/* Shared validation runs both in the private admin and in publication tests. */
var GrainAdminDomain = (function () {
  var states = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
  var extraHeaders = ['Public ID', 'City', 'Latitude', 'Longitude', 'Location Precision', 'Map Fingerprint', 'Status', 'Operational Status'];
  var fields = { name:'Name', category:'Category', state:'State', functions:'Function', grains:'Grains', address:'Address', phone:'Phone', email:'Email', url:'URL', sources:'Source', operationalStatus:'Operational Status', city:'City' };
  function text(v, max) {
    var s = String(v == null ? '' : v).trim();
    if (s.length > (max || 500) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) throw new Error('A field is too long or contains invalid characters.');
    return s;
  }
  function key(v) { return text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
  function list(v) { return Array.from(new Set((Array.isArray(v) ? v : String(v || '').split(/[,;\n]/)).map(function(s){return text(s,200);}).filter(Boolean))); }
  function web(v) { return /^https?:\/\/[^\s/@]+(?:\.[^\s/@]+|localhost)(?::\d+)?(?:[/?#][^\s]*)?$/i.test(v) && !/^https?:\/\/[^/]*@/i.test(v); }
  function identity(o) { return key(o.name) + '|' + o.state; }
  function addressKey(v) {var aliases={st:'street',rd:'road',ln:'lane',hwy:'highway',blvd:'boulevard',ave:'avenue',av:'avenue',dr:'drive',ct:'court',cir:'circle',pkwy:'parkway',pl:'place',ter:'terrace',terr:'terrace',trl:'trail',rte:'route',tpke:'turnpike',expy:'expressway',fwy:'freeway'};return key(v).replace(/\b(st|rd|ln|hwy|blvd|ave|av|dr|ct|cir|pkwy|pl|ter|terr|trl|rte|tpke|expy|fwy)\b/g,function(s){return aliases[s];});}
  function mapKey(o) { return JSON.stringify([addressKey(o.address),o.state,o.location && o.location.precision === 'organization' ? key(o.name) : '']); }
  function publicId(raw, hash) { return /^grain-[a-f0-9]{16}$/.test(String(raw)) ? String(raw) : 'grain-' + hash(String(raw)).slice(0,16); }
  function normalize(input, allowed, allowIncomplete) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid organization.');
    var o = {};
    ['name','category','state','address','phone','email','url','city'].forEach(function(k){o[k]=text(input[k], k==='url'?2000:500);});
    o.state = o.state.toUpperCase();
    o.functions = list(input.functions).sort(function(a,b){return a.toLowerCase().localeCompare(b.toLowerCase());});
    o.grains = list(input.grains);
    o.sources = Array.from(new Set((Array.isArray(input.sources) ? input.sources : String(input.sources || '').split(/[;\n]/)).map(function(s){return text(s,2000);}).filter(Boolean)));
    if (o.functions.length>30 || o.grains.length>150 || o.sources.length>30) throw new Error('Too many functions, grains, or sources.');
    if (!o.name || ((!allowIncomplete || o.state) && states.indexOf(o.state)<0)) throw new Error('Name and a supported US state are required.');
    if ((!allowIncomplete && !o.functions.length && input.operationalStatus!=='Closed') || o.functions.some(function(f){return allowed.indexOf(f)<0;})) throw new Error('Choose supported Function values.');
    if (o.grains.some(function(g){return ['chickpea','chickpeas','garbanzo','garbanzo beans','lentil','lentils','soybean','soybeans','whole wheat','gluten free','gluten-free'].indexOf(g.toLowerCase())>=0;})) throw new Error('Grains must contain grain names, not legumes or product descriptions.');
    if (o.url && !web(o.url)) throw new Error('Use an http or https website URL.');
    if ((!allowIncomplete && !o.sources.length) || o.sources.some(function(s){return !web(s);})) throw new Error('Include valid supporting source URLs.');
    if (o.phone) {
      var digits=o.phone.replace(/\D/g,''); if(digits.length===11 && digits[0]==='1')digits=digits.slice(1);
      if(digits.length!==10)throw new Error('Enter a ten-digit phone number.');
      o.phone=digits.slice(0,3)+'-'+digits.slice(3,6)+'-'+digits.slice(6);
    }
    if (o.email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email) || /(?:example\.com|^test@|^email@|yourname@|name@domain)/i.test(o.email))) throw new Error('Check the email address.');
    var addressState=o.address.match(/(?:,|\s)([A-Z]{2})\s*(?:\d{5}(?:-\d{4})?)?\s*$/);
    if(addressState && states.indexOf(addressState[1])>=0 && addressState[1]!==o.state)throw new Error('The address and State column disagree.');
    o.operationalStatus=input.operationalStatus==='Closed'?'Closed':'Active';
    o.location=null;
    if(input.location) {
      var lat=input.location.lat,lng=input.location.lng,precision=input.location.precision;
      if(typeof lat!=='number'||typeof lng!=='number'||!isFinite(lat)||!isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||['address','organization','place','state'].indexOf(precision)<0)throw new Error('Check the map coordinates and precision.');
      o.location={lat:lat,lng:lng,precision:precision};
      if(!allowIncomplete && precision==='address' && !o.address)throw new Error('An address-level map point needs an address. Otherwise choose city or region precision.');
    }
    o.locationChecked=input.locationChecked===true;
    if(JSON.stringify(o).length>20000)throw new Error('The record is too large. Use concise grain names and source URLs.');
    return o;
  }
  function revision(o, hash) {
    var values={}; Object.keys(fields).forEach(function(k){values[k]=o[k] || (['functions','grains','sources'].indexOf(k)>=0?[]:'');});
    values.location=o.location || null;
    return hash(JSON.stringify(values));
  }
  function changed(before, after) {
    return Object.keys(fields).concat(['location']).filter(function(k){return JSON.stringify(before && before[k])!==JSON.stringify(after[k]);});
  }
  function cleared(before, after) {
    return before ? Object.keys(fields).filter(function(k){var b=before[k],a=after[k];return (Array.isArray(b)?b.length:!!b) && !(Array.isArray(a)?a.length:!!a);}) : [];
  }
  function assertPublish(o, records, id) {
    if(o.operationalStatus==='Active' && (!o.location || !o.locationChecked))throw new Error('Confirm the map location before publishing.');
    if(records.some(function(r){return r.recordId!==id && r.operationalStatus!=='Closed' && identity(r)===identity(o);}))throw new Error('Another organization with this name and state already exists.');
  }
  function toPublic(o, id, status) {
    if(status && (typeof status!=='string' || status.length>80))throw new Error('Invalid publication status.');
    return {id:id,name:o.name,category:o.category,state:o.state,city:o.city,functions:o.functions,grains:o.grains,address:o.address,phone:o.phone,email:o.email,url:o.url,status:status||'Partial',sources:o.sources,location:o.location};
  }
  return {states:states,extraHeaders:extraHeaders,fields:fields,text:text,key:key,list:list,web:web,identity:identity,mapKey:mapKey,publicId:publicId,normalize:normalize,revision:revision,changed:changed,cleared:cleared,assertPublish:assertPublish,toPublic:toPublic};
})();
if (typeof module !== 'undefined') module.exports=GrainAdminDomain;
