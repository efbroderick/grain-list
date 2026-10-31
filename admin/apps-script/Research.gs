/* Direct-site research only. No search provider, LLM, or publishing calls. */
var GrainAdminResearch=(function(){
  function decode(s){return String(s||'').replace(/&#(x[0-9a-f]+|\d+);/gi,function(_,n){return String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):parseInt(n,10));}).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');}
  function pageText(html){return decode(String(html).replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();}
  function host(url){var m=String(url).match(/^https:\/\/([a-z0-9.-]+)(\/[^\s]*)?$/i);if(!m||m[1].length>253||!m[1].includes('.')||/(?:^|\.)(?:localhost|local|internal|test|invalid)$|^\d+(?:\.\d+){3}$|\.\./i.test(m[1]))throw new Error('Research needs a public HTTPS website without a port or login.');return m[1].toLowerCase();}
  function sameSite(a,b){return host(a).replace(/^www\./,'')===host(b).replace(/^www\./,'');}
  function resolve(base,href){if(/^https:\/\//i.test(href))return href.split('#')[0];if(/^\/\//.test(href))return 'https:'+href.split('#')[0];if(href[0]==='/')return 'https://'+host(base)+href.split('#')[0];if(!/^[a-z]+:/i.test(href))return base.replace(/[?#].*$/,'').replace(/[^/]*$/,'')+href.split('#')[0];return '';}
  function findings(html,url,name){
    var result=[], text=pageText(html), brand=GrainAdminDomain.key(name), nodes=[];
    function add(field,value,evidence){if(!value||!evidence)return;if(!result.some(function(f){return f.field===field&&JSON.stringify(f.value)===JSON.stringify(value);}))result.push({field:field,value:value,source:url,evidence:evidence.slice(0,1200)});}
    var scripts=String(html).match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi)||[];
    function visit(v){if(Array.isArray(v))return v.forEach(visit);if(!v||typeof v!=='object')return;nodes.push(v);Object.keys(v).forEach(function(k){if(v[k]&&typeof v[k]==='object')visit(v[k]);});}
    scripts.forEach(function(s){try{visit(JSON.parse(s.replace(/^<script[^>]*>/i,'').replace(/<\/script>$/i,'')));}catch(_){}});
    nodes.forEach(function(n){
      var types=Array.isArray(n['@type'])?n['@type']:[n['@type']], identity=GrainAdminDomain.key(n.name||'');
      if(!types.some(function(t){return /^(?:Organization|LocalBusiness|Bakery|Restaurant|Store|GroceryStore|FoodEstablishment|Farm|Distillery|Brewery)$/.test(t||'');})||!brand||!(identity===brand||identity.indexOf(brand+' ')===0))return;
      var addresses=Array.isArray(n.address)?n.address:[n.address];
      addresses.forEach(function(a){if(!a||typeof a!=='object'||!a.streetAddress||!a.addressLocality||GrainAdminDomain.states.indexOf(a.addressRegion)<0)return;
        var address=[a.streetAddress,a.addressLocality,a.addressRegion+(a.postalCode?' '+a.postalCode:'')].join(', ');
        add('locations',{name:n.name===name?a.addressLocality:String(n.name),type:'Other',address:address,city:a.addressLocality,state:a.addressRegion,phone:n.telephone||'',email:n.email||'',url:sameSafeUrl(n.url,url)},JSON.stringify({name:n.name,address:a,telephone:n.telephone||'',email:n.email||''}));
      });
    });
    var ownedHtml=String(html).split(/<h[1-6]\b[^>]*>\s*(?:<[^>]+>\s*)*(?:find\s+)?(?:partner locations|stockists|retail partners|where to buy|our retailers)/i)[0];
    if(/<h[1-6]\b[^>]*>[\s\S]{0,100}?(?:our locations|locations|come visit us|visit us)[\s\S]{0,100}?<\/h[1-6]>/i.test(ownedHtml)) {
      var anchors=ownedHtml.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
      for(var link of anchors) {
        if(!/^https:\/\/(?:www\.)?(?:google\.com\/maps|maps\.google\.com|maps\.apple\.com)/i.test(decode(link[1])))continue;
        var label=pageText(link[2]),match=label.match(/^(.+?\b(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Lane|Ln\.?|Highway|Hwy\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Court|Ct\.?|Way|Place|Pl\.?|Parkway|Pkwy\.?))(?:\s*,?\s*((?:#|Suite\s|Ste\s)\S+))?\s*,?\s+(.+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
        if(!match||!/^\d/.test(label)||GrainAdminDomain.states.indexOf(match[4].toUpperCase())<0)continue;
        var city=match[3].replace(/,$/,'').trim(),location=null,coordinates=decode(link[1]).match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
        if(coordinates&&Math.abs(Number(coordinates[1]))<=90&&Math.abs(Number(coordinates[2]))<=180)location={lat:Number(coordinates[1]),lng:Number(coordinates[2]),precision:'organization'};
        add('locations',{name:city,type:'Other',address:label,city:city,state:match[4].toUpperCase(),phone:'',email:'',url:'',location:location},label+' | '+decode(link[1]));
      }
    }
    function sameSafeUrl(v,base){try{return v&&sameSite(v,base)?v:'';}catch(_){return '';}}
    var emailPattern=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, email;
    while((email=emailPattern.exec(text))&&result.length<60){if(!/(?:example\.|sentry\.|wixpress\.|domain\.|yourname|^test@)/i.test(email[0]))add('email',email[0],text.slice(Math.max(0,email.index-60),email.index+email[0].length+60));}
    var phonePattern=/(?:\+1[ .-]?)?\(?\b(\d{3})\)?[ .-](\d{3})[ .-](\d{4})\b/g,phone;
    while((phone=phonePattern.exec(text))&&result.length<60){if(!/^(000|111|123)/.test(phone[1]))add('phone',phone[1]+'-'+phone[2]+'-'+phone[3],text.slice(Math.max(0,phone.index-60),phone.index+phone[0].length+60));}
    // The approved grain vocabulary is shared with the original research/import work.
    var grainNames=Array.from(new Set(Object.keys(GrainAdminDomain.taxonomy.grain_aliases).map(function(k){return GrainAdminDomain.taxonomy.grain_aliases[k];}))).sort(function(a,b){return b.length-a.length;});
    var claimed=[];
    grainNames.forEach(function(g){var escaped=g.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),m=new RegExp('\\b'+escaped+'\\b','i').exec(text);if(!m||claimed.some(function(c){return c.start<=m.index&&c.end>=m.index+m[0].length;}))return;var evidence=text.slice(Math.max(0,m.index-100),m.index+m[0].length+140);if(!/\b(?:our|offer|sell|grown|grow|milled|flour|bread|menu|ingredient|product|grain|wheat|rye|corn)\b/i.test(evidence))return;claimed.push({start:m.index,end:m.index+m[0].length});add('grains',g,evidence);});
    var sentences=text.match(/[^.!?]+(?:[.!?]|$)/g)||[];
    sentences.forEach(function(s){
      if(/\b(?:allerg(?:en|y|ies)|may contain|free from|gluten.free|not grown|do not grow)\b/i.test(s))return;
      if(/\b(?:we grow|our farm grows|our own)\b/i.test(s)&&/\b(?:wheat|rye|barley|oats?|corn|popcorn|millet|sorghum|quinoa)\b/i.test(s))add('functions','Grain Grower',s.trim());
      if(/\b(?:we mill|our mill processes|we process)\b/i.test(s)&&/\b(?:grain|wheat|rye|barley|oats?|corn|flour)\b/i.test(s))add('functions','Grain Processor',s.trim());
      if(/\b(?:order|buy|bakery counter|visit our bakery)\b/i.test(s)&&/\b(?:bread|croissants?|pastries|sourdough loaves)\b/i.test(s))add('functions','Retail Baked Goods',s.trim());
      if(/\b(?:menu|served|dish|dishes)\b/i.test(s)&&/\b(?:quinoa|rice|bread|pasta|polenta|barley|farro)\b/i.test(s))add('functions','Grain Featured on Menu',s.trim());
    });
    return result.slice(0,60);
  }
  return {host:host,sameSite:sameSite,resolve:resolve,text:pageText,findings:findings};
})();

function researchAdminOrganization(input) {
  owner_();input=input||{};var name=GrainAdminDomain.text(input.name,500),url=GrainAdminDomain.text(input.url,2000),pages=input.pages||[],pasted=GrainAdminDomain.text(input.text,40000);
  if(!name||!Array.isArray(pages)||pages.length>4)throw new Error('Enter the organization name and up to four additional website pages.');
  GrainAdminResearch.host(url);url=url.replace(/^(https:\/\/[^/]+)$/,'$1/');pages.forEach(function(p){if(!GrainAdminResearch.sameSite(url,p))throw new Error('Additional pages must be on the official website.');});
  var queue=[url].concat(pages),seen={},findings=[],attempts=[],started=Date.now(),dns={};
  function publicAddress(ip){if(ip.indexOf(':')>=0)return !/^(?:::|::1$|f[cd]|fe[89ab]|::ffff:)/i.test(ip);var n=ip.split('.').map(Number);return n.length===4&&n.every(function(x){return x>=0&&x<=255;})&&n[0]!==0&&n[0]!==10&&n[0]!==127&&n[0]<224&&!(n[0]===169&&n[1]===254)&&!(n[0]===172&&n[1]>=16&&n[1]<=31)&&!(n[0]===192&&n[1]===168)&&!(n[0]===100&&n[1]>=64&&n[1]<=127);}
  function checkHost(target){var host=GrainAdminResearch.host(target);if(dns[host])return;var response=UrlFetchApp.fetch('https://dns.google/resolve?name='+encodeURIComponent(host)+'&type=A',{muteHttpExceptions:true});if(response.getResponseCode()!==200)throw new Error('Could not validate the website hostname.');var answer=JSON.parse(response.getContentText()).Answer||[],ips=answer.filter(function(a){return a.type===1;}).map(function(a){return a.data;});if(!ips.length||ips.some(function(ip){return !publicAddress(ip);}))throw new Error('The website did not resolve to a public address.');dns[host]=true;}
  while(queue.length&&attempts.length<5&&Date.now()-started<60000){
    var target=queue.shift();if(seen[target])continue;seen[target]=true;
    try {
      checkHost(target);var response,redirects=0;
      while(true){response=UrlFetchApp.fetch(target,{muteHttpExceptions:true,followRedirects:false,validateHttpsCertificates:true});var status=response.getResponseCode();if(status<300||status>=400)break;if(++redirects>3)throw new Error('Too many website redirects.');var headers=response.getAllHeaders(),next=GrainAdminResearch.resolve(target,headers.Location||headers.location||'');if(!next||!GrainAdminResearch.sameSite(url,next))throw new Error('The website redirects to another domain; check its identity first.');checkHost(next);target=next;}
      attempts.push({url:target,status:status});if(status!==200)continue;
      var contentType=String(response.getAllHeaders()['Content-Type']||response.getAllHeaders()['content-type']||'');if(contentType&&!/text\/html|application\/xhtml/i.test(contentType))continue;
      var html=response.getContentText();if(html.length>1500000)throw new Error('Page too large for this research pass.');
      findings=findings.concat(GrainAdminResearch.findings(html,target,name));
      if(attempts.length===1&&!pages.length){var links=html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi);for(var item of links){var link=GrainAdminResearch.resolve(target,item[1]);try{if(link&&GrainAdminResearch.sameSite(url,link)&&/\/(?:locations?|visit|contact|about|products)(?:[\/?#-]|$)/i.test(link)&&queue.indexOf(link)<0&&!seen[link])queue.push(link);}catch(_){}}}
    }catch(error){attempts.push({url:target,error:error.message});}
  }
  if(pasted)findings=findings.concat(GrainAdminResearch.findings(pasted,url,name));
  var unique={};findings=findings.filter(function(f){var key=f.field+'|'+JSON.stringify(f.value);if(unique[key])return false;unique[key]=true;return true;}).slice(0,80);
  return {findings:findings,attempts:attempts,method:'Direct website; no paid APIs',researchedAt:new Date().toISOString()};
}
